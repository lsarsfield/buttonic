import { describe, expect, it } from 'vitest'
import { makeHatchLayer } from '../model/types'
import { clipCompiled, clipSegmentOutsideCircle } from './clip'
import { compileHatch } from './hatch'
import { expandInstanced } from './expand'
import { instanceMatrix } from './expand'
import { apply } from './mat2d'

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
    const clipped = clipCompiled(compiled, [{ rMM: 2.3 }])
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
      [{ rMM: 2 }],
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
