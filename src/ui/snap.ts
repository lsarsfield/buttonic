/**
 * Snapping: radii to 0.1 mm, angles to 1°. Shift coarsens (0.5 mm / 5°),
 * Alt bypasses, and the whole system honours the toolbar magnet toggle.
 */

export interface SnapModifiers {
  shiftKey: boolean
  altKey: boolean
}

export function snapRadius(rMM: number, e: SnapModifiers, enabled: boolean): number {
  if (!enabled || e.altKey) return rMM
  const step = e.shiftKey ? 0.5 : 0.1
  return Math.round(rMM / step) * step
}

export function snapAngle(deg: number, e: SnapModifiers, enabled: boolean): number {
  if (!enabled || e.altKey) return deg
  const step = e.shiftKey ? 5 : 1
  return Math.round(deg / step) * step
}
