import type { RingLayer } from '../model/types'
import { annulusPathD } from './format'
import type { CompiledLayer } from './shapes'
import { fillPaint, strokePaint } from './shapes'

export function compileRing(layer: RingLayer): CompiledLayer {
  if (layer.mode === 'annulus') {
    const rOuter = Math.max(layer.rOuterMM, layer.rInnerMM)
    const rInner = Math.min(layer.rOuterMM, layer.rInnerMM)
    return {
      shapes: [{ kind: 'path', d: annulusPathD(rOuter, rInner), fillRule: 'evenodd', paint: fillPaint() }],
      warnings: [],
    }
  }
  return {
    shapes: [{ kind: 'circle', rMM: layer.radiusMM, paint: strokePaint(layer.strokeMM) }],
    warnings: [],
  }
}
