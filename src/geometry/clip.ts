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
 * Minimum length for a surviving clipped stroke fragment. A piece only as long
 * as the stroke is wide reads as a stray nub, not a tick — these appear where a
 * tick grazes a serif or the letter-shaped halo edge. Require a few stroke
 * widths (floored for hairline strokes) so the fringe around text stays tidy.
 */
const stubMinLen = (strokeWidthMM: number | undefined): number =>
  Math.max(3 * (strokeWidthMM ?? 0), 0.15)

function polylineLen(pts: Pt[]): number {
  let len = 0
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y)
  return len
}

// --- swath-shadow clipping ---------------------------------------------------
// A hatch tick is a constant-width TOOL PASS: it must be cut wherever ANY part
// of its width would enter a keepout region, not just where its centreline
// does. Centreline-only clipping left two errors of order strokeMM/2: oblique
// region edges reached the tick's leading corner before the centreline (late
// cuts, corners overlapping letter ink), and corner grazes that never crossed
// the centreline weren't detected at all. The swath shadow is exact: project
// every region edge crossing the (convex) tick onto its axis, union the blocked
// intervals, and keep the fully-clear spans.

interface REdge {
  x1: number
  y1: number
  x2: number
  y2: number
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Flatten all region rings into one edge list (built once per clipCompiled). */
function collectRegionEdges(regions: MultiPolygon[]): REdge[] {
  const edges: REdge[] = []
  for (const mp of regions) {
    for (const poly of mp) {
      for (const ring of poly) {
        const n = ring.length
        for (let i = 0; i < n; i++) {
          const [x1, y1] = ring[i]!
          const [x2, y2] = ring[(i + 1) % n]!
          edges.push({
            x1, y1, x2, y2,
            minX: Math.min(x1, x2), minY: Math.min(y1, y2),
            maxX: Math.max(x1, x2), maxY: Math.max(y1, y2),
          })
        }
      }
    }
  }
  return edges
}

const CONVEX_EPS = 1e-9

/**
 * Cyrus–Beck: clip a region edge to the inside of the convex polygon `poly`
 * (shrunk by CONVEX_EPS so pure boundary tangency does not count as blocking).
 * Returns the surviving sub-segment's axial extent, or null if it misses.
 */
function clipSegToConvex(
  e: REdge,
  poly: Pt[],
  axialOf: (x: number, y: number) => number,
): [number, number] | null {
  const n = poly.length
  let area2 = 0 // shoelace → orientation → inward-normal side
  for (let i = 0; i < n; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % n]!
    area2 += a.x * b.y - b.x * a.y
  }
  const sgn = area2 >= 0 ? 1 : -1
  const dx = e.x2 - e.x1
  const dy = e.y2 - e.y1
  let t0 = 0
  let t1 = 1
  for (let i = 0; i < n; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % n]!
    const nx = -(b.y - a.y) * sgn // inward normal (unnormalized)
    const ny = (b.x - a.x) * sgn
    const num = nx * (e.x1 - a.x) + ny * (e.y1 - a.y) // >0 ⇒ inside this side
    const den = nx * dx + ny * dy
    if (Math.abs(den) < 1e-12) {
      if (num < CONVEX_EPS) return null // parallel and outside (or tangent)
      continue
    }
    const t = (CONVEX_EPS - num) / den
    if (den > 0) {
      if (t > t0) t0 = t
    } else if (t < t1) {
      t1 = t
    }
    if (t0 > t1) return null
  }
  const s0 = axialOf(e.x1 + dx * t0, e.y1 + dy * t0)
  const s1 = axialOf(e.x1 + dx * t1, e.y1 + dy * t1)
  return s0 <= s1 ? [s0, s1] : [s1, s0]
}

/**
 * Axial spans of the convex swath `poly` fully clear of every region. Blocked =
 * union of the axial shadows of region edges crossing the swath; a gap between
 * shadows contains no boundary, so its inside/outside status is uniform — one
 * axis-point sample classifies it (same argument as splitCircleOutsideRegions).
 */
function swathClearSpans(
  poly: Pt[],
  axialOf: (x: number, y: number) => number,
  sToPoint: (s: number) => Pt,
  sMin: number,
  sMax: number,
  edges: REdge[],
  regions: MultiPolygon[],
): Array<[number, number]> {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of poly) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y)
  }
  const blocked: Array<[number, number]> = []
  for (const e of edges) {
    if (e.minX > maxX || e.maxX < minX || e.minY > maxY || e.maxY < minY) continue
    const ext = clipSegToConvex(e, poly, axialOf)
    if (ext) blocked.push(ext)
  }
  blocked.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const b of blocked) {
    const last = merged[merged.length - 1]
    if (last && b[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], b[1])
    else merged.push([b[0], b[1]])
  }
  const gaps: Array<[number, number]> = []
  let cursor = sMin
  for (const [lo, hi] of merged) {
    if (lo > cursor + 1e-9) gaps.push([cursor, Math.min(lo, sMax)])
    cursor = Math.max(cursor, hi)
    if (cursor >= sMax) break
  }
  if (cursor < sMax - 1e-9) gaps.push([cursor, sMax])
  const out: Array<[number, number]> = []
  for (const g of gaps) {
    const p = sToPoint((g[0] + g[1]) / 2)
    if (!insideAny(p.x, p.y, regions)) out.push(g)
  }
  return out
}

/**
 * Straight constant-width stroke (a hatch tick) minus regions, full-width
 * semantics: the tool must not pass wherever any part of the stroke's width
 * would enter a region. Returns the surviving sub-segments (stub-filtered);
 * an untouched tick returns its exact original endpoints.
 */
function strokeSwathSegments(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  widthMM: number | undefined,
  edges: REdge[],
  regions: MultiPolygon[],
): Seg[] {
  const len = Math.hypot(x2 - x1, y2 - y1)
  if (len < 1e-9) return []
  const ux = (x2 - x1) / len
  const uy = (y2 - y1) / len
  const hw = Math.max((widthMM ?? 0.1) / 2, 1e-6)
  const px = -uy
  const py = ux
  const rect: Pt[] = [
    { x: x1 + px * hw, y: y1 + py * hw },
    { x: x2 + px * hw, y: y2 + py * hw },
    { x: x2 - px * hw, y: y2 - py * hw },
    { x: x1 - px * hw, y: y1 - py * hw },
  ]
  const axialOf = (x: number, y: number) => (x - x1) * ux + (y - y1) * uy
  const sToPoint = (s: number): Pt => ({ x: x1 + ux * s, y: y1 + uy * s })
  const spans = swathClearSpans(rect, axialOf, sToPoint, 0, len, edges, regions)
  if (spans.length === 1 && spans[0]![0] <= 1e-9 && spans[0]![1] >= len - 1e-9) {
    return [{ ax: x1, ay: y1, bx: x2, by: y2 }] // untouched — exact endpoints
  }
  const minLen = stubMinLen(widthMM)
  const out: Seg[] = []
  for (const [lo, hi] of spans) {
    if (hi - lo < minLen) continue
    const a = sToPoint(lo)
    const b = sToPoint(hi)
    out.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y })
  }
  return out
}

/**
 * A thin, straight, single-loop filled polygon is a pointed hatch tick — a
 * stroke in disguise. Differencing it against a text halo with martinez is its
 * worst case: hundreds of near-degenerate polygons make the clip crawl (a halo
 * over a pointed-hatch band could hang for tens of seconds) and mangle edges.
 * Instead, compute the exact swath shadow on the tick's axis and band-cut the
 * ORIGINAL polygon per clear span — every span survives (a halo is an outline
 * MARGIN: the reeding continues on both sides of the letters and through open
 * counters), exact width, pointed tips intact. Returns null for anything that
 * isn't a thin straight tick (real motifs, curves, multi-loop shapes) so they
 * fall back to polygon difference.
 */
function filledThinTickClip(
  shape: Extract<Shape, { kind: 'path' }>,
  regions: MultiPolygon[],
  edges: REdge[],
): Shape[] | null {
  const d = shape.d
  if (/[CAQSTVHcaqstvh]/.test(d)) return null // curved or shorthand → a motif
  if ((d.match(/M/g) || []).length !== 1) return null // single loop only
  const nums = d.match(/-?\d*\.?\d+/g)
  if (!nums || nums.length < 6) return null
  const pts: Pt[] = []
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: +nums[i]!, y: +nums[i + 1]! })

  // Principal axis through the centroid = the tick's TRUE centreline. (The
  // spindle is mirror-symmetric about its axis, so the PCA axis IS the symmetry
  // axis exactly; the longest chord runs corner→tip on a diagonal and skewed
  // both width and centre — that produced fat, shifted, blunt stubs.)
  const n = pts.length
  let cx = 0, cy = 0
  for (const p of pts) { cx += p.x; cy += p.y }
  cx /= n; cy /= n
  let sxx = 0, syy = 0, sxy = 0
  for (const p of pts) {
    const dx = p.x - cx, dy = p.y - cy
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  let ux = Math.cos(theta), uy = Math.sin(theta)
  if (ux * cx + uy * cy < 0) { ux = -ux; uy = -uy } // orient outward (increasing radius)
  const px = -uy, py = ux
  const axialOf = (x: number, y: number) => (x - cx) * ux + (y - cy) * uy
  let sMin = Infinity, sMax = -Infinity, wMin = Infinity, wMax = -Infinity
  for (const p of pts) {
    const s = axialOf(p.x, p.y)
    const w = (p.x - cx) * px + (p.y - cy) * py
    sMin = Math.min(sMin, s); sMax = Math.max(sMax, s)
    wMin = Math.min(wMin, w); wMax = Math.max(wMax, w)
  }
  const halfW = (wMax - wMin) / 2
  const axialLen = sMax - sMin
  if (halfW <= 0 || axialLen < 1e-6 || (2 * halfW) / axialLen > 0.25) return null // not thin → real motif

  // Swath = the original convex polygon itself (not its bounding rectangle), so
  // a region passing within halfW of the APEX but outside the taper is a miss.
  const wMid = (wMax + wMin) / 2
  const sToPoint = (s: number): Pt => ({ x: cx + ux * s + px * wMid, y: cy + uy * s + py * wMid })
  const spans = swathClearSpans(pts, axialOf, sToPoint, sMin, sMax, edges, regions)
  if (spans.length === 1 && spans[0]![0] <= sMin + 1e-9 && spans[0]![1] >= sMax - 1e-9) {
    return [shape] // untouched by the halo → keep the exact spindle (tips intact)
  }
  const min = stubMinLen(2 * halfW)
  const out: Shape[] = []
  for (const [lo, hi] of spans) {
    if (hi - lo < min) continue // sub-few-stroke nubs (tight concavities) drop
    const kept = clipPolyBand(pts, axialOf, lo, hi) // hi ≈ sMax keeps the point; a buried tip cuts flat
    if (kept.length < 3) continue
    out.push({
      kind: 'path',
      d: 'M ' + kept.map((p, i) => `${i ? 'L ' : ''}${fmt(p.x)} ${fmt(p.y)}`).join(' ') + ' Z',
      paint: shape.paint,
    })
  }
  return out
}

/** Sutherland–Hodgman clip of a polygon to the slab lo ≤ axial(pt) ≤ hi. */
function clipPolyBand(pts: Pt[], axial: (x: number, y: number) => number, lo: number, hi: number): Pt[] {
  const half = (poly: Pt[], bound: number, sign: number): Pt[] => {
    const out: Pt[] = []
    const n = poly.length
    for (let i = 0; i < n; i++) {
      const cur = poly[i]!, nxt = poly[(i + 1) % n]!
      const ca = sign * (axial(cur.x, cur.y) - bound)
      const na = sign * (axial(nxt.x, nxt.y) - bound)
      if (ca >= 0) out.push(cur)
      if (ca >= 0 !== na >= 0) {
        const t = ca / (ca - na)
        out.push({ x: cur.x + t * (nxt.x - cur.x), y: cur.y + t * (nxt.y - cur.y) })
      }
    }
    return out
  }
  const lower = half(pts, lo, 1) // keep axial ≥ lo
  return lower.length < 3 ? [] : half(lower, hi, -1) // keep axial ≤ hi
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
  edges: REdge[],
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
      for (const s of strokeSwathSegments(shape.x1, shape.y1, shape.x2, shape.y2, shape.paint.stroke?.widthMM, edges, regions)) {
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
        // Pointed hatch ticks are thin filled spindles; clip them by their
        // exact swath shadow instead of martinez (pathologically slow on them).
        const thin = filledThinTickClip(shape, regions, edges)
        if (thin !== null) {
          for (const t of thin) out.push(t)
          return
        }
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
          if (!sub.closed && pts.length === 2) {
            // a straight hatch tick — clip its full-width swath, not just the centreline
            for (const s of strokeSwathSegments(pts[0]!.x, pts[0]!.y, pts[1]!.x, pts[1]!.y, shape.paint.stroke?.widthMM, edges, regions)) {
              parts.push(`M ${fmt(s.ax)} ${fmt(s.ay)} L ${fmt(s.bx)} ${fmt(s.by)}`)
            }
            continue
          }
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
      for (const flat of expandInstanced(shape)) regionClipShape(flat, regions, edges, band, box, tolMM, out, warnings)
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
  const edges = collectRegionEdges(regions)
  const out: Shape[] = []
  for (const shape of discClipped) regionClipShape(shape, regions, edges, band, box, tolMM, out, warnings)
  return { shapes: out, warnings }
}

/** Rotate a point — exported for instance-expansion in the exporter. */
export function rotatePoint(x: number, y: number, deg: number): { x: number; y: number } {
  return apply(rotation(deg), x, y)
}
