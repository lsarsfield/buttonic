import { mul, scaling, translation } from './mat2d'
import type { Box, PathSeg } from './pathData'
import { segsToD, transformSegs } from './pathData'

/**
 * A parsed, normalized SVG asset: flat list of paths (absolute M/L/C/Z segs)
 * with resolved paint semantics, plus the drawable bounding box. Produced by
 * io/svgImport.ts; consumed by the bend / repeat / center compilers.
 */

export interface SvgAssetPath {
  segs: PathSeg[]
  fill: boolean
  fillRule?: 'evenodd'
  stroke: boolean
  /** Stroke width in source units (informational; layers set the mm width). */
  strokeWidthSrc: number
}

export interface ParsedSvgAsset {
  paths: SvgAssetPath[]
  box: Box
}

export interface UnitMotifPath {
  d: string
  paintType: 'fill' | 'stroke'
  fillRule?: 'evenodd'
}

/**
 * Normalize an asset into the motif unit frame (height 1, centred on the
 * origin) so repeat/center layers can place it exactly like a builtin motif.
 */
export function assetToUnitMotif(asset: ParsedSvgAsset): UnitMotifPath[] {
  const h = asset.box.h || 1
  const s = 1 / h
  const cx = asset.box.x + asset.box.w / 2
  const cy = asset.box.y + asset.box.h / 2
  const m = mul(scaling(s, s), translation(-cx, -cy))
  return asset.paths.map((p) => ({
    d: segsToD(transformSegs(p.segs, m)),
    paintType: p.stroke && !p.fill ? 'stroke' : 'fill',
    fillRule: p.fillRule,
  }))
}
