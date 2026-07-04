import { IDENTITY, mul, parseTransform, translation, type Mat2d } from '../geometry/mat2d'
import { flattenSegs } from '../geometry/flatten'
import { parsePathData, transformSegs, type PathSeg } from '../geometry/pathData'
import type { ParsedSvgAsset, SvgAssetPath } from '../geometry/svgAsset'

/**
 * SVG import with a strict capability whitelist: vector art only, transforms
 * baked, Illustrator-style `<style>` class rules resolved. Everything outside
 * the whitelist is skipped WITH a report entry — never silently, never a
 * crash. Source units are irrelevant: bend/repeat/center rescale the bbox.
 */

export interface ImportReportItem {
  kind: 'skipped' | 'warning'
  what: string
}

export type SvgImportResult =
  | { ok: true; asset: ParsedSvgAsset; report: ImportReportItem[] }
  | { ok: false; error: string }

interface ResolvedStyle {
  fill: string
  stroke: string
  strokeWidth: number
  fillRule: 'nonzero' | 'evenodd'
}

const KAPPA = 0.5522847498307936

export function importSvg(svgText: string): SvgImportResult {
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  } catch {
    return { ok: false, error: 'The file could not be parsed as SVG.' }
  }
  if (doc.getElementsByTagName('parsererror').length > 0) {
    return { ok: false, error: 'The file is not well-formed SVG.' }
  }
  const root = doc.documentElement
  if (!root || root.tagName.toLowerCase() !== 'svg') {
    return { ok: false, error: 'No <svg> root element found.' }
  }

  const report: ImportReportItem[] = []
  const reported = new Set<string>()
  const say = (kind: ImportReportItem['kind'], what: string) => {
    const key = kind + what
    if (!reported.has(key)) {
      reported.add(key)
      report.push({ kind, what })
    }
  }

  // Minimal <style> class resolver — Illustrator's default export format.
  const classRules = new Map<string, Record<string, string>>()
  for (const styleEl of Array.from(root.getElementsByTagName('style'))) {
    const css = styleEl.textContent ?? ''
    const ruleRe = /\.([A-Za-z_][\w-]*)\s*\{([^}]*)\}/g
    let m: RegExpExecArray | null
    while ((m = ruleRe.exec(css)) !== null) {
      const decls: Record<string, string> = { ...(classRules.get(m[1]!) ?? {}) }
      for (const decl of m[2]!.split(';')) {
        const colon = decl.indexOf(':')
        if (colon === -1) continue
        decls[decl.slice(0, colon).trim().toLowerCase()] = decl.slice(colon + 1).trim()
      }
      classRules.set(m[1]!, decls)
    }
  }

  const paths: SvgAssetPath[] = []

  const resolveStyle = (el: Element, parent: ResolvedStyle): ResolvedStyle => {
    const decls: Record<string, string> = {}
    for (const cls of (el.getAttribute('class') ?? '').split(/\s+/)) {
      const rule = classRules.get(cls)
      if (rule) Object.assign(decls, rule)
    }
    // presentation attributes apply only when no class rule set the property
    // (CSS beats presentation attributes in the cascade)
    for (const name of ['fill', 'stroke', 'stroke-width', 'fill-rule'] as const) {
      if (!(name in decls)) {
        const attr = el.getAttribute(name)
        if (attr !== null) decls[name] = attr
      }
    }
    // inline style beats everything
    const inline = el.getAttribute('style')
    if (inline) {
      for (const decl of inline.split(';')) {
        const colon = decl.indexOf(':')
        if (colon === -1) continue
        decls[decl.slice(0, colon).trim().toLowerCase()] = decl.slice(colon + 1).trim()
      }
    }

    const out: ResolvedStyle = { ...parent }
    if (decls.fill !== undefined) out.fill = decls.fill
    if (decls.stroke !== undefined) out.stroke = decls.stroke
    if (decls['stroke-width'] !== undefined) {
      const w = parseFloat(decls['stroke-width'])
      if (Number.isFinite(w)) out.strokeWidth = w
    }
    if (decls['fill-rule'] !== undefined) {
      out.fillRule = decls['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero'
    }
    return out
  }

  const pushGeometry = (segs: PathSeg[], ctm: Mat2d, style: ResolvedStyle) => {
    if (segs.length === 0) return
    const isPaint = (v: string) => v !== 'none' && v !== 'transparent'
    let fill = isPaint(style.fill)
    const stroke = isPaint(style.stroke)
    if (style.fill.startsWith('url(') || style.stroke.startsWith('url(')) {
      say('warning', 'Gradient/pattern paint flattened to solid engraving')
    }
    if (!fill && !stroke) return // invisible helper geometry
    paths.push({
      segs: transformSegs(segs, ctm),
      fill,
      fillRule: style.fillRule === 'evenodd' ? 'evenodd' : undefined,
      stroke,
      strokeWidthSrc: style.strokeWidth,
    })
  }

  const shapeToSegs = (el: Element): PathSeg[] | null => {
    const num = (name: string, fallback = 0) => {
      const v = parseFloat(el.getAttribute(name) ?? '')
      return Number.isFinite(v) ? v : fallback
    }
    switch (el.tagName.toLowerCase()) {
      case 'path': {
        const d = el.getAttribute('d')
        if (!d) return null
        try {
          return parsePathData(d)
        } catch {
          say('warning', 'A path had unparseable data and was skipped')
          return null
        }
      }
      case 'rect': {
        const x = num('x')
        const y = num('y')
        const w = num('width')
        const h = num('height')
        if (w <= 0 || h <= 0) return null
        if (num('rx') > 0 || num('ry') > 0) say('warning', 'Rounded rect corners squared off')
        return [
          { type: 'M', x, y },
          { type: 'L', x: x + w, y },
          { type: 'L', x: x + w, y: y + h },
          { type: 'L', x, y: y + h },
          { type: 'Z' },
        ]
      }
      case 'circle':
      case 'ellipse': {
        const cx = num('cx')
        const cy = num('cy')
        const rx = el.tagName.toLowerCase() === 'circle' ? num('r') : num('rx')
        const ry = el.tagName.toLowerCase() === 'circle' ? num('r') : num('ry')
        if (rx <= 0 || ry <= 0) return null
        const kx = KAPPA * rx
        const ky = KAPPA * ry
        return [
          { type: 'M', x: cx + rx, y: cy },
          { type: 'C', x1: cx + rx, y1: cy + ky, x2: cx + kx, y2: cy + ry, x: cx, y: cy + ry },
          { type: 'C', x1: cx - kx, y1: cy + ry, x2: cx - rx, y2: cy + ky, x: cx - rx, y: cy },
          { type: 'C', x1: cx - rx, y1: cy - ky, x2: cx - kx, y2: cy - ry, x: cx, y: cy - ry },
          { type: 'C', x1: cx + kx, y1: cy - ry, x2: cx + rx, y2: cy - ky, x: cx + rx, y: cy },
          { type: 'Z' },
        ]
      }
      case 'line':
        return [
          { type: 'M', x: num('x1'), y: num('y1') },
          { type: 'L', x: num('x2'), y: num('y2') },
        ]
      case 'polyline':
      case 'polygon': {
        const nums = (el.getAttribute('points') ?? '')
          .trim()
          .split(/[\s,]+/)
          .map(Number)
          .filter(Number.isFinite)
        if (nums.length < 4) return null
        const segs: PathSeg[] = [{ type: 'M', x: nums[0]!, y: nums[1]! }]
        for (let i = 2; i + 1 < nums.length; i += 2) {
          segs.push({ type: 'L', x: nums[i]!, y: nums[i + 1]! })
        }
        if (el.tagName.toLowerCase() === 'polygon') segs.push({ type: 'Z' })
        return segs
      }
      default:
        return null
    }
  }

  const SKIP_SILENT = new Set(['style', 'title', 'desc', 'metadata', 'defs', 'sodipodi:namedview'])
  const SKIP_REPORT: Record<string, string> = {
    text: 'Live <text> skipped — outline your text before importing',
    tspan: 'Live <text> skipped — outline your text before importing',
    image: '<image> skipped — vector art only',
    foreignobject: '<foreignObject> skipped',
    svg: 'Nested <svg> skipped',
  }

  const walk = (el: Element, ctm: Mat2d, style: ResolvedStyle, depth: number) => {
    if (depth > 32) return
    const tag = el.tagName.toLowerCase()
    if (SKIP_SILENT.has(tag)) return
    if (el.getAttribute('clip-path')) say('warning', 'clip-path ignored')
    if (el.getAttribute('mask')) say('warning', 'mask ignored')
    if (el.getAttribute('filter')) say('warning', 'filter ignored')

    const own = mul(ctm, parseTransform(el.getAttribute('transform')))
    const resolved = resolveStyle(el, style)

    if (tag === 'g') {
      for (const child of Array.from(el.children)) walk(child, own, resolved, depth + 1)
      return
    }
    if (tag === 'use') {
      const href = el.getAttribute('href') ?? el.getAttribute('xlink:href')
      if (href?.startsWith('#')) {
        const target = doc.getElementById(href.slice(1))
        if (target) {
          const shift = translation(
            parseFloat(el.getAttribute('x') ?? '0') || 0,
            parseFloat(el.getAttribute('y') ?? '0') || 0,
          )
          walk(target, mul(own, shift), resolved, depth + 1)
        } else {
          say('warning', `<use> target ${href} not found`)
        }
      }
      return
    }
    if (tag in SKIP_REPORT) {
      say('skipped', SKIP_REPORT[tag]!)
      return
    }

    const segs = shapeToSegs(el)
    if (segs) {
      pushGeometry(segs, own, resolved)
      return
    }
    if (el.children.length > 0) {
      for (const child of Array.from(el.children)) walk(child, own, resolved, depth + 1)
    } else if (!SKIP_SILENT.has(tag)) {
      say('skipped', `<${tag}> is not supported and was skipped`)
    }
  }

  const rootStyle: ResolvedStyle = { fill: '#000', stroke: 'none', strokeWidth: 1, fillRule: 'nonzero' }
  for (const child of Array.from(root.children)) walk(child, IDENTITY, rootStyle, 0)

  if (paths.length === 0) {
    return { ok: false, error: 'No drawable vector geometry found in the SVG.' }
  }

  // Accurate drawable bbox from finely flattened outlines.
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of paths) {
    for (const sub of flattenSegs(p.segs, 0.05)) {
      for (const pt of sub.pts) {
        if (pt.x < minX) minX = pt.x
        if (pt.y < minY) minY = pt.y
        if (pt.x > maxX) maxX = pt.x
        if (pt.y > maxY) maxY = pt.y
      }
    }
  }
  // A zero-height (or zero-width) box is fine — a single engraved line is
  // legitimate art; only a zero-area point is degenerate.
  if (!Number.isFinite(minX) || (maxX - minX <= 0 && maxY - minY <= 0)) {
    return { ok: false, error: 'The SVG geometry has a degenerate bounding box.' }
  }

  return {
    ok: true,
    asset: { paths, box: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } },
    report,
  }
}
