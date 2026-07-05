import type { Layer } from '../model/types'
import { rotation, apply } from './mat2d'
import { defMatrix, expandInstanced } from './expand'
import { flattenSegs, distToSegment, type Pt } from './flatten'
import { parsePathData, segsControlBox, transformSegs } from './pathData'
import { arcPathD, fmt } from './format'
import { normDeg, polarToXY, xyToPolar } from './polar'
import {
  mpBounds,
  mpRadialBand,
  multiPolygonToPathD,
  pathToMultiPolygon,
  pointInMultiPolygon,
  safeDifference,
  type MultiPolygon,
} from './poly'
import type { CompiledLayer, Shape } from './shapes'

/**
 * Cross-layer subtraction: clearance discs (the "moat", rotation-invariant) and
 * arbitrary polygon REGIONS (cut-out knockouts, text halos — shape-following).
 *
 * Disc clipping is the shipped v1 code, untouched. Region clipping is a second
 * phase that runs ONLY when regions are present — so with `regions: []` this
 * returns byte-identical output to before (golden discipline).
 */

export interface ClearanceDisc {
  rMM: number
}

/** Clearance discs cast by layers ABOVE the given index (paint order). */
export function clearancesAbove(layers: Layer[], index: number): ClearanceDisc[] {
  const discs: ClearanceDisc[] = []
  for (let i = index + 1; i < layers.length; i++) {
    const l = layers[i]!
    if (l.type === 'center' && l.visible && l.clearanceMM > 0) {
      // only centred discs are rotation-invariant; tiny optical offsets are
      // treated as centred, larger offsets disable the clearance
      if (Math.hypot(l.offsetXMM, l.offsetYMM) < 0.25) discs.push({ rMM: l.clearanceMM })
    }
  }
  return discs
}

export function maxClearance(discs: ClearanceDisc[]): number {
  return discs.reduce((m, d) => Math.max(m, d.rMM), 0)
}

/**
 * Clip segment a→b against the OUTSIDE of a circle of radius R centred on the
 * origin. Returns null if fully inside, or the surviving segment.
 */
export function clipSegmentOutsideCircle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  R: number,
): { ax: number; ay: number; bx: number; by: number } | null {
  const inA = Math.hypot(ax, ay) < R
  const inB = Math.hypot(bx, by) < R
  if (!inA && !inB) {
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    if (len2 === 0) return { ax, ay, bx, by }
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2))
    const cx = ax + t * dx
    const cy = ay + t * dy
    if (Math.hypot(cx, cy) >= R) return { ax, ay, bx, by }
    const hits = segCircleHits(ax, ay, bx, by, R)
    if (hits.length < 2) return { ax, ay, bx, by }
    const [t1, , t2] = [hits[0]!, 0, hits[hits.length - 1]!]
    const lenA = t1
    const lenB = 1 - t2
    return lenA >= lenB
      ? { ax, ay, bx: ax + t1 * dx, by: ay + t1 * dy }
      : { ax: ax + t2 * dx, ay: ay + t2 * dy, bx, by }
  }
  if (inA && inB) return null
  const hits = segCircleHits(ax, ay, bx, by, R)
  if (hits.length === 0) return null
  const t = inA ? hits[hits.length - 1]! : hits[0]!
  const px = ax + t * (bx - ax)
  const py = ay + t * (by - ay)
  return inA ? { ax: px, ay: py, bx, by } : { ax, ay, bx: px, by: py }
}

/** Parameter values t ∈ [0,1] where segment a→b crosses the circle radius R. */
function segCircleHits(ax: number, ay: number, bx: number, by: number, R: number): number[] {
  const dx = bx - ax
  const dy = by - ay
  const A = dx * dx + dy * dy
  const B = 2 * (ax * dx + ay * dy)
  const C = ax * ax + ay * ay - R * R
  const disc = B * B - 4 * A * C
  if (A === 0 || disc < 0) return []
  const s = Math.sqrt(disc)
  return [(-B - s) / (2 * A), (-B + s) / (2 * A)].filter((t) => t >= 0 && t <= 1).sort((a, b) => a - b)
}

/** Parse the simple `M x y L x y` def emitted by the hatch compiler. */
function parseLineDef(d: string): { ax: number; ay: number; bx: number; by: number } | null {
  const m = d.match(/^M\s+([-\d.]+)\s+([-\d.]+)\s+L\s+([-\d.]+)\s+([-\d.]+)$/)
  if (!m) return null
  return { ax: Number(m[1]), ay: Number(m[2]), bx: Number(m[3]), by: Number(m[4]) }
}

// ---------------------------------------------------------------------------
// Region clipping (polygon keepouts) — new
// ---------------------------------------------------------------------------

interface Seg {
  ax: number
  ay: number
  bx: number
  by: number
}

const insideAny = (x: number, y: number, regions: MultiPolygon[]): boolean =>
  regions.some((mp) => pointInMultiPolygon(x, y, mp))

/**
 * Minimum length for a surviving clipped stroke fragment. A piece shorter than
 * the stroke is wide reads as a stray dot, not a tick — these grazing slivers
 * appear where a tick crosses a serif or a faceted halo edge. Floored so
 * hairline strokes still shed sub-tolerance crumbs.
 */
const stubMinLen = (strokeWidthMM: number | undefined): number => Math.max(strokeWidthMM ?? 0, 0.08)

function polylineLen(pts: Pt[]): number {
  let len = 0
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y)
  return len
}

/** t-params in (0,1) where segment a→b crosses any region edge. */
function segCrossings(ax: number, ay: number, bx: number, by: number, regions: MultiPolygon[]): number[] {
  const ts: number[] = []
  const dx = bx - ax
  const dy = by - ay
  for (const mp of regions) {
    for (const poly of mp) {
      for (const ring of poly) {
        const n = ring.length
        for (let i = 0; i < n; i++) {
          const [cx, cy] = ring[i]!
          const [ex, ey] = ring[(i + 1) % n]!
          const ux = ex - cx
          const uy = ey - cy
          const denom = dx * uy - dy * ux
          if (Math.abs(denom) < 1e-12) continue
          const t = ((cx - ax) * uy - (cy - ay) * ux) / denom
          const s = ((cx - ax) * dy - (cy - ay) * dx) / denom
          if (t > 1e-9 && t < 1 - 1e-9 && s >= -1e-9 && s <= 1 + 1e-9) ts.push(t)
        }
      }
    }
  }
  return ts
}

/** Segment minus the union of regions → 0..n surviving sub-segments (merged). */
export function clipSegmentOutsideRegions(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  regions: MultiPolygon[],
): Seg[] {
  const dx = bx - ax
  const dy = by - ay
  const cuts = [0, 1, ...segCrossings(ax, ay, bx, by, regions)].sort((a, b) => a - b)
  const out: (Seg & { t1: number })[] = []
  for (let i = 0; i < cuts.length - 1; i++) {
    const t0 = cuts[i]!
    const t1 = cuts[i + 1]!
    if (t1 - t0 < 1e-9) continue
    const tm = (t0 + t1) / 2
    if (insideAny(ax + dx * tm, ay + dy * tm, regions)) continue
    const seg = { ax: ax + dx * t0, ay: ay + dy * t0, bx: ax + dx * t1, by: ay + dy * t1, t1 }
    const last = out[out.length - 1]
    if (last && Math.abs(last.t1 - t0) < 1e-9) {
      last.bx = seg.bx
      last.by = seg.by
      last.t1 = t1
    } else {
      out.push(seg)
    }
  }
  return out.map(({ ax, ay, bx, by }) => ({ ax, ay, bx, by }))
}

/** Origin-centred circle minus regions: 'keep' whole, 'drop', or surviving arcs. */
export function splitCircleOutsideRegions(
  rMM: number,
  regions: MultiPolygon[],
): 'keep' | 'drop' | Array<[number, number]> {
  const angles: number[] = []
  for (const mp of regions) {
    for (const poly of mp) {
      for (const ring of poly) {
        const n = ring.length
        for (let i = 0; i < n; i++) {
          const [cx, cy] = ring[i]!
          const [ex, ey] = ring[(i + 1) % n]!
          for (const t of segCircleHits(cx, cy, ex, ey, rMM)) {
            const px = cx + (ex - cx) * t
            const py = cy + (ey - cy) * t
            angles.push(normDeg(xyToPolar(px, py).thetaDeg))
          }
        }
      }
    }
  }
  if (angles.length === 0) {
    const p = polarToXY(0, rMM)
    return insideAny(p.x, p.y, regions) ? 'drop' : 'keep'
  }
  angles.sort((a, b) => a - b)
  const uniq: number[] = []
  for (const a of angles) if (!uniq.length || Math.abs(a - uniq[uniq.length - 1]!) > 1e-6) uniq.push(a)
  const arcs: Array<[number, number]> = []
  for (let i = 0; i < uniq.length; i++) {
    const a0 = uniq[i]!
    const a1 = i + 1 < uniq.length ? uniq[i + 1]! : uniq[0]! + 360
    const mid = (a0 + a1) / 2
    const p = polarToXY(mid, rMM)
    if (!insideAny(p.x, p.y, regions)) arcs.push([a0, a1])
  }
  if (arcs.length === 0) return 'drop'
  return arcs
}

interface Band {
  rMin: number
  rMax: number
}

function regionsBand(regions: MultiPolygon[]): Band | null {
  let rMin = Infinity
  let rMax = 0
  for (const mp of regions) {
    const b = mpRadialBand(mp)
    if (b) {
      rMin = Math.min(rMin, b.rMin)
      rMax = Math.max(rMax, b.rMax)
    }
  }
  return Number.isFinite(rMin) ? { rMin, rMax } : null
}

function regionsBox(regions: MultiPolygon[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const mp of regions) {
    const b = mpBounds(mp)
    if (b) {
      minX = Math.min(minX, b.minX)
      minY = Math.min(minY, b.minY)
      maxX = Math.max(maxX, b.maxX)
      maxY = Math.max(maxY, b.maxY)
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null
}

const bandOverlaps = (a: Band | null, r0: number, r1: number, pad = 0.02): boolean =>
  !a || (Math.min(r0, r1) <= a.rMax + pad && Math.max(r0, r1) >= a.rMin - pad)

/** Region-clip one already-disc-clipped shape into `out`. Recurses on instanced. */
function regionClipShape(
  shape: Shape,
  regions: MultiPolygon[],
  band: Band | null,
  box: { minX: number; minY: number; maxX: number; maxY: number } | null,
  tolMM: number,
  out: Shape[],
  warnings: string[],
): void {
  switch (shape.kind) {
    case 'line': {
      const r0 = Math.hypot(shape.x1, shape.y1)
      const r1 = Math.hypot(shape.x2, shape.y2)
      const near = distToSegment({ x: 0, y: 0 }, { x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 })
      if (!bandOverlaps(band, Math.min(r0, r1, near), Math.max(r0, r1))) {
        out.push(shape)
        return
      }
      const lineMin = stubMinLen(shape.paint.stroke?.widthMM)
      for (const s of clipSegmentOutsideRegions(shape.x1, shape.y1, shape.x2, shape.y2, regions)) {
        if (Math.hypot(s.bx - s.ax, s.by - s.ay) < lineMin) continue // drop grazing slivers
        out.push({ kind: 'line', x1: s.ax, y1: s.ay, x2: s.bx, y2: s.by, paint: shape.paint })
      }
      return
    }
    case 'circle': {
      if (shape.paint.stroke) {
        const res = splitCircleOutsideRegions(shape.rMM, regions)
        if (res === 'keep') out.push(shape)
        else if (res === 'drop') return
        else for (const [a0, a1] of res) out.push({ kind: 'path', d: arcPathD(shape.rMM, a0, a1), paint: shape.paint })
      } else {
        out.push(shape) // fill circles are never emitted; pass through defensively
      }
      return
    }
    case 'path': {
      const segs = parsePathData(shape.d)
      const cbox = segsControlBox(segs)
      if (cbox && box && (cbox.x > box.maxX || cbox.x + cbox.w < box.minX || cbox.y > box.maxY || cbox.y + cbox.h < box.minY)) {
        out.push(shape) // disjoint from all regions — untouched, exact
        return
      }
      if (shape.paint.fill) {
        const subject = pathToMultiPolygon(shape.d, shape.fillRule ?? 'nonzero', tolMM)
        if (subject.length === 0) {
          out.push(shape)
          return
        }
        const diff = safeDifference(subject, ...regions)
        if (diff === null) {
          out.push(shape)
          warnings.push('A knockout could not be computed — geometry left uncut.')
        } else if (diff.length > 0) {
          out.push({ kind: 'path', d: multiPolygonToPathD(diff), fillRule: 'evenodd', paint: shape.paint })
        }
      } else {
        // stroked path (warped centreline / halo outline): clip each polyline segment
        const minLen = stubMinLen(shape.paint.stroke?.widthMM)
        const parts: string[] = []
        for (const sub of flattenSegs(segs, tolMM)) {
          const pts = sub.pts
          let open: Pt[] = []
          const flush = () => {
            if (open.length >= 2 && polylineLen(open) >= minLen) {
              parts.push(`M ${fmt(open[0]!.x)} ${fmt(open[0]!.y)}`)
              for (let i = 1; i < open.length; i++) parts.push(`L ${fmt(open[i]!.x)} ${fmt(open[i]!.y)}`)
            }
            open = []
          }
          for (let i = 0; i + 1 < pts.length; i++) {
            const segsKept = clipSegmentOutsideRegions(pts[i]!.x, pts[i]!.y, pts[i + 1]!.x, pts[i + 1]!.y, regions)
            for (const s of segsKept) {
              const tail = open[open.length - 1]
              if (!tail || Math.hypot(tail.x - s.ax, tail.y - s.ay) > 1e-9) {
                flush()
                open = [{ x: s.ax, y: s.ay }, { x: s.bx, y: s.by }]
              } else {
                open.push({ x: s.bx, y: s.by })
              }
            }
          }
          flush()
        }
        if (parts.length > 0) out.push({ kind: 'path', d: parts.join(' '), paint: shape.paint })
      }
      return
    }
    case 'instanced': {
      const defSegs = transformSegs(parsePathData(shape.def.d), defMatrix(shape.def))
      const rb = radialBandOf(defSegs)
      if (rb && !bandOverlaps(band, rb.rMin, rb.rMax)) {
        out.push(shape) // whole instanced band misses every region
        return
      }
      for (const flat of expandInstanced(shape)) regionClipShape(flat, regions, band, box, tolMM, out, warnings)
      return
    }
  }
}

function radialBandOf(segs: ReturnType<typeof parsePathData>): Band | null {
  let rMin = Infinity
  let rMax = 0
  let prev: Pt | null = null
  for (const s of segs) {
    if (s.type === 'Z') continue
    const p = { x: s.x, y: s.y }
    rMax = Math.max(rMax, Math.hypot(p.x, p.y))
    if (prev) rMin = Math.min(rMin, distToSegment({ x: 0, y: 0 }, prev, p))
    else rMin = Math.min(rMin, Math.hypot(p.x, p.y))
    prev = p
  }
  return Number.isFinite(rMin) ? { rMin, rMax } : null
}

/**
 * Apply clearance discs (phase 1, unchanged) then polygon regions (phase 2,
 * skipped entirely when none) to a compiled layer.
 */
export function clipCompiled(
  compiled: CompiledLayer,
  keepouts: { discs: ClearanceDisc[]; regions: MultiPolygon[] },
  tolMM: number,
): CompiledLayer {
  const { discs, regions } = keepouts
  const R = maxClearance(discs)
  const hasRegions = regions.length > 0
  if (R <= 0 && !hasRegions) return compiled

  // ---- phase 1: disc clipping (byte-identical to the shipped v1 code) ----
  const discClipped: Shape[] = []
  const warnings = [...compiled.warnings]
  for (const shape of compiled.shapes) {
    if (R <= 0) {
      discClipped.push(shape)
      continue
    }
    switch (shape.kind) {
      case 'circle': {
        if (shape.rMM < R) continue
        discClipped.push(shape)
        break
      }
      case 'line': {
        const clipped = clipSegmentOutsideCircle(shape.x1, shape.y1, shape.x2, shape.y2, R)
        if (clipped) discClipped.push({ ...shape, x1: clipped.ax, y1: clipped.ay, x2: clipped.bx, y2: clipped.by })
        break
      }
      case 'instanced': {
        const line = parseLineDef(shape.def.d)
        const isBareLineDef =
          line !== null && shape.def.dx === 0 && shape.def.dy === 0 && shape.def.rotateDeg === 0 && shape.def.scale === 1
        if (isBareLineDef) {
          const clipped = clipSegmentOutsideCircle(line.ax, line.ay, line.bx, line.by, R)
          if (clipped) {
            discClipped.push({
              ...shape,
              def: { ...shape.def, d: `M ${clipped.ax} ${clipped.ay} L ${clipped.bx} ${clipped.by}` },
            })
          }
          break
        }
        const placedR = Math.hypot(shape.def.dx, shape.def.dy)
        if (placedR > 0 && placedR < R) break
        discClipped.push(shape)
        break
      }
      case 'path':
        discClipped.push(shape)
        break
    }
  }

  if (!hasRegions) return { shapes: discClipped, warnings }

  // ---- phase 2: polygon region clipping ----
  const band = regionsBand(regions)
  const box = regionsBox(regions)
  const out: Shape[] = []
  for (const shape of discClipped) regionClipShape(shape, regions, band, box, tolMM, out, warnings)
  return { shapes: out, warnings }
}

/** Rotate a point — exported for instance-expansion in the exporter. */
export function rotatePoint(x: number, y: number, deg: number): { x: number; y: number } {
  return apply(rotation(deg), x, y)
}
