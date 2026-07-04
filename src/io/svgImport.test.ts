// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { flattenSegs } from '../geometry/flatten'
import { importSvg } from './svgImport'

const wrap = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${inner}</svg>`

describe('importSvg', () => {
  it('converts basic shapes to paths with correct geometry', () => {
    const result = importSvg(
      wrap(`
        <rect x="10" y="10" width="30" height="20"/>
        <circle cx="50" cy="50" r="10"/>
        <polygon points="0,0 10,0 5,8"/>
        <line x1="0" y1="0" x2="10" y2="10" stroke="black"/>
      `),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.asset.paths).toHaveLength(4)
    // rect flattens to its 4 corners (+ closing point weld)
    const rectPts = flattenSegs(result.asset.paths[0]!.segs, 0.01)[0]!.pts
    const xs = rectPts.map((p) => p.x)
    const ys = rectPts.map((p) => p.y)
    expect(Math.min(...xs)).toBeCloseTo(10, 9)
    expect(Math.max(...xs)).toBeCloseTo(40, 9)
    expect(Math.min(...ys)).toBeCloseTo(10, 9)
    expect(Math.max(...ys)).toBeCloseTo(30, 9)
    // circle → 4 cubics whose flattened radius ≈ 10 everywhere
    for (const sub of flattenSegs(result.asset.paths[1]!.segs, 0.005)) {
      for (const p of sub.pts) {
        expect(Math.hypot(p.x - 50, p.y - 50)).toBeCloseTo(10, 1)
      }
    }
  })

  it('bakes nested group transforms into coordinates', () => {
    const result = importSvg(
      wrap(`<g transform="translate(10 0)"><g transform="scale(2)"><rect x="0" y="0" width="5" height="5"/></g></g>`),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const pts = flattenSegs(result.asset.paths[0]!.segs, 0.01)[0]!.pts
    const xs = pts.map((p) => p.x)
    expect(Math.min(...xs)).toBeCloseTo(10, 9)
    expect(Math.max(...xs)).toBeCloseTo(20, 9)
  })

  it('resolves Illustrator-style <style> class rules onto elements', () => {
    const result = importSvg(
      wrap(`
        <style>.st0{fill:none;stroke:#000;stroke-width:2;}</style>
        <path class="st0" d="M 0 0 L 10 0"/>
      `),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const p = result.asset.paths[0]!
    expect(p.fill).toBe(false)
    expect(p.stroke).toBe(true)
    expect(p.strokeWidthSrc).toBe(2)
  })

  it('inline style beats class rules', () => {
    const result = importSvg(
      wrap(`
        <style>.st0{fill:#000;}</style>
        <rect class="st0" style="fill:none;stroke:#f00" x="0" y="0" width="5" height="5"/>
      `),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.asset.paths[0]!.fill).toBe(false)
    expect(result.asset.paths[0]!.stroke).toBe(true)
  })

  it('skips live <text> with a readable report entry, not a crash', () => {
    const result = importSvg(wrap(`<text x="0" y="10">hello</text><rect x="0" y="0" width="5" height="5"/>`))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.asset.paths).toHaveLength(1)
    expect(result.report.some((r) => r.kind === 'skipped' && /outline your text/i.test(r.what))).toBe(true)
  })

  it('expands simple <use> references', () => {
    const result = importSvg(
      wrap(`
        <defs><rect id="u" x="0" y="0" width="4" height="4"/></defs>
        <use href="#u" x="10" y="0"/>
      `),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.asset.paths).toHaveLength(1)
    const xs = flattenSegs(result.asset.paths[0]!.segs, 0.01)[0]!.pts.map((p) => p.x)
    expect(Math.min(...xs)).toBeCloseTo(10, 9)
  })

  it('fails cleanly on files with no drawable geometry', () => {
    const result = importSvg(wrap(`<text x="0" y="0">only text</text>`))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/geometry/i)
  })

  it('computes the drawable bbox', () => {
    const result = importSvg(wrap(`<rect x="5" y="10" width="20" height="30"/>`))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.asset.box).toEqual(
      expect.objectContaining({ x: 5, y: 10, w: 20, h: 30 }),
    )
  })
})
