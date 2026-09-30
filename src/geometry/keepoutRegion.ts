import type { Layer } from '../model/types'
import { expandInstanced } from './expand'
import { flattenSegs, type SubPath } from './flatten'
import { parsePathData } from './pathData'
import {
  dilateMultiPolygon,
  dilatePolylines,
  pathToMultiPolygon,
  ringsToMultiPolygonEvenodd,
  safeDifference,
  safeUnion,
  type MultiPolygon,
  type Ring,
} from './poly'
import type { Paint, Shape } from './shapes'
import { strokePieces } from './strokePieces'

/**
 * Pure region building from ALREADY-COMPILED shapes — split out of keepout.ts
 * so the Web Worker that runs the expensive dilation off the UI thread imports
 * only the polygon kernel (no compile.ts → no opentype.js in the worker
 * bundle). keepout.ts composes compileLayer + this for the sync path.
 */

function circleRing(rMM: number, n: number): Ring {
  const ring: Ring = []
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n
    ring.push([rMM * Math.cos(a), rMM * Math.sin(a)])
  }
  return ring
}

/**
 * A stroke's painted area with SVG cap/join semantics. Round cap + round join
 * is exactly a disc sweep; anything else (butt/square caps, miter/bevel joins)
 * is the union of the stroke's convex pieces — a butt-capped cut-out must not
 * knock out a rounded end it doesn't have.
 */
function strokeRegion(subs: SubPath[], stroke: Paint['stroke'], arcTol: number): MultiPolygon {
  const w = Math.max(stroke?.widthMM ?? 0.1, 2e-4)
  const cap = stroke?.cap ?? 'butt'
  const join = stroke?.join ?? 'miter'
  if (cap === 'round' && join === 'round') return dilatePolylines(subs, w / 2, arcTol)
  const pieces: MultiPolygon[] = strokePieces(subs, w, cap, join, arcTol).map((P) => [[P.map((q) => [q.x, q.y] as [number, number])]])
  // union in batches: one giant martinez call on thousands of thin quads is its worst case
  let acc: MultiPolygon[] = pieces
  while (acc.length > 1) {
    const next: MultiPolygon[] = []
    for (let i = 0; i < acc.length; i += 32) {
      const u = safeUnion(...acc.slice(i, i + 32))
      if (u === null) return dilatePolylines(subs, w / 2, arcTol) // never lose the region — round is a superset
      next.push(u)
    }
    acc = next
  }
  return acc[0] ?? []
}

/** One compiled Shape → its filled polygon region. */
export function shapeToRegion(shape: Shape, srcTol: number, arcTol: number): MultiPolygon {
  switch (shape.kind) {
    case 'path':
      if (shape.paint.fill) return pathToMultiPolygon(shape.d, shape.fillRule ?? 'nonzero', srcTol)
      return strokeRegion(flattenSegs(parsePathData(shape.d), srcTol), shape.paint.stroke, arcTol)
    case 'line':
      return strokeRegion(
        [{ pts: [{ x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }], closed: false }],
        shape.paint.stroke,
        arcTol,
      )
    case 'instanced': {
      const acc: MultiPolygon[] = []
      for (const flat of expandInstanced(shape)) {
        const r = shapeToRegion(flat, srcTol, arcTol)
        if (r.length > 0) acc.push(r)
      }
      return safeUnion(...acc) ?? []
    }
    case 'circle': {
      // defensive — content layers don't emit circles
      const w = shape.paint.stroke?.widthMM ?? 0
      if (w > 0) {
        return ringsToMultiPolygonEvenodd([circleRing(shape.rMM + w / 2, 128), circleRing(shape.rMM - w / 2, 128)])
      }
      return [[circleRing(shape.rMM, 128)]]
    }
  }
}

/**
 * Source-flatten / dilation-arc tolerances for a keepout region. Halo
 * boundaries are VISIBLE (exact tick cuts trace them; outline mode engraves
 * them) — 0.005 is the cost/quality knee: ~9µm peak ripple, ~2× dilation cost
 * (Liam-approved trade). Fixed — not ctx-clamped — so render and export halos
 * are the same geometry (WYSIWYG). Subtract-role regions keep the ctx tol.
 */
export function keepoutTolerances(haloMM: number, ctxTolMM: number): { srcTol: number; arcTol: number } {
  const srcTol = haloMM > 0 ? 0.005 : ctxTolMM
  return { srcTol, arcTol: srcTol }
}

/**
 * Union the shapes' regions, dilate by the halo. With `outlineMM` > 0 (halo
 * 'outline'), also the engraved outline as an exact filled RING from the gap's
 * edge out to gap + outline width — so the stated gap really is clear metal,
 * and the ring is geometry the layers above can cut. With `maskDiscRMM` > 0
 * (a mask layer) the result is the COMPLEMENT of the grown shape within that
 * origin-centred disc: subtracting it keeps what's below only inside the
 * shape. The disc is rotation-invariant, so the pre-phase caching and
 * phase-at-clip-time rotation carry over untouched; an empty shape keeps
 * nothing. Pure — safe in a worker.
 */
export function buildKeepoutRegion(
  shapes: Shape[],
  haloMM: number,
  srcTol: number,
  arcTol: number,
  outlineMM = 0,
  maskDiscRMM = 0,
): { region: MultiPolygon | null; outline: MultiPolygon | null; warnings: string[] } {
  const parts: MultiPolygon[] = []
  for (const shape of shapes) {
    const r = shapeToRegion(shape, srcTol, arcTol)
    if (r.length > 0) parts.push(r)
  }
  let region: MultiPolygon | null = parts.length === 0 ? [] : safeUnion(...parts)
  if (region !== null && region.length > 0 && haloMM > 0) {
    // the source was flattened with chords that cut INSIDE its curves (up to
    // ~0.75·srcTol at our radii) — grow by that too so the margin never undershoots
    region = dilateMultiPolygon(region, haloMM + 0.75 * srcTol, arcTol)
  }
  if (region !== null && maskDiscRMM > 0) {
    // the far ring never meets geometry, so its chord count is irrelevant
    region = safeDifference([[circleRing(maskDiscRMM, 64)]], region)
  }
  let outline: MultiPolygon | null = null
  if (region !== null && region.length > 0 && outlineMM > 0 && maskDiscRMM <= 0) {
    const outer = dilateMultiPolygon(region, outlineMM, arcTol)
    outline = safeDifference(outer, region)
  }
  const warnings = region === null ? ['A keepout region could not be computed.'] : []
  if (outlineMM > 0 && outline === null && region !== null && region.length > 0) warnings.push('A halo outline could not be computed.')
  return { region, outline, warnings }
}

/**
 * Content key for a layer's keepout region. Regions are cached PRE-PHASE
 * (consumers rotate by phase at clip time) and names are cosmetic, so neither
 * invalidates — phase scrubs and renames cost nothing (nor does toggling a
 * cut-out's invert-over-bare, which changes what it engraves, not its
 * region). `ctxKey` is compileCtxKey(ctx), passed in so this module stays
 * compile-free.
 */
export function regionKey(layer: Layer, ctxKey: string): string {
  // invertOverBare decides what a cut-out engraves, never the region it casts
  // (nor does relief: how a layer is struck never changes the region it casts)
  const norm = { ...('invertOverBare' in layer ? { ...layer, invertOverBare: false } : layer), relief: 'inherit' }
  return ctxKey + '|' + JSON.stringify({ ...norm, phaseDeg: 0, name: '' })
}
