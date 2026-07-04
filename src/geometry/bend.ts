import type { BendLayer } from '../model/types'
import { flattenSegs } from './flatten'
import { DEG2RAD } from './polar'
import type { ParsedSvgAsset } from './svgAsset'
import type { CompiledLayer, Shape } from './shapes'
import { fillPaint, strokePaint } from './shapes'
import { annulusWarp, autoSweepDeg, subPathsToD, warpSubPaths, type AnnulusBand } from './warp'

/**
 * The flagship: an arbitrary SVG bent into an annulus band. Stroke-only
 * source paths warp their centreline and keep a constant mm stroke width
 * (a graver cuts constant width); filled paths warp their outline.
 */
export function compileBend(
  layer: BendLayer,
  asset: ParsedSvgAsset | null,
  toleranceMM: number,
): CompiledLayer {
  if (!layer.assetId) {
    return { shapes: [], warnings: ['Choose or upload an SVG source for this bend layer.'] }
  }
  if (!asset) return { shapes: [], warnings: ['Parsing SVG…'] }
  const box = asset.box
  if (box.w <= 0 || box.h <= 0 || asset.paths.length === 0) {
    return { shapes: [], warnings: ['The SVG contains no drawable geometry.'] }
  }

  const rInner = Math.min(layer.rInnerMM, layer.rOuterMM)
  const rOuter = Math.max(layer.rInnerMM, layer.rOuterMM)
  const sweep =
    layer.sweepMode === 'auto' ? autoSweepDeg(box, rInner, rOuter) : Math.max(0.1, layer.sweepDeg)

  // Flattening happens in source units; scale the mm tolerance down by the
  // largest source→mm stretch so the warped result still meets toleranceMM.
  const vScale = (rOuter - rInner) / box.h
  const hScale = (sweep * DEG2RAD * ((rInner + rOuter) / 2)) / box.w
  const srcTol = toleranceMM / Math.max(vScale, hScale, 1e-6)

  const repeat = Math.max(1, Math.round(layer.repeat))
  const shapes: Shape[] = []
  const warnings: string[] = []

  const totalSpan = repeat * sweep + (repeat - 1) * layer.gapDeg
  if (totalSpan > 360.0001) {
    warnings.push(`Repeats span ${totalSpan.toFixed(0)}° — more than a full circle.`)
  }

  for (let k = 0; k < repeat; k++) {
    const band: AnnulusBand = {
      startDeg: layer.startDeg + k * (sweep + layer.gapDeg),
      sweepDeg: sweep,
      rInnerMM: rInner,
      rOuterMM: rOuter,
      flipRadial: layer.flipRadial,
      mirrorX: layer.alternateMirror && k % 2 === 1,
    }
    const fn = annulusWarp(box, band)
    for (const p of asset.paths) {
      const centerline =
        layer.strokeHandling === 'centerline' ||
        (layer.strokeHandling === 'auto' && p.stroke && !p.fill)
      const subs = warpSubPaths(flattenSegs(p.segs, srcTol), fn, toleranceMM)
      if (subs.length === 0) continue
      shapes.push({
        kind: 'path',
        d: subPathsToD(subs),
        fillRule: centerline ? undefined : p.fillRule,
        paint: centerline ? strokePaint(layer.strokeMM, 'round') : fillPaint(),
      })
    }
  }

  return { shapes, warnings }
}
