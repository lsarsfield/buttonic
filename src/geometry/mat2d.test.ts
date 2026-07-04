import { describe, expect, it } from 'vitest'
import { apply, mul, parseTransform, rotation, scaling, translation } from './mat2d'

describe('mat2d', () => {
  it('composes in application order: mul(A, B) applies B first', () => {
    // translate(10,0) after scale(2): point (1,0) → scale → (2,0) → translate → (12,0)
    const m = mul(translation(10, 0), scaling(2, 2))
    const p = apply(m, 1, 0)
    expect(p.x).toBeCloseTo(12, 12)
    expect(p.y).toBeCloseTo(0, 12)
  })

  it('rotation is clockwise in y-down SVG coordinates', () => {
    const p = apply(rotation(90), 1, 0)
    expect(p.x).toBeCloseTo(0, 12)
    expect(p.y).toBeCloseTo(1, 12) // (1,0) rotates to (0,1) = downward = clockwise on screen
  })

  it('parses SVG transform sequences left-to-right', () => {
    const m = parseTransform('translate(5 5) rotate(90) scale(2)')
    // (1,0): scale→(2,0), rotate→(0,2), translate→(5,7)
    const p = apply(m, 1, 0)
    expect(p.x).toBeCloseTo(5, 9)
    expect(p.y).toBeCloseTo(7, 9)
  })

  it('parses rotate with a centre and matrix()', () => {
    const rotAt = parseTransform('rotate(180 5 0)')
    const p = apply(rotAt, 0, 0)
    expect(p.x).toBeCloseTo(10, 9)
    expect(p.y).toBeCloseTo(0, 9)

    const mat = parseTransform('matrix(1 0 0 1 3 4)')
    const q = apply(mat, 1, 1)
    expect(q.x).toBeCloseTo(4, 12)
    expect(q.y).toBeCloseTo(5, 12)
  })

  it('nested group CTMs bake to known coordinates', () => {
    // <g transform="translate(10,0)"><g transform="rotate(90)"><g transform="scale(3)">
    const ctm = mul(parseTransform('translate(10 0)'), mul(parseTransform('rotate(90)'), parseTransform('scale(3)')))
    const p = apply(ctm, 1, 0)
    expect(p.x).toBeCloseTo(10, 9)
    expect(p.y).toBeCloseTo(3, 9)
  })
})
