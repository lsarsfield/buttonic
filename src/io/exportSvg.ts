import type { ButtonDoc } from '../model/types'
import { clipCompiled } from '../geometry/clip'
import { compileLayer, EXPORT_TOLERANCE_MM, type CompileCtx } from '../geometry/compile'
import {
  castsRegion,
  haloOf,
  isSubtractLayer,
  keepoutsAbove,
  layerKeepoutRegion,
  regionOutlineShapes,
} from '../geometry/keepout'
import { rotateMultiPolygon } from '../geometry/poly'
import { expandInstanced, defMatrix } from '../geometry/expand'
import { fmt } from '../geometry/format'
import { flattenSegs } from '../geometry/flatten'
import { parsePathData, transformSegs } from '../geometry/pathData'
import type { Paint, Shape } from '../geometry/shapes'
import { stringifyDoc } from '../model/serialize'
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
    parts.push(
      `stroke="#000000" stroke-width="${fmt(paint.stroke.widthMM)}" stroke-linecap="${paint.stroke.cap}"`,
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

export function exportSvg(doc: ButtonDoc, options: SvgExportOptions = DEFAULT_SVG_OPTIONS): SvgExportResult {
  const warnings: string[] = []
  const R = doc.diameterMM / 2
  const ctx: CompileCtx = {
    diameterMM: doc.diameterMM,
    toleranceMM: EXPORT_TOLERANCE_MM,
    assetsRevision: -1, // export never reuses the interactive memo entries
    fontsRevision: -1,
    getFont: getLoadedFont,
    getSvgAsset,
  }

  const layerMarkup: string[] = []
  const defs: string[] = []

  doc.layers.forEach((layer, index) => {
    if (!layer.visible) return

    // cut-out layers emit no markup — but still compile so an empty knockout is
    // a LOUD warning (a silently-missing knockout is a scrapped die)
    if (castsRegion(layer)) {
      const { region, warnings: rw } = layerKeepoutRegion(layer, ctx)
      for (const w of rw) warnings.push(`${layer.name}: ${w}`)
      if (!region || region.length === 0) {
        warnings.push(
          `${layer.name}: ${isSubtractLayer(layer) ? 'cut-out' : 'halo'} produced no geometry — the knockout is MISSING from this export`,
        )
      }
      if (isSubtractLayer(layer)) return
    }

    let compiled = compileLayer(layer, ctx)
    const keepouts = keepoutsAbove(doc.layers, index, ctx)
    const regions = keepouts.contributors.map((c) => rotateMultiPolygon(c.region, c.phaseDeg - layer.phaseDeg))
    if (keepouts.discs.length > 0 || regions.length > 0) {
      compiled = clipCompiled(compiled, { discs: keepouts.discs, regions }, ctx.toleranceMM)
    }
    if (haloOf(layer) > 0 && layer.type !== 'bend' && (layer as { haloMode?: string }).haloMode === 'outline') {
      const own = layerKeepoutRegion(layer, ctx).region
      if (own) compiled = { shapes: [...compiled.shapes, ...regionOutlineShapes(own, (layer as { haloStrokeMM: number }).haloStrokeMM)], warnings: compiled.warnings }
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
      if (shape.kind === 'instanced' && options.expandInstances) {
        for (const flat of expandInstanced(shape)) shapeToMarkup(flat, '', body, defs)
      } else {
        shapeToMarkup(shape, `def-${layer.id}-${si}`, body, defs)
      }
    })
    if (body.length === 0) return

    const phase = layer.phaseDeg !== 0 ? ` transform="rotate(${fmt(layer.phaseDeg)})"` : ''
    layerMarkup.push(
      `<g id="layer-${layer.id}" data-name="${xmlEscape(layer.name)}"${phase}>\n${body.join('\n')}\n</g>`,
    )
  })

  const outline = options.includeBlankOutline
    ? `<circle r="${fmt(R)}" fill="none" stroke="#000000" stroke-width="0.02" data-name="blank outline"/>`
    : ''
  const mirror = options.mirrorForDie ? ` transform="scale(-1 1)"` : ''
  const defsBlock = defs.length > 0 ? `<defs>\n${defs.join('\n')}\n</defs>\n` : ''
  const meta =
    options.embedProject === false
      ? ''
      : `<metadata id="buttonic-project">${xmlEscape(stringifyDoc(doc))}</metadata>`

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(-R)} ${fmt(-R)} ${fmt(doc.diameterMM)} ${fmt(
    doc.diameterMM,
  )}" width="${fmt(doc.diameterMM)}mm" height="${fmt(doc.diameterMM)}mm">
<title>${xmlEscape(doc.name)}</title>
${meta}
${defsBlock}<g id="engraving"${mirror}>
${outline}
${layerMarkup.join('\n')}
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
