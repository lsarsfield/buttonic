import type { ButtonDoc, LogoDisplay } from '../model/types'
import { CENTRE_LABELS, centreKindOf, isOpening, reliefGroups } from '../model/product'
import { clipCompiled } from '../geometry/clip'
import { compileLayer, EXPORT_TOLERANCE_MM, type CompileCtx } from '../geometry/compile'
import {
  castsRegion,
  isSubtractLayer,
  keepoutsAbove,
  layerKeepoutRegion,
  outlineOf,
  outlineShapes,
} from '../geometry/keepout'
import { bareInvertRegion, invertsBare } from '../geometry/invert'
import { multiPolygonToPathD, rotateMultiPolygon } from '../geometry/poly'
import { expandInstanced, defMatrix } from '../geometry/expand'
import { fmt } from '../geometry/format'
import { distToSegment, flattenSegs } from '../geometry/flatten'
import { parsePathData, transformSegs } from '../geometry/pathData'
import { fillPaint, type Paint, type Shape } from '../geometry/shapes'
import { stringifyDoc } from '../model/serialize'
import { specSheet } from './specSheet'
import { getLoadedFont } from './fonts'
import { getSvgAsset } from './svgAssets'

/**
 * Die-file export: recompiles every layer at export tolerance, bakes phase
 * rotations and (by default) expands all instances to plain paths, and embeds
 * the project JSON in <metadata> so the exported SVG re-opens as a document.
 * mm-true: user units are millimetres, width/height carry the mm size.
 * No filters, no masks, no CSS — black geometry on transparency, plus an
 * optional blank outline.
 */

export interface SvgExportOptions {
  expandInstances: boolean
  mirrorForDie: boolean
  includeBlankOutline: boolean
  /** Embed the project JSON in <metadata> (default true; thumbnails pass false). */
  embedProject?: boolean
  /**
   * Emit only these layers' markup — every layer still casts its knockouts and
   * halos, so each emitted layer is exactly as in the full die (the 3D view
   * rasterizes raised / sunk / lasered art separately this way).
   */
  onlyLayers?: ReadonlySet<string>
}

export const DEFAULT_SVG_OPTIONS: SvgExportOptions = {
  expandInstances: true,
  mirrorForDie: false,
  includeBlankOutline: true,
}

export interface SvgExportResult {
  svg: string
  warnings: string[]
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const MIN_STROKE_MM = 0.05

function paintAttrs(paint: Paint): string {
  const parts: string[] = []
  parts.push(`fill="${paint.fill ? '#000000' : 'none'}"`)
  if (paint.stroke) {
    const join = paint.stroke.join ? ` stroke-linejoin="${paint.stroke.join}"` : ''
    parts.push(
      `stroke="#000000" stroke-width="${fmt(paint.stroke.widthMM)}" stroke-linecap="${paint.stroke.cap}"${join}`,
    )
  }
  return parts.join(' ')
}

function shapeToMarkup(shape: Shape, defIdBase: string, out: string[], defs: string[]): void {
  switch (shape.kind) {
    case 'circle':
      out.push(`<circle r="${fmt(shape.rMM)}" ${paintAttrs(shape.paint)}/>`)
      break
    case 'line':
      out.push(
        `<line x1="${fmt(shape.x1)}" y1="${fmt(shape.y1)}" x2="${fmt(shape.x2)}" y2="${fmt(
          shape.y2,
        )}" ${paintAttrs(shape.paint)}/>`,
      )
      break
    case 'path': {
      const fr = shape.fillRule ? ` fill-rule="${shape.fillRule}"` : ''
      out.push(`<path d="${shape.d}"${fr} ${paintAttrs(shape.paint)}/>`)
      break
    }
    case 'instanced': {
      const dm = defMatrix(shape.def)
      const defD = shape.def.d
      const strokeScale = Math.abs(shape.def.scale)
      const adjustedPaint: Paint = shape.paint.stroke
        ? {
            ...shape.paint,
            stroke: { ...shape.paint.stroke, widthMM: shape.paint.stroke.widthMM / strokeScale },
          }
        : shape.paint
      const matAttr = `matrix(${fmt(dm.a)} ${fmt(dm.b)} ${fmt(dm.c)} ${fmt(dm.d)} ${fmt(dm.e)} ${fmt(dm.f)})`
      defs.push(`<path id="${defIdBase}" d="${defD}" transform="${matAttr}" ${paintAttrs(adjustedPaint)}/>`)
      for (const tr of shape.transforms) {
        const parts: string[] = []
        if (tr.dx !== 0 || tr.dy !== 0) parts.push(`translate(${fmt(tr.dx)} ${fmt(tr.dy)})`)
        if (tr.rotateDeg !== 0) parts.push(`rotate(${fmt(tr.rotateDeg)})`)
        if (tr.mirrorX) parts.push('scale(-1 1)')
        const t = parts.length > 0 ? ` transform="${parts.join(' ')}"` : ''
        out.push(`<use href="#${defIdBase}"${t}/>`)
      }
      break
    }
  }
}

/** Rough outer extent of a shape in mm, for the off-the-face warning. */
function shapeMaxRadius(shape: Shape): number {
  switch (shape.kind) {
    case 'circle':
      return shape.rMM + (shape.paint.stroke?.widthMM ?? 0) / 2
    case 'line':
      return Math.max(Math.hypot(shape.x1, shape.y1), Math.hypot(shape.x2, shape.y2))
    case 'path': {
      let max = 0
      for (const sub of flattenSegs(parsePathData(shape.d), 0.1)) {
        for (const p of sub.pts) max = Math.max(max, Math.hypot(p.x, p.y))
      }
      return max
    }
    case 'instanced': {
      let max = 0
      const segs = transformSegs(parsePathData(shape.def.d), defMatrix(shape.def))
      for (const sub of flattenSegs(segs, 0.1)) {
        for (const p of sub.pts) max = Math.max(max, Math.hypot(p.x, p.y))
      }
      // instances are rotations/translations by |t|; translations shift the extent
      const extraShift = shape.transforms.reduce((m, t) => Math.max(m, Math.hypot(t.dx, t.dy)), 0)
      return shape.def.dx === 0 && shape.def.dy === 0 && extraShift > 0 ? max + extraShift : max
    }
  }
}

/** Nearest approach of a shape to the axis in mm (stroke included), for the centre-hole warning. */
function shapeMinRadius(shape: Shape): number {
  const half = (shape.paint.stroke?.widthMM ?? 0) / 2
  const O = { x: 0, y: 0 }
  const polyMin = (subs: ReturnType<typeof flattenSegs>): number => {
    let min = Infinity
    for (const sub of subs) {
      const pts = sub.pts
      if (pts.length === 1) min = Math.min(min, Math.hypot(pts[0]!.x, pts[0]!.y))
      for (let i = 0; i + 1 < pts.length; i++) min = Math.min(min, distToSegment(O, pts[i]!, pts[i + 1]!))
      if (sub.closed && pts.length > 2) min = Math.min(min, distToSegment(O, pts[pts.length - 1]!, pts[0]!))
    }
    return min
  }
  switch (shape.kind) {
    case 'circle':
      return Math.max(0, shape.rMM - half)
    case 'line':
      return Math.max(0, distToSegment(O, { x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }) - half)
    case 'path':
      return Math.max(0, polyMin(flattenSegs(parsePathData(shape.d), 0.05)) - half)
    case 'instanced':
      // pure rotations keep radii — only translated instances need expanding
      if (shape.transforms.every((t) => t.dx === 0 && t.dy === 0)) {
        return Math.max(0, polyMin(flattenSegs(transformSegs(parsePathData(shape.def.d), defMatrix(shape.def)), 0.05)) - half)
      }
      return expandInstanced(shape).reduce((m, s) => Math.min(m, shapeMinRadius(s)), Infinity)
  }
}

export function exportSvg(doc: ButtonDoc, options: SvgExportOptions = DEFAULT_SVG_OPTIONS): SvgExportResult {
  const warnings: string[] = []
  const R = doc.diameterMM / 2
  const centre = centreKindOf(doc)
  const holeR = centre === 'none' ? 0 : doc.holeDiameterMM / 2
  const centreName = centre === 'none' ? '' : CENTRE_LABELS[centre].toLowerCase()
  const ctx: CompileCtx = {
    diameterMM: doc.diameterMM,
    toleranceMM: EXPORT_TOLERANCE_MM,
    assetsRevision: -1, // export never reuses the interactive memo entries
    fontsRevision: -1,
    getFont: getLoadedFont,
    getSvgAsset,
  }

  const layerMarkup: { id: string; markup: string }[] = []
  const defs: string[] = []

  doc.layers.forEach((layer, index) => {
    if (!layer.visible) return

    // cut-out layers emit no markup of their own (bar any invert-over-bare
    // overhang) — but still compile so an empty knockout is a LOUD warning
    // (a silently-missing knockout is a scrapped die)
    if (castsRegion(layer)) {
      const { region, warnings: rw } = layerKeepoutRegion(layer, ctx)
      for (const w of rw) warnings.push(`${layer.name}: ${w}`)
      if (!region || region.length === 0) {
        warnings.push(
          `${layer.name}: ${isSubtractLayer(layer) ? 'cut-out' : 'halo'} produced no geometry — the knockout is MISSING from this export`,
        )
      }
      // a cut-out engraves only where it crosses bare metal (invertOverBare)
      if (isSubtractLayer(layer) && !invertsBare(layer)) return
    }

    let compiled = compileLayer(layer, ctx)
    if (isSubtractLayer(layer)) {
      const bare = bareInvertRegion(doc.layers, index, ctx, (l) => layerKeepoutRegion(l, ctx).region)
      if (bare.length === 0) return
      compiled = { shapes: [{ kind: 'path', d: multiPolygonToPathD(bare), fillRule: 'evenodd', paint: fillPaint() }], warnings: [] }
    }
    // halo 'outline': the engraved ring joins the art BEFORE clipping (layers above trim it)
    if (!isSubtractLayer(layer) && outlineOf(layer) > 0) {
      const own = outlineShapes(layerKeepoutRegion(layer, ctx).outline)
      if (own.length > 0) compiled = { shapes: [...compiled.shapes, ...own], warnings: compiled.warnings }
    }
    const keepouts = keepoutsAbove(doc.layers, index, ctx, doc.logoDisplay)
    const regions = keepouts.contributors.map((c) => rotateMultiPolygon(c.region, c.phaseDeg - layer.phaseDeg))
    if (keepouts.discs.length > 0 || regions.length > 0) {
      compiled = clipCompiled(compiled, { discs: keepouts.discs, regions }, ctx.toleranceMM)
    }
    for (const w of compiled.warnings) warnings.push(`${layer.name}: ${w}`)

    const body: string[] = []
    compiled.shapes.forEach((shape, si) => {
      if (shape.paint.stroke && shape.paint.stroke.widthMM < MIN_STROKE_MM) {
        warnings.push(
          `${layer.name}: stroke ${shape.paint.stroke.widthMM.toFixed(3)} mm is below the ${MIN_STROKE_MM} mm engraving minimum`,
        )
      }
      if (shapeMaxRadius(shape) > R + 0.01) {
        warnings.push(`${layer.name}: geometry extends beyond the button face`)
      }
      if (holeR > 0 && shapeMinRadius(shape) < holeR - 0.01) {
        warnings.push(`${layer.name}: geometry extends into the ${centreName}`)
      }
      if (shape.kind === 'instanced' && options.expandInstances) {
        for (const flat of expandInstanced(shape)) shapeToMarkup(flat, '', body, defs)
      } else {
        shapeToMarkup(shape, `def-${layer.id}-${si}`, body, defs)
      }
    })
    if (body.length === 0) return

    const phase = layer.phaseDeg !== 0 ? ` transform="rotate(${fmt(layer.phaseDeg)})"` : ''
    layerMarkup.push({
      id: layer.id,
      markup: `<g id="layer-${layer.id}" data-name="${xmlEscape(layer.name)}"${phase}>\n${body.join('\n')}\n</g>`,
    })
  })

  const outline = options.includeBlankOutline
    ? `<circle r="${fmt(R)}" fill="none" stroke="#000000" stroke-width="0.02" data-name="blank outline"/>` +
      (holeR > 0 && isOpening(centre)
        ? `\n<circle r="${fmt(holeR)}" fill="none" stroke="#000000" stroke-width="0.02" data-name="${centreName}"/>`
        : '')
    : ''
  // a mixed-relief die: the maker needs each depth as its own group (all still
  // plain black); a single-relief die keeps the flat layer list
  const emitted = options.onlyLayers ? layerMarkup.filter((m) => options.onlyLayers!.has(m.id)) : layerMarkup
  const groups = reliefGroups(doc)
  let engravingBody: string
  if (groups.size > 1 && !options.onlyLayers) {
    const RELIEF_GROUP: Record<LogoDisplay, [string, string]> = {
      embossed: ['relief-raised', 'Raised (embossed)'],
      debossed: ['relief-sunk', 'Sunk (debossed)'],
      lasered: ['relief-lasered', 'Lasered (flush marking)'],
    }
    engravingBody = [...groups.entries()]
      .map(([relief, members]) => {
        const ids = new Set(members.map((m) => m.id))
        const inner = emitted.filter((m) => ids.has(m.id)).map((m) => m.markup)
        if (inner.length === 0) return ''
        const [gid, label] = RELIEF_GROUP[relief]
        return `<g id="${gid}" data-name="${label}">\n${inner.join('\n')}\n</g>`
      })
      .filter(Boolean)
      .join('\n')
  } else {
    engravingBody = emitted.map((m) => m.markup).join('\n')
  }
  const mirror = options.mirrorForDie ? ` transform="scale(-1 1)"` : ''
  const defsBlock = defs.length > 0 ? `<defs>\n${defs.join('\n')}\n</defs>\n` : ''
  // the order spec travels with the artwork (skipped for thumbnails / rasters)
  const desc = options.embedProject === false ? '' : `<desc>${xmlEscape(specSheet(doc))}</desc>\n`
  const meta =
    options.embedProject === false
      ? ''
      : `<metadata id="buttonic-project">${xmlEscape(stringifyDoc(doc))}</metadata>`

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(-R)} ${fmt(-R)} ${fmt(doc.diameterMM)} ${fmt(
    doc.diameterMM,
  )}" width="${fmt(doc.diameterMM)}mm" height="${fmt(doc.diameterMM)}mm">
<title>${xmlEscape(doc.name)}</title>
${desc}${meta}
${defsBlock}<g id="engraving"${mirror}>
${outline}
${engravingBody}
</g>
</svg>`

  return { svg, warnings: [...new Set(warnings)] }
}

/**
 * Re-open an exported SVG as a project (reads the embedded metadata JSON).
 * Accepts the pre-rename "button-engraver-project" id so older exports open.
 */
export function extractEmbeddedProject(svgText: string): string | null {
  const m = svgText.match(/<metadata id="(?:buttonic|button-engraver)-project">([\s\S]*?)<\/metadata>/)
  if (!m) return null
  return m[1]!
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}
