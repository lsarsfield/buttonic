import type { HatchLayer } from '../model/types'
import { polarToXY } from './polar'
import { fmt } from './format'
import type { CompiledLayer, InstanceTransform, Paint } from './shapes'
import { fillPaint, strokePaint } from './shapes'

/**
 * Radial ticks as one def line + exact rotations. The def is the tick at angle
 * 0: inner endpoint on the 12 o'clock axis, outer endpoint skewed by twistDeg.
 *
 * `count` ticks fill an arc of `sweepDeg` at pitch sweepDeg/count, and that arc
 * block is placed `repeats` times at exact `r*360/repeats` — so partial-arc and
 * symmetric-fill layouts drop out of one formula. Every angle is computed
 * directly (never accumulated); at sweepDeg=360, repeats=1 the angles are
 * exactly `k*360/count`, byte-identical to a full ring.
 */
export function compileHatch(layer: HatchLayer): CompiledLayer {
  const count = Math.max(1, Math.round(layer.count))
  const repeats = Math.max(1, Math.round(layer.repeats))
  const sweepDeg = Math.max(0.01, Math.min(360, layer.sweepDeg))
  const rInner = Math.min(layer.rInnerMM, layer.rOuterMM)
  const rOuter = Math.max(layer.rInnerMM, layer.rOuterMM)
  const inner = { x: 0, y: -rInner }
  const outer = polarToXY(layer.twistDeg, rOuter)

  const transforms: InstanceTransform[] = []
  for (let r = 0; r < repeats; r++) {
    const arcStart = (r * 360) / repeats
    for (let k = 0; k < count; k++) {
      transforms.push({ rotateDeg: arcStart + (k * sweepDeg) / count, dx: 0, dy: 0, mirrorX: false })
    }
  }

  const warnings: string[] = []
  if (repeats * sweepDeg > 360.0001) {
    warnings.push(`${repeats} arcs of ${sweepDeg.toFixed(0)}° overlap (total ${(repeats * sweepDeg).toFixed(0)}°).`)
  }

  // A pointed cap has no SVG equivalent, so the tick becomes a filled tapered
  // polygon: a spike (outer point, flat inner base) or a spindle (both ends).
  // Built from the tick's own direction so twist just works.
  let d: string
  let paint: Paint
  if (layer.cap === 'point') {
    const dx = outer.x - inner.x
    const dy = outer.y - inner.y
    const len = Math.hypot(dx, dy) || 1
    const ux = dx / len
    const uy = dy / len // unit vector inner → outer
    const px = -uy
    const py = ux // perpendicular
    const hw = layer.strokeMM / 2
    const P = Math.max(0, layer.capPointMM)
    const pnt = (x: number, y: number) => `${fmt(x)} ${fmt(y)}`
    const oApex = pnt(outer.x + ux * P, outer.y + uy * P)
    const oL = pnt(outer.x + px * hw, outer.y + py * hw)
    const oR = pnt(outer.x - px * hw, outer.y - py * hw)
    const iL = pnt(inner.x + px * hw, inner.y + py * hw)
    const iR = pnt(inner.x - px * hw, inner.y - py * hw)
    if (layer.pointEnds === 'both') {
      const pi = Math.min(P, rInner) // don't let the inner tip cross the axis
      const iApex = pnt(inner.x - ux * pi, inner.y - uy * pi)
      d = `M ${iApex} L ${iL} L ${oL} L ${oApex} L ${oR} L ${iR} Z`
    } else {
      d = `M ${iL} L ${oL} L ${oApex} L ${oR} L ${iR} Z`
    }
    paint = fillPaint()
  } else {
    d = `M ${fmt(inner.x)} ${fmt(inner.y)} L ${fmt(outer.x)} ${fmt(outer.y)}`
    paint = strokePaint(layer.strokeMM, layer.cap)
  }

  return {
    shapes: [
      {
        kind: 'instanced',
        def: { d, dx: 0, dy: 0, rotateDeg: 0, scale: 1, flipY: 1 },
        paint,
        transforms,
      },
    ],
    warnings,
  }
}
