import { describe, expect, it } from 'vitest'
import { flattenSegs, type Pt } from './flatten'
import { parsePathData } from './pathData'
import { xyToPolar, normDeg } from './polar'
import { annulusWarp, autoSweepDeg, subPathsToD, warpPolyline, warpSubPaths } from './warp'

const BOX = { x: 0, y: 0, w: 100, h: 20 }
const BAND = { startDeg: 0, sweepDeg: 180, rInnerMM: 5, rOuterMM: 7 }
const TOL = 0.01

describe('flatten', () => {
  it('a straight line stays exactly 2 points', () => {
    const subs = flattenSegs(parsePathData('M 0 0 L 100 0'), 0.001)
    expect(subs).toHaveLength(1)
    expect(subs[0]!.pts).toHaveLength(2)
  })

  it('pathological cubics stay within the chord tolerance', () => {
    // cusp-ish and loop-ish curves
    const cases = [
      'M 0 0 C 100 0 0 100 100 100',
      'M 0 0 C 150 50 -50 50 100 0',
      'M 0 0 C 0 0 100 100 100 100', // degenerate colinear controls
    ]
    for (const d of cases) {
      const tol = 0.05
      const subs = flattenSegs(parsePathData(d), tol)
      const pts = subs[0]!.pts
      // sample the true curve densely and check distance to the polyline
      const seg = parsePathData(d)[1]!
      if (seg.type !== 'C') throw new Error('expected cubic')
      for (let i = 0; i <= 200; i++) {
        const t = i / 200
        const mt = 1 - t
        const x =
          mt * mt * mt * 0 + 3 * mt * mt * t * seg.x1 + 3 * mt * t * t * seg.x2 + t * t * t * seg.x
        const y =
          mt * mt * mt * 0 + 3 * mt * mt * t * seg.y1 + 3 * mt * t * t * seg.y2 + t * t * t * seg.y
        let best = Infinity
        for (let j = 1; j < pts.length; j++) {
          best = Math.min(best, distToSeg({ x, y }, pts[j - 1]!, pts[j]!))
        }
        // chord tolerance plus a small numerical allowance
        expect(best).toBeLessThan(tol * 1.5)
      }
    }
  })
})

function distToSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

describe('annulus warp', () => {
  it('horizontal source line → constant-radius arc with monotonic angle', () => {
    const warp = annulusWarp(BOX, BAND)
    const pts = warpPolyline(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      warp,
      TOL,
    )
    expect(pts.length).toBeGreaterThan(20) // a 180° arc must densify
    let prevTheta = -Infinity
    for (const p of pts) {
      const { thetaDeg, rMM } = xyToPolar(p.x, p.y)
      expect(rMM).toBeCloseTo(7, 9) // y=0 = top of box = outer radius
      const t = thetaDeg > 350 ? thetaDeg - 360 : thetaDeg // 0 wraps
      expect(t).toBeGreaterThanOrEqual(prevTheta - 1e-9)
      prevTheta = t
    }
    // sagitta check: consecutive chord midpoints stay within tol of radius 7
    for (let i = 1; i < pts.length; i++) {
      const mx = (pts[i - 1]!.x + pts[i]!.x) / 2
      const my = (pts[i - 1]!.y + pts[i]!.y) / 2
      expect(7 - Math.hypot(mx, my)).toBeLessThan(TOL * 1.5)
    }
  })

  it('vertical source line → exactly 2 points (radial lines never subdivide)', () => {
    const warp = annulusWarp(BOX, BAND)
    const pts = warpPolyline(
      [
        { x: 25, y: 0 },
        { x: 25, y: 20 },
      ],
      warp,
      TOL,
    )
    expect(pts).toHaveLength(2)
    const a = xyToPolar(pts[0]!.x, pts[0]!.y)
    const b = xyToPolar(pts[1]!.x, pts[1]!.y)
    expect(a.thetaDeg).toBeCloseTo(45, 9)
    expect(b.thetaDeg).toBeCloseTo(45, 9)
    expect(a.rMM).toBeCloseTo(7, 12)
    expect(b.rMM).toBeCloseTo(5, 12)
  })

  it('rect corners land at the four expected (θ, r) points', () => {
    const warp = annulusWarp(BOX, { startDeg: 30, sweepDeg: 90, rInnerMM: 4, rOuterMM: 8 })
    const check = (src: Pt, thetaDeg: number, rMM: number) => {
      const p = warp(src)
      const polar = xyToPolar(p.x, p.y)
      expect(polar.thetaDeg).toBeCloseTo(normDeg(thetaDeg), 9)
      expect(polar.rMM).toBeCloseTo(rMM, 9)
    }
    check({ x: 0, y: 0 }, 30, 8) // top-left → start, outer
    check({ x: 100, y: 0 }, 120, 8) // top-right → end, outer
    check({ x: 100, y: 20 }, 120, 4) // bottom-right → end, inner
    check({ x: 0, y: 20 }, 30, 4) // bottom-left → start, inner
  })

  it('flipRadial swaps the radial mapping', () => {
    const warp = annulusWarp(BOX, { ...BAND, flipRadial: true })
    const top = xyToPolar(warp({ x: 0, y: 0 }).x, warp({ x: 0, y: 0 }).y)
    expect(top.rMM).toBeCloseTo(5, 12) // art top now faces the centre
  })

  it('full-circle warp of a closed rect welds the 0°/360° seam', () => {
    const warp = annulusWarp(BOX, { startDeg: 0, sweepDeg: 360, rInnerMM: 5, rOuterMM: 7 })
    const subs = warpSubPaths(
      flattenSegs(parsePathData('M 0 0 L 100 0 L 100 20 L 0 20 Z'), 0.01),
      warp,
      TOL,
    )
    expect(subs).toHaveLength(1)
    const pts = subs[0]!.pts
    expect(subs[0]!.closed).toBe(true)
    // no duplicate seam vertex: first and last differ (Z closes the gap)
    const first = pts[0]!
    const last = pts[pts.length - 1]!
    expect(Math.hypot(first.x - last.x, first.y - last.y)).toBeGreaterThan(1e-6)
    const d = subPathsToD(subs)
    expect(d.endsWith('Z')).toBe(true)
  })

  it('auto sweep preserves arc length at mid-radius within 1%', () => {
    const box = { x: 0, y: 0, w: 40, h: 10 }
    const rIn = 5
    const rOut = 7
    const sweep = autoSweepDeg(box, rIn, rOut)
    const rMid = 6
    const arcLen = (sweep * Math.PI / 180) * rMid
    expect(Math.abs(arcLen - box.w * ((rOut - rIn) / box.h)) / box.w).toBeLessThan(0.01)
  })
})
