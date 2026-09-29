import { describe, expect, it } from 'vitest'
import { makeBlankDoc, makeRingLayer } from './types'
import { parseDoc } from './serialize'
import { exportSvg } from '../io/exportSvg'
import { centreKindOf, coerceProductOptions, defaultCentreMM, FINISH_GROUPS, layerRelief, PRODUCTS, reliefGroups, STYLES } from './product'
import { FINISH_IDS } from './types'
import { specSheet } from '../io/specSheet'

describe('product catalogue', () => {
  it('every style belongs to exactly one product list, and defaults are coherent', () => {
    for (const [id, st] of Object.entries(STYLES)) {
      expect(PRODUCTS[st.product].styles).toContain(id)
      if (st.centre === 'none') expect(st.centreFrac).toBe(0)
      else expect(st.centreFrac).toBeGreaterThan(0)
    }
    for (const p of Object.values(PRODUCTS)) {
      expect(p.styles).toContain(p.defaultStyle)
      for (const z of p.sizes) {
        expect(z.mm).toBeGreaterThanOrEqual(8) // inside the Diameter field's bounds
        expect(z.mm).toBeLessThanOrEqual(30)
      }
    }
  })

  it('every finish appears in exactly one picker group', () => {
    const grouped = FINISH_GROUPS.flatMap((g) => g.options)
    expect([...grouped].sort()).toEqual([...FINISH_IDS].sort())
  })

  it('centre features scale with the cap and vanish at zero size', () => {
    expect(defaultCentreMM('open-top', 17)).toBe(7)
    expect(defaultCentreMM('flat-cap', 17)).toBe(0)
    expect(centreKindOf({ style: 'nipple', holeDiameterMM: 2.7 })).toBe('nipple')
    expect(centreKindOf({ style: 'nipple', holeDiameterMM: 0 })).toBe('none')
  })

  it('coerces a style that belongs to the other product to that product’s default', () => {
    expect(
      coerceProductOptions({ product: 'button', style: 'nipple', material: 'brass', logoDisplay: 'embossed', distressed: false, postFinish: 'x' }).style,
    ).toBe('flat-cap')
  })
})

describe('spec sheet', () => {
  it('states the order in the trade’s terms', () => {
    const doc = {
      ...makeBlankDoc(),
      name: 'Workwear rivet',
      product: 'rivet' as const,
      style: 'nipple' as const,
      diameterMM: 9,
      holeDiameterMM: 2.7,
      material: 'die-cast' as const,
      logoDisplay: 'debossed' as const,
      finish: 'antique-copper' as const,
      distressed: true,
    }
    expect(specSheet(doc)).toMatchInlineSnapshot(`
      "Workwear rivet — jeans rivet spec

      Product       Jeans rivet
      Shape         Nipple
      Size          9 mm diameter
      Nipple        2.7 mm diameter
      Material      Die-cast alloy
      Logo display  Debossed
      Finish        Antique copper, distressed
      Artwork       Vector outlines, mm-true (SVG; text converted to outlines). Convert to AI / PDF / EPS if required."
    `)
  })
})

describe('per-layer relief', () => {
  const doc = () => ({
    ...makeBlankDoc(),
    name: 'Mixed',
    layers: [
      makeRingLayer({ id: 'rim', name: 'Rim', mode: 'stroke', radiusMM: 8.2, strokeMM: 0.3, relief: 'debossed' }),
      makeRingLayer({ id: 'ring', name: 'Ring', mode: 'stroke', radiusMM: 6, strokeMM: 0.3 }),
    ],
  })

  it('a layer follows the button unless it has its own relief', () => {
    const d = doc()
    expect(layerRelief(d.layers[0]!, d)).toBe('debossed')
    expect(layerRelief(d.layers[1]!, d)).toBe('embossed')
    expect([...reliefGroups(d).keys()].sort()).toEqual(['debossed', 'embossed'])
  })

  it('the die SVG groups each depth separately; a single-relief die stays flat', () => {
    const mixed = exportSvg(doc()).svg
    expect(mixed).toMatch(/<g id="relief-raised"[^>]*>\s*<g id="layer-ring"/)
    expect(mixed).toMatch(/<g id="relief-sunk"[^>]*>\s*<g id="layer-rim"/)
    const single = exportSvg({ ...doc(), layers: doc().layers.map((l) => ({ ...l, relief: 'inherit' as const })) }).svg
    expect(single).not.toMatch(/relief-/)
    const only = exportSvg(doc(), { expandInstances: true, mirrorForDie: false, includeBlankOutline: false, onlyLayers: new Set(['rim']) }).svg
    expect(only).toMatch(/layer-rim/)
    expect(only).not.toMatch(/layer-ring/)
  })

  it('the spec sheet lists which layers are raised and which are sunk', () => {
    expect(specSheet(doc())).toMatch(/Logo display\s+Mixed relief — (debossed: Rim; embossed: Ring|embossed: Ring; debossed: Rim)/)
  })

  it('v13 documents: every layer follows the button', () => {
    const v13 = { ...makeBlankDoc(), version: 13 } as unknown as { layers: Record<string, unknown>[] } & Record<string, unknown>
    v13.layers = v13.layers.map((l) => {
      const { relief, ...rest } = l
      void relief
      return rest
    })
    const r = parseDoc(JSON.stringify(v13))
    expect(r.ok && r.doc.layers.every((l) => l.relief === 'inherit')).toBe(true)
  })
})
