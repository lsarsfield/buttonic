/**
 * Built-in motif library. Every motif lives in a unit box centred on the
 * origin (height 1 = the layer's sizeMM), pointing "up" — which reads as
 * outward when the instance is placed at 12 o'clock and rotated around the
 * axis.
 */

export interface BuiltinMotif {
  id: string
  label: string
  /** Path data in the unit box, y-down, centred at origin. */
  d: string
  paintType: 'fill' | 'stroke'
}

export const BUILTIN_MOTIFS: readonly BuiltinMotif[] = [
  {
    id: 'chevron',
    label: 'Chevron',
    d: 'M -0.38 0.3 L 0 -0.3 L 0.38 0.3',
    paintType: 'stroke',
  },
  {
    id: 'wedge',
    label: 'Wedge',
    d: 'M -0.32 0.5 L 0 -0.5 L 0.32 0.5 Z',
    paintType: 'fill',
  },
  {
    id: 'dot',
    label: 'Dot',
    d: 'M 0 -0.35 A 0.35 0.35 0 1 1 0 0.35 A 0.35 0.35 0 1 1 0 -0.35 Z',
    paintType: 'fill',
  },
  {
    id: 'dash',
    label: 'Dash',
    d: 'M 0 -0.5 L 0 0.5',
    paintType: 'stroke',
  },
  {
    id: 'arrow',
    label: 'Arrow',
    d: 'M 0 0.5 L 0 -0.34 M -0.28 -0.08 L 0 -0.46 L 0.28 -0.08',
    paintType: 'stroke',
  },
  {
    id: 'leaf',
    label: 'Leaf',
    d: 'M 0 -0.5 C 0.32 -0.22 0.32 0.22 0 0.5 C -0.32 0.22 -0.32 -0.22 0 -0.5 Z',
    paintType: 'fill',
  },
  {
    id: 'star',
    label: 'Star',
    d: 'M 0 -0.5 L 0.112 -0.154 L 0.476 -0.155 L 0.181 0.059 L 0.294 0.405 L 0 0.19 L -0.294 0.405 L -0.181 0.059 L -0.476 -0.155 L -0.112 -0.154 Z',
    paintType: 'fill',
  },
]

export function getBuiltinMotif(id: string): BuiltinMotif | null {
  return BUILTIN_MOTIFS.find((m) => m.id === id) ?? null
}
