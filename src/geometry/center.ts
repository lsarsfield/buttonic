import type { Font } from 'opentype.js'
import type { CenterLayer } from '../model/types'
import { glyphPathD } from './glyphs'
import { mul, rotateThenTranslate, scaling, translation } from './mat2d'
import { segsToD, transformSegs } from './pathData'
import type { ParsedSvgAsset } from './svgAsset'
import type { CompiledLayer, Shape } from './shapes'
import { fillPaint, strokePaint } from './shapes'

/**
 * Monogram or SVG at the axis: content is centred on the origin by its
 * bounding box (plus a small optical offset if the user wants one), scaled to
 * sizeMM, then rotated.
 */
export function compileCenter(
  layer: CenterLayer,
  font: Font | null,
  getSvgAsset: (assetId: string) => ParsedSvgAsset | null = () => null,
): CompiledLayer {
  if (layer.sourceType === 'asset') {
    if (!layer.assetId) {
      return { shapes: [], warnings: ['Choose or upload an SVG for the centre element.'] }
    }
    const asset = getSvgAsset(layer.assetId)
    if (!asset) return { shapes: [], warnings: ['Parsing SVG…'] }
    if (asset.paths.length === 0 || asset.box.w <= 0 || asset.box.h <= 0) {
      return { shapes: [], warnings: ['The SVG contains no drawable geometry.'] }
    }
    // fit the LONGER bbox side to sizeMM, centred on the axis
    const s = layer.sizeMM / Math.max(asset.box.w, asset.box.h)
    const cx = asset.box.x + asset.box.w / 2
    const cy = asset.box.y + asset.box.h / 2
    const m = mul(
      rotateThenTranslate(layer.rotationDeg, layer.offsetXMM, layer.offsetYMM),
      mul(scaling(s, s), translation(-cx, -cy)),
    )
    const shapes: Shape[] = asset.paths.map((p) => ({
      kind: 'path',
      d: segsToD(transformSegs(p.segs, m)),
      fillRule: p.fillRule,
      paint:
        layer.render === 'stroke' || (p.stroke && !p.fill)
          ? strokePaint(layer.strokeMM, 'round')
          : fillPaint(),
    }))
    return { shapes, warnings: [] }
  }
  if (!font) {
    return { shapes: [], warnings: ['Font unavailable — text not rendered (loading, or a missing local font).'] }
  }
  if (layer.text.length === 0) return { shapes: [], warnings: [] }

  const path = font.getPath(layer.text, 0, 0, layer.sizeMM, { kerning: true })
  const bb = path.getBoundingBox()
  if (!Number.isFinite(bb.x1) || bb.x2 - bb.x1 <= 0) return { shapes: [], warnings: [] }

  const cx = (bb.x1 + bb.x2) / 2
  const cy = (bb.y1 + bb.y2) / 2
  const m = mul(
    rotateThenTranslate(layer.rotationDeg, layer.offsetXMM, layer.offsetYMM),
    translation(-cx, -cy),
  )

  return {
    shapes: [
      {
        kind: 'path',
        d: glyphPathD(path, m),
        paint: layer.render === 'fill' ? fillPaint() : strokePaint(layer.strokeMM, 'round'),
      },
    ],
    warnings: [],
  }
}
