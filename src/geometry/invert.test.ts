import { describe, expect, it } from 'vitest'
import {
  DOC_VERSION,
  makeBlankDoc,
  makeCenterLayer,
  makeHatchLayer,
  makeRingLayer,
  makeRingTextLayer,
  NEW_TEXT_GAP_MM,
  type ButtonDoc,
  type Layer,
} from '../model/types'
import { parseDoc } from '../model/serialize'
import { exportSvg } from '../io/exportSvg'
import { EXPORT_TOLERANCE_MM, type CompileCtx } from './compile'
import { bareInvertRegion, hatchBand, invertsBare } from './invert'
import { layerKeepoutRegion } from './keepout'
import { multiPolygonArea, pointInMultiPolygon, rotateMultiPolygon, safeXor } from './poly'

const ctx = (): CompileCtx => ({
  diameterMM: 17,
  toleranceMM: EXPORT_TOLERANCE_MM,
  assetsRevision: 0,
  fontsRevision: 0,
  getFont: () => null,
  getSvgAsset: () => null,
})
const regionOf = (l: Layer) => layerKeepoutRegion(l, ctx()).region

// The builtin 'square' spans ±0.42 of the unit box: sizeMM = 2/0.84 → a 2 mm square.
const SQ = 2 / 0.84
const square = (patch: Parameters<typeof makeCenterLayer>[0] = {}) =>
  makeCenterLayer({
    id: 'sq',
    sourceType: 'builtin',
    motifId: 'square',
    sizeMM: SQ,
    booleanRole: 'subtract',
    haloMM: 0,
    invertOverBare: true,
    ...patch,
  })
const disc = (rOuterMM: number) => makeRingLayer({ id: 'disc', mode: 'annulus', rInnerMM: 0, rOuterMM })

/** ∫ area of {x ≥ x0, |y| ≤ h, x²+y² ≤ R²} — a circle cap cut by a slab. */
const capSlabArea = (R: number, x0: number, h: number): number => {
  const F = (y: number) => (y / 2) * Math.sqrt(R * R - y * y) + ((R * R) / 2) * Math.asin(y / R)
  return F(h) - F(-h) - 2 * h * x0
}

describe('cut-out: invert over bare metal', () => {
  it('engraves exactly the overhang: square straddling a filled disc edge', () => {
    // square x∈[2,4], y∈[−1,1]; disc radius 3
    const layers = [disc(3), square({ offsetXMM: 3 })]
    const inv = bareInvertRegion(layers, 1, ctx(), regionOf)
    const expected = 4 - capSlabArea(3, 2, 1)
    expect(multiPolygonArea(inv)).toBeCloseTo(expected, 2)
    expect(pointInMultiPolygon(3.5, 0, inv)).toBe(true) // over bare metal → engraved
    expect(pointInMultiPolygon(2.5, 0, inv)).toBe(false) // over the disc → knocked out, not engraved
  })

  it('a shape wholly over bare metal is engraved whole; wholly over fill engraves nothing', () => {
    const bare = bareInvertRegion([disc(1), square({ offsetXMM: 4 })], 1, ctx(), regionOf)
    expect(multiPolygonArea(bare)).toBeCloseTo(4, 3)
    const inside = bareInvertRegion([disc(6), square()], 1, ctx(), regionOf)
    expect(inside).toEqual([])
  })

  it('drops sub-resolution slivers along a shared edge', () => {
    // overhangs the disc by only 0.01 mm → a sliver, not a feature
    const inv = bareInvertRegion([disc(3), square({ offsetXMM: 1.01 })], 1, ctx(), regionOf)
    expect(inv).toEqual([])
  })

  it('a hatch tones its whole band: letters over it knock out, beyond it engrave', () => {
    const hatch = makeHatchLayer({ id: 'h', rInnerMM: 1, rOuterMM: 3, count: 24, strokeMM: 0.1 })
    const inv = bareInvertRegion([hatch, square({ offsetXMM: 3 })], 1, ctx(), regionOf)
    // same geometry as a solid disc of radius 3 (the band covers r ∈ [1,3] ⊃ the overlap)
    expect(multiPolygonArea(inv)).toBeCloseTo(4 - capSlabArea(3, 2, 1), 2)
    expect(pointInMultiPolygon(2.5, 0.05, inv)).toBe(false) // between ticks, still inside the band
  })

  it('partial-arc hatch band spans first→last tick (+½ stroke), and follows phase', () => {
    const h = makeHatchLayer({ rInnerMM: 2, rOuterMM: 4, count: 10, sweepDeg: 90, strokeMM: 0.2, phaseDeg: 30 })
    const band = hatchBand(h, 0, 0.001)
    const polar = (deg: number, r: number): [number, number] => [
      r * Math.sin((deg * Math.PI) / 180),
      -r * Math.cos((deg * Math.PI) / 180),
    ]
    expect(pointInMultiPolygon(...polar(30 + 40, 3), band)).toBe(true)
    expect(pointInMultiPolygon(...polar(30 + 81 + 1, 3), band)).toBe(true) // last tick at 81° + pad
    expect(pointInMultiPolygon(...polar(30 + 81 + 5, 3), band)).toBe(false)
    expect(pointInMultiPolygon(...polar(25, 3), band)).toBe(false)
  })

  it('is rotation-consistent: phases rotate the result, never change it', () => {
    const h = (p: number) => makeHatchLayer({ id: 'h', rInnerMM: 2, rOuterMM: 4, count: 12, sweepDeg: 120, strokeMM: 0.1, phaseDeg: p })
    const a = bareInvertRegion([h(0), square({ offsetYMM: -4 })], 1, ctx(), regionOf)
    const b = bareInvertRegion([h(37), square({ offsetYMM: -4, phaseDeg: 37 })], 1, ctx(), regionOf)
    expect(multiPolygonArea(a)).toBeGreaterThan(0.1)
    expect(multiPolygonArea(b)).toBeCloseTo(multiPolygonArea(a), 3)
    // b is stored in its own pre-phase frame, so it overlays a directly…
    expect(multiPolygonArea(safeXor(a, b)!)).toBeLessThan(1e-3)
    // …and rotating it into the absolute frame does not
    expect(multiPolygonArea(safeXor(a, rotateMultiPolygon(b, 37))!)).toBeGreaterThan(0.1)
  })

  it('a halo between them re-exposes bare metal, which the cut-out then engraves', () => {
    const gapText = makeCenterLayer({
      id: 'gap', sourceType: 'builtin', motifId: 'square', sizeMM: SQ, offsetXMM: 3,
      haloMM: 0.3, render: 'fill', booleanRole: 'draw',
    })
    // the engraved square (halo 0.3) sits exactly under the cut-out: the cut-out
    // square overlaps only that engraving, so it engraves nothing
    const inv = bareInvertRegion([disc(3), gapText, square({ offsetXMM: 3 })], 2, ctx(), regionOf)
    expect(inv).toEqual([])
    // hide the engraved square: its halo-cleared disc area no longer exists, the
    // plain disc-edge overhang comes back
    const inv2 = bareInvertRegion([disc(3), { ...gapText, visible: false }, square({ offsetXMM: 3 })], 2, ctx(), regionOf)
    expect(multiPolygonArea(inv2)).toBeCloseTo(4 - capSlabArea(3, 2, 1), 2)
  })

  it('invertsBare gates on role + flag + layer type', () => {
    expect(invertsBare(square())).toBe(true)
    expect(invertsBare(square({ invertOverBare: false }))).toBe(false)
    expect(invertsBare(square({ booleanRole: 'draw' }))).toBe(false)
  })
})

describe('export: cut-out over bare metal', () => {
  const doc = (invertOverBare: boolean): ButtonDoc => ({
    ...makeBlankDoc(),
    layers: [disc(3), square({ offsetXMM: 3, invertOverBare })],
  })
  const layerGroup = (svg: string) => svg.match(/<g id="layer-sq"[\s\S]*?<\/g>/)?.[0] ?? null

  it('emits the engraved overhang as a plain filled path', () => {
    const { svg } = exportSvg(doc(true))
    const g = layerGroup(svg)
    expect(g).not.toBeNull()
    expect(g!).toMatch(/<path [^>]*fill-rule="evenodd"/)
  })

  it('emits nothing for the cut-out when Over bare = Hide (the old behaviour)', () => {
    expect(layerGroup(exportSvg(doc(false)).svg)).toBeNull()
  })
})

describe('schema v9', () => {
  it('new text / centre layers engrave with a gap and invert cut-outs over bare', () => {
    expect(makeRingTextLayer().haloMM).toBe(NEW_TEXT_GAP_MM)
    expect(makeCenterLayer().haloMM).toBe(NEW_TEXT_GAP_MM)
    expect(makeRingTextLayer().invertOverBare).toBe(true)
    expect(makeCenterLayer().invertOverBare).toBe(true)
  })

  it('v8 documents keep their old behaviour (invertOverBare false, halos untouched)', () => {
    const text = makeRingTextLayer({ booleanRole: 'subtract', haloMM: 0 }) as unknown as Record<string, unknown>
    const center = makeCenterLayer({ haloMM: 0.2 }) as unknown as Record<string, unknown>
    delete text.invertOverBare
    delete center.invertOverBare
    const v8 = { ...makeBlankDoc(), version: 8, layers: [text, center] }
    const r = parseDoc(JSON.stringify(v8))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.doc.version).toBe(DOC_VERSION)
    const [t, c] = r.doc.layers
    if (t?.type !== 'ringText' || c?.type !== 'center') throw new Error('type')
    expect(t.invertOverBare).toBe(false)
    expect(t.haloMM).toBe(0)
    expect(c.invertOverBare).toBe(false)
    expect(c.haloMM).toBe(0.2)
  })
})

describe('export: centre hole', () => {
  it('adds the hole to the blank outline and warns when art enters it', () => {
    const doc: ButtonDoc = {
      ...makeBlankDoc(),
      holeDiameterMM: 4,
      layers: [makeRingLayer({ id: 'r', mode: 'stroke', radiusMM: 1.5, strokeMM: 0.2 })],
    }
    const { svg, warnings } = exportSvg(doc, { expandInstances: true, mirrorForDie: false, includeBlankOutline: true })
    expect(svg).toMatch(/<circle r="2" [^>]*data-name="centre hole"/)
    expect(warnings.some((w) => /centre hole/.test(w))).toBe(true)
    const clear = exportSvg({ ...doc, holeDiameterMM: 2 }, { expandInstances: true, mirrorForDie: false, includeBlankOutline: true })
    expect(clear.warnings.some((w) => /centre hole/.test(w))).toBe(false)
  })
})
