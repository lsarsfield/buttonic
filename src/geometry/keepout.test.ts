import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as opentype from 'opentype.js'
import { describe, expect, it } from 'vitest'
import { makeCenterLayer, makeRepeatLayer, makeRingTextLayer } from '../model/types'
import { EXPORT_TOLERANCE_MM, type CompileCtx } from './compile'
import { keepoutsAbove, layerKeepoutRegion } from './keepout'
import { mpRadialBand } from './poly'

function loadFont(rel: string): opentype.Font {
  const path = fileURLToPath(new URL(rel, import.meta.url))
  const buf = readFileSync(path)
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
}
const fonts = new Map<string, opentype.Font>([
  ['cinzel', loadFont('../../public/fonts/cinzel.ttf')],
  ['unifraktur', loadFont('../../public/fonts/unifrakturcook-bold.ttf')],
])

const ctx = (over: Partial<CompileCtx> = {}): CompileCtx => ({
  diameterMM: 17,
  toleranceMM: EXPORT_TOLERANCE_MM,
  assetsRevision: 0,
  fontsRevision: 0,
  getFont: (id) => fonts.get(id) ?? null,
  getSvgAsset: () => null,
  ...over,
})

describe('layerKeepoutRegion', () => {
  it('a halo region extends the text band outward by ~haloMM', () => {
    const halo = 0.5
    const layer = makeRingTextLayer({ text: 'BUTTON', fontId: 'cinzel', sizeMM: 1.8, radiusMM: 6.2, haloMM: halo })
    const { region } = layerKeepoutRegion(layer, ctx())
    expect(region).not.toBeNull()
    const band = mpRadialBand(region!)!
    // text roughly occupies [radius − size, radius + size]; halo pushes both out
    expect(band.rMin).toBeLessThan(6.2 - halo * 0.5)
    expect(band.rMax).toBeGreaterThan(6.2 + halo)
  })

  it('memoizes on region CONTENT (identity churn and phase edits reuse; geometry edits rebuild)', () => {
    const layer = makeCenterLayer({ text: 'D', fontId: 'unifraktur', booleanRole: 'subtract' })
    const a = layerKeepoutRegion(layer, ctx()).region
    const b = layerKeepoutRegion(layer, ctx()).region
    expect(a).toBe(b) // same object + ctx → cached reference
    expect(layerKeepoutRegion({ ...layer }, ctx()).region).toBe(a) // immer churn, same content → reused
    expect(layerKeepoutRegion({ ...layer, phaseDeg: 45 }, ctx()).region).toBe(a) // pre-phase cache → reused
    expect(layerKeepoutRegion({ ...layer, sizeMM: layer.sizeMM + 1 }, ctx()).region).not.toBe(a) // rebuilt
  })

  it('a stroked-glyph centre yields a non-empty region', () => {
    const layer = makeCenterLayer({ text: 'D', fontId: 'unifraktur', render: 'stroke', strokeMM: 0.2, booleanRole: 'subtract' })
    const { region } = layerKeepoutRegion(layer, ctx())
    expect(region).not.toBeNull()
    expect(region!.length).toBeGreaterThan(0)
  })

  it('a subtract chevron repeat yields one region polygon per instance', () => {
    const layer = makeRepeatLayer({
      source: { kind: 'builtin', motifId: 'chevron' },
      count: 8,
      radiusMM: 6.5,
      sizeMM: 0.9,
      booleanRole: 'subtract',
    })
    const { region } = layerKeepoutRegion(layer, ctx())
    expect(region).not.toBeNull()
    expect(region!.length).toBe(8) // disjoint chevrons
  })

  it('an unavailable font yields an empty region (→ loud MISSING at export)', () => {
    const layer = makeRingTextLayer({ text: 'X', fontId: 'missing', booleanRole: 'subtract' })
    const { region } = layerKeepoutRegion(layer, ctx({ getFont: () => null }))
    expect(region).toEqual([])
  })
})

describe('keepoutsAbove', () => {
  it('collects only visible region-casting layers above the index', () => {
    const layers = [
      makeRingTextLayer({ text: 'below' }),
      makeCenterLayer({ text: 'D', fontId: 'unifraktur', booleanRole: 'subtract' }), // casts
      makeCenterLayer({ text: 'E', fontId: 'unifraktur', booleanRole: 'draw', visible: false }), // hidden
      makeRingTextLayer({ text: 'halo', fontId: 'cinzel', haloMM: 0.4 }), // casts (halo)
    ]
    const k = keepoutsAbove(layers, 0, ctx())
    expect(k.contributors).toHaveLength(2)
    expect(k.contributors.every((c) => c.region.length > 0)).toBe(true)
  })
})
