import { DEG2RAD } from './polar'

/**
 * 2D affine matrix in SVG order: x' = a·x + c·y + e, y' = b·x + d·y + f.
 * Hand-rolled instead of DOMMatrix so the geometry kernel stays DOM-free and
 * testable in plain node.
 */
export interface Mat2d {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export const IDENTITY: Mat2d = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

/** Compose: apply `second` first, then `first` (matrix product first·second). */
export function mul(first: Mat2d, second: Mat2d): Mat2d {
  return {
    a: first.a * second.a + first.c * second.b,
    b: first.b * second.a + first.d * second.b,
    c: first.a * second.c + first.c * second.d,
    d: first.b * second.c + first.d * second.d,
    e: first.a * second.e + first.c * second.f + first.e,
    f: first.b * second.e + first.d * second.f + first.f,
  }
}

export function apply(m: Mat2d, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }
}

export function translation(tx: number, ty: number): Mat2d {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty }
}

export function rotation(deg: number): Mat2d {
  const r = deg * DEG2RAD
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 }
}

export function scaling(sx: number, sy: number): Mat2d {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }
}

/** rotate around origin then translate — the common glyph placement. */
export function rotateThenTranslate(deg: number, tx: number, ty: number): Mat2d {
  return mul(translation(tx, ty), rotation(deg))
}

/**
 * Parse an SVG `transform` attribute (translate/scale/rotate/matrix/skewX/
 * skewY, any sequence). Unknown functions are ignored. Pure string → matrix,
 * so import stays testable without a real DOM CTM.
 */
export function parseTransform(attr: string | null | undefined): Mat2d {
  if (!attr) return IDENTITY
  let m = IDENTITY
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(attr)) !== null) {
    const fn = match[1]!
    const args = match[2]!
      .trim()
      .split(/[\s,]+/)
      .filter((s) => s.length > 0)
      .map(Number)
    if (args.some((n) => !Number.isFinite(n))) continue
    switch (fn) {
      case 'translate':
        m = mul(m, translation(args[0] ?? 0, args[1] ?? 0))
        break
      case 'scale':
        m = mul(m, scaling(args[0] ?? 1, args[1] ?? args[0] ?? 1))
        break
      case 'rotate': {
        const deg = args[0] ?? 0
        if (args.length >= 3) {
          const cx = args[1]!
          const cy = args[2]!
          m = mul(m, mul(translation(cx, cy), mul(rotation(deg), translation(-cx, -cy))))
        } else {
          m = mul(m, rotation(deg))
        }
        break
      }
      case 'matrix':
        if (args.length === 6) {
          m = mul(m, { a: args[0]!, b: args[1]!, c: args[2]!, d: args[3]!, e: args[4]!, f: args[5]! })
        }
        break
      case 'skewX':
        m = mul(m, { a: 1, b: 0, c: Math.tan((args[0] ?? 0) * DEG2RAD), d: 1, e: 0, f: 0 })
        break
      case 'skewY':
        m = mul(m, { a: 1, b: Math.tan((args[0] ?? 0) * DEG2RAD), c: 0, d: 1, e: 0, f: 0 })
        break
    }
  }
  return m
}
