import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as opentype from 'opentype.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { exportSvg } from '../io/exportSvg'
import { specSheet } from '../io/specSheet'
import { reliefGroups } from '../model/product'
import { parseDoc, stringifyDoc } from '../model/serialize'
import {
  DOC_VERSION,
  makeBlankDoc,
  makeCenterLayer,
  makeHatchLayer,
  makeRepeatLayer,
  makeRingLayer,
  makeRingTextLayer,
  type ButtonDoc,
  type Layer,
} from '../model/types'
import { clipCompiled } from './clip'
import { compileLayer, EXPORT_TOLERANCE_MM, type CompileCtx } from './compile'
import { bareInvertRegion } from './invert'
import { castsRegion, clipsAcrossRelief, isMaskLayer, keepoutsAbove, layerKeepoutRegion } from './keepout'
import { parsePathData } from './pathData'
import { flattenSegs } from './flatten'
import {
  multiPolygonArea,
  pathToMultiPolygon,
  pointInMultiPolygon,
  rotateMultiPolygon,
  safeDifference,
  type MultiPolygon,
} from './poly'
import { fillPaint, type Shape } from './shapes'
import { starArea, starPathD, starVertices } from './star'

/*
 * booleanRole 'mask': a window. The layer draws nothing and everything below
 * it survives only inside its (grown) shape — implemented as the subtract of
 * the shape's complement, so every exactness guarantee of the cut carries over.
 */

function loadFont(rel: string): opentype.Font {
  const path = fileURLToPath(new URL(rel, import.meta.url))
  const buf = readFileSync(path)
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
}
const fonts = new Map<string, opentype.Font>()
beforeAll(() => {
  fonts.set('cinzel', loadFont('../../public/fonts/cinzel.ttf'))
  fonts.set('unifraktur', loadFont('../../public/fonts/unifrakturcook-bold.ttf'))
})

const ctx = (): CompileCtx => ({
  diameterMM: 17,
  toleranceMM: EXPORT_TOLERANCE_MM,
  assetsRevision: 0,
  fontsRevision: 0,
  getFont: (id) => fonts.get(id) ?? null,
  getSvgAsset: () => null,
})

/** The DocRenderer/exportSvg clip pipeline for one consumer layer. */
function clipLayer(layers: Layer[], index: number): Shape[] {
  const c = ctx()
  const compiled = compileLayer(layers[index]!, c)
  const keepouts = keepoutsAbove(layers, index, c)
  const regions = keepouts.contributors.map((k) => rotateMultiPolygon(k.region, k.phaseDeg - layers[index]!.phaseDeg))
  return clipCompiled(compiled, { discs: keepouts.discs, regions }, c.toleranceMM).shapes
}

/** Total filled area of clipped output (stroked leftovers must not exist here). */
function filledArea(shapes: Shape[]): number {
  let a = 0
  for (const s of shapes) {
    expect(s.kind === 'path' && !!s.paint.fill).toBe(true)
    if (s.kind === 'path') a += multiPolygonArea(pathToMultiPolygon(s.d, s.fillRule ?? 'nonzero', EXPORT_TOLERANCE_MM))
  }
  return a
}

function outputPoints(shapes: Shape[]): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = []
  for (const s of shapes) if (s.kind === 'path') for (const sub of flattenSegs(parsePathData(s.d), 0.001)) pts.push(...sub.pts)
  return pts
}

/** Areas agree to the flattening tolerance (µm chords over mm perimeters → ~1e-4 relative). */
function expectArea(actual: number, expected: number, rel = 5e-4): void {
  expect(Math.abs(actual - expected) / expected).toBeLessThan(rel)
}

/** The built-in dot's arcs become 90° cubics, which bulge ≲2.7e-4·r past the true circle. */
const ARC_EPS = 0.002

/** ∫ over the tick width of the radial extent kept between r = lo(x) and hi(x) (butt ticks on the axis). */
function tickArea(w: number, lo: (x: number) => number, hi: (x: number) => number): number {
  const n = 2000
  let a = 0
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + ((i + 0.5) * w) / n
    a += Math.max(0, hi(x) - lo(x)) * (w / n)
  }
  return a
}

/** A centred filled disc as a centre layer (the built-in dot has radius 0.35·size). */
const discMask = (id: string, r: number, patch: Partial<Parameters<typeof makeCenterLayer>[0]> = {}) =>
  makeCenterLayer({ id, sourceType: 'builtin', motifId: 'dot', sizeMM: r / 0.35, haloMM: 0, booleanRole: 'mask', ...patch })

const filledDisc = () => makeRingLayer({ id: 'disc', mode: 'annulus', rInnerMM: 0.01, rOuterMM: 8 })

describe('star source (geometry/star.ts)', () => {
  it('puts N points on the outer circle (first at 12 o’clock) and N valleys on the inner one', () => {
    const v = starVertices({ points: 4, outerR: 8.5, innerRatio: 0.6, bulge: 0 })
    expect(v).toHaveLength(8)
    expect(v[0]!.x).toBeCloseTo(0, 12)
    expect(v[0]!.y).toBeCloseTo(-8.5, 12)
    expect(Math.hypot(v[1]!.x, v[1]!.y)).toBeCloseTo(5.1, 12)
    expect(Math.atan2(v[1]!.x, -v[1]!.y) * (180 / Math.PI)).toBeCloseTo(45, 10) // clockwise, y-down
  })

  it('encloses exactly its analytic area — straight, swelling and caved-in sides', () => {
    // (extreme curves on few points make neighbouring sides overlap — then the
    // nonzero fill is no longer polygon ± segments, so those are left out)
    const cases: [number, number, number][] = [
      [3, 0.55, 0], [3, 0.55, 0.25], [3, 0.55, -0.2], [4, 0.55, 0], [4, 0.6, 0.25], [4, 0.55, 0.5],
      [4, 0.85, -0.4], [7, 0.55, 0.25], [7, 0.55, -0.2],
    ]
    for (const [points, innerRatio, bulge] of cases) {
      const p = { points, outerR: 5, innerRatio, bulge }
      const mp = pathToMultiPolygon(starPathD(p), 'nonzero', 0.0005)
      expectArea(multiPolygonArea(mp), starArea(p), 3e-4)
    }
    // a regular polygon: inner = cos(180°/N)
    const hex = { points: 6, outerR: 4, innerRatio: Math.cos(Math.PI / 6), bulge: 0 }
    expect(starArea(hex)).toBeCloseTo((3 * Math.sqrt(3) * 16) / 2, 10)
  })
})

describe('mask: exact analytic cuts', () => {
  const hatch = (patch: Partial<Parameters<typeof makeHatchLayer>[0]> = {}) =>
    makeHatchLayer({ id: 'h', count: 36, rInnerMM: 4, rOuterMM: 8, strokeMM: 0.2, cap: 'butt', ...patch })

  it('a hatch band masked by a disc keeps only the ticks inside it, cut exactly on the circle', () => {
    const R = 6
    const layers: Layer[] = [hatch(), discMask('m', R)]
    const out = clipLayer(layers, 0)
    // nothing survives outside the window (flattening sits INSIDE the arc)
    for (const p of outputPoints(out)) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(R + ARC_EPS)
    const expected = 36 * tickArea(0.2, () => 4, (x) => Math.sqrt(R * R - x * x))
    expectArea(filledArea(out), expected)
  })

  it('Grow widens the window by exactly the halo', () => {
    const grown = filledArea(clipLayer([hatch(), discMask('m', 5, { haloMM: 1 })], 0))
    const plain = filledArea(clipLayer([hatch(), discMask('m2', 6)], 0))
    // halos may exceed the stated margin by ≲9 µm (chord allowance), never fall short
    expect(grown).toBeGreaterThanOrEqual(plain)
    expect(grown - plain).toBeLessThan(36 * 0.2 * 0.009)
  })

  it('a filled layer under a star mask keeps exactly the star', () => {
    for (const bulge of [0, 0.25, -0.3]) {
      const star = makeCenterLayer({
        id: 's', sourceType: 'star', starPoints: 4, starInner: 0.6, starBulge: bulge, sizeMM: 12, haloMM: 0, booleanRole: 'mask',
      })
      const kept = filledArea(clipLayer([filledDisc(), star], 0))
      expectArea(kept, starArea({ points: 4, outerR: 6, innerRatio: 0.6, bulge }))
    }
  })

  it('masked TEXT keeps exactly its overlap with the window', () => {
    const text = makeRingTextLayer({ id: 't', text: 'BUTTONIC', fontId: 'cinzel', sizeMM: 2, radiusMM: 5.4, haloMM: 0 })
    const R = 6
    const out = clipLayer([text, discMask('m', R)], 0)
    const T = layerKeepoutRegion({ ...text, id: 't-region' }, ctx()).region! // the letters as polygons
    const window = layerKeepoutRegion(discMask('w', R, { booleanRole: 'subtract' }), ctx()).region! // the disc itself
    const outside = safeDifference(T, window)!
    const expected = multiPolygonArea(T) - multiPolygonArea(outside)
    expect(expected).toBeGreaterThan(0.3) // the window genuinely cuts the letters
    expect(expected).toBeLessThan(multiPolygonArea(T) - 0.3)
    expectArea(filledArea(out), expected, 2e-3)
    for (const p of outputPoints(out)) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(R + ARC_EPS)
  })

  it('mask + cut-out: the window and the knockout both apply (in either order)', () => {
    const cut = discMask('c', 3.5, { booleanRole: 'subtract', invertOverBare: false })
    const mask = discMask('m', 6)
    const base = hatch({ rInnerMM: 2, count: 24 })
    const expected = 24 * tickArea(0.2, (x) => Math.sqrt(3.5 * 3.5 - x * x), (x) => Math.sqrt(36 - x * x))
    expectArea(filledArea(clipLayer([base, cut, mask], 0)), expected)
    expectArea(filledArea(clipLayer([base, mask, cut], 0)), expected)
  })

  it('stacked masks intersect; a mask only restricts what is BELOW it', () => {
    const r = 6
    const d = 3
    const m1 = discMask('m1', r)
    const m2 = discMask('m2', r, { offsetXMM: d })
    const kept = filledArea(clipLayer([filledDisc(), m1, m2], 0))
    const lens = 2 * r * r * Math.acos(d / (2 * r)) - (d / 2) * Math.sqrt(4 * r * r - d * d)
    expectArea(kept, lens)
    // a layer between the two masks sees only the upper one
    expectArea(filledArea(clipLayer([filledDisc(), m1, filledDisc(), m2], 2)), filledArea(clipLayer([filledDisc(), m2], 0)))
  })

  it('a mask draws nothing, casts a region, and never takes part in cross-relief clipping', () => {
    const m = discMask('m', 5)
    const h = hatch({ relief: 'debossed' })
    expect(isMaskLayer(m)).toBe(true)
    expect(castsRegion(m)).toBe(true)
    expect(clipsAcrossRelief({ ...m, relief: 'embossed' }, h, 'embossed')).toBe(false)
    expect(clipsAcrossRelief(h, { ...m, relief: 'embossed' }, 'embossed')).toBe(false)
    // a repeat of discs is a mask too (union of instances = a quatrefoil window)
    const quatrefoil = makeRepeatLayer({ id: 'q', source: { kind: 'builtin', motifId: 'dot' }, count: 4, radiusMM: 2.5, sizeMM: 6, booleanRole: 'mask' })
    const kept = filledArea(clipLayer([filledDisc(), quatrefoil], 0))
    expect(kept).toBeGreaterThan(Math.PI * 2.1 * 2.1 * 1.5)
    expect(kept).toBeLessThan(4 * Math.PI * 2.1 * 2.1)
  })
})

describe('region band prefilter', () => {
  it('a region containing the axis reaches r = 0: geometry nearer the axis than its edge is inside it', () => {
    // a solid centre cut-out over a short hatch wholly inside it (the prefilter used
    // to measure the region's band from its boundary only and wave these ticks through)
    const ticks = makeHatchLayer({ id: 'h', count: 24, rInnerMM: 1, rOuterMM: 2, strokeMM: 0.1 })
    expect(clipLayer([ticks, discMask('c', 3, { booleanRole: 'subtract', invertOverBare: false })], 0)).toEqual([])
    // …and an empty mask (its region is the whole far disc) keeps nothing
    const empty = makeCenterLayer({ id: 'e', sourceType: 'star', sizeMM: 0, haloMM: 0, booleanRole: 'mask' })
    expect(clipLayer([ticks, empty], 0)).toEqual([])
  })
})

describe('mask: phase', () => {
  const star = (phaseDeg: number) =>
    makeCenterLayer({ id: 's', sourceType: 'star', starPoints: 4, starInner: 0.5, starBulge: 0, sizeMM: 14, haloMM: 0, booleanRole: 'mask', phaseDeg })

  it('the window tracks the mask phase exactly (point classification in the absolute frame)', () => {
    const mp0 = pathToMultiPolygon((clipLayer([filledDisc(), star(0)], 0)[0] as { d: string }).d, 'evenodd', EXPORT_TOLERANCE_MM)
    const mp37 = pathToMultiPolygon((clipLayer([filledDisc(), star(37)], 0)[0] as { d: string }).d, 'evenodd', EXPORT_TOLERANCE_MM)
    expectArea(multiPolygonArea(mp37), multiPolygonArea(mp0))
    for (let a = 0; a < 360; a += 7) {
      for (const r of [3.2, 4.4, 5.6]) {
        const px = r * Math.sin((a * Math.PI) / 180)
        const py = -r * Math.cos((a * Math.PI) / 180)
        const back = rotateMultiPolygon([[[[px, py], [px + 0.01, py], [px, py + 0.01]]]], -37)[0]![0]![0]!
        expect(pointInMultiPolygon(px, py, mp37)).toBe(pointInMultiPolygon(back[0], back[1], mp0))
      }
    }
  })

  it('only the RELATIVE phase of mask and consumer matters', () => {
    const hatch = (phaseDeg: number) => makeHatchLayer({ id: 'h', count: 40, rInnerMM: 3, rOuterMM: 8, strokeMM: 0.15, phaseDeg })
    const a = filledArea(clipLayer([hatch(7), star(20)], 0))
    const b = filledArea(clipLayer([hatch(0), star(13)], 0))
    const c = filledArea(clipLayer([hatch(0), star(20)], 0))
    expect(a).toBeCloseTo(b, 4)
    expect(Math.abs(a - c)).toBeGreaterThan(1e-3) // ticks land differently on the star's sides
  })
})

describe('mask: invert-over-bare cut-outs', () => {
  it('outside a mask beneath it, a cut-out finds bare metal and engraves there', () => {
    const dee = makeCenterLayer({ id: 'd', text: 'D', fontId: 'unifraktur', sizeMM: 7, haloMM: 0, booleanRole: 'subtract', invertOverBare: true })
    const layers: Layer[] = [filledDisc(), discMask('m', 1.5), dee]
    const c = ctx()
    const inv = bareInvertRegion(layers, 2, c, (l) => layerKeepoutRegion(l, c).region)
    const T = layerKeepoutRegion(dee, c).region!
    const window = layerKeepoutRegion(discMask('w', 1.5, { booleanRole: 'subtract' }), c).region!
    const expected = multiPolygonArea(safeDifference(T, window)!) // T ∖ window = the letter over bare metal
    expect(expected).toBeGreaterThan(1)
    expectArea(multiPolygonArea(inv), expected, 5e-3)
  })

  it('a mask ABOVE a cut-out trims its engraved overhang like any engraving', () => {
    const dee = makeCenterLayer({ id: 'd', text: 'D', fontId: 'unifraktur', sizeMM: 7, haloMM: 0, booleanRole: 'subtract', invertOverBare: true })
    const layers: Layer[] = [dee, discMask('m', 2)]
    const c = ctx()
    const inv = bareInvertRegion(layers, 0, c, (l) => layerKeepoutRegion(l, c).region) // all bare: the whole D
    const k = keepoutsAbove(layers, 0, c)
    const out = clipCompiled(
      { shapes: [{ kind: 'path', d: mpToD(inv), fillRule: 'evenodd', paint: fillPaint() }], warnings: [] },
      { discs: k.discs, regions: k.contributors.map((x) => x.region) },
      c.toleranceMM,
    ).shapes
    for (const p of outputPoints(out)) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(2 + ARC_EPS)
    expect(filledArea(out)).toBeGreaterThan(0.5)
  })
})

function mpToD(mp: MultiPolygon): string {
  return mp
    .flatMap((poly) => poly.map((ring) => 'M ' + ring.map(([x, y]) => `${x} ${y}`).join(' L ') + ' Z'))
    .join(' ')
}

describe('mask: documents and dies', () => {
  const doc = (): ButtonDoc => ({
    ...makeBlankDoc(),
    style: 'open-top',
    holeDiameterMM: 6,
    layers: [
      makeHatchLayer({ id: 'hatch', count: 72, rInnerMM: 4.1, rOuterMM: 7.8, strokeMM: 0.15 }),
      makeCenterLayer({
        id: 'star', name: 'Star window', sourceType: 'star', starPoints: 4, starInner: 0.6, starBulge: 0.25, sizeMM: 17,
        haloMM: 0, booleanRole: 'mask', relief: 'lasered',
      }),
    ],
  })

  it('round-trips through the schema (star source + mask role); unknown roles degrade to draw', () => {
    const d = doc()
    const r = parseDoc(stringifyDoc(d))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.doc).toEqual(d)
    const future = JSON.parse(stringifyDoc(d))
    future.layers[1].booleanRole = 'intersect'
    const f = parseDoc(JSON.stringify(future))
    expect(f.ok).toBe(true)
    if (f.ok) expect((f.doc.layers[1] as { booleanRole: string }).booleanRole).toBe('draw')
  })

  it('v14 centre layers migrate with inert star defaults', () => {
    const old = JSON.parse(stringifyDoc({ ...makeBlankDoc(), layers: [makeCenterLayer({ id: 'c' })] }))
    old.version = 14
    for (const k of ['starPoints', 'starInner', 'starBulge']) delete old.layers[0][k]
    const r = parseDoc(JSON.stringify(old))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.doc.version).toBe(DOC_VERSION)
      expect(r.doc.layers[0]).toMatchObject({ starPoints: 5, starInner: 0.5, starBulge: 0, sourceType: 'glyph' })
    }
  })

  it('the die holds only the masked art; the mask joins no relief group', () => {
    const { svg, warnings } = exportSvg(doc())
    expect(svg).toContain('id="layer-hatch"')
    expect(svg).not.toContain('id="layer-star"')
    expect(svg).not.toContain('relief-') // the lasered mask must not make the die "mixed"
    expect(warnings.filter((w) => w.startsWith('Star window'))).toEqual([])
    expect([...reliefGroups(doc()).keys()]).toEqual(['embossed'])
    expect(specSheet(doc())).not.toMatch(/Mixed relief/)
    // the hatch really is windowed: nothing reaches the star's valleys on the diagonals
    const body = svg.slice(svg.indexOf('id="layer-hatch"'))
    const ds = [...body.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]!)
    for (const d of ds) {
      for (const sub of flattenSegs(parsePathData(d), 0.01)) {
        for (const p of sub.pts) {
          const deg = ((Math.atan2(p.x, -p.y) * 180) / Math.PI + 360) % 90
          if (Math.abs(deg - 45) < 0.5) expect(Math.hypot(p.x, p.y)).toBeLessThan(5.3) // unmasked ticks reach 7.8
        }
      }
    }
  })

  it('an empty mask hides everything beneath it — loudly', () => {
    const d = doc()
    d.layers[1] = { ...(d.layers[1] as ReturnType<typeof makeCenterLayer>), sizeMM: 0 }
    const { svg, warnings } = exportSvg(d)
    expect(warnings.some((w) => /mask has no shape/.test(w))).toBe(true)
    expect(svg).not.toContain('id="layer-hatch"')
  })
})
