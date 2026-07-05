import { describe, expect, it } from 'vitest'
import { makeHatchLayer, makeRepeatLayer, makeRingLayer } from '../model/types'
import { compileHatch } from './hatch'
import { compileRing } from './ring'
import { compileRepeat } from './repeat'
import { fmt } from './format'
import { polarToXY } from './polar'

describe('fmt', () => {
  it('strips trailing zeros and never emits -0', () => {
    expect(fmt(1.5)).toBe('1.5')
    expect(fmt(2)).toBe('2')
    expect(fmt(0.12345)).toBe('0.1235')
    expect(fmt(-0.00001)).toBe('0')
    expect(fmt(-3.1)).toBe('-3.1')
  })
})

describe('ring compiler', () => {
  it('stroke mode emits an exact circle shape, not a path', () => {
    const out = compileRing(makeRingLayer({ mode: 'stroke', radiusMM: 7.5, strokeMM: 0.2 }))
    expect(out.shapes).toHaveLength(1)
    const s = out.shapes[0]!
    expect(s.kind).toBe('circle')
    if (s.kind === 'circle') {
      expect(s.rMM).toBe(7.5)
      expect(s.paint.stroke?.widthMM).toBe(0.2)
      expect(s.paint.fill).toBe(false)
    }
  })

  it('annulus mode emits a two-subpath even-odd fill', () => {
    const out = compileRing(makeRingLayer({ mode: 'annulus', rInnerMM: 6, rOuterMM: 7 }))
    const s = out.shapes[0]!
    expect(s.kind).toBe('path')
    if (s.kind === 'path') {
      expect(s.fillRule).toBe('evenodd')
      expect(s.d.match(/M /g)).toHaveLength(2)
      expect(s.paint.fill).toBe(true)
    }
  })

  it('annulus tolerates swapped inner/outer radii', () => {
    const out = compileRing(makeRingLayer({ mode: 'annulus', rInnerMM: 7, rOuterMM: 6 }))
    const s = out.shapes[0]!
    if (s.kind === 'path') expect(s.d.startsWith('M 0 -7')).toBe(true)
  })
})

describe('hatch compiler', () => {
  it('emits one def line + exactly N rotations at exact multiples of 360/N', () => {
    const out = compileHatch(makeHatchLayer({ count: 7, rInnerMM: 3, rOuterMM: 8, twistDeg: 0 }))
    const s = out.shapes[0]!
    expect(s.kind).toBe('instanced')
    if (s.kind !== 'instanced') return
    expect(s.transforms).toHaveLength(7)
    // exactness: no accumulation drift — k·360/N computed directly
    expect(s.transforms[6]!.rotateDeg).toBe((6 * 360) / 7)
    expect(s.transforms[0]!.rotateDeg).toBe(0)
    expect(s.def.d).toBe('M 0 -3 L 0 -8')
  })

  it('twist skews the outer endpoint by twistDeg', () => {
    const twist = 30
    const out = compileHatch(makeHatchLayer({ count: 4, rInnerMM: 2, rOuterMM: 6, twistDeg: twist }))
    const s = out.shapes[0]!
    if (s.kind !== 'instanced') return
    const expected = polarToXY(twist, 6)
    expect(s.def.d).toBe(`M 0 -2 L ${fmt(expected.x)} ${fmt(expected.y)}`)
  })

  it('normalizes swapped radii', () => {
    const out = compileHatch(makeHatchLayer({ count: 4, rInnerMM: 8, rOuterMM: 3, twistDeg: 0 }))
    const s = out.shapes[0]!
    if (s.kind === 'instanced') expect(s.def.d).toBe('M 0 -3 L 0 -8')
  })

  it('partial arc distributes exactly count ticks across sweepDeg', () => {
    const out = compileHatch(makeHatchLayer({ count: 30, sweepDeg: 90 }))
    const s = out.shapes[0]!
    if (s.kind !== 'instanced') return
    expect(s.transforms).toHaveLength(30)
    expect(s.transforms[0]!.rotateDeg).toBe(0)
    expect(s.transforms[1]!.rotateDeg).toBe(90 / 30) // exact 3° pitch
    expect(s.transforms[29]!.rotateDeg).toBe((29 * 90) / 30) // 87°, still inside the arc
    expect(s.transforms.every((t) => t.rotateDeg < 90)).toBe(true)
    expect(out.warnings).toEqual([])
  })

  it('repeats place the arc block at exact 360/repeats offsets (no drift)', () => {
    const out = compileHatch(makeHatchLayer({ count: 5, sweepDeg: 40, repeats: 3 }))
    const s = out.shapes[0]!
    if (s.kind !== 'instanced') return
    expect(s.transforms).toHaveLength(15) // count × repeats
    expect(s.transforms[0]!.rotateDeg).toBe(0)
    expect(s.transforms[5]!.rotateDeg).toBe(120) // block 1 start
    expect(s.transforms[10]!.rotateDeg).toBe(240) // block 2 start
    expect(s.transforms[13]!.rotateDeg).toBe(240 + (3 * 40) / 5) // block 2, tick 3
  })

  it('warns when repeated arcs overlap', () => {
    const out = compileHatch(makeHatchLayer({ count: 10, sweepDeg: 200, repeats: 3 }))
    expect(out.warnings.some((w) => /overlap/.test(w))).toBe(true)
  })
})

const noAssets = () => null

describe('repeat compiler', () => {
  it('emits exactly N transforms with exact angles and the radius in the def', () => {
    const out = compileRepeat(makeRepeatLayer({ count: 48, radiusMM: 6.5, sizeMM: 0.9, rows: 1 }), noAssets)
    expect(out.shapes).toHaveLength(1)
    const s = out.shapes[0]!
    if (s.kind !== 'instanced') return
    expect(s.transforms).toHaveLength(48)
    expect(s.transforms[13]!.rotateDeg).toBe((13 * 360) / 48)
    expect(s.def.dy).toBe(-6.5)
    expect(s.def.scale).toBe(0.9)
  })

  it('staggerRow2 offsets row 2 by exactly half a step; flipRow2 mirrors radially', () => {
    const out = compileRepeat(
      makeRepeatLayer({ count: 40, rows: 2, staggerRow2: true, flipRow2: true, rowGapMM: 1, radiusMM: 6 }),
      noAssets,
    )
    expect(out.shapes).toHaveLength(2)
    const row1 = out.shapes[0]!
    const row2 = out.shapes[1]!
    if (row1.kind !== 'instanced' || row2.kind !== 'instanced') return
    expect(row1.transforms[0]!.rotateDeg).toBe(0)
    expect(row2.transforms[0]!.rotateDeg).toBe(180 / 40)
    expect(row2.transforms[5]!.rotateDeg).toBe(180 / 40 + (5 * 360) / 40)
    expect(row1.def.flipY).toBe(1)
    expect(row2.def.flipY).toBe(-1)
    expect(row2.def.dy).toBe(-5)
  })

  it('alternateFlip mirrors odd instances only', () => {
    const out = compileRepeat(makeRepeatLayer({ count: 6, alternateFlip: true }), noAssets)
    const s = out.shapes[0]!
    if (s.kind !== 'instanced') return
    expect(s.transforms.map((t) => t.mirrorX)).toEqual([false, true, false, true, false, true])
  })

  it('upright alignment uses pure translations at exact polar positions', () => {
    const out = compileRepeat(makeRepeatLayer({ count: 4, align: 'upright', radiusMM: 5 }), noAssets)
    const s = out.shapes[0]!
    if (s.kind !== 'instanced') return
    expect(s.def.dy).toBe(0)
    const t1 = s.transforms[1]!
    expect(t1.rotateDeg).toBe(0)
    const p = polarToXY(90, 5)
    expect(t1.dx).toBeCloseTo(p.x, 12)
    expect(t1.dy).toBeCloseTo(p.y, 12)
  })

  it('stroke-type motifs carry the layer stroke width; fill motifs fill', () => {
    const chevron = compileRepeat(
      makeRepeatLayer({ source: { kind: 'builtin', motifId: 'chevron' }, strokeMM: 0.14 }),
      noAssets,
    )
    const wedge = compileRepeat(makeRepeatLayer({ source: { kind: 'builtin', motifId: 'wedge' } }), noAssets)
    const c = chevron.shapes[0]!
    const w = wedge.shapes[0]!
    if (c.kind === 'instanced') {
      expect(c.paint.fill).toBe(false)
      expect(c.paint.stroke?.widthMM).toBe(0.14)
    }
    if (w.kind === 'instanced') {
      expect(w.paint.fill).toBe(true)
      expect(w.paint.stroke).toBeNull()
    }
  })

  it('applies the layer cap and omits join when miter (golden-safe default)', () => {
    const out = compileRepeat(
      makeRepeatLayer({ source: { kind: 'builtin', motifId: 'chevron' }, cap: 'round', join: 'miter' }),
      noAssets,
    )
    const s = out.shapes[0]!
    if (s.kind !== 'instanced') return
    expect(s.paint.stroke?.cap).toBe('round')
    expect('join' in (s.paint.stroke as object)).toBe(false) // miter default → no key emitted
  })

  it('carries a non-miter join and a square cap onto the stroke paint', () => {
    const out = compileRepeat(
      makeRepeatLayer({ source: { kind: 'builtin', motifId: 'chevron' }, cap: 'square', join: 'round' }),
      noAssets,
    )
    const s = out.shapes[0]!
    if (s.kind !== 'instanced') return
    expect(s.paint.stroke?.cap).toBe('square')
    expect(s.paint.stroke?.join).toBe('round')
  })
})
