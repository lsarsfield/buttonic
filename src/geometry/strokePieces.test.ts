import { describe, expect, it } from 'vitest'
import { shapeToRegion } from './keepoutRegion'
import { multiPolygonArea, pointInMultiPolygon, safeUnion, type MultiPolygon } from './poly'
import { strokePaint } from './shapes'
import { holdsDisc, linePieces, strokePieces } from './strokePieces'
import type { Pt } from './flatten'

const area = (P: Pt[]) => {
  let a = 0
  for (let i = 0; i < P.length; i++) {
    const p = P[i]!
    const q = P[(i + 1) % P.length]!
    a += p.x * q.y - q.x * p.y
  }
  return Math.abs(a / 2)
}
const toMp = (pieces: Pt[][]): MultiPolygon => safeUnion(...pieces.map((P) => [[P.map((q) => [q.x, q.y] as [number, number])]]))!

describe('stroke outlines (SVG cap/join semantics)', () => {
  it('a round-capped segment is a stadium whose caps bulge OUTWARD past the ends', () => {
    const [P] = linePieces({ x: 0, y: -4 }, { x: 0, y: -6 }, 0.2, 'round', 0.001)
    expect(area(P!)).toBeCloseTo(0.2 * 2 + Math.PI * 0.01, 3)
    const mp = toMp([P!])
    expect(pointInMultiPolygon(0, -6.09, mp)).toBe(true) // beyond the far end
    expect(pointInMultiPolygon(0, -3.91, mp)).toBe(true) // beyond the near end
  })

  it('butt and square caps', () => {
    expect(area(linePieces({ x: 0, y: 0 }, { x: 2, y: 0 }, 0.2, 'butt', 0.001)[0]!)).toBeCloseTo(0.4, 9)
    expect(area(linePieces({ x: 0, y: 0 }, { x: 2, y: 0 }, 0.2, 'square', 0.001)[0]!)).toBeCloseTo(0.44, 9)
  })

  it('a miter join fills the outer corner; bevel cuts it; both leave the inside alone', () => {
    const sub = [{ pts: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }], closed: false }]
    const miter = toMp(strokePieces(sub, 0.2, 'butt', 'miter', 0.001))
    const bevel = toMp(strokePieces(sub, 0.2, 'butt', 'bevel', 0.001))
    expect(pointInMultiPolygon(2.09, -0.09, miter)).toBe(true) // the square outer corner
    expect(pointInMultiPolygon(2.09, -0.09, bevel)).toBe(false)
    expect(multiPolygonArea(miter)).toBeCloseTo(0.8 - 0.01 + 0.01, 6) // two arms − their inner overlap + the outer corner square
  })
})

describe('stroked cut-out regions honour caps and joins', () => {
  it('a butt-capped stroke casts no rounded ends', () => {
    const mp = shapeToRegion({ kind: 'line', x1: 0, y1: 0, x2: 2, y2: 0, paint: strokePaint(0.4, 'butt') }, 0.001, 0.001)
    expect(multiPolygonArea(mp)).toBeCloseTo(0.8, 6)
    expect(pointInMultiPolygon(-0.1, 0, mp)).toBe(false)
  })
  it('a round-capped stroke still casts its round ends', () => {
    const mp = shapeToRegion({ kind: 'line', x1: 0, y1: 0, x2: 2, y2: 0, paint: strokePaint(0.4, 'round') }, 0.001, 0.001)
    expect(pointInMultiPolygon(-0.15, 0, mp)).toBe(true)
  })
  it('a mitered chevron casts its sharp outer corner', () => {
    const d = 'M 0 0 L 1 -1 L 2 0'
    const mp = shapeToRegion({ kind: 'path', d, paint: strokePaint(0.2, 'butt', 'miter') }, 0.001, 0.001)
    // the miter tip sits 0.1·√2 above the apex; a round sweep would stop at 0.1
    expect(pointInMultiPolygon(1, -1 - 0.13, mp)).toBe(true)
  })
})

describe('minimum surviving piece (a 0.05 mm disc must fit somewhere)', () => {
  const r = 0.025
  const P = (pts: [number, number][]) => [pts.map(([x, y]) => ({ x, y }))]
  it('a hairline strip goes, however long', () => {
    expect(holdsDisc(P([[0, 0], [5, 0], [5, 0.04], [0, 0.04]]), r)).toBe(false)
    expect(holdsDisc(P([[0, 0], [5, 5], [5.03, 4.97], [0.03, -0.03]]), r)).toBe(false) // diagonal sliver
  })
  it('a wedge thin on average but thick at one end stays', () => {
    // 1 mm long, 0.1 wide at its base: mean width 2A/P ≈ 0.048 < 0.05, yet it's 0.1 thick
    expect(holdsDisc(P([[0, 0], [1, 0.05], [0, 0.1]]), r)).toBe(true)
  })
  it('a ring with a big hole is judged by its wall, not its extent', () => {
    const sq = (h: number) => [[-h, -h], [h, -h], [h, h], [-h, h]] as [number, number][]
    const thin = [sq(1).map(([x, y]) => ({ x, y })), sq(0.97).reverse().map(([x, y]) => ({ x, y }))]
    const thick = [sq(1).map(([x, y]) => ({ x, y })), sq(0.9).reverse().map(([x, y]) => ({ x, y }))]
    expect(holdsDisc(thin, r)).toBe(false)
    expect(holdsDisc(thick, r)).toBe(true)
  })
})
