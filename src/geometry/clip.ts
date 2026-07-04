import type { Layer } from '../model/types'
import { rotation, apply } from './mat2d'
import type { CompiledLayer, Shape } from './shapes'

/**
 * Clearance clipping — the "moat" a real die leaves around a centre device.
 * Exact closed-form segment-vs-circle math; no boolean library.
 *
 * v1 scope (covers the reference buttons): clips LINE geometry — hatch tick
 * defs and plain line shapes — against clearance discs centred on the axis.
 * Circles fully inside a disc are dropped. Fill paths are left alone
 * (fill-vs-fill booleans are explicitly v2).
 */

export interface ClearanceDisc {
  rMM: number
}

/** Clearance discs cast by layers ABOVE the given index (paint order). */
export function clearancesAbove(layers: Layer[], index: number): ClearanceDisc[] {
  const discs: ClearanceDisc[] = []
  for (let i = index + 1; i < layers.length; i++) {
    const l = layers[i]!
    if (l.type === 'center' && l.visible && l.clearanceMM > 0) {
      // only centred discs are rotation-invariant; tiny optical offsets are
      // treated as centred, larger offsets disable the clearance
      if (Math.hypot(l.offsetXMM, l.offsetYMM) < 0.25) discs.push({ rMM: l.clearanceMM })
    }
  }
  return discs
}

export function maxClearance(discs: ClearanceDisc[]): number {
  return discs.reduce((m, d) => Math.max(m, d.rMM), 0)
}

/**
 * Clip segment a→b against the OUTSIDE of a circle of radius R centred on the
 * origin. Returns null if fully inside, or the surviving segment.
 * (Line geometry on a die is always cut outward from the centre, so the
 * "keep the outer part" rule matches how these layers are built.)
 */
export function clipSegmentOutsideCircle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  R: number,
): { ax: number; ay: number; bx: number; by: number } | null {
  const inA = Math.hypot(ax, ay) < R
  const inB = Math.hypot(bx, by) < R
  if (!inA && !inB) {
    // Both outside. A chord could still cross the disc; for die line-work
    // (radial ticks) that cannot happen, so we keep the segment whole unless
    // the closest point of the segment is inside.
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    if (len2 === 0) return { ax, ay, bx, by }
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2))
    const cx = ax + t * dx
    const cy = ay + t * dy
    if (Math.hypot(cx, cy) >= R) return { ax, ay, bx, by }
    // crosses the disc: keep the longer outer piece (rare for real layouts)
    const hits = segCircleHits(ax, ay, bx, by, R)
    if (hits.length < 2) return { ax, ay, bx, by }
    const [t1, , t2] = [hits[0]!, 0, hits[hits.length - 1]!]
    const lenA = t1
    const lenB = 1 - t2
    return lenA >= lenB
      ? { ax, ay, bx: ax + t1 * dx, by: ay + t1 * dy }
      : { ax: ax + t2 * dx, ay: ay + t2 * dy, bx, by }
  }
  if (inA && inB) return null
  const hits = segCircleHits(ax, ay, bx, by, R)
  if (hits.length === 0) return null
  const t = inA ? hits[hits.length - 1]! : hits[0]!
  const px = ax + t * (bx - ax)
  const py = ay + t * (by - ay)
  return inA ? { ax: px, ay: py, bx, by } : { ax, ay, bx: px, by: py }
}

/** Parameter values t ∈ [0,1] where segment a→b crosses the circle radius R. */
function segCircleHits(ax: number, ay: number, bx: number, by: number, R: number): number[] {
  const dx = bx - ax
  const dy = by - ay
  const A = dx * dx + dy * dy
  const B = 2 * (ax * dx + ay * dy)
  const C = ax * ax + ay * ay - R * R
  const disc = B * B - 4 * A * C
  if (A === 0 || disc < 0) return []
  const s = Math.sqrt(disc)
  return [(-B - s) / (2 * A), (-B + s) / (2 * A)].filter((t) => t >= 0 && t <= 1).sort((a, b) => a - b)
}

/** Parse the simple `M x y L x y` def emitted by the hatch compiler. */
function parseLineDef(d: string): { ax: number; ay: number; bx: number; by: number } | null {
  const m = d.match(/^M\s+([-\d.]+)\s+([-\d.]+)\s+L\s+([-\d.]+)\s+([-\d.]+)$/)
  if (!m) return null
  return { ax: Number(m[1]), ay: Number(m[2]), bx: Number(m[3]), by: Number(m[4]) }
}

/**
 * Apply clearance discs to a compiled layer. Instanced line defs (hatch)
 * clip exactly when the disc is centred: the disc is rotation-invariant, so
 * clipping the def clips every instance identically.
 */
export function clipCompiled(compiled: CompiledLayer, discs: ClearanceDisc[]): CompiledLayer {
  const R = maxClearance(discs)
  if (R <= 0) return compiled
  const shapes: Shape[] = []
  const warnings = [...compiled.warnings]
  for (const shape of compiled.shapes) {
    switch (shape.kind) {
      case 'circle': {
        if (shape.rMM < R) continue // fully swallowed by the moat
        shapes.push(shape)
        break
      }
      case 'line': {
        const clipped = clipSegmentOutsideCircle(shape.x1, shape.y1, shape.x2, shape.y2, R)
        if (clipped) {
          shapes.push({ ...shape, x1: clipped.ax, y1: clipped.ay, x2: clipped.bx, y2: clipped.by })
        }
        break
      }
      case 'instanced': {
        const line = parseLineDef(shape.def.d)
        const isBareLineDef =
          line !== null &&
          shape.def.dx === 0 &&
          shape.def.dy === 0 &&
          shape.def.rotateDeg === 0 &&
          shape.def.scale === 1
        if (isBareLineDef) {
          const clipped = clipSegmentOutsideCircle(line.ax, line.ay, line.bx, line.by, R)
          if (clipped) {
            shapes.push({
              ...shape,
              def: {
                ...shape.def,
                d: `M ${clipped.ax} ${clipped.ay} L ${clipped.bx} ${clipped.by}`,
              },
            })
          }
          break
        }
        // Motif instances: drop whole instances whose placement radius is
        // inside the moat; leave others untouched (no partial motif cuts).
        const placedR = Math.hypot(shape.def.dx, shape.def.dy)
        if (placedR > 0 && placedR < R) break
        shapes.push(shape)
        break
      }
      case 'path':
        // fill/warped geometry passes through; fill booleans are v2
        shapes.push(shape)
        break
    }
  }
  return { shapes, warnings }
}

/** Rotate a point — exported for instance-expansion in the exporter. */
export function rotatePoint(x: number, y: number, deg: number): { x: number; y: number } {
  return apply(rotation(deg), x, y)
}
