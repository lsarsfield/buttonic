import { describe, expect, it } from 'vitest'
import {
  baseProfile,
  buildHeightField,
  RELIEF_DEFAULTS,
  signedDistance,
  wallProfile,
  type ReliefParams,
} from './heightField'

// 0.03 mm/px: the kernel's pixel-sized smoothing is tuned for fine rasters (0.008 mm/px live)
const N = 512
const SPAN = 16
const MMPX = SPAN / N

/** Coverage of an analytic disc (radius mm, centred), 4×4 supersampled per pixel. */
function discCoverage(rMM: number, cx = 0, cy = 0): Float32Array {
  const cov = new Float32Array(N * N)
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let hit = 0
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const wx = -SPAN / 2 + (x + (sx + 0.5) / 4) * MMPX - cx
          const wy = -SPAN / 2 + (y + (sy + 0.5) / 4) * MMPX - cy
          if (wx * wx + wy * wy <= rMM * rMM) hit++
        }
      }
      cov[y * N + x] = hit / 16
    }
  }
  return cov
}

const px = (xMM: number, yMM: number) => {
  const x = Math.floor((xMM + SPAN / 2) / MMPX)
  const y = Math.floor((yMM + SPAN / 2) / MMPX)
  return y * N + x
}
const pxCentre = (i: number) => ({
  x: -SPAN / 2 + ((i % N) + 0.5) * MMPX,
  y: -SPAN / 2 + (Math.floor(i / N) + 0.5) * MMPX,
})

const params = (patch: Partial<ReliefParams> = {}): ReliefParams => ({
  relief: 'raised',
  faceR: 7.5,
  holeR: 0,
  ...RELIEF_DEFAULTS,
  ...patch,
})

describe('signed distance', () => {
  it('matches the analytic distance to a disc edge within a pixel, positive inside', () => {
    const R = 3
    const sd = signedDistance(discCoverage(R), N, MMPX)
    for (const [x, y] of [
      [0, 0],
      [1.2, -0.7],
      [4.5, 0.3],
      [-5.1, 2.2],
      [2.9, 0.4],
    ] as const) {
      const i = px(x, y)
      const c = pxCentre(i)
      const truth = R - Math.hypot(c.x, c.y)
      expect(Math.abs(sd[i]! - truth)).toBeLessThan(MMPX)
    }
  })
})

describe('wall profile', () => {
  it('is 0 on the field, 1 on the art, ½ at the edge', () => {
    expect(wallProfile(-0.03, 0.06)).toBe(0)
    expect(wallProfile(0.03, 0.06)).toBe(1)
    expect(wallProfile(0, 0.06)).toBeCloseTo(0.5, 6)
  })
})

describe('cap profile', () => {
  it('is flat on the face, rolls down at the rim and into the hole', () => {
    const p = params({ holeR: 2 })
    expect(baseProfile(4, p)).toEqual({ y: 0, dydr: 0 })
    const rim = baseProfile(p.faceR, p)
    expect(rim.y).toBeCloseTo(-p.rollMM, 1)
    expect(rim.dydr).toBeLessThan(-10) // near-vertical
    const lip = baseProfile(p.holeR, p)
    expect(lip.y).toBeCloseTo(-p.holeRollMM, 1)
    expect(lip.dydr).toBeGreaterThan(10)
  })
})

describe('height field', () => {
  const cov = discCoverage(2)

  it('raised art stands proud; recessed is its negative', () => {
    const up = buildHeightField(cov, N, SPAN, params())
    const down = buildHeightField(cov, N, SPAN, params({ relief: 'recessed' }))
    // disp is DISP_N² — sample its centre and a far corner
    const n = up.dispN
    const centre = (n / 2) * n + n / 2
    const corner = 10 * n + 10
    expect(up.disp[centre]).toBeCloseTo(RELIEF_DEFAULTS.depthMM, 3)
    expect(up.disp[corner]).toBeCloseTo(0, 6)
    expect(down.disp[centre]).toBeCloseTo(-RELIEF_DEFAULTS.depthMM, 3)
    for (let i = 0; i < n * n; i += 997) expect(down.disp[i]).toBeCloseTo(-up.disp[i]!, 6)
  })

  it('normals point up on flat ground and tilt outward on a raised wall', () => {
    const f = buildHeightField(cov, N, SPAN, params())
    const nrm = (i: number) => [f.normal[i * 4]! / 127.5 - 1, f.normal[i * 4 + 1]! / 127.5 - 1, f.normal[i * 4 + 2]! / 127.5 - 1]
    const flat = nrm(px(4, 4)) // on the flat face, clear of the rolled shoulder
    expect(flat[1]).toBeGreaterThan(0.99)
    // on the +x wall of a raised disc the surface falls away toward +x → normal leans +x
    const wall = nrm(px(2, 0.01))
    expect(wall[0]).toBeGreaterThan(0.2)
  })

  it('cavity darkens the low ground hemmed in by art, not open ground', () => {
    // a narrow ring slot: art between r 1.5 and 3 with a 0.25 mm gap at r ≈ 2.2
    const ring = new Float32Array(N * N)
    const a = discCoverage(3)
    const b = discCoverage(2.35)
    const c = discCoverage(2.1)
    for (let i = 0; i < N * N; i++) ring[i] = Math.min(1, Math.max(0, a[i]! - b[i]! + c[i]!))
    const f = buildHeightField(ring, N, SPAN, params())
    const ao = (i: number) => f.surface[i * 4]!
    expect(ao(px(2.22, 0.05))).toBeLessThan(ao(px(6, 6)) - 20)
  })
})
