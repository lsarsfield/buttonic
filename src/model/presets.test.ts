import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as opentype from 'opentype.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { clearancesAbove, clipCompiled } from '../geometry/clip'
import { compileLayer, EXPORT_TOLERANCE_MM, type CompileCtx } from '../geometry/compile'
import { presetReferenceA, presetReferenceB } from './presets'
import { parseDoc, stringifyDoc } from './serialize'

/**
 * Golden acceptance: the two reference presets compile to stable geometry.
 * Any kernel change that alters die output shows up as a snapshot diff.
 */

const fonts = new Map<string, opentype.Font>()

function loadFont(id: string, rel: string) {
  const path = fileURLToPath(new URL(rel, import.meta.url))
  const buf = readFileSync(path)
  fonts.set(id, opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)))
}

beforeAll(() => {
  loadFont('garamond', '../../public/fonts/ebgaramond.ttf')
  loadFont('unifraktur', '../../public/fonts/unifrakturcook-bold.ttf')
  loadFont('cinzel', '../../public/fonts/cinzel.ttf')
})

function compileDoc(doc: ReturnType<typeof presetReferenceA>) {
  const ctx: CompileCtx = {
    diameterMM: doc.diameterMM,
    toleranceMM: EXPORT_TOLERANCE_MM,
    assetsRevision: 0,
    fontsRevision: 0,
    getFont: (id) => fonts.get(id) ?? null,
    getSvgAsset: () => null,
  }
  return doc.layers.map((layer, index) => {
    const compiled = clipCompiled(
      compileLayer(layer, ctx),
      { discs: clearancesAbove(doc.layers, index), regions: [] },
      EXPORT_TOLERANCE_MM,
    )
    return { layer: layer.id, warnings: compiled.warnings, shapes: compiled.shapes }
  })
}

describe('reference presets', () => {
  it('reference A compiles with no warnings and clips the moat', () => {
    const out = compileDoc(presetReferenceA())
    expect(out.flatMap((l) => l.warnings)).toEqual([])
    // band 1 def must start ON the emblem clearance circle (2.3 mm)
    const band1 = out.find((l) => l.layer === 'refA-band1')!.shapes[0]!
    if (band1.kind !== 'instanced') throw new Error('expected instanced hatch')
    const m = band1.def.d.match(/^M ([-\d.e]+) ([-\d.e]+)/)
    expect(Math.hypot(Number(m![1]), Number(m![2]))).toBeCloseTo(2.3, 5)
  })

  it('reference B compiles with no warnings and both herringbone rows', () => {
    const out = compileDoc(presetReferenceB())
    expect(out.flatMap((l) => l.warnings)).toEqual([])
    const band = out.find((l) => l.layer === 'refB-band')!
    expect(band.shapes).toHaveLength(2)
  })

  it('golden: reference A geometry snapshot', () => {
    expect(JSON.stringify(compileDoc(presetReferenceA()), null, 1)).toMatchSnapshot()
  })

  it('golden: reference B geometry snapshot', () => {
    expect(JSON.stringify(compileDoc(presetReferenceB()), null, 1)).toMatchSnapshot()
  })

  it('presets survive serialize round-trip', () => {
    for (const make of [presetReferenceA, presetReferenceB]) {
      const doc = make()
      const round = parseDoc(stringifyDoc(doc))
      expect(round.ok).toBe(true)
      if (round.ok) expect(round.doc).toEqual(doc)
    }
  })
})
