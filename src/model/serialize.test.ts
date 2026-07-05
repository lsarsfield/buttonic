import { describe, expect, it } from 'vitest'
import { coerceDoc, parseDoc, stringifyDoc } from './serialize'
import {
  DOC_VERSION,
  makeBendLayer,
  makeBlankDoc,
  makeCenterLayer,
  makeHatchLayer,
  makeRepeatLayer,
  makeRingLayer,
  makeRingTextLayer,
  type ButtonDoc,
} from './types'

function docWithEverything(): ButtonDoc {
  return {
    version: DOC_VERSION,
    name: 'Kitchen sink',
    diameterMM: 17,
    finish: 'gunmetal',
    layers: [
      makeCenterLayer(),
      makeRingTextLayer(),
      makeHatchLayer(),
      makeRepeatLayer({ rows: 2 }),
      makeBendLayer({ assetId: 'a1' }),
      makeRingLayer({ mode: 'annulus' }),
    ],
    assets: {
      a1: { kind: 'svg', name: 'laurel.svg', dataBase64: 'PHN2Zz48L3N2Zz4=' },
    },
    localFonts: {
      'local:TestFont-Bold': { postscriptName: 'TestFont-Bold', family: 'Test Font', fullName: 'Test Font Bold' },
    },
  }
}

describe('serialize round-trip', () => {
  it('parse(stringify(doc)) deep-equals a doc exercising all six layer types', () => {
    const doc = docWithEverything()
    const result = parseDoc(stringifyDoc(doc))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.doc).toEqual(doc)
  })

  it('round-trips the blank doc', () => {
    const doc = makeBlankDoc()
    const result = parseDoc(stringifyDoc(doc))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.doc).toEqual(doc)
  })
})

describe('migrations', () => {
  it('v1: adds an empty localFonts registry', () => {
    const v1 = { ...makeBlankDoc(), version: 1 } as Record<string, unknown>
    delete v1.localFonts
    const r = parseDoc(JSON.stringify(v1))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.doc.version).toBe(DOC_VERSION)
      expect(r.doc.localFonts).toEqual({})
    }
  })

  it('v2: ring text layers gain symmetric-layout defaults', () => {
    const oldRingText = makeRingTextLayer() as unknown as Record<string, unknown>
    delete oldRingText.repeats
    delete oldRingText.dividerSource
    delete oldRingText.dividerSizeMM
    delete oldRingText.dividerStrokeMM
    const v2 = { ...makeBlankDoc(), version: 2, layers: [oldRingText] }
    const r = parseDoc(JSON.stringify(v2))
    expect(r.ok).toBe(true)
    if (r.ok) {
      const layer = r.doc.layers[0]!
      if (layer.type !== 'ringText') throw new Error('expected ringText')
      expect(layer.repeats).toBe(1)
      expect(layer.dividerSource).toBeNull()
      expect(layer.dividerSizeMM).toBe(0.8)
    }
  })

  it('v3: content layers gain boolean-role/halo defaults without overwriting values', () => {
    const oldText = makeRingTextLayer({ booleanRole: 'subtract' }) as unknown as Record<string, unknown>
    for (const k of ['booleanRole', 'haloMM', 'haloMode', 'haloStrokeMM']) delete oldText[k]
    const keepRole = makeCenterLayer({ booleanRole: 'subtract' }) as unknown as Record<string, unknown>
    for (const k of ['haloMM', 'haloMode', 'haloStrokeMM'] as const) delete keepRole[k]
    const v3 = { ...makeBlankDoc(), version: 3, layers: [oldText, keepRole] }
    const r = parseDoc(JSON.stringify(v3))
    expect(r.ok).toBe(true)
    if (r.ok) {
      const text = r.doc.layers[0]!
      const center = r.doc.layers[1]!
      if (text.type !== 'ringText' || center.type !== 'center') throw new Error('type')
      expect(text.booleanRole).toBe('draw') // absent → default
      expect(text.haloMM).toBe(0)
      expect(text.haloMode).toBe('clear')
      expect(center.booleanRole).toBe('subtract') // present → preserved
    }
  })

  it('a v4 subtract layer round-trips unchanged', () => {
    const doc = { ...makeBlankDoc(), layers: [makeCenterLayer({ booleanRole: 'subtract', haloMM: 0.5, haloMode: 'outline' })] }
    const r = parseDoc(stringifyDoc(doc))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.doc).toEqual(doc)
  })
})

describe('coerceDoc (plain values, no JSON text)', () => {
  it('accepts a valid structured-clone object', () => {
    const doc = docWithEverything()
    const clone = structuredClone(doc)
    const r = coerceDoc(clone)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.doc).toEqual(doc)
  })

  it('rejects versionless and non-object values with readable errors', () => {
    const noVersion = coerceDoc({ name: 'x' })
    expect(noVersion.ok).toBe(false)
    if (!noVersion.ok) expect(noVersion.error).toMatch(/version/)
    expect(coerceDoc(null).ok).toBe(false)
    expect(coerceDoc(42).ok).toBe(false)
  })

  it('rejects docs from a newer app version', () => {
    const r = coerceDoc({ ...makeBlankDoc(), version: DOC_VERSION + 3 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/newer/)
  })
})

describe('parseDoc failure modes', () => {
  it('rejects non-JSON with a readable error', () => {
    const r = parseDoc('not json {')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/JSON/)
  })

  it('rejects a doc from a newer app version', () => {
    const doc = { ...makeBlankDoc(), version: DOC_VERSION + 5 }
    const r = parseDoc(JSON.stringify(doc))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/newer/)
  })

  it('rejects unknown layer types by name', () => {
    const doc = { ...makeBlankDoc(), layers: [{ id: 'x', type: 'hologram', name: 'H', visible: true, phaseDeg: 0 }] }
    const r = parseDoc(JSON.stringify(doc))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/hologram/)
  })

  it('rejects a layer missing a required numeric field', () => {
    const bad = makeHatchLayer() as unknown as Record<string, unknown>
    delete bad.count
    const doc = { ...makeBlankDoc(), layers: [bad] }
    const r = parseDoc(JSON.stringify(doc))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/count/)
  })

  it('rejects duplicate layer ids', () => {
    const a = makeRingLayer({ id: 'dup' })
    const b = makeRingLayer({ id: 'dup' })
    const doc = { ...makeBlankDoc(), layers: [a, b] }
    const r = parseDoc(JSON.stringify(doc))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/dup/)
  })
})
