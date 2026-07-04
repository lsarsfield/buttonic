import type { Font } from 'opentype.js'
import type { Layer } from '../model/types'
import { compileBend } from './bend'
import { compileCenter } from './center'
import { compileHatch } from './hatch'
import { compileRing } from './ring'
import { compileRingText } from './ringText'
import { compileRepeat } from './repeat'
import type { ParsedSvgAsset } from './svgAsset'
import type { CompiledLayer } from './shapes'

export interface CompileCtx {
  diameterMM: number
  /** Chord tolerance for warped content. Interactive 0.01, export 0.0025. */
  toleranceMM: number
  assetsRevision: number
  fontsRevision: number
  /** Parsed font lookup — null while a font is still loading. */
  getFont: (fontId: string) => Font | null
  /** Parsed SVG asset lookup — null while parsing (or unknown id). */
  getSvgAsset: (assetId: string) => ParsedSvgAsset | null
}

export const INTERACTIVE_TOLERANCE_MM = 0.01
export const EXPORT_TOLERANCE_MM = 0.0025

/**
 * Memoized per-layer compile. Immer keeps unchanged layers referentially
 * identical across store updates, so the WeakMap only recompiles the edited
 * layer; the ctx key catches diameter/tolerance/asset/font changes.
 */
const cache = new WeakMap<Layer, { key: string; result: CompiledLayer }>()

export function compileLayer(layer: Layer, ctx: CompileCtx): CompiledLayer {
  const key = `${ctx.diameterMM}|${ctx.toleranceMM}|${ctx.assetsRevision}|${ctx.fontsRevision}`
  const hit = cache.get(layer)
  if (hit && hit.key === key) return hit.result
  const result = compileByType(layer, ctx)
  cache.set(layer, { key, result })
  return result
}

function compileByType(layer: Layer, ctx: CompileCtx): CompiledLayer {
  switch (layer.type) {
    case 'ring':
      return compileRing(layer)
    case 'hatch':
      return compileHatch(layer)
    case 'repeat':
      return compileRepeat(layer, ctx.getSvgAsset)
    case 'ringText':
      return compileRingText(layer, ctx.getFont(layer.fontId), ctx.toleranceMM, ctx.getSvgAsset)
    case 'center':
      return compileCenter(
        layer,
        layer.sourceType === 'glyph' ? ctx.getFont(layer.fontId) : null,
        ctx.getSvgAsset,
      )
    case 'bend':
      return compileBend(layer, layer.assetId ? ctx.getSvgAsset(layer.assetId) : null, ctx.toleranceMM)
  }
}
