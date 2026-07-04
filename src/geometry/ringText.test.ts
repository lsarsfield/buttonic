import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as opentype from 'opentype.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { makeCenterLayer, makeRingTextLayer } from '../model/types'
import { compileCenter } from './center'
import { RAD2DEG } from './polar'
import { compileRingText, ringTextArcDeg } from './ringText'

let garamond: opentype.Font
let cinzel: opentype.Font

function loadFont(rel: string): opentype.Font {
  const path = fileURLToPath(new URL(rel, import.meta.url))
  const buf = readFileSync(path)
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
}

beforeAll(() => {
  garamond = loadFont('../../public/fonts/ebgaramond.ttf')
  cinzel = loadFont('../../public/fonts/cinzel.ttf')
})

describe('ring text layout', () => {
  it('total arc matches Σ(advance + kern + spacing) / r exactly', () => {
    const layer = makeRingTextLayer({
      text: 'ABC',
      sizeMM: 2,
      radiusMM: 6,
      letterSpacingMM: 0.2,
      useKerning: false,
    })
    const scale = 2 / garamond.unitsPerEm
    const glyphs = garamond.stringToGlyphs('ABC')
    const mm =
      glyphs.reduce((s, g) => s + (g.advanceWidth ?? 0) * scale, 0) + 2 * 0.2
    const expected = (mm / 6) * RAD2DEG
    expect(ringTextArcDeg(layer, garamond)).toBeCloseTo(expected, 9)
  })

  it('kerned "AV" spans a smaller angle than unkerned (Cinzel GPOS kerning)', () => {
    const base = { text: 'AV', sizeMM: 2.5, radiusMM: 6, letterSpacingMM: 0 }
    const kerned = ringTextArcDeg(makeRingTextLayer({ ...base, useKerning: true }), cinzel)
    const unkerned = ringTextArcDeg(makeRingTextLayer({ ...base, useKerning: false }), cinzel)
    // sanity: the font must actually kern the pair, else this test is vacuous
    const glyphs = cinzel.stringToGlyphs('AV')
    expect(cinzel.getKerningValue(glyphs[0]!, glyphs[1]!)).toBeLessThan(0)
    expect(kerned).toBeLessThan(unkerned)
  })

  it('compiles to a single fill path with content', () => {
    const out = compileRingText(makeRingTextLayer({ text: 'RIVET' }), garamond)
    expect(out.shapes).toHaveLength(1)
    const s = out.shapes[0]!
    if (s.kind === 'path') {
      expect(s.d).toMatch(/^M /)
      expect(s.paint.fill).toBe(true)
      expect((s.d.match(/M /g) ?? []).length).toBeGreaterThanOrEqual(5)
    } else {
      throw new Error('expected path shape')
    }
  })

  it('warns when text exceeds a full circle', () => {
    const out = compileRingText(
      makeRingTextLayer({ text: 'MMMMMMMMMMMMMMMMMMMM', sizeMM: 4, radiusMM: 2 }),
      garamond,
    )
    expect(out.warnings.some((w) => w.includes('°'))).toBe(true)
  })

  it('returns a loading warning without a font', () => {
    const out = compileRingText(makeRingTextLayer({ text: 'X' }), null)
    expect(out.shapes).toHaveLength(0)
    expect(out.warnings[0]).toMatch(/font/i)
  })

  it('outward top text sits above the centre; inward bottom text sits below', () => {
    const yOf = (d: string) => Number(d.split(' ')[2])
    const top = compileRingText(
      makeRingTextLayer({ text: 'O', anchorDeg: 0, direction: 'outward', radiusMM: 6 }),
      garamond,
    )
    const bottom = compileRingText(
      makeRingTextLayer({ text: 'O', anchorDeg: 180, direction: 'inward', radiusMM: 6 }),
      garamond,
    )
    const topShape = top.shapes[0]!
    const bottomShape = bottom.shapes[0]!
    if (topShape.kind === 'path' && bottomShape.kind === 'path') {
      expect(yOf(topShape.d)).toBeLessThan(0)
      expect(yOf(bottomShape.d)).toBeGreaterThan(0)
    }
  })

  it('inward direction reverses glyph order so text reads LTR at the bottom', () => {
    // First glyph of inward text must sit at a LARGER angle (screen-left at
    // the bottom) than the last glyph. Compare x of first/last subpath starts.
    const out = compileRingText(
      makeRingTextLayer({ text: 'AB', anchorDeg: 180, direction: 'inward', radiusMM: 6, sizeMM: 2 }),
      garamond,
    )
    const s = out.shapes[0]!
    if (s.kind !== 'path') throw new Error('expected path')
    const starts = [...s.d.matchAll(/M ([-\d.]+) ([-\d.]+)/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
    }))
    const firstGlyphX = starts[0]!.x
    const lastGlyphX = starts[starts.length - 1]!.x
    // at the bottom of the button, screen-left is negative x → first glyph (A) left of last (B)
    expect(firstGlyphX).toBeLessThan(lastGlyphX)
  })
})

describe('centre monogram', () => {
  it('centres the glyph bounding box on the origin', () => {
    const out = compileCenter(makeCenterLayer({ text: 'D', fontId: 'garamond', sizeMM: 6 }), garamond)
    expect(out.shapes).toHaveLength(1)
    const s = out.shapes[0]!
    if (s.kind !== 'path') throw new Error('expected path')
    const nums = [...s.d.matchAll(/([-\d.]+) ([-\d.]+)/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
    }))
    const xs = nums.map((p) => p.x)
    const ys = nums.map((p) => p.y)
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2
    // control points can overshoot the outline bbox slightly; centre must be near origin
    expect(Math.abs(cx)).toBeLessThan(0.35)
    expect(Math.abs(cy)).toBeLessThan(0.35)
  })

  it('stroke render carries the stroke width', () => {
    const out = compileCenter(
      makeCenterLayer({ text: 'D', render: 'stroke', strokeMM: 0.09 }),
      garamond,
    )
    const s = out.shapes[0]!
    if (s.kind === 'path') expect(s.paint.stroke?.widthMM).toBe(0.09)
  })
})
