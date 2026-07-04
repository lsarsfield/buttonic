import { describe, expect, it } from 'vitest'
import { presetReferenceA, presetReferenceB } from '../model/presets'
import { renderThumbSvg, THUMB_COLOR } from './thumbnail'

describe('renderThumbSvg', () => {
  it('omits the project metadata block', () => {
    const svg = renderThumbSvg(presetReferenceA())
    expect(svg).not.toBeNull()
    expect(svg).not.toContain('<metadata')
  })

  it('recolors all geometry for the dark UI', () => {
    const svg = renderThumbSvg(presetReferenceA())!
    expect(svg).not.toContain('#000000')
    expect(svg).toContain(THUMB_COLOR)
  })

  it('keeps <defs> so every <use> reference resolves in-string', () => {
    // regression: extracting the engraving group would strip defs and render
    // instanced layers (hatch/repeat) empty
    for (const make of [presetReferenceA, presetReferenceB]) {
      const svg = renderThumbSvg(make())!
      const hrefs = [...svg.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]!)
      expect(hrefs.length).toBeGreaterThan(0)
      for (const id of hrefs) {
        expect(svg).toContain(`id="${id}"`)
      }
    }
  })

  it('returns null above the size cap', () => {
    expect(renderThumbSvg(presetReferenceA(), 100)).toBeNull()
  })
})
