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
