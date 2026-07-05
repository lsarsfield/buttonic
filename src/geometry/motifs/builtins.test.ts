import { describe, expect, it } from 'vitest'
import { parsePathData } from '../pathData'
import { BUILTIN_MOTIFS, getBuiltinMotif } from './builtins'

/**
 * Cheap guard over the whole motif library: every motif's path parses, stays
 * inside the unit box, and carries valid metadata. Catches a typo'd `d` or a
 * stray out-of-box coordinate before it reaches a die.
 */
describe('builtin motif library', () => {
  it('has unique ids and valid metadata', () => {
    const ids = new Set<string>()
    for (const m of BUILTIN_MOTIFS) {
      expect(m.id, 'non-empty id').toBeTruthy()
      expect(ids.has(m.id), `duplicate id "${m.id}"`).toBe(false)
      ids.add(m.id)
      expect(m.label, `${m.id} label`).toBeTruthy()
      expect(m.group, `${m.id} group`).toBeTruthy()
      expect(['fill', 'stroke']).toContain(m.paintType)
    }
  })

  it('every path parses to M/L/C/Z and stays within the unit box', () => {
    for (const m of BUILTIN_MOTIFS) {
      const segs = parsePathData(m.d)
      expect(segs.length, `${m.id} yields segments`).toBeGreaterThan(0)
      for (const s of segs) {
        const coords =
          s.type === 'C'
            ? [s.x1, s.y1, s.x2, s.y2, s.x, s.y]
            : s.type === 'Z'
              ? []
              : [s.x, s.y]
        for (const c of coords) {
          expect(Math.abs(c), `${m.id} coord ${c} within box`).toBeLessThanOrEqual(0.85)
        }
      }
    }
  })

  it('resolves known ids and rejects unknown', () => {
    expect(getBuiltinMotif('daisy')?.label).toBe('Daisy')
    expect(getBuiltinMotif('fleurdelis')?.group).toBe('Old Book')
    expect(getBuiltinMotif('not-a-motif')).toBeNull()
  })

  it('covers both new themes plus the originals', () => {
    const groups = new Set(BUILTIN_MOTIFS.map((m) => m.group))
    expect(groups.has('Basic')).toBe(true)
    expect(groups.has('Groovy')).toBe(true)
    expect(groups.has('Old Book')).toBe(true)
  })
})
