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
import { fillPaint, strokePaint, type Shape } from './shapes'

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

describe('tick clipping: EXACT difference (pointed) + tool-pass swath (stroked)', () => {
  // A vertical pointed tick, exactly as compileHatch emits it: inner base at
  // y=-4, outer at y=-7, apex at y=-7.3, half-width 0.105 (stroke 0.21).
  const TICK_D = 'M 0.105 -4 L 0.105 -7 L 0 -7.3 L -0.105 -7 L -0.105 -4 Z'
  const TICK_AREA = 0.21 * 3 + 0.5 * 0.21 * 0.3 // body + apex = 0.6615
  const tickShape = (): Shape => ({ kind: 'path', d: TICK_D, paint: fillPaint() })
  const tickMp = pathToMultiPolygon(TICK_D, 'nonzero', 0.0025)

  const clip = (shape: Shape, region: MultiPolygon) =>
    clipCompiled({ shapes: [shape], warnings: [] }, { discs: [], regions: [region] }, 0.0025).shapes

  const pieces = (shapes: Shape[]) =>
    shapes
      .filter((s): s is Extract<Shape, { kind: 'path' }> => s.kind === 'path')
      .map((s) => [...s.d.matchAll(/([-\d.]+)\s+([-\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) })))

  const shoelace = (pts: Array<{ x: number; y: number }>): number => {
    let a = 0
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!
      const q = pts[(i + 1) % pts.length]!
      a += p.x * q.y - q.x * p.y
    }
    return Math.abs(a / 2)
  }

  const firstPieceMp = (shapes: Shape[]): MultiPolygon => {
    const s = shapes.find((x): x is Extract<Shape, { kind: 'path' }> => x.kind === 'path')!
    return pathToMultiPolygon(s.d, 'nonzero', 0.0025)
  }

  /**
   * Each edge midpoint, nudged 1e-3 toward the piece's LOCAL interior (edge
   * normal — a centroid pull is wrong for notched pieces), clears the region:
   * the exact difference's interior never overlaps the region.
   */
  const assertClear = (poly: Array<{ x: number; y: number }>, region: MultiPolygon) => {
    let a2 = 0
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!
      const q = poly[(i + 1) % poly.length]!
      a2 += p.x * q.y - q.x * p.y
    }
    const sgn = a2 >= 0 ? 1 : -1
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!
      const b = poly[(i + 1) % poly.length]!
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      if (len < 1e-6) continue
      const nx = (-(b.y - a.y) / len) * sgn // inward normal
      const ny = ((b.x - a.x) / len) * sgn
      expect(pointInMultiPolygon((a.x + b.x) / 2 + nx * 1e-3, (a.y + b.y) / 2 + ny * 1e-3, region)).toBe(false)
    }
  }

  it('oblique 45° edge: the cut FOLLOWS the region edge — oblique corners + analytic area', () => {
    // region interior = { y ≥ x−5.5 } ∩ { y ≤ −3.5 }: swallows the tick's inner
    // base with a 45° boundary. Exact difference keeps everything below the
    // line: cut corners at (−0.105,−5.605) and (0.105,−5.395), area 0.6615−0.315.
    const region: MultiPolygon = [[[[-1, -6.5], [1, -4.5], [1, -3.5], [-1, -3.5]]]]
    const out = clip(tickShape(), region)
    const polys = pieces(out)
    expect(polys).toHaveLength(1)
    const piece = polys[0]!
    const hasVertexNear = (x: number, y: number) => piece.some((p) => Math.hypot(p.x - x, p.y - y) < 1e-3)
    expect(hasVertexNear(-0.105, -5.605)).toBe(true) // oblique cut, left corner
    expect(hasVertexNear(0.105, -5.395)).toBe(true) // oblique cut, right corner
    expect(hasVertexNear(0, -7.3)).toBe(true) // apex intact
    expect(shoelace(piece)).toBeCloseTo(TICK_AREA - 0.315, 3)
    assertClear(piece, region)
    // completeness: every clear tick point is kept, every covered one is cut
    const pieceMp = firstPieceMp(out)
    for (const x of [-0.09, 0, 0.09]) {
      for (let y = -6.9; y <= -4.05; y += 0.05) {
        if (Math.abs(y - (x - 5.5)) < 0.02) continue // region-boundary margin
        if (!pointInMultiPolygon(x, y, tickMp)) continue
        expect(pointInMultiPolygon(x, y, pieceMp)).toBe(!pointInMultiPolygon(x, y, region))
      }
    }
  })

  it('corner graze: ONLY the corner is shaved — one notched piece, nothing severed', () => {
    // triangle pokes 0.085 into the left flank, stopping 0.02 short of the
    // centreline. Exact difference = a notch; the tick stays in one piece and
    // material between the graze and the centreline SURVIVES (nothing more cut).
    const region: MultiPolygon = [[[[-0.5, -5.2], [-0.02, -5.0], [-0.5, -4.8]]]]
    const out = clip(tickShape(), region)
    const polys = pieces(out)
    expect(polys).toHaveLength(1)
    const piece = polys[0]!
    expect(piece.length).toBeGreaterThanOrEqual(7) // pentagon + notch vertices
    const bite = 0.096 * (0.085 / 0.48) ** 2 // similar-triangle overlap ≈ 0.00301
    expect(shoelace(piece)).toBeCloseTo(TICK_AREA - bite, 3)
    assertClear(piece, region)
    const pieceMp = firstPieceMp(out)
    expect(pointInMultiPolygon(-0.005, -5.0, pieceMp)).toBe(true) // beside the graze: kept
    expect(pointInMultiPolygon(-0.09, -5.0, pieceMp)).toBe(false) // inside the graze: cut
  })

  it('a region within half-width of the APEX but outside the taper leaves the tick untouched (identity)', () => {
    // beside the pointed tip: inside the bounding rectangle, outside the taper
    const region: MultiPolygon = [[[[0.05, -7.28], [0.12, -7.28], [0.12, -7.18], [0.05, -7.18]]]]
    const shape = tickShape()
    const out = clip(shape, region)
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(shape) // the exact original object — polygon test, not bbox
  })

  it('partial-width overlap: the uncovered part of the tick SURVIVES (nothing more is cut)', () => {
    // rectangle covers the tick's left flank up to x=−0.02 over y∈[−6,−5]; the
    // right side must stand as a partial-width run — exactly tick ∖ region.
    const region: MultiPolygon = [[[[-1, -6], [-0.02, -6], [-0.02, -5], [-1, -5]]]]
    const out = clip(tickShape(), region)
    const polys = pieces(out)
    expect(polys).toHaveLength(1)
    const piece = polys[0]!
    expect(shoelace(piece)).toBeCloseTo(TICK_AREA - 0.085 * 1, 3) // bite = 0.085 × 1
    assertClear(piece, region)
    const pieceMp = firstPieceMp(out)
    expect(pointInMultiPolygon(0.04, -5.5, pieceMp)).toBe(true) // uncovered side stands
    expect(pointInMultiPolygon(-0.06, -5.5, pieceMp)).toBe(false) // covered side cut
  })

  it('stroked tick (tool-pass): endpoint sits where the full width clears — a stroke cannot end obliquely', () => {
    // oblique boundary y = x - 6.5; the stroke edge at x=+0.1 reaches it at
    // y=-6.4 — a full 0.1 (= half-width) before the centreline does at -6.5
    const region: MultiPolygon = [[[[-1, -7.5], [1, -5.5], [1, -8.5], [-1, -8.5]]]]
    const shape: Shape = { kind: 'path', d: 'M 0 -4 L 0 -7', paint: strokePaint(0.2, 'butt') }
    const out = clip(shape, region)
    expect(out).toHaveLength(1)
    const s = out[0]!
    if (s.kind !== 'path') throw new Error('expected path')
    expect((s.d.match(/M/g) || []).length).toBe(1) // outer remnant fully blocked → dropped
    const nums = [...s.d.matchAll(/([-\d.]+)\s+([-\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const)
    expect(nums[0]![1]).toBeCloseTo(-4, 9)
    expect(nums[1]![1]).toBeCloseTo(-6.4, 6) // hw-aware; centreline-only gave -6.5
  })

  it('region swallowing the middle: two pieces with exact horizontal cut boundaries', () => {
    const region: MultiPolygon = [[[[-1, -6.2], [1, -6.2], [1, -5.2], [-1, -5.2]]]]
    const out = pieces(clip(tickShape(), region))
    expect(out).toHaveLength(2)
    const spans = out
      .map((p) => [Math.min(...p.map((q) => q.y)), Math.max(...p.map((q) => q.y))] as const)
      .sort((a, b) => a[0] - b[0])
    expect(spans[0]![0]).toBeCloseTo(-7.3, 4) // apex piece
    expect(spans[0]![1]).toBeCloseTo(-6.2, 4)
    expect(spans[1]![0]).toBeCloseTo(-5.2, 4)
    expect(spans[1]![1]).toBeCloseTo(-4, 4) // inner base piece
    for (const p of out) assertClear(p, region)
  })
})
