import type { StrokeJoin, SvgStrokeCap } from '../model/types'
import type { Pt, SubPath } from './flatten'

/**
 * A stroke's exact outline as CONVEX pieces, honouring SVG stroke semantics:
 * one quad per segment, a join piece at each interior vertex (round = disc,
 * miter = wedge up to SVG's miter limit 4, else bevel triangle) and a cap at
 * each open end (butt = none, square = the end quad extended by half a width,
 * round = disc). Their union is the painted stroke; each piece is convex, so a
 * halo can be subtracted from it EXACTLY with the convex boundary walk — no
 * martinez on thin shapes (clip.ts). Pure geometry.
 */

const SVG_MITER_LIMIT = 4

/** Disc polygon (vertices ON the circle) fine enough for tolerance tol. */
export function discPts(cx: number, cy: number, r: number, tol: number): Pt[] {
  const n = Math.max(12, Math.ceil(Math.PI / Math.acos(Math.max(-1, Math.min(1, 1 - tol / Math.max(r, 1e-9))))))
  const out: Pt[] = []
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
  }
  return out
}

/** The convex outline of ONE straight stroked segment (a hatch tick) with its caps. */
export function linePieces(a: Pt, b: Pt, widthMM: number, cap: SvgStrokeCap, tol: number): Pt[][] {
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  const hw = widthMM / 2
  if (len < 1e-9) return cap === 'round' ? [discPts(a.x, a.y, hw, tol)] : []
  const ux = (b.x - a.x) / len
  const uy = (b.y - a.y) / len
  const px = -uy * hw
  const py = ux * hw
  if (cap === 'round') {
    // a stadium: two half-discs joined by the side edges — one convex polygon
    const n = Math.max(6, Math.ceil(Math.PI / Math.acos(Math.max(-1, Math.min(1, 1 - tol / Math.max(hw, 1e-9))))))
    // b+p → round the far side of b (along +u) → b−p, then a−p → round a (−u) → a+p
    const pts: Pt[] = []
    for (let k = 0; k <= n; k++) {
      const c = Math.cos((Math.PI * k) / n)
      const s = Math.sin((Math.PI * k) / n) * hw
      pts.push({ x: b.x + px * c + ux * s, y: b.y + py * c + uy * s })
    }
    for (let k = 0; k <= n; k++) {
      const c = Math.cos((Math.PI * k) / n)
      const s = Math.sin((Math.PI * k) / n) * hw
      pts.push({ x: a.x - px * c - ux * s, y: a.y - py * c - uy * s })
    }
    return [pts]
  }
  const ext = cap === 'square' ? hw : 0
  const a2 = { x: a.x - ux * ext, y: a.y - uy * ext }
  const b2 = { x: b.x + ux * ext, y: b.y + uy * ext }
  return [
    [
      { x: a2.x + px, y: a2.y + py },
      { x: b2.x + px, y: b2.y + py },
      { x: b2.x - px, y: b2.y - py },
      { x: a2.x - px, y: a2.y - py },
    ],
  ]
}

/** Every convex piece of a stroked polyline set (SVG stroke semantics). */
export function strokePieces(
  subs: SubPath[],
  widthMM: number,
  cap: SvgStrokeCap,
  join: StrokeJoin | undefined,
  tol: number,
): Pt[][] {
  const hw = widthMM / 2
  const out: Pt[][] = []
  for (const sub of subs) {
    // weld duplicates
    const pts: Pt[] = []
    for (const p of sub.pts) {
      const q = pts[pts.length - 1]
      if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-9) pts.push(p)
    }
    if (sub.closed && pts.length > 2) {
      const f = pts[0]!
      const l = pts[pts.length - 1]!
      if (Math.hypot(f.x - l.x, f.y - l.y) <= 1e-9) pts.pop()
    }
    if (pts.length === 1) {
      if (cap === 'round') out.push(discPts(pts[0]!.x, pts[0]!.y, hw, tol))
      else if (cap === 'square') {
        const p = pts[0]!
        out.push([{ x: p.x - hw, y: p.y - hw }, { x: p.x + hw, y: p.y - hw }, { x: p.x + hw, y: p.y + hw }, { x: p.x - hw, y: p.y + hw }])
      }
      continue
    }
    const closed = sub.closed && pts.length > 2
    const nSeg = closed ? pts.length : pts.length - 1
    for (let i = 0; i < nSeg; i++) {
      const a = pts[i]!
      const b = pts[(i + 1) % pts.length]!
      const first = !closed && i === 0
      const last = !closed && i === nSeg - 1
      // butt everywhere except a square cap at a true open end; round caps are discs below
      const segCap: SvgStrokeCap = cap === 'square' && (first || last) ? 'square' : 'butt'
      if (segCap === 'square' && !(first && last)) {
        // extend only the open end(s)
        const len = Math.hypot(b.x - a.x, b.y - a.y)
        const ux = (b.x - a.x) / len
        const uy = (b.y - a.y) / len
        const a2 = first ? { x: a.x - ux * hw, y: a.y - uy * hw } : a
        const b2 = last ? { x: b.x + ux * hw, y: b.y + uy * hw } : b
        out.push(...linePieces(a2, b2, widthMM, 'butt', tol))
      } else {
        out.push(...linePieces(a, b, widthMM, segCap, tol))
      }
    }
    if (!closed && cap === 'round') {
      out.push(discPts(pts[0]!.x, pts[0]!.y, hw, tol))
      out.push(discPts(pts[pts.length - 1]!.x, pts[pts.length - 1]!.y, hw, tol))
    }
    // joins
    const nJoin = closed ? pts.length : pts.length - 2
    for (let j = 0; j < nJoin; j++) {
      const vi = closed ? j : j + 1
      const v = pts[vi]!
      const p0 = pts[(vi - 1 + pts.length) % pts.length]!
      const p1 = pts[(vi + 1) % pts.length]!
      const piece = joinPiece(p0, v, p1, hw, join ?? 'miter', tol)
      if (piece) out.push(piece)
    }
  }
  return out
}

/** The join wedge at v between segments p0→v and v→p1 (outer side only; null when collinear). */
function joinPiece(p0: Pt, v: Pt, p1: Pt, hw: number, join: StrokeJoin, tol: number): Pt[] | null {
  const l1 = Math.hypot(v.x - p0.x, v.y - p0.y)
  const l2 = Math.hypot(p1.x - v.x, p1.y - v.y)
  if (l1 < 1e-12 || l2 < 1e-12) return null
  const d1 = { x: (v.x - p0.x) / l1, y: (v.y - p0.y) / l1 }
  const d2 = { x: (p1.x - v.x) / l2, y: (p1.y - v.y) / l2 }
  const cross = d1.x * d2.y - d1.y * d2.x
  const dot = d1.x * d2.x + d1.y * d2.y
  if (Math.abs(cross) < 1e-9 && dot > 0) return null // straight on
  if (join === 'round') return discPts(v.x, v.y, hw, tol)
  const s = cross > 0 ? -1 : 1 // the outer side is opposite the turn
  const n1 = { x: s * -d1.y * hw, y: s * d1.x * hw }
  const n2 = { x: s * -d2.y * hw, y: s * d2.x * hw }
  const c1 = { x: v.x + n1.x, y: v.y + n1.y }
  const c2 = { x: v.x + n2.x, y: v.y + n2.y }
  if (join === 'miter') {
    // miter length / stroke width = 1 / sin(θ/2), θ = the angle between the segments
    const theta = Math.acos(Math.max(-1, Math.min(1, -dot)))
    const ratio = 1 / Math.max(1e-9, Math.sin(theta / 2))
    if (ratio <= SVG_MITER_LIMIT) {
      // tip: where the two outer edges meet
      const denom = d1.x * d2.y - d1.y * d2.x
      if (Math.abs(denom) > 1e-12) {
        const t = ((c2.x - c1.x) * d2.y - (c2.y - c1.y) * d2.x) / denom
        const tip = { x: c1.x + d1.x * t, y: c1.y + d1.y * t }
        return [v, c1, tip, c2]
      }
    }
  }
  return [v, c1, c2] // bevel (or a miter past the limit)
}

/** Annular trapezoids tiling a stroked circle's band over [a0, a1] (radians, y-down atan2 frame). */
export function ringSectorPieces(r: number, widthMM: number, a0: number, a1: number, tol: number): Pt[][] {
  const ro = r + widthMM / 2
  const ri = Math.max(0, r - widthMM / 2)
  const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / Math.max(ro, 1e-9))))
  const n = Math.max(1, Math.ceil((a1 - a0) / Math.max(step, 1e-4)))
  const out: Pt[][] = []
  for (let k = 0; k < n; k++) {
    const t0 = a0 + ((a1 - a0) * k) / n
    const t1 = a0 + ((a1 - a0) * (k + 1)) / n
    out.push([
      { x: ro * Math.cos(t0), y: ro * Math.sin(t0) },
      { x: ro * Math.cos(t1), y: ro * Math.sin(t1) },
      { x: ri * Math.cos(t1), y: ri * Math.sin(t1) },
      { x: ri * Math.cos(t0), y: ri * Math.sin(t0) },
    ])
  }
  return out
}

/** Minimum caliper width of a convex polygon (its thinnest dimension). */
export function convexMinWidth(pts: Pt[]): number {
  const n = pts.length
  if (n < 3) return 0
  let best = Infinity
  for (let i = 0; i < n; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % n]!
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len < 1e-12) continue
    let far = 0
    for (const p of pts) far = Math.max(far, Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / len)
    best = Math.min(best, far)
  }
  return Number.isFinite(best) ? best : 0
}

/**
 * Does a disc of radius r fit anywhere inside this piece (outer loop + holes)?
 * The minimum-surviving-piece rule: a piece is kept when it is at least 2r
 * thick SOMEWHERE — a star tip or a wedge that's thick at one end stays, a
 * hairline strip goes. Polylabel-style cell search with early exit either way.
 */
export function holdsDisc(loops: Pt[][], r: number): boolean {
  const outer = loops[0]
  if (!outer || outer.length < 3) return false
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of outer) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y)
  }
  const w = maxX - minX
  const h = maxY - minY
  if (w < 2 * r || h < 2 * r) {
    // a disc of diameter 2r needs 2r of extent on both axes
    return false
  }
  const signedDist = (x: number, y: number): number => {
    let inside = false
    let best = Infinity
    for (const loop of loops) {
      for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
        const a = loop[i]!
        const b = loop[j]!
        if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside
        const dx = b.x - a.x
        const dy = b.y - a.y
        const L = dx * dx + dy * dy
        const t = L > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / L)) : 0
        best = Math.min(best, Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t)))
      }
    }
    return inside ? best : -best
  }
  interface Cell { x: number; y: number; half: number; d: number; max: number }
  const cell = (x: number, y: number, half: number): Cell => {
    const d = signedDist(x, y)
    return { x, y, half, d, max: d + half * Math.SQRT2 }
  }
  // max-heap on `max`
  const heap: Cell[] = []
  const push = (c: Cell) => {
    if (c.max < r) return
    heap.push(c)
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p]!.max >= heap[i]!.max) break
      ;[heap[p], heap[i]] = [heap[i]!, heap[p]!]
      i = p
    }
  }
  const pop = (): Cell => {
    const top = heap[0]!
    const last = heap.pop()!
    if (heap.length > 0) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const rr = l + 1
        let m = i
        if (l < heap.length && heap[l]!.max > heap[m]!.max) m = l
        if (rr < heap.length && heap[rr]!.max > heap[m]!.max) m = rr
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i]!, heap[m]!]
        i = m
      }
    }
    return top
  }
  const size = Math.max(Math.min(w, h), Math.max(w, h) / 256, 1e-9)
  for (let x = minX; x < maxX; x += size) for (let y = minY; y < maxY; y += size) push(cell(x + size / 2, y + size / 2, size / 2))
  let guard = 0
  while (heap.length > 0 && ++guard < 20000) {
    const c = pop()
    if (c.d >= r) return true
    if (c.half < 1e-6) continue
    const q = c.half / 2
    push(cell(c.x - q, c.y - q, q))
    push(cell(c.x + q, c.y - q, q))
    push(cell(c.x - q, c.y + q, q))
    push(cell(c.x + q, c.y + q, q))
  }
  return false
}
