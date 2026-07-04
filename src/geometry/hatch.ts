import type { HatchLayer } from '../model/types'
import { polarToXY } from './polar'
import { fmt } from './format'
import type { CompiledLayer, InstanceTransform } from './shapes'
import { strokePaint } from './shapes'

/**
 * N radial ticks as one def line + N exact rotations. The def is the tick at
 * angle 0: inner endpoint on the 12 o'clock axis, outer endpoint skewed by
 * twistDeg. Instance angles are exact multiples of 360/count — never
 * accumulated — so there is no floating-point drift at the 0°/360° seam.
 */
export function compileHatch(layer: HatchLayer): CompiledLayer {
  const count = Math.max(1, Math.round(layer.count))
  const rInner = Math.min(layer.rInnerMM, layer.rOuterMM)
  const rOuter = Math.max(layer.rInnerMM, layer.rOuterMM)
  const inner = { x: 0, y: -rInner }
  const outer = polarToXY(layer.twistDeg, rOuter)

  const transforms: InstanceTransform[] = Array.from({ length: count }, (_, k) => ({
    rotateDeg: (k * 360) / count,
    dx: 0,
    dy: 0,
    mirrorX: false,
  }))

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
    warnings: [],
  }
}
