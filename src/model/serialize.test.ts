import { describe, expect, it } from 'vitest'
import { parseDoc, stringifyDoc } from './serialize'
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
