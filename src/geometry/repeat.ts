import type { RepeatLayer } from '../model/types'
import { getBuiltinMotif } from './motifs/builtins'
import { polarToXY } from './polar'
import type { ParsedSvgAsset, UnitMotifPath } from './svgAsset'
import { assetToUnitMotif } from './svgAsset'
import type { CompiledLayer, InstanceTransform, Paint, Shape } from './shapes'
import { fillPaint, strokePaint } from './shapes'

/**
 * A motif instanced count× around the axis, one instanced Shape per row.
 *
 * Radial alignment lives in the def (motif translated to 12 o'clock at the
 * row radius), so instances are pure exact rotations k·360/count. Upright
 * alignment keeps the def at the origin and gives each instance a pure
 * translation instead. Row 2 gets its own def (own radius, optional radial
 * flip) with the half-step stagger baked into its instance angles.
 */
export function compileRepeat(
  layer: RepeatLayer,
  getSvgAsset: (assetId: string) => ParsedSvgAsset | null,
): CompiledLayer {
  let motifPaths: UnitMotifPath[]
  if (layer.source.kind === 'asset') {
    const asset = getSvgAsset(layer.source.assetId)
    if (!asset) return { shapes: [], warnings: ['Parsing SVG motif…'] }
    motifPaths = assetToUnitMotif(asset)
    if (motifPaths.length === 0) {
      return { shapes: [], warnings: ['The SVG motif contains no drawable geometry.'] }
    }
  } else {
    const motif = getBuiltinMotif(layer.source.motifId)
    if (!motif) {
      return { shapes: [], warnings: [`Unknown motif "${layer.source.motifId}".`] }
    }
    motifPaths = [{ d: motif.d, paintType: motif.paintType }]
  }

  const count = Math.max(1, Math.round(layer.count))
  const scale = Math.max(0.01, layer.sizeMM)
  const upright = layer.align === 'upright'
  const baseRotation =
    layer.align === 'radial-in' ? 180 + layer.rotationOffsetDeg : layer.rotationOffsetDeg

  const shapes: Shape[] = []
  const rowCount = layer.rows === 2 ? 2 : 1
  for (let row = 0; row < rowCount; row++) {
    const radius = row === 0 ? layer.radiusMM : Math.max(0, layer.radiusMM - layer.rowGapMM)
    const flip = row === 1 && layer.flipRow2
    const phase = row === 1 && layer.staggerRow2 ? 180 / count : 0

    const transforms: InstanceTransform[] = Array.from({ length: count }, (_, k) => {
      const angle = phase + (k * 360) / count
      const mirrorX = layer.alternateFlip && k % 2 === 1
      if (upright) {
        const p = polarToXY(angle, radius)
        return { rotateDeg: 0, dx: p.x, dy: p.y, mirrorX }
      }
      return { rotateDeg: angle, dx: 0, dy: 0, mirrorX }
    })

    for (const motifPath of motifPaths) {
      const paint: Paint =
        motifPath.paintType === 'fill'
          ? fillPaint()
          : strokePaint(layer.strokeMM, layer.cap === 'point' ? 'round' : layer.cap, layer.join)
      shapes.push({
        kind: 'instanced',
        def: {
          d: motifPath.d,
          dx: 0,
          dy: upright ? 0 : -radius,
          rotateDeg: baseRotation,
          scale,
          flipY: flip ? -1 : 1,
        },
        paint,
        transforms,
      })
    }
  }

  return { shapes, warnings: [] }
}
