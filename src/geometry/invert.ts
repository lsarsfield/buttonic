import type { HatchLayer, Layer } from '../model/types'
import { clearancesAbove, clipCompiled, maxClearance, MIN_PIECE_MM } from './clip'
import { compileCtxKey, compileLayer, type CompileCtx } from './compile'
import { expandInstanced } from './expand'
import { castsRegion, haloOf, isMaskLayer, isSubtractLayer, layerKeepoutRegion, outlineOf, outlineShapes } from './keepout'
import { buildKeepoutRegion, keepoutTolerances, shapeToRegion } from './keepoutRegion'
import { holdsDisc } from './strokePieces'
import { segsControlBox, parsePathData } from './pathData'
import {
  mpBounds,
  rotateMultiPolygon,
  safeDifference,
  safeUnion,
  type Bounds,
  type MultiPolygon,
  type Ring,
} from './poly'
import type { Shape } from './shapes'

/**
 * Cut-out text over bare metal — the "invert" half of a knockout.
 *
 * A cut-out layer subtracts its letters from the engraving beneath it; where
 * a letter overhangs BARE metal there is nothing to subtract from, so it would
 * vanish. With `invertOverBare` the letter is engraved there instead:
 *
 *   engraving' = (beneath ∖ K) ∪ (T ∖ coverage)
 *
 * K is the layer's knockout region (the letters, grown by any halo), T the
 * bare letter outlines, and `coverage` the area already engraved beneath —
 * the classic stamp reversal: the word reads in full, knocked out where it
 * crosses engraving and engraved where it crosses bare metal.
 *
 * Coverage is the ACTUAL engraved geometry of every layer below (strokes as
 * their stroked outline, after disc moats and intervening halos/knockouts),
 * with one deliberate exception: a hatch counts as its whole band. Hatching
 * is a tone, not individual marks — literal XOR would engrave the gaps between
 * ticks inside each letter (stripes at the inverse duty cycle, barely
 * distinguishable from the field), while the band reading gives clean
 * knocked-out letters inside the hatch and engraved letters outside it.
 *
 * The result is a filled region in the layer's own pre-phase frame; it is
 * emitted as this layer's geometry and clipped by keepouts above like any
 * other engraving. Pure kernel code: region lookups are injected so the canvas
 * can feed stale-while-recomputing regions and the exporter exact ones.
 */

export type RegionOf = (layer: Layer) => MultiPolygon | null

/** Does this layer engrave its letters where they cross bare metal? */
export function invertsBare(l: Layer): boolean {
  return (l.type === 'ringText' || l.type === 'center') && l.booleanRole === 'subtract' && l.invertOverBare
}

/** Pieces nowhere this thick (mm) are boundary slivers, not features — the minimum surviving piece. */
const MIN_PIECE_WIDTH_MM = MIN_PIECE_MM

// ---------------------------------------------------------------------------

interface CacheEntry {
  key: string
  deps: (MultiPolygon | null)[]
  result: MultiPolygon
}
const cache = new Map<string, CacheEntry>()

/** Drop cache entries for layers that no longer exist. */
export function pruneInvertCache(validIds: ReadonlySet<string>): void {
  for (const k of cache.keys()) if (!validIds.has(k.slice(0, k.indexOf('|')))) cache.delete(k)
}

/**
 * The engraved-over-bare region of cut-out layer `index`, in its pre-phase
 * frame ([] when nothing overhangs bare metal). Memoized on the content of
 * every layer up to and including it plus the identity of the keepout regions
 * it consumed, so a stale→exact region landing recomputes it exactly once.
 */
export function bareInvertRegion(
  layers: Layer[],
  index: number,
  ctx: CompileCtx,
  regionOf: RegionOf,
  /** a halo 'outline' layer's engraved ring (default: the exact sync one) */
  outlineFor: RegionOf = (l) => layerKeepoutRegion(l, ctx).outline,
): MultiPolygon {
  const layer = layers[index]!
  const discs = clearancesAbove(layers, index).map((d) => d.rMM)
  const key =
    compileCtxKey(ctx) +
    '|' +
    JSON.stringify(discs) +
    '|' +
    JSON.stringify(layers.slice(0, index + 1).map((l) => ({ ...l, name: '' })))
  const deps: (MultiPolygon | null)[] = []
  for (let j = 0; j <= index; j++) {
    const l = layers[j]!
    if (l.visible && castsRegion(l)) deps.push(regionOf(l), outlineOf(l) > 0 ? outlineFor(l) : null)
  }
  // one slot per layer AND tolerance, so an export never evicts the canvas entry
  const slot = layer.id + '|' + ctx.toleranceMM
  const hit = cache.get(slot)
  if (hit && hit.key === key && hit.deps.length === deps.length && hit.deps.every((d, i) => d === deps[i])) {
    return hit.result
  }
  const result = computeInvert(layers, index, ctx, regionOf, outlineFor)
  cache.set(slot, { key, deps, result })
  return result
}

function computeInvert(layers: Layer[], index: number, ctx: CompileCtx, regionOf: RegionOf, outlineFor: RegionOf): MultiPolygon {
  const layer = layers[index]!
  const tol = ctx.toleranceMM
  // T: the bare letters. Without a halo the knockout region IS the letters
  // (same flattening → the knockout and the engraved overhang share vertices).
  let T: MultiPolygon | null
  if (haloOf(layer) === 0) T = regionOf(layer)
  else {
    const { srcTol, arcTol } = keepoutTolerances(0, tol)
    T = buildKeepoutRegion(compileLayer(layer, ctx).shapes, 0, srcTol, arcTol).region
  }
  if (!T || T.length === 0) return []
  const tAbs = rotateMultiPolygon(T, layer.phaseDeg)
  const tBox = mpBounds(tAbs)
  if (!tBox) return []

  let cov: MultiPolygon = []
  for (let j = 0; j < index; j++) {
    const lj = layers[j]!
    if (!lj.visible) continue

    // a halo or knockout at j re-exposes bare metal in everything beneath it
    // (a mask's region is its complement: everything outside the window is bare)
    if (castsRegion(lj) && cov.length > 0) {
      const K = regionOf(lj)
      if (K && K.length > 0) {
        const kAbs = rotateMultiPolygon(K, lj.phaseDeg)
        const kBox = mpBounds(kAbs)
        if (kBox && boxesOverlap(kBox, tBox)) cov = safeDifference(cov, kAbs) ?? cov
      }
    }

    const add: MultiPolygon[] = []
    if (isSubtractLayer(lj) || isMaskLayer(lj)) {
      // a cut-out below only engraves its own inverted overhang; a mask engraves nothing
      if (invertsBare(lj)) {
        const inv = bareInvertRegion(layers, j, ctx, regionOf, outlineFor)
        if (inv.length > 0) add.push(rotateMultiPolygon(inv, lj.phaseDeg))
      }
    } else if (lj.type === 'hatch') {
      const band = hatchBand(lj, maxClearance(clearancesAbove(layers, j)), tol)
      if (band.length > 0) add.push(band)
    } else {
      const localBox = rotateBox(tBox, -lj.phaseDeg)
      for (const shape of engravedShapes(layers, j, ctx, outlineFor)) {
        for (const flat of shape.kind === 'instanced' ? expandInstanced(shape) : [shape]) {
          if (!shapeMayOverlap(flat, localBox)) continue
          const r = shapeToRegion(flat, tol, tol)
          if (r.length > 0) add.push(rotateMultiPolygon(r, lj.phaseDeg))
        }
      }
    }
    if (add.length > 0) cov = safeUnion(cov, ...add) ?? cov
  }

  const bare = cov.length === 0 ? tAbs : safeDifference(tAbs, cov)
  if (!bare) return []
  return rotateMultiPolygon(dropSlivers(bare), -layer.phaseDeg)
}

/** A draw layer's engraved shapes as they end up (disc moats applied; halo outline included). */
function engravedShapes(layers: Layer[], j: number, ctx: CompileCtx, outlineFor: RegionOf): Shape[] {
  const lj = layers[j]!
  const discs = clearancesAbove(layers, j)
  const compiled = compileLayer(lj, ctx)
  const own = outlineOf(lj) > 0 ? outlineShapes(outlineFor(lj)) : []
  const all = own.length > 0 ? { shapes: [...compiled.shapes, ...own], warnings: [] } : compiled
  return discs.length > 0 ? clipCompiled(all, { discs, regions: [] }, ctx.toleranceMM).shapes : all.shapes
}

// ---------------------------------------------------------------------------
// hatch band
// ---------------------------------------------------------------------------

/** Vertex count for an arc of `sweepRad` at radius r within chord tolerance tol. */
function arcSteps(r: number, sweepRad: number, tol: number): number {
  if (r <= 0) return 1
  const maxStep = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / r)))
  return Math.max(2, Math.ceil(Math.abs(sweepRad) / Math.max(maxStep, 1e-4)))
}

/** Points along an origin-centred arc, 0° at 12 o'clock, clockwise (y-down). */
function arcPts(r: number, a0Deg: number, a1Deg: number, tol: number): Ring {
  const a0 = (a0Deg * Math.PI) / 180
  const a1 = (a1Deg * Math.PI) / 180
  const n = arcSteps(r, a1 - a0, tol)
  const pts: Ring = []
  for (let k = 0; k <= n; k++) {
    const a = a0 + ((a1 - a0) * k) / n
    pts.push([r * Math.sin(a), -r * Math.cos(a)])
  }
  return pts
}

/**
 * The band a hatch layer tones, in the absolute frame: the annulus between
 * its radii (inner edge pushed out by any centre moat, which trims stroked
 * ticks), restricted to each arc block — first tick to last, padded by half a
 * stroke, twisted like the ticks — or the full annulus when blocks close the
 * circle.
 */
export function hatchBand(layer: HatchLayer, moatMM: number, tol: number): MultiPolygon {
  const rI0 = Math.min(layer.rInnerMM, layer.rOuterMM)
  const rOut = Math.max(layer.rInnerMM, layer.rOuterMM)
  const rIn = layer.cap === 'point' ? rI0 : Math.max(rI0, moatMM)
  if (rOut - rIn <= 1e-6) return []
  const count = Math.max(1, Math.round(layer.count))
  const repeats = Math.max(1, Math.round(layer.repeats))
  const sweep = Math.max(0.01, Math.min(360, layer.sweepDeg))
  const pitch = sweep / count
  if (repeats * sweep >= 360 - 1e-6) {
    const outer = arcPts(rOut, 0, 360, tol).slice(0, -1)
    if (rIn <= 1e-6) return [[outer]]
    const inner = arcPts(rIn, 0, 360, tol).slice(0, -1).reverse()
    return [[outer, inner]]
  }
  // twist at the (possibly moat-raised) inner edge, interpolated along the tick
  const tw = layer.twistDeg
  const twIn = rOut > rI0 ? (tw * (rIn - rI0)) / (rOut - rI0) : 0
  const pad = (r: number) => (r > 0 ? (((layer.strokeMM / 2) / r) * 180) / Math.PI : 0)
  const out: MultiPolygon = []
  for (let b = 0; b < repeats; b++) {
    const a0 = layer.phaseDeg + (b * 360) / repeats
    const a1 = a0 + (count - 1) * pitch
    const ring: Ring = [
      ...arcPts(rOut, a0 + tw - pad(rOut), a1 + tw + pad(rOut), tol),
      ...(rIn > 1e-6 ? arcPts(rIn, a1 + twIn + pad(rIn), a0 + twIn - pad(rIn), tol) : [[0, 0] as [number, number]]),
    ]
    out.push([ring])
  }
  return out.length > 1 ? (safeUnion(...out) ?? out) : out
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const boxesOverlap = (a: Bounds, b: Bounds, pad = 0.05): boolean =>
  a.minX <= b.maxX + pad && a.maxX >= b.minX - pad && a.minY <= b.maxY + pad && a.maxY >= b.minY - pad

/** Axis-aligned box enclosing `box` rotated by deg about the origin. */
function rotateBox(box: Bounds, deg: number): Bounds {
  const r = rotateMultiPolygon(
    [[[[box.minX, box.minY], [box.maxX, box.minY], [box.maxX, box.maxY], [box.minX, box.maxY]]]],
    deg,
  )
  return mpBounds(r)!
}

/** Conservative overlap test (control boxes padded by the stroke). */
function shapeMayOverlap(shape: Shape, box: Bounds): boolean {
  const w = (shape.paint.stroke?.widthMM ?? 0) / 2
  switch (shape.kind) {
    case 'line':
      return boxesOverlap(
        {
          minX: Math.min(shape.x1, shape.x2) - w,
          minY: Math.min(shape.y1, shape.y2) - w,
          maxX: Math.max(shape.x1, shape.x2) + w,
          maxY: Math.max(shape.y1, shape.y2) + w,
        },
        box,
      )
    case 'circle': {
      // annulus [r−w, r+w] vs box: nearest/farthest box distances from the origin
      const nx = Math.max(box.minX, Math.min(0, box.maxX))
      const ny = Math.max(box.minY, Math.min(0, box.maxY))
      const near = Math.hypot(nx, ny)
      const far = Math.max(
        Math.hypot(box.minX, box.minY),
        Math.hypot(box.maxX, box.minY),
        Math.hypot(box.minX, box.maxY),
        Math.hypot(box.maxX, box.maxY),
      )
      return shape.rMM + w >= near - 0.05 && shape.rMM - w <= far + 0.05
    }
    case 'path': {
      const c = segsControlBox(parsePathData(shape.d))
      if (!c) return false
      return boxesOverlap({ minX: c.x - w, minY: c.y - w, maxX: c.x + c.w + w, maxY: c.y + c.h + w }, box)
    }
    case 'instanced':
      return true
  }
}

/** Remove boundary slivers: pieces nowhere as thick as the minimum surviving piece. */
function dropSlivers(mp: MultiPolygon): MultiPolygon {
  return mp.filter(
    (poly) => poly[0] && poly[0].length >= 3 && holdsDisc(poly.map((r) => r.map(([x, y]) => ({ x, y }))), MIN_PIECE_WIDTH_MM / 2),
  )
}
