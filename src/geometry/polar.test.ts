import { describe, expect, it } from 'vitest'
import { normDeg, polarToXY, xyToPolar } from './polar'

/** Deterministic LCG so the fuzz set never varies between runs. */
function* lcg(seed: number): Generator<number> {
  let s = seed >>> 0
  while (true) {
    s = (s * 1664525 + 1013904223) >>> 0
    yield s / 0x100000000
  }
}

describe('angle convention lock — 0° at 12 o\'clock, clockwise, y-down', () => {
  it('maps the four compass points exactly', () => {
    const r = 5
    const at = (deg: number) => polarToXY(deg, r)
    expect(at(0).x).toBeCloseTo(0, 12)
    expect(at(0).y).toBeCloseTo(-r, 12)
    expect(at(90).x).toBeCloseTo(r, 12)
    expect(at(90).y).toBeCloseTo(0, 12)
    expect(at(180).x).toBeCloseTo(0, 12)
    expect(at(180).y).toBeCloseTo(r, 12)
    expect(at(270).x).toBeCloseTo(-r, 12)
    expect(at(270).y).toBeCloseTo(0, 12)
  })

  it('round-trips xyToPolar ∘ polarToXY for 1000 fuzzed inputs', () => {
    const rand = lcg(0xbeefcafe)
    for (let i = 0; i < 1000; i++) {
      const theta = rand.next().value * 360
      const r = 0.01 + rand.next().value * 12
      const { x, y } = polarToXY(theta, r)
      const back = xyToPolar(x, y)
      expect(back.rMM).toBeCloseTo(r, 9)
      // compare angles on the circle (359.999… ≈ 0)
      const diff = Math.abs(normDeg(back.thetaDeg - theta))
      expect(Math.min(diff, 360 - diff)).toBeLessThan(1e-9)
    }
  })

  it('normalizes angles into [0, 360)', () => {
    expect(normDeg(0)).toBe(0)
    expect(normDeg(360)).toBe(0)
    expect(normDeg(-90)).toBe(270)
    expect(normDeg(725)).toBe(5)
    expect(normDeg(-725)).toBe(355)
  })
})
