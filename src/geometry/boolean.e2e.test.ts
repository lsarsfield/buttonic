import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as opentype from 'opentype.js'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  makeCenterLayer,
  makeHatchLayer,
  makeRingLayer,
  makeRingTextLayer,
  type ButtonDoc,
  type Layer,
} from '../model/types'
import { clipCompiled } from './clip'
import { compileLayer, EXPORT_TOLERANCE_MM, type CompileCtx } from './compile'
import { keepoutsAbove, layerKeepoutRegion, regionOutlineShapes } from './keepout'
import {
  multiPolygonArea,
  pathToMultiPolygon,
  pointInMultiPolygon,
  rotateMultiPolygon,
  type MultiPolygon,
} from './poly'
import type { Shape } from './shapes'

function loadFont(rel: string): opentype.Font {
  const path = fileURLToPath(new URL(rel, import.meta.url))
  const buf = readFileSync(path)
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
}
const fonts = new Map<string, opentype.Font>()
beforeAll(() => {
  fonts.set('unifraktur', loadFont('../../public/fonts/unifrakturcook-bold.ttf'))
  fonts.set('cinzel', loadFont('../../public/fonts/cinzel.ttf'))
})

const ctx = (): CompileCtx => ({
  diameterMM: 17,
  toleranceMM: EXPORT_TOLERANCE_MM,
  assetsRevision: 0,
  fontsRevision: 0,
  getFont: (id) => fonts.get(id) ?? null,
  getSvgAsset: () => null,
})

/** Mimic the DocRenderer/exportSvg clip pipeline for one consumer layer. */
function clipLayer(layers: Layer[], index: number): Shape[] {
  const c = ctx()
  const compiled = compileLayer(layers[index]!, c)
  const keepouts = keepoutsAbove(layers, index, c)
  const regions = keepouts.contributors.map((k) => rotateMultiPolygon(k.region, k.phaseDeg - layers[index]!.phaseDeg))
  return clipCompiled(compiled, { discs: keepouts.discs, regions }, c.toleranceMM).shapes
}

const resultMp = (shapes: Shape[]): MultiPolygon => {
  const path = shapes.find((s) => s.kind === 'path') as { d: string; fillRule?: string } | undefined
  return path ? pathToMultiPolygon(path.d, 'evenodd', EXPORT_TOLERANCE_MM) : []
}

describe('reversed monogram (cut-out)', () => {
  const disc = () => makeRingLayer({ id: 'disc', mode: 'annulus', rInnerMM: 0.01, rOuterMM: 7 })
  const dee = (phaseDeg = 0) =>
    makeCenterLayer({ id: 'd', text: 'D', fontId: 'unifraktur', sizeMM: 6, booleanRole: 'subtract', phaseDeg })

  it('knocks the D out of the disc but KEEPS its counter (raised metal)', () => {
    const layers = [disc(), dee()]
    const out = clipLayer(layers, 0)
    // compound path with holes
    const path = out.find((s) => s.kind === 'path') as { d: string; fillRule?: string }
    expect(path).toBeDefined()
    expect(path.fillRule).toBe('evenodd')
    expect((path.d.match(/M /g) ?? []).length).toBeGreaterThanOrEqual(3)

    const result = resultMp(out)
    const dRegion = layerKeepoutRegion(layers[1]!, ctx()).region!
    // a point in the D's counter (inside D-outer, in a hole) must stay FILLED
    let counterPt: [number, number] | null = null
    let strokePt: [number, number] | null = null
    for (let x = -3; x <= 3 && (!counterPt || !strokePt); x += 0.15) {
      for (let y = -3; y <= 3; y += 0.15) {
        const inD = pointInMultiPolygon(x, y, dRegion)
        const inOuter = pointInMultiPolygon(x, y, [[dRegion[0]![0]!]]) // D exterior ring only
        if (inOuter && !inD && !counterPt) counterPt = [x, y] // in a counter
        if (inD && !strokePt) strokePt = [x, y] // in the ink
      }
    }
    expect(counterPt).not.toBeNull()
    expect(strokePt).not.toBeNull()
    expect(pointInMultiPolygon(counterPt![0], counterPt![1], result)).toBe(true) // counter filled
    expect(pointInMultiPolygon(strokePt![0], strokePt![1], result)).toBe(false) // ink knocked out
  })

  it('the knockout tracks the contributor phase exactly', () => {
    const mp0 = resultMp(clipLayer([disc(), dee(0)], 0))
    const mp37 = resultMp(clipLayer([disc(), dee(37)], 0))
    expect(multiPolygonArea(mp37)).toBeCloseTo(multiPolygonArea(mp0), 1) // rotation preserves area
    // classifying p against phase-37 equals classifying the −37-rotated p against phase-0
    for (let a = 0; a < 360; a += 23) {
      const r = 5
      const px = r * Math.sin((a * Math.PI) / 180)
      const py = -r * Math.cos((a * Math.PI) / 180)
      const back = rotateMultiPolygon([[[[px, py], [px + 0.01, py], [px, py + 0.01]]]], -37)[0]![0]![0]!
      expect(pointInMultiPolygon(px, py, mp37)).toBe(pointInMultiPolygon(back[0], back[1], mp0))
    }
  })
})

describe('text halo over a pattern', () => {
  it('trims hatch ticks clear of the halo but leaves the far side untouched', () => {
    const layers = [
      makeHatchLayer({ id: 'h', count: 200, rInnerMM: 4, rOuterMM: 8 }),
      makeRingTextLayer({ id: 't', text: 'BUTTONIC', fontId: 'cinzel', sizeMM: 1.8, radiusMM: 6.2, anchorDeg: 0, haloMM: 0.6 }),
    ]
    const region = layerKeepoutRegion(layers[1]!, ctx()).region!
    const out = clipLayer(layers, 0)
    // every emitted segment midpoint clears the region
    for (const s of out) {
      const subs: Array<Array<[number, number]>> = []
      if (s.kind === 'line') subs.push([[s.x1, s.y1], [s.x2, s.y2]])
      else if (s.kind === 'path') for (const sub of s.d.split('M').filter((x) => x.trim())) {
        subs.push([...sub.matchAll(/([-\d.]+)\s+([-\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]))
      }
      for (const pts of subs) for (let i = 0; i + 1 < pts.length; i++) {
        const mx = (pts[i]![0] + pts[i + 1]![0]) / 2
        const my = (pts[i]![1] + pts[i + 1]![1]) / 2
        expect(pointInMultiPolygon(mx, my, region)).toBe(false)
      }
    }
    // a tick at 6 o'clock (opposite the text at 12) survives at full length
    const bottom = out.find((s) => {
      if (s.kind !== 'path') return false
      const pts = [...s.d.matchAll(/([-\d.]+)\s+([-\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as [number, number])
      return pts.some((p) => p[1] > 3 && Math.abs(p[0]) < 1) // near 6 o'clock
    })
    expect(bottom).toBeDefined()
  })

  it('clips a POINTED (filled) hatch by centreline, not martinez — ticks clear the halo', () => {
    const layers = [
      makeHatchLayer({ id: 'h', count: 180, rInnerMM: 4, rOuterMM: 8, cap: 'point', capPointMM: 0.05, pointEnds: 'both', strokeMM: 0.09 }),
      makeRingTextLayer({ id: 't', text: 'BUTTONIC', fontId: 'cinzel', sizeMM: 1.8, radiusMM: 6.2, anchorDeg: 0, haloMM: 0.6 }),
    ]
    const region = layerKeepoutRegion(layers[1]!, ctx()).region!
    const out = clipLayer(layers, 0)
    const filled = out.filter((s): s is Extract<Shape, { kind: 'path' }> => s.kind === 'path' && s.paint.fill)
    expect(filled.length).toBeGreaterThan(0)
    // no surviving tick intrudes into the halo — not its centroid, and (swath
    // semantics) not any vertex or edge midpoint either, nudged 0.1% inward so
    // exactly-on-boundary cut ends don't flicker the point-in test
    for (const s of filled) {
      const pts = [...s.d.matchAll(/(-?\d+\.?\d*)\s+(-?\d+\.?\d*)/g)].map((m) => [Number(m[1]), Number(m[2])] as [number, number])
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length
      const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length
      expect(pointInMultiPolygon(cx, cy, region)).toBe(false)
      const probe = (x: number, y: number) =>
        expect(pointInMultiPolygon(x + (cx - x) * 1e-3, y + (cy - y) * 1e-3, region)).toBe(false)
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!
        const b = pts[(i + 1) % pts.length]!
        probe(a[0], a[1])
        probe((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
      }
    }
    // full spindles (6 verts) away from the text; at the text, the ORIGINAL
    // polygon is band-cut to keep its pointed tip + exact width — a 5-vert body
    // cut or a 3-vert tip, never a fat re-emitted blunt quad
    const verts = filled.map((s) => (s.d.match(/[ML]/g) || []).length)
    expect(verts.some((n) => n === 6)).toBe(true)
    expect(verts.some((n) => n === 3 || n === 5)).toBe(true)
    // a halo is a MARGIN around the outline, not a wedge knockout: the reeding
    // survives on BOTH sides of the letters, so an inner run (well inside the
    // text radius, near 12 o'clock) persists — a whole radial section is never
    // deleted. Ticks therefore split into inner + outer pieces (> one per tick).
    const innerRun = filled.some((s) => {
      const pts = [...s.d.matchAll(/(-?\d+\.?\d*)\s+(-?\d+\.?\d*)/g)].map((m) => [Number(m[1]), Number(m[2])] as [number, number])
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length
      const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length
      return cy < -3.5 && Math.hypot(cx, cy) < 5.8
    })
    expect(innerRun).toBe(true)
    expect(filled.length).toBeGreaterThan(180) // splits ⇒ more pieces than ticks
    expect(filled.length).toBeLessThan(180 * 3) // but bounded — no nub clutter
  })

  it('halo outline mode emits a stroked L-only boundary', () => {
    const layer = makeRingTextLayer({ text: 'AB', fontId: 'cinzel', haloMM: 0.5, haloMode: 'outline', haloStrokeMM: 0.1 })
    const region = layerKeepoutRegion(layer, ctx()).region!
    const shapes = regionOutlineShapes(region, 0.1)
    expect(shapes.length).toBeGreaterThan(0)
    const s = shapes[0]!
    if (s.kind === 'path') {
      expect(s.paint.fill).toBe(false)
      expect(s.paint.stroke?.widthMM).toBe(0.1)
      expect(s.d).not.toContain('C ')
    }
  })
})

describe('export', () => {
  it('a subtract layer emits no markup and the knockout survives instance expansion', async () => {
    const { registerParsedFont } = await import('../io/fonts')
    registerParsedFont('unifraktur', fonts.get('unifraktur')!)
    const { exportSvg } = await import('../io/exportSvg')
    const doc: ButtonDoc = {
      version: 4,
      name: 'Reversed D',
      diameterMM: 17,
      finish: 'steel',
      layers: [
        makeRingLayer({ id: 'disc', mode: 'annulus', rInnerMM: 0.01, rOuterMM: 7 }),
        makeCenterLayer({ id: 'd', text: 'D', fontId: 'unifraktur', sizeMM: 6, booleanRole: 'subtract' }),
      ],
      assets: {},
      localFonts: {},
    }
    const svg = exportSvg(doc, { expandInstances: true, mirrorForDie: false, includeBlankOutline: false }).svg
    expect(svg).not.toContain('id="layer-d"') // subtract layer emits nothing
    expect(svg).not.toContain('<use ') // instances expanded
    expect(svg).toContain('fill-rule="evenodd"') // the knocked-out disc
  })

  it('warns loudly when a subtract layer produces no geometry', async () => {
    const { exportSvg } = await import('../io/exportSvg')
    const doc: ButtonDoc = {
      version: 4,
      name: 'Broken',
      diameterMM: 17,
      finish: 'steel',
      layers: [
        makeRingLayer({ id: 'disc', mode: 'annulus', rInnerMM: 0.01, rOuterMM: 7 }),
        makeCenterLayer({ id: 'd', text: 'D', fontId: 'no-such-font', sizeMM: 6, booleanRole: 'subtract' }),
      ],
      assets: {},
      localFonts: {},
    }
    const { warnings } = exportSvg(doc)
    expect(warnings.some((w) => w.includes('MISSING'))).toBe(true)
  })
})
