import type { HatchLayer } from '../model/types'
import { polarToXY } from './polar'
import { fmt } from './format'
import type { CompiledLayer, InstanceTransform } from './shapes'
import { strokePaint } from './shapes'

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

  return {
    shapes: [
      {
        kind: 'instanced',
        def: {
          d: `M ${fmt(inner.x)} ${fmt(inner.y)} L ${fmt(outer.x)} ${fmt(outer.y)}`,
          dx: 0,
          dy: 0,
          rotateDeg: 0,
          scale: 1,
          flipY: 1,
        },
        paint: strokePaint(layer.strokeMM, layer.cap),
        transforms,
      },
    ],
    warnings,
  }
}
