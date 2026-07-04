import { mul, rotation, scaling, translation, type Mat2d } from './mat2d'
import { parsePathData, segsToD, transformSegs } from './pathData'
import type { InstanceDef, InstanceTransform, Shape } from './shapes'

/**
 * Instance expansion: bake every <use> rotation into concrete path data.
 * Engraving CAM software imports <use> inconsistently, so the die file gets
 * flat paths (export default) while the live canvas keeps instancing.
 */

export function defMatrix(def: InstanceDef): Mat2d {
  return mul(
    translation(def.dx, def.dy),
    mul(rotation(def.rotateDeg), scaling(def.scale, def.scale * def.flipY)),
  )
}

export function instanceMatrix(tr: InstanceTransform): Mat2d {
  let m = tr.dx !== 0 || tr.dy !== 0 ? translation(tr.dx, tr.dy) : null
  const rot = tr.rotateDeg !== 0 ? rotation(tr.rotateDeg) : null
  const mir = tr.mirrorX ? scaling(-1, 1) : null
  let out: Mat2d | null = null
  for (const part of [m, rot, mir]) {
    if (!part) continue
    out = out ? mul(out, part) : part
  }
  return out ?? { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
}

/** One instanced shape → N plain path shapes (paint preserved). */
export function expandInstanced(shape: Extract<Shape, { kind: 'instanced' }>): Shape[] {
  const defSegs = parsePathData(shape.def.d)
  const dm = defMatrix(shape.def)
  return shape.transforms.map((tr) => ({
    kind: 'path' as const,
    d: segsToD(transformSegs(defSegs, mul(instanceMatrix(tr), dm))),
    paint: shape.paint,
  }))
}
