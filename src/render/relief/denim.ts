/**
 * Procedural denim for the 3D backdrop: a 3/1 right-hand twill of slubby
 * warp over a paler weft, with ring-dyed white flecks — raw indigo selvedge
 * (the Stevenson reference) or undyed ecru (the first reference). Tiles
 * seamlessly: every noise is indexed modulo the thread count.
 *
 * Returns colour + bump canvases; a tile spans TILE_MM.
 */

export type DenimKind = 'raw' | 'ecru'

export const TILE_MM = 20
const THREADS = 68 // per tile each way → ~0.29 mm pitch (≈ 86 ends/inch, 14 oz raw)

const hash = (a: number, b: number, c = 0): number => {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

/** 1D value noise, periodic in `period`. */
function vnoise(line: number, t: number, period: number, seed: number): number {
  const i = Math.floor(t)
  const f = t - i
  const s = f * f * (3 - 2 * f)
  const a = hash(line, ((i % period) + period) % period, seed)
  const b = hash(line, (((i + 1) % period) + period) % period, seed)
  return a + (b - a) * s
}

interface Palette {
  warp: [number, number, number]
  warpLight: [number, number, number]
  weft: [number, number, number]
  fleck: [number, number, number]
  fleckRate: number
  /** Weave relief contrast (undyed yarn shows the structure far less than indigo). */
  contrast: number
}

const PALETTES: Record<DenimKind, Palette> = {
  raw: {
    warp: [10, 14, 32],
    warpLight: [30, 40, 76],
    weft: [70, 76, 96],
    fleck: [168, 176, 196],
    fleckRate: 0.03,
    contrast: 1,
  },
  ecru: {
    warp: [206, 199, 182],
    warpLight: [226, 220, 204],
    weft: [196, 189, 172],
    fleck: [236, 232, 222],
    fleckRate: 0.012,
    contrast: 0.35,
  },
}

/**
 * Per pixel: which yarn is on top (3/1 twill: the warp floats over three
 * picks, stepping one pick per end — the diagonal wale), then that yarn's own
 * look — round profile, Z-twist striation, slub (thick/thin, lighter where it
 * swells) and, for ring-dyed raw indigo, rare pale flecks where the white
 * core shows. The weft barely peeks between warp floats.
 */
export function makeDenim(kind: DenimKind, size = 2048): { color: HTMLCanvasElement; bump: HTMLCanvasElement } {
  const pal = PALETTES[kind]
  const color = Object.assign(document.createElement('canvas'), { width: size, height: size })
  const bump = Object.assign(document.createElement('canvas'), { width: size, height: size })
  const cctx = color.getContext('2d')!
  const bctx = bump.getContext('2d')!
  const cimg = cctx.createImageData(size, size)
  const bimg = bctx.createImageData(size, size)
  const pitch = size / THREADS
  const period = THREADS * 3

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = Math.floor(x / pitch) // warp end (vertical)
      const j = Math.floor(y / pitch) // weft pick (horizontal)
      const u = x / pitch - i
      const v = y / pitch - j
      const warpUp = (((j - i) % 4) + 4) % 4 !== 0
      let r: number
      let g: number
      let b: number
      let height: number
      if (warpUp) {
        const across = Math.sin(Math.PI * u) // yarn roundness
        const twist = 0.5 + 0.5 * Math.sin(2 * Math.PI * (u * 1.2 + (y / pitch) * 2.2 + hash(i, 5))) // Z-twist fibres
        const slub = vnoise(i, (y / pitch) * 0.35, period, 1) * 0.7 + vnoise(i, (y / pitch) * 1.3, period, 4) * 0.3
        const k0 = Math.min(1, (0.15 + 0.85 * slub * (0.55 + 0.45 * hash(i, 7))) * (0.55 + 0.45 * across) * (0.8 + 0.2 * twist))
        const k = 1 - pal.contrast * (1 - k0)
        r = pal.warp[0] + (pal.warpLight[0] - pal.warp[0]) * k
        g = pal.warp[1] + (pal.warpLight[1] - pal.warp[1]) * k
        b = pal.warp[2] + (pal.warpLight[2] - pal.warp[2]) * k
        // pale core flecks: short, irregular streaks along the yarn, on the swell
        const seg = (y / pitch) * (0.7 + 1.6 * hash(i, 11)) + hash(i, 12) * 7
        const f = hash(i, Math.floor(seg), 3) * (0.6 + 0.8 * vnoise(i, (y / pitch) * 0.08, period, 13))
        const along = Math.sin(Math.PI * (seg - Math.floor(seg)))
        if (f < pal.fleckRate && across > 0.4 && along > 0.25) {
          const w = across * along * (0.55 + 0.45 * twist)
          r += (pal.fleck[0] - r) * w
          g += (pal.fleck[1] - g) * w
          b += (pal.fleck[2] - b) * w
        }
        height = 0.5 + 0.5 * across * (0.85 + 0.15 * twist)
      } else {
        // the pick shows only in a pinched window between neighbouring floats
        const window = Math.max(0, Math.sin(Math.PI * v)) * Math.max(0, Math.sin(Math.PI * u))
        const k = 0.6 + 0.4 * vnoise(j, (x / pitch) * 0.5, period, 2)
        const t = Math.min(1, window * 1.4) * (0.4 + 0.6 * pal.contrast)
        r = pal.warp[0] + (pal.weft[0] * k - pal.warp[0]) * t
        g = pal.warp[1] + (pal.weft[1] * k - pal.warp[1]) * t
        b = pal.warp[2] + (pal.weft[2] * k - pal.warp[2]) * t
        height = 0.15 + 0.35 * window
      }
      const n = (hash(x, y, 9) - 0.5) * 6 // fibre grain
      const o = (y * size + x) * 4
      cimg.data[o] = Math.max(0, Math.min(255, r + n))
      cimg.data[o + 1] = Math.max(0, Math.min(255, g + n))
      cimg.data[o + 2] = Math.max(0, Math.min(255, b + n * 1.3))
      cimg.data[o + 3] = 255
      const hv = Math.round(height * 255)
      bimg.data[o] = hv
      bimg.data[o + 1] = hv
      bimg.data[o + 2] = hv
      bimg.data[o + 3] = 255
    }
  }
  cctx.putImageData(cimg, 0, 0)
  bctx.putImageData(bimg, 0, 0)
  return { color, bump }
}
