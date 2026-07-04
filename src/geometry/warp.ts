import type { Box } from './pathData'
import { distToSegment, type Pt, type SubPath } from './flatten'
import { fmt } from './format'
import { polarToXY, RAD2DEG } from './polar'

/**
 * Non-affine warps. The pipeline is flatten-then-warp — never warp bezier
 * control points (the polar map is not affine; a bezier's image is not a
 * bezier). After mapping each source vertex, segments are adaptively
 * subdivided IN WARPED SPACE: a straight horizontal source segment must
 * densify into an arc, while a radial segment stays exactly two points.
 */

export type WarpFn = (p: Pt) => Pt

export interface AnnulusBand {
  startDeg: number
  sweepDeg: number
  rInnerMM: number
  rOuterMM: number
  /** Swap the radial mapping (art top faces the centre — bottom-of-button placement). */
  flipRadial?: boolean
  /** Mirror the source horizontally (for alternating herringbone repeats). */
  mirrorX?: boolean
}

/** Source bbox → annulus: x → angle, y → radius (top of the art faces outward). */
export function annulusWarp(box: Box, band: AnnulusBand): WarpFn {
  const w = box.w || 1
  const h = box.h || 1
  return (p) => {
    let u = (p.x - box.x) / w
    if (band.mirrorX) u = 1 - u
    const v = (p.y - box.y) / h
    const theta = band.startDeg + u * band.sweepDeg
    const r = band.flipRadial
      ? band.rInnerMM + v * (band.rOuterMM - band.rInnerMM)
      : band.rOuterMM - v * (band.rOuterMM - band.rInnerMM)
    return polarToXY(theta, r)
  }
}

/**
 * Text-baseline warp: y = 0 maps onto the circle of `radiusMM` with arc
 * length preserved along the baseline (undistorted where it matters).
 * Outward: +x advances clockwise, glyph tops (−y) point away from the centre.
 * Inward: reversed, so text laid left-to-right reads left-to-right at the
 * bottom of the button.
 */
export function baselineWarp(radiusMM: number, startDeg: number, direction: 'outward' | 'inward'): WarpFn {
  const dir = direction === 'outward' ? 1 : -1
  return (p) => {
    const theta = startDeg + dir * (p.x / radiusMM) * RAD2DEG
    const r = radiusMM - dir * p.y
    return polarToXY(theta, r)
  }
}

/** `sweepMode: auto` — sweep that keeps the art locally undistorted at mid-radius. */
export function autoSweepDeg(box: Box, rInnerMM: number, rOuterMM: number): number {
  const rMid = Math.max(0.1, (rInnerMM + rOuterMM) / 2)
  const h = box.h || 1
  return ((box.w / h) * (rOuterMM - rInnerMM)) / rMid * RAD2DEG
}

const MAX_DEPTH = 20
const WELD_EPS = 1e-6

function refine(
  srcA: Pt,
  srcB: Pt,
  dstA: Pt,
  dstB: Pt,
  warp: WarpFn,
  tol: number,
  depth: number,
  out: Pt[],
): void {
  const srcM = { x: (srcA.x + srcB.x) / 2, y: (srcA.y + srcB.y) / 2 }
  const dstM = warp(srcM)
  if (depth >= MAX_DEPTH || distToSegment(dstM, dstA, dstB) <= tol) {
    out.push(dstB)
    return
  }
  refine(srcA, srcM, dstA, dstM, warp, tol, depth + 1, out)
  refine(srcM, srcB, dstM, dstB, warp, tol, depth + 1, out)
}

export function warpPolyline(pts: Pt[], warp: WarpFn, tolMM: number): Pt[] {
  if (pts.length === 0) return []
  const first = warp(pts[0]!)
  const out: Pt[] = [first]
  for (let i = 1; i < pts.length; i++) {
    const srcA = pts[i - 1]!
    const srcB = pts[i]!
    const dstA = out[out.length - 1]!
    const dstB = warp(srcB)
    refine(srcA, srcB, dstA, dstB, warp, tolMM, 0, out)
  }
  return weld(out)
}

/** Drop consecutive duplicates (e.g. the 0°/360° seam) within numeric noise. */
function weld(pts: Pt[]): Pt[] {
  const out: Pt[] = []
  for (const p of pts) {
    const prev = out[out.length - 1]
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > WELD_EPS) out.push(p)
  }
  return out
}

export function warpSubPaths(subs: SubPath[], warp: WarpFn, tolMM: number): SubPath[] {
  return subs
    .map((sub) => {
      let pts = warpPolyline(sub.pts, warp, tolMM)
      if (sub.closed && pts.length > 2) {
        const first = pts[0]!
        const last = pts[pts.length - 1]!
        // seam closure: snap the final vertex onto the start before Z
        if (Math.hypot(first.x - last.x, first.y - last.y) <= WELD_EPS) pts = pts.slice(0, -1)
      }
      return { pts, closed: sub.closed }
    })
    .filter((sub) => sub.pts.length > 1)
}

/** Polyline subpaths → L-only path data (the only place polylines become paths). */
export function subPathsToD(subs: SubPath[]): string {
  const parts: string[] = []
  for (const sub of subs) {
    const [first, ...rest] = sub.pts
    if (!first) continue
    parts.push(`M ${fmt(first.x)} ${fmt(first.y)}`)
    for (const p of rest) parts.push(`L ${fmt(p.x)} ${fmt(p.y)}`)
    if (sub.closed) parts.push('Z')
  }
  return parts.join(' ')
}
