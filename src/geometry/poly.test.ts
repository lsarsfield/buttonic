import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as opentype from 'opentype.js'
import { describe, expect, it } from 'vitest'
import { annulusPathD } from './format'
import { glyphPathD } from './glyphs'
import { IDENTITY } from './mat2d'
import type { MultiPolygon, Ring } from './poly'
import {
  dilateMultiPolygon,
  dilatePolylines,
  multiPolygonArea,
  multiPolygonToPathD,
  pathToMultiPolygon,
  pointInMultiPolygon,
  ringsToMultiPolygonNonzero,
  rotateMultiPolygon,
  safeDifference,
  safeUnion,
  safeXor,
  subPathsToRings,
} from './poly'
import { flattenSegs } from './flatten'
import { parsePathData } from './pathData'

function loadFont(rel: string): opentype.Font {
  const path = fileURLToPath(new URL(rel, import.meta.url))
  const buf = readFileSync(path)
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
}
const unifraktur = loadFont('../../public/fonts/unifrakturcook-bold.ttf')

const holeCount = (mp: MultiPolygon) => mp.reduce((s, p) => s + Math.max(0, p.length - 1), 0)
const squareRing = (cx: number, cy: number, h: number): Ring => [
  [cx - h, cy - h],
  [cx + h, cy - h],
  [cx + h, cy + h],
  [cx - h, cy + h],
]
const circleRing = (r: number, n = 96): Ring =>
  Array.from({ length: n }, (_, k) => {
    const a = (2 * Math.PI * k) / n
    return [r * Math.cos(a), r * Math.sin(a)] as [number, number]
  })

describe('winding reconstruction', () => {
  it('a "D" glyph becomes exactly one polygon with one hole (counter preserved)', () => {
    const d = glyphPathD(unifraktur.getPath('D', 0, 0, 20), IDENTITY)
    const mp = pathToMultiPolygon(d, 'nonzero', 0.01)
    expect(mp.length).toBe(1)
    expect(holeCount(mp)).toBe(1)
    // round trip → L-only, >= 2 subpaths
    const backD = multiPolygonToPathD(mp)
    expect(backD).not.toContain('C ')
    expect((backD.match(/M /g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('plain union of the same rings ERASES the counter (documents the trap)', () => {
    const d = glyphPathD(unifraktur.getPath('D', 0, 0, 20), IDENTITY)
    const rings = subPathsToRings(flattenSegs(parsePathData(d), 0.01), true)
    const naive = safeUnion(...rings.map((r) => [r]))!
    expect(holeCount(naive)).toBe(0) // the D's hole is gone
    expect(holeCount(ringsToMultiPolygonNonzero(rings))).toBe(1) // ours keeps it
  })

  it('island-in-counter (Θ: three concentric squares) → two polygons', () => {
    const mp = ringsToMultiPolygonNonzero([squareRing(0, 0, 10), squareRing(0, 0, 6), squareRing(0, 0, 2)])
    expect(mp.length).toBe(2) // outer(+hole) and the inner island
    expect(holeCount(mp)).toBe(1)
  })

  it('evenodd annulus xor has the right area', () => {
    const mp = pathToMultiPolygon(annulusPathD(7, 6), 'evenodd', 0.005)
    expect(multiPolygonArea(mp)).toBeCloseTo(Math.PI * (49 - 36), 0) // within ~0.5%
    expect(holeCount(mp)).toBe(1)
  })
})

describe('dilation (Minkowski with a disc)', () => {
  it('square dilated by r matches the analytic area', () => {
    const r = 0.3
    const mp = dilateMultiPolygon([[squareRing(0, 0, 0.5)]], r, 0.02) // unit square
    const expected = (1 + 2 * r) ** 2 - (4 - Math.PI) * r ** 2
    expect(multiPolygonArea(mp)).toBeGreaterThan(expected * 0.99)
    expect(multiPolygonArea(mp)).toBeLessThan(expected * 1.01)
  })

  it('a single segment dilates to a stadium of the right area', () => {
    const r = 0.3
    const L = 2
    const mp = dilatePolylines([{ pts: [{ x: 0, y: 0 }, { x: L, y: 0 }], closed: false }], r, 0.02)
    const expected = 2 * r * L + Math.PI * r ** 2
    expect(multiPolygonArea(mp)).toBeGreaterThan(expected * 0.99)
    expect(multiPolygonArea(mp)).toBeLessThan(expected * 1.02)
  })

  it('caps are circumscribed — the true offset boundary lies INSIDE the result', () => {
    const r = 0.4
    const mp = dilateMultiPolygon([[squareRing(0, 0, 0.5)]], r, 0.03)
    // points exactly r from the corner (1 o'clock quadrant) must be inside
    for (let a = 0; a <= Math.PI / 2; a += Math.PI / 16) {
      const px = 0.5 + r * Math.cos(a)
      const py = 0.5 + r * Math.sin(a)
      expect(pointInMultiPolygon(px, py, mp)).toBe(true)
    }
  })

  it('a concave L dilates cleanly (one polygon, no holes)', () => {
    const L: Ring = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]]
    const mp = dilateMultiPolygon([[L]], 0.4, 0.03)
    expect(mp.length).toBe(1)
    expect(holeCount(mp)).toBe(0)
  })

  it('holes erode: r < holeRadius shrinks it, r > holeRadius removes it', () => {
    const annulus = safeXor([circleRing(5)], [circleRing(2)])! // outer 5, hole 2
    const areaBefore = multiPolygonArea(annulus)
    const small = dilateMultiPolygon(annulus, 0.5, 0.03)
    expect(multiPolygonArea(small)).toBeGreaterThan(areaBefore) // outer grew, hole shrank
    expect(holeCount(small)).toBe(1)
    const big = dilateMultiPolygon(annulus, 2.5, 0.05) // > hole radius
    expect(holeCount(big)).toBe(0) // hole eroded away
  })
})

describe('rotation + safe wrappers', () => {
  it('rotateMultiPolygon(90°) maps (0,−r) to (r,0)', () => {
    const mp: MultiPolygon = [[[[0, -3], [0.1, -3], [0, -2.9]]]]
    const out = rotateMultiPolygon(mp, 90)
    expect(out[0]![0]![0]![0]).toBeCloseTo(3, 9)
    expect(out[0]![0]![0]![1]).toBeCloseTo(0, 9)
    expect(rotateMultiPolygon(mp, 0)).toBe(mp) // 0° fast path returns same ref
  })

  it('safe wrappers never throw on degenerate input', () => {
    expect(safeUnion()).toEqual([])
    expect(safeUnion([[[0, 0], [0, 0], [0, 0]]])).not.toBeNull() // zero-area
    expect(safeXor()).toEqual([])
    expect(safeDifference([])).toEqual([])
    const disc = safeUnion([circleRing(3)])!
    expect(safeDifference(disc)).toBe(disc) // no clips → subject unchanged
  })
})
