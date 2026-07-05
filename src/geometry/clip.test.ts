import { describe, expect, it } from 'vitest'
import { makeHatchLayer, makeRingLayer } from '../model/types'
import {
  clipCompiled,
  clipSegmentOutsideCircle,
  clipSegmentOutsideRegions,
  splitCircleOutsideRegions,
} from './clip'
import { compileHatch } from './hatch'
import { compileRing } from './ring'
import { expandInstanced } from './expand'
import { instanceMatrix } from './expand'
import { apply } from './mat2d'
import { multiPolygonArea, pathToMultiPolygon, pointInMultiPolygon, type MultiPolygon } from './poly'

/** Axis-aligned square region, half-width h, centred at (cx,cy). */
const squareRegion = (cx: number, cy: number, h: number): MultiPolygon => [
  [
    [
      [cx - h, cy - h],
      [cx + h, cy - h],
      [cx + h, cy + h],
      [cx - h, cy + h],
    ],
  ],
]

describe('clipSegmentOutsideCircle', () => {
  it('removes a segment fully inside the disc', () => {
    expect(clipSegmentOutsideCircle(0, -1, 0.5, 0.5, 2)).toBeNull()
  })

  it('keeps a segment fully outside untouched', () => {
    const seg = clipSegmentOutsideCircle(0, -5, 0, -3, 2)
    expect(seg).toEqual({ ax: 0, ay: -5, bx: 0, by: -3 })
  })

  it('clips a crossing segment so the cut endpoint lies exactly on the circle', () => {
    const seg = clipSegmentOutsideCircle(0, -1, 0, -6, 2.3)
    expect(seg).not.toBeNull()
    expect(Math.hypot(seg!.ax, seg!.ay)).toBeCloseTo(2.3, 9)
    expect(seg!.bx).toBeCloseTo(0, 12)
    expect(seg!.by).toBeCloseTo(-6, 12)
  })
})

describe('clipCompiled on hatch', () => {
  it('clips the shared def once and every rotated instance clears the moat', () => {
    const compiled = compileHatch(makeHatchLayer({ count: 24, rInnerMM: 1.3, rOuterMM: 4, twistDeg: 0 }))
    const clipped = clipCompiled(compiled, { discs: [{ rMM: 2.3 }], regions: [] }, 0.0025)
    const s = clipped.shapes[0]!
    expect(s.kind).toBe('instanced')
    if (s.kind !== 'instanced') return
    // def now starts on the clearance circle
    const m = s.def.d.match(/^M ([-\d.e]+) ([-\d.e]+) L/)
    expect(m).not.toBeNull()
    expect(Math.hypot(Number(m![1]), Number(m![2]))).toBeCloseTo(2.3, 6)
    // spot-check an actual instance endpoint after rotation
    const inner = { x: Number(m![1]), y: Number(m![2]) }
    for (const tr of s.transforms) {
      const p = apply(instanceMatrix(tr), inner.x, inner.y)
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(2.3, 6)
    }
  })

  it('drops circles fully inside the moat, keeps larger ones', () => {
    const clipped = clipCompiled(
      {
        shapes: [
          { kind: 'circle', rMM: 1.5, paint: { fill: false, stroke: { widthMM: 0.1, cap: 'butt' } } },
          { kind: 'circle', rMM: 5, paint: { fill: false, stroke: { widthMM: 0.1, cap: 'butt' } } },
        ],
        warnings: [],
      },
      { discs: [{ rMM: 2 }], regions: [] },
      0.0025,
    )
    expect(clipped.shapes).toHaveLength(1)
    const kept = clipped.shapes[0]!
    if (kept.kind === 'circle') expect(kept.rMM).toBe(5)
  })
})

describe('expandInstanced', () => {
  it('bakes N instances into N plain paths at exact rotations', () => {
    const compiled = compileHatch(makeHatchLayer({ count: 8, rInnerMM: 2, rOuterMM: 6, twistDeg: 0 }))
    const s = compiled.shapes[0]!
    if (s.kind !== 'instanced') throw new Error('expected instanced')
    const flat = expandInstanced(s)
    expect(flat).toHaveLength(8)
    // instance 2 (90°): inner endpoint rotates (0,-2) → (2,0)
    const third = flat[2]!
    if (third.kind !== 'path') throw new Error('expected path')
    const m = third.d.match(/^M ([-\d.]+) ([-\d.]+)/)
    expect(Number(m![1])).toBeCloseTo(2, 9)
    expect(Number(m![2])).toBeCloseTo(0, 9)
  })
})

describe('region clipping', () => {
  it('segment vs a centred square → two pieces cut exactly at the square edges', () => {
    const region = [squareRegion(0, 0, 1)]
    const pieces = clipSegmentOutsideRegions(-5, 0, 5, 0, region)
    expect(pieces).toHaveLength(2)
    expect(pieces[0]!.bx).toBeCloseTo(-1, 9) // enters square at x=-1
    expect(pieces[1]!.ax).toBeCloseTo(1, 9) // exits at x=1
    // fully inside → nothing; fully outside → one identical piece
    expect(clipSegmentOutsideRegions(0, 0, 0.5, 0, region)).toHaveLength(0)
    const outside = clipSegmentOutsideRegions(2, 0, 3, 0, region)
    expect(outside).toHaveLength(1)
    expect(outside[0]).toMatchObject({ ax: 2, ay: 0, bx: 3, by: 0 })
  })

  it('circle split: enclosed → drop, disjoint → keep, straddling → arcs', () => {
    expect(splitCircleOutsideRegions(0.5, [squareRegion(0, 0, 5)])).toBe('drop')
    expect(splitCircleOutsideRegions(5, [squareRegion(20, 0, 1)])).toBe('keep')
    const arcs = splitCircleOutsideRegions(5, [squareRegion(5, 0, 1)])
    expect(Array.isArray(arcs)).toBe(true)
    if (Array.isArray(arcs)) {
      const swept = arcs.reduce((s, [a0, a1]) => s + (a1 - a0), 0)
      expect(swept).toBeGreaterThan(330) // only a ~23° notch removed near 3 o'clock
      expect(swept).toBeLessThan(350)
    }
  })

  it('hatch under a region is clipped clear of the region', () => {
    const compiled = compileHatch(makeHatchLayer({ count: 60, rInnerMM: 3, rOuterMM: 8, twistDeg: 0 }))
    const region = squareRegion(0, -5.5, 1) // straddles the band at 12 o'clock
    const out = clipCompiled(compiled, { discs: [], regions: [region] }, 0.0025)
    expect(out.shapes.some((s) => s.kind !== 'instanced')).toBe(true) // expanded
    // every emitted segment midpoint must be outside the region (per subpath —
    // a clipped tick emits several M…L pieces; never bridge across an M)
    const subpaths: Array<Array<[number, number]>> = []
    for (const s of out.shapes) {
      if (s.kind === 'line') subpaths.push([[s.x1, s.y1], [s.x2, s.y2]])
      else if (s.kind === 'path') {
        for (const sub of s.d.split('M').filter((x) => x.trim())) {
          const pts: Array<[number, number]> = []
          for (const m of sub.matchAll(/([-\d.]+)\s+([-\d.]+)/g)) pts.push([Number(m[1]), Number(m[2])])
          subpaths.push(pts)
        }
      }
    }
    for (const pts of subpaths) {
      for (let i = 0; i + 1 < pts.length; i++) {
        const mx = (pts[i]![0] + pts[i + 1]![0]) / 2
        const my = (pts[i]![1] + pts[i + 1]![1]) / 2
        expect(pointInMultiPolygon(mx, my, region)).toBe(false)
      }
    }
  })

  it('annulus fill minus a straddling square → one evenodd path, area reduced', () => {
    const compiled = compileRing(makeRingLayer({ mode: 'annulus', rInnerMM: 6, rOuterMM: 8 }))
    const region = squareRegion(0, -7, 1) // bites the band at 12 o'clock
    const out = clipCompiled(compiled, { discs: [], regions: [region] }, 0.0025)
    expect(out.shapes).toHaveLength(1)
    const s = out.shapes[0]!
    expect(s.kind).toBe('path')
    if (s.kind === 'path') {
      expect(s.fillRule).toBe('evenodd')
      const before = multiPolygonArea(pathToMultiPolygon(compiled.shapes[0]! && (compiled.shapes[0] as { d: string }).d, 'evenodd', 0.0025))
      const after = multiPolygonArea(pathToMultiPolygon(s.d, 'evenodd', 0.0025))
      expect(after).toBeLessThan(before) // a bite was taken
      expect(after).toBeGreaterThan(before * 0.9) // but only a bite
    }
  })

  it('empty keepouts return the compiled object unchanged (golden discipline)', () => {
    const compiled = compileHatch(makeHatchLayer({ count: 24 }))
    expect(clipCompiled(compiled, { discs: [], regions: [] }, 0.01)).toBe(compiled)
  })
})
