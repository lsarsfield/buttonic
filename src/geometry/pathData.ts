import { SVGPathData, SVGPathDataTransformer } from 'svg-pathdata'
import { fmt } from './format'
import { apply, type Mat2d } from './mat2d'

/**
 * Internal normalized path form: absolute M / L / C / Z only. The single
 * wrapper around svg-pathdata — nothing else in the codebase touches its API.
 * Arcs and quadratics become cubics (exact for Q→C, sub-tolerance for A→C),
 * H/V/S/T shorthands are expanded.
 */

export type PathSeg =
  | { type: 'M'; x: number; y: number }
  | { type: 'L'; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'Z' }

export function parsePathData(d: string): PathSeg[] {
  const pd = new SVGPathData(d)
    .toAbs()
    .transform(SVGPathDataTransformer.NORMALIZE_HVZ(false))
    .transform(SVGPathDataTransformer.NORMALIZE_ST())
    .transform(SVGPathDataTransformer.QT_TO_C())
    .transform(SVGPathDataTransformer.A_TO_C())

  const segs: PathSeg[] = []
  for (const c of pd.commands) {
    switch (c.type) {
      case SVGPathData.MOVE_TO:
        segs.push({ type: 'M', x: c.x, y: c.y })
        break
      case SVGPathData.LINE_TO:
        segs.push({ type: 'L', x: c.x, y: c.y })
        break
      case SVGPathData.CURVE_TO:
        segs.push({ type: 'C', x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2, x: c.x, y: c.y })
        break
      case SVGPathData.CLOSE_PATH:
        segs.push({ type: 'Z' })
        break
      default:
        // NORMALIZE/QT_TO_C/A_TO_C guarantee only M/L/C/Z remain
        throw new Error(`Unexpected path command after normalization: ${c.type}`)
    }
  }
  return segs
}

/** Affine transform of a normalized path — exact (beziers are closed under affine). */
export function transformSegs(segs: PathSeg[], m: Mat2d): PathSeg[] {
  return segs.map((s) => {
    switch (s.type) {
      case 'M':
      case 'L': {
        const p = apply(m, s.x, s.y)
        return { ...s, x: p.x, y: p.y }
      }
      case 'C': {
        const c1 = apply(m, s.x1, s.y1)
        const c2 = apply(m, s.x2, s.y2)
        const p = apply(m, s.x, s.y)
        return { type: 'C', x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: p.x, y: p.y }
      }
      case 'Z':
        return s
    }
  })
}

/** Normalized segs → path data (exact beziers, deterministic formatting). */
export function segsToD(segs: PathSeg[]): string {
  const parts: string[] = []
  for (const s of segs) {
    switch (s.type) {
      case 'M':
        parts.push(`M ${fmt(s.x)} ${fmt(s.y)}`)
        break
      case 'L':
        parts.push(`L ${fmt(s.x)} ${fmt(s.y)}`)
        break
      case 'C':
        parts.push(`C ${fmt(s.x1)} ${fmt(s.y1)} ${fmt(s.x2)} ${fmt(s.y2)} ${fmt(s.x)} ${fmt(s.y)}`)
        break
      case 'Z':
        parts.push('Z')
        break
    }
  }
  return parts.join(' ')
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Bounding box over anchor + control points — conservative but cheap. */
export function segsControlBox(segs: PathSeg[]): Box | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const eat = (x: number, y: number) => {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  for (const s of segs) {
    if (s.type === 'M' || s.type === 'L') eat(s.x, s.y)
    else if (s.type === 'C') {
      eat(s.x1, s.y1)
      eat(s.x2, s.y2)
      eat(s.x, s.y)
    }
  }
  if (!Number.isFinite(minX)) return null
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}
