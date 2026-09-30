import { fmt } from './format'

/**
 * Parametric star / polygon, computed from the centre outward: N points on a
 * circle of radius `outerR` (the first at 12 o'clock), alternating with N
 * valleys on a circle of radius `innerRatio · outerR`, each side a straight
 * line or an exact circular arc.
 *
 *   innerRatio = cos(180°/N)  → a regular N-gon (valleys sit on the sides)
 *   bulge = sagitta ÷ half-chord: 0 straight, + bows away from the centre,
 *   − caves in toward it (±1 = a semicircle). A four-point star with −bulge
 *   is the classic "circle with four circular notches"; with +bulge, a
 *   compass star with swelling sides.
 *
 * Emitted as SVG path data with A commands (parsePathData turns them into
 * sub-µm cubics, like every motif arc). Degrees, 0° at 12 o'clock, clockwise,
 * y-down (polar.ts conventions). Pure.
 */

export const STAR_MIN_POINTS = 2
export const STAR_MAX_POINTS = 64

export interface StarParams {
  points: number
  outerR: number
  innerRatio: number
  bulge: number
}

/** Clamp to the ranges the geometry is defined on. */
export function normalizeStar(p: StarParams): StarParams {
  const points = Math.max(STAR_MIN_POINTS, Math.min(STAR_MAX_POINTS, Math.round(Number.isFinite(p.points) ? p.points : 5)))
  const innerRatio = Math.max(0.01, Math.min(1, Number.isFinite(p.innerRatio) ? p.innerRatio : 0.5))
  const bulge = Math.max(-1, Math.min(1, Number.isFinite(p.bulge) ? p.bulge : 0))
  return { points, outerR: Math.max(0, p.outerR), innerRatio, bulge }
}

/** The 2N vertices (tip, valley, tip, …), y-down, first tip at 12 o'clock. */
export function starVertices(p: StarParams): { x: number; y: number }[] {
  const { points, outerR, innerRatio } = normalizeStar(p)
  const out: { x: number; y: number }[] = []
  for (let k = 0; k < 2 * points; k++) {
    const a = (k * Math.PI) / points // exact k·180°/N, never accumulated
    const r = k % 2 === 0 ? outerR : outerR * innerRatio
    out.push({ x: r * Math.sin(a), y: -r * Math.cos(a) })
  }
  return out
}

/** Closed star outline as SVG path data (clockwise on screen). */
export function starPathD(p: StarParams): string {
  const n = normalizeStar(p)
  if (n.outerR <= 0) return ''
  const v = starVertices(n)
  const parts = [`M ${fmt(v[0]!.x)} ${fmt(v[0]!.y)}`]
  for (let i = 1; i <= v.length; i++) {
    const a = v[i - 1]!
    const b = v[i % v.length]!
    const h = Math.hypot(b.x - a.x, b.y - a.y) / 2
    const s = Math.abs(n.bulge) * h
    if (s < 1e-9 || h < 1e-12) {
      parts.push(i === v.length ? 'Z' : `L ${fmt(b.x)} ${fmt(b.y)}`)
      continue
    }
    // circle through a, b with sagitta s: radius (h² + s²) / 2s, always the
    // minor arc (|bulge| ≤ 1). The outline runs clockwise on screen, so a side
    // bowing AWAY from the centre turns clockwise too → sweep-flag 1.
    const rho = (h * h + s * s) / (2 * s)
    const sweep = n.bulge > 0 ? 1 : 0
    parts.push(`A ${fmt(rho)} ${fmt(rho)} 0 0 ${sweep} ${fmt(b.x)} ${fmt(b.y)}`)
    if (i === v.length) parts.push('Z')
  }
  return parts.join(' ')
}

/** Exact enclosed area (straight polygon ± circular segments) — for tests and readouts. */
export function starArea(p: StarParams): number {
  const n = normalizeStar(p)
  const v = starVertices(n)
  let area = 0
  for (let i = 0; i < v.length; i++) {
    const a = v[i]!
    const b = v[(i + 1) % v.length]!
    area += (a.x * b.y - b.x * a.y) / 2
  }
  area = Math.abs(area)
  if (Math.abs(n.bulge) > 1e-9) {
    for (let i = 0; i < v.length; i++) {
      const a = v[i]!
      const b = v[(i + 1) % v.length]!
      const h = Math.hypot(b.x - a.x, b.y - a.y) / 2
      const s = Math.abs(n.bulge) * h
      const rho = (h * h + s * s) / (2 * s)
      const theta = 2 * Math.asin(Math.min(1, h / rho)) // subtended angle (minor arc)
      const seg = (rho * rho * (theta - Math.sin(theta))) / 2
      area += n.bulge > 0 ? seg : -seg
    }
  }
  return area
}
