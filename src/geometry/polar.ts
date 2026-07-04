/**
 * Polar ⇄ cartesian conversion — the single place the angle convention lives.
 *
 * Convention (locked by polar.test.ts, relied on everywhere):
 *   - lengths in mm, SVG y-down coordinates, origin at the button centre
 *   - angles in degrees, 0° at 12 o'clock, positive clockwise on screen
 *
 * Hence polarToXY(0, r) = (0, -r) and polarToXY(90, r) = (r, 0).
 */

export const DEG2RAD = Math.PI / 180
export const RAD2DEG = 180 / Math.PI

/** Normalize an angle to [0, 360). */
export function normDeg(deg: number): number {
  const d = deg % 360
  return d < 0 ? d + 360 : d
}

export interface XY {
  x: number
  y: number
}

export function polarToXY(thetaDeg: number, rMM: number): XY {
  const t = thetaDeg * DEG2RAD
  return { x: rMM * Math.sin(t), y: -rMM * Math.cos(t) }
}

export function xyToPolar(x: number, y: number): { thetaDeg: number; rMM: number } {
  return { thetaDeg: normDeg(Math.atan2(x, -y) * RAD2DEG), rMM: Math.hypot(x, y) }
}
