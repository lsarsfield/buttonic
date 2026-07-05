import { polarToXY } from './polar'

/**
 * Number → path-data formatting: fixed 4 decimals (0.1 µm — far beyond
 * engraving resolution), trailing zeros stripped, never "-0". Deterministic
 * output keeps golden snapshots stable and export files small.
 */
export function fmt(n: number): string {
  let s = n.toFixed(4)
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
  return s === '-0' ? '0' : s
}

/** Full-circle annulus as a two-subpath even-odd path. */
export function annulusPathD(rOuterMM: number, rInnerMM: number): string {
  const ring = (r: number, sweep: 0 | 1) => {
    const rs = fmt(r)
    return `M 0 ${fmt(-r)} A ${rs} ${rs} 0 1 ${sweep} 0 ${rs} A ${rs} ${rs} 0 1 ${sweep} 0 ${fmt(-r)} Z`
  }
  return `${ring(rOuterMM, 1)} ${ring(rInnerMM, 0)}`
}

/** Open arc of an origin-centred circle from a0 to a1 (degrees, clockwise per
 *  the polar convention). Exact `A` command — for stroked circle remnants after
 *  region clipping. Callers must not pass a full 360° span (undrawable as one A). */
export function arcPathD(rMM: number, a0Deg: number, a1Deg: number): string {
  const p0 = polarToXY(a0Deg, rMM)
  const p1 = polarToXY(a1Deg, rMM)
  const largeArc = Math.abs(a1Deg - a0Deg) > 180 ? 1 : 0
  const rs = fmt(rMM)
  return `M ${fmt(p0.x)} ${fmt(p0.y)} A ${rs} ${rs} 0 ${largeArc} 1 ${fmt(p1.x)} ${fmt(p1.y)}`
}
