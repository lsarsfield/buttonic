import type { PathSeg } from './pathData'

export interface Pt {
  x: number
  y: number
}

export interface SubPath {
  pts: Pt[]
  closed: boolean
}

/** Distance from p to the (infinite-safe) segment a–b. */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

const MAX_DEPTH = 24

/**
 * Adaptive cubic flattening with a chord-error guarantee: every point of the
 * true curve lies within tol of the emitted polyline. Flatness test = max
 * distance of the control points from the chord (a proven upper bound on
 * curve-to-chord deviation, within a small constant).
 */
function flattenCubic(
  p0: Pt,
  c1: Pt,
  c2: Pt,
  p1: Pt,
  tol: number,
  depth: number,
  out: Pt[],
): void {
  const d1 = distToSegment(c1, p0, p1)
  const d2 = distToSegment(c2, p0, p1)
  if (depth >= MAX_DEPTH || Math.max(d1, d2) <= tol) {
    out.push(p1)
    return
  }
  // de Casteljau split at t = 0.5
  const ab = mid(p0, c1)
  const bc = mid(c1, c2)
  const cd = mid(c2, p1)
  const abbc = mid(ab, bc)
  const bccd = mid(bc, cd)
  const m = mid(abbc, bccd)
  flattenCubic(p0, ab, abbc, m, tol, depth + 1, out)
  flattenCubic(m, bccd, cd, p1, tol, depth + 1, out)
}

const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

/**
 * Normalized segs → polyline subpaths. Straight lines stay exactly 2 points;
 * only curves subdivide.
 */
export function flattenSegs(segs: PathSeg[], tol: number): SubPath[] {
  const subs: SubPath[] = []
  let cur: Pt[] | null = null
  let start: Pt | null = null
  let pos: Pt = { x: 0, y: 0 }

  const flush = (closed: boolean) => {
    if (cur && cur.length > 1) subs.push({ pts: cur, closed })
    cur = null
  }

  for (const s of segs) {
    switch (s.type) {
      case 'M':
        flush(false)
        pos = { x: s.x, y: s.y }
        start = pos
        cur = [pos]
        break
      case 'L': {
        if (!cur) cur = [pos]
        const p = { x: s.x, y: s.y }
        cur.push(p)
        pos = p
        break
      }
      case 'C': {
        if (!cur) cur = [pos]
        const p = { x: s.x, y: s.y }
        flattenCubic(pos, { x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }, p, tol, 0, cur)
        pos = p
        break
      }
      case 'Z': {
        if (cur && start) {
          const last = cur[cur.length - 1]!
          if (Math.hypot(last.x - start.x, last.y - start.y) > 1e-9) cur.push(start)
          flush(true)
          pos = start
        }
        break
      }
    }
  }
  flush(false)
  return subs
}
