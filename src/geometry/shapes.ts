/**
 * Compiled geometry IR. Layer compilers turn parametric layers into Shapes;
 * renderers map Shapes to SVG elements; the exporter serializes them.
 *
 * Everything is exact where it can be: circles stay circles, hatch ticks are
 * a def line plus N rotations, motifs are bezier path data placed by affine
 * transforms. Polylines appear only for polar-warped content (bend layers,
 * warp-mode ring text).
 *
 * Plain structured-cloneable data — zero DOM or React imports.
 */

import type { StrokeJoin, SvgStrokeCap } from '../model/types'

export interface StrokePaint {
  widthMM: number
  cap: SvgStrokeCap
  /** Omitted when 'miter' (the SVG default) so unstyled strokes stay byte-identical. */
  join?: StrokeJoin
}

export interface Paint {
  fill: boolean
  stroke: StrokePaint | null
}

export const fillPaint = (): Paint => ({ fill: true, stroke: null })
export const strokePaint = (widthMM: number, cap: SvgStrokeCap = 'butt', join?: StrokeJoin): Paint => ({
  fill: false,
  stroke: { widthMM, cap, ...(join && join !== 'miter' ? { join } : {}) },
})

/**
 * Def-space placement of an instanced motif: the motif's own path data plus
 * the affine that places instance zero. Applied as
 * translate(dx,dy) · rotate(rotateDeg) · scale(scale, scale·flipY).
 * Uniform |scale| keeps constant stroke widths honest (renderer divides the
 * mm stroke width by scale inside the def).
 */
export interface InstanceDef {
  d: string
  dx: number
  dy: number
  rotateDeg: number
  scale: number
  flipY: 1 | -1
}

/**
 * Per-instance transform, applied as translate(dx,dy) · rotate(rotateDeg) ·
 * [mirrorX]. Radial placement uses pure rotation (dx = dy = 0, radius lives
 * in the def); upright placement uses pure translation.
 */
export interface InstanceTransform {
  rotateDeg: number
  dx: number
  dy: number
  mirrorX: boolean
}

export type Shape =
  | { kind: 'circle'; rMM: number; paint: Paint }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; paint: Paint }
  | { kind: 'path'; d: string; fillRule?: 'evenodd'; paint: Paint }
  | { kind: 'instanced'; def: InstanceDef; paint: Paint; transforms: InstanceTransform[] }

export interface CompiledLayer {
  shapes: Shape[]
  warnings: string[]
}

export const EMPTY_COMPILED: CompiledLayer = { shapes: [], warnings: [] }
