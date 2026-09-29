import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as opentype from 'opentype.js'
import { describe, expect, it } from 'vitest'
import { flattenSegs } from './flatten'
import { BUILTIN_MOTIFS } from './motifs/builtins'
import { parsePathData } from './pathData'
import { multiPolygonArea, pathToMultiPolygon } from './poly'

/**
 * Fill-rule regression: the polygon a filled path becomes must cover exactly
 * what SVG's nonzero rule paints. The reference is an independent scanline
 * fill with winding numbers, straight off the flattened contours — fonts with
 * OVERLAPPING contours (Cinzel's A/E, Jost's R, Roboto's 3, Oswald's g) and
 * motifs with nested same-direction loops were once mangled by a parity
 * shortcut (crossbars became holes).
 */

function nonzeroArea(d: string, tol: number, rows = 900): number {
  const subs = flattenSegs(parsePathData(d), tol)
  const edges: [number, number, number, number][] = []
  let minY = Infinity
  let maxY = -Infinity
  for (const s of subs) {
    const p = s.pts
    for (let i = 0; i < p.length; i++) {
      const a = p[i]!
      const b = p[(i + 1) % p.length]!
      edges.push([a.x, a.y, b.x, b.y])
      minY = Math.min(minY, a.y)
      maxY = Math.max(maxY, a.y)
    }
  }
  const h = (maxY - minY) / rows
  let area = 0
  for (let r = 0; r < rows; r++) {
    const y = minY + (r + 0.5) * h
    const xs: [number, number][] = []
    for (const [x0, y0, x1, y1] of edges) {
      if (y0 <= y !== y1 <= y) xs.push([x0 + ((y - y0) * (x1 - x0)) / (y1 - y0), y1 > y0 ? 1 : -1])
    }
    xs.sort((a, b) => a[0] - b[0])
    let w = 0
    for (let i = 0; i < xs.length; i++) {
      const prev = w
      w += xs[i]![1]
      if (prev !== 0 && i > 0) area += (xs[i]![0] - xs[i - 1]![0]) * h
    }
  }
  return area
}

const loadFont = (file: string): opentype.Font => {
  const buf = readFileSync(fileURLToPath(new URL(`../../public/fonts/${file}`, import.meta.url)))
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
}

const FONTS = ['cinzel.ttf', 'jost.ttf', 'roboto.ttf', 'playfair-display.ttf', 'oswald.ttf', 'roboto-slab.ttf', 'ebgaramond.ttf', 'rye.ttf', 'unifrakturcook-bold.ttf', 'bebas-neue.ttf', 'pinyon-script.ttf', 'allerta-stencil.ttf']
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ&0123456789abcdefghijklmnopqrstuvwxyz@$%'

describe('filled paths reconstruct with TRUE nonzero winding', () => {
  for (const file of FONTS) {
    it(`${file}: every glyph matches the scanline nonzero fill`, { timeout: 60_000 }, () => {
      const font = loadFont(file)
      const bad: string[] = []
      for (const ch of CHARS) {
        const d = font.getPath(ch, 0, 0, 10).toPathData(5)
        if (!d) continue
        const ref = nonzeroArea(d, 0.002)
        const got = multiPolygonArea(pathToMultiPolygon(d, 'nonzero', 0.002))
        if (Math.abs(got - ref) > 0.01 * ref) bad.push(`${ch} ${got.toFixed(3)} vs ${ref.toFixed(3)}`)
      }
      expect(bad).toEqual([])
    })
  }

  it('every filled built-in motif matches the scanline nonzero fill', { timeout: 60_000 }, () => {
    const bad: string[] = []
    for (const m of BUILTIN_MOTIFS) {
      if (m.paintType !== 'fill') continue
      const ref = nonzeroArea(m.d, 0.0005)
      const got = multiPolygonArea(pathToMultiPolygon(m.d, 'nonzero', 0.0005))
      if (Math.abs(got - ref) > 0.01 * Math.max(ref, 1e-6)) bad.push(`${m.id} ${got.toFixed(4)} vs ${ref.toFixed(4)}`)
    }
    expect(bad).toEqual([])
  })
})
