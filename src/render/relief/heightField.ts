import type { Relief } from '../../model/types'

/**
 * Height field of the struck button, from the die file's rasterized coverage.
 * Pure and worker-safe (no DOM, no three.js) — node-tested.
 *
 * Pipeline (all lengths mm, image rows top→bottom = design y −V → +V):
 *  1. coverage (alpha of the black die art) → exact signed distance to the
 *     art edge (Felzenszwalb–Huttenlocher EDT, sub-pixel on boundary pixels,
 *     lightly smoothed so diagonal walls don't terrace on the pixel lattice)
 *  2. design height = depth · smoothstep over a finite wall — raised (die-
 *     struck: what's cut into the die stands proud) or recessed
 *  3. cavity = how enclosed a point is by higher ground (blurred coverage vs
 *     local height), plus plain lowness — raw inputs; each FINISH turns them
 *     into its own patina (finishMaps: nickel greys only tight recesses,
 *     antique brass fills the whole low ground with brown oxide) so switching
 *     finish never re-runs the EDT
 *  4. object-space normals of the WHOLE surface: cap profile (flat face,
 *     optional dome, rolled outer edge, rolled hole lip) + design relief
 */

export interface ReliefParams {
  relief: Relief
  /** Relief height of the design, mm. */
  depthMM: number
  /** Width of the sloped wall between field and design, mm. */
  wallMM: number
  faceR: number
  /** 0 = solid cap. */
  holeR: number
  /** Radius of the rolled outer shoulder, mm. */
  rollMM: number
  /** Radius of the rolled hole lip, mm. */
  holeRollMM: number
  /** Face dome height at the axis, mm (0 = flat). */
  domeMM: number
}

export const RELIEF_DEFAULTS = { depthMM: 0.15, wallMM: 0.06, rollMM: 0.45, holeRollMM: 0.3, domeMM: 0 }

export interface HeightField {
  n: number
  /** Full width (and height) of the square image in mm, centred on the axis. */
  spanMM: number
  /** Design displacement (mm, + up) at DISP_N² — vertex displacement input. */
  disp: Float32Array
  dispN: number
  /** Object-space normals of the full surface, RGBA8 (xyz·0.5+0.5), n². */
  normal: Uint8Array
  /** R = cavity (enclosed by higher ground), G = lowness (1 − high-ground occupancy), RGBA8 n². */
  occl: Uint8Array
}

/** How a finish weathers: where oxide settles and how dark it gets. */
export interface Patina {
  /** Oxide in tight recesses (cavity), 0..1. */
  cavity: number
  /** Oxide over all low ground (antiquing fills the field), 0..1. */
  field: number
  /** How dark full oxide is (albedo multiplier = 1 − darken·patina). */
  darken: number
}

/** Recess roughness can reach this multiple of the finish's base roughness. */
export const ROUGH_HEADROOM = 1.8

// ---------------------------------------------------------------------------
// cap profile
// ---------------------------------------------------------------------------

/**
 * Height of the bare cap surface at radius r (before the design): flat face
 * (optionally domed), a quarter-round shoulder rolling down to vertical at
 * faceR, and a quarter-round lip rolling down into the hole. Slope clamped so
 * the vertical tangents stay finite.
 */
export function baseProfile(r: number, p: ReliefParams): { y: number; dydr: number } {
  const R = p.faceR
  const R2 = R * R
  const dome = (rr: number) => (p.domeMM > 0 ? p.domeMM * (1 - (rr * rr) / R2) : 0)
  const domeSlope = (rr: number) => (p.domeMM > 0 ? (-2 * p.domeMM * rr) / R2 : 0)
  const MAX_SLOPE = 40
  const a = R - p.rollMM
  if (p.rollMM > 0 && r > a) {
    const u = Math.min(r - a, p.rollMM * 0.9995)
    const s = Math.sqrt(p.rollMM * p.rollMM - u * u)
    return { y: dome(a) - p.rollMM + s, dydr: Math.max(-MAX_SLOPE, domeSlope(a) - u / s) }
  }
  const b = p.holeR + p.holeRollMM
  if (p.holeR > 0 && p.holeRollMM > 0 && r < b) {
    const u = Math.min(b - r, p.holeRollMM * 0.9995)
    const s = Math.sqrt(p.holeRollMM * p.holeRollMM - u * u)
    return { y: dome(b) - p.holeRollMM + s, dydr: Math.min(MAX_SLOPE, domeSlope(b) + u / s) }
  }
  return { y: dome(r), dydr: domeSlope(r) }
}

// ---------------------------------------------------------------------------
// signed distance
// ---------------------------------------------------------------------------

function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0
  v[0] = 0
  z[0] = -Infinity
  z[1] = Infinity
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!)
    while (s <= z[k]!) {
      k--
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!)
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++
    d[q] = (q - v[k]!) * (q - v[k]!) + f[v[k]!]!
  }
}

/** In-place squared Euclidean distance transform (g: 0 at features, 1e20 elsewhere). */
function edt2d(g: Float64Array, n: number): void {
  const f = new Float64Array(n)
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) f[y] = g[y * n + x]!
    edt1d(f, n, d, v, z)
    for (let y = 0; y < n; y++) g[y * n + x] = d[y]!
  }
  for (let y = 0; y < n; y++) {
    const o = y * n
    for (let x = 0; x < n; x++) f[x] = g[o + x]!
    edt1d(f, n, d, v, z)
    for (let x = 0; x < n; x++) g[o + x] = d[x]!
  }
}

/** Separable box blur, in place, clamped edges. */
export function boxBlur(a: Float32Array, n: number, r: number): void {
  if (r <= 0) return
  const t = new Float32Array(n)
  const w = 2 * r + 1
  const clampI = (i: number) => (i < 0 ? 0 : i >= n ? n - 1 : i)
  for (let y = 0; y < n; y++) {
    const o = y * n
    let acc = 0
    for (let k = -r; k <= r; k++) acc += a[o + clampI(k)]!
    for (let x = 0; x < n; x++) {
      t[x] = acc / w
      acc += a[o + clampI(x + r + 1)]! - a[o + clampI(x - r)]!
    }
    a.set(t, o)
  }
  for (let x = 0; x < n; x++) {
    let acc = 0
    for (let k = -r; k <= r; k++) acc += a[clampI(k) * n + x]!
    for (let y = 0; y < n; y++) {
      t[y] = acc / w
      acc += a[clampI(y + r + 1) * n + x]! - a[clampI(y - r) * n + x]!
    }
    for (let y = 0; y < n; y++) a[y * n + x] = t[y]!
  }
}

/**
 * Signed distance (mm) to the coverage edge, positive inside the art.
 * Boundary pixels use their fractional coverage for sub-pixel accuracy.
 */
export function signedDistance(cov: Float32Array, n: number, mmPerPx: number): Float32Array {
  const inG = new Float64Array(n * n)
  const outG = new Float64Array(n * n)
  for (let i = 0; i < n * n; i++) {
    const inside = cov[i]! >= 0.5
    inG[i] = inside ? 1e20 : 0
    outG[i] = inside ? 0 : 1e20
  }
  edt2d(inG, n) // inside px: squared distance to nearest outside px
  edt2d(outG, n) // outside px: squared distance to nearest inside px
  const sd = new Float32Array(n * n)
  for (let i = 0; i < n * n; i++) {
    const c = cov[i]!
    const px =
      c > 0.02 && c < 0.98 ? c - 0.5 : c >= 0.5 ? Math.sqrt(inG[i]!) - 0.5 : -(Math.sqrt(outG[i]!) - 0.5)
    sd[i] = px * mmPerPx
  }
  return sd
}

// ---------------------------------------------------------------------------

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** Normalized design occupancy from signed distance: 0 on the field, 1 on the art, wall between. */
export function wallProfile(sdMM: number, wallMM: number): number {
  return smoothstep(-wallMM / 2, wallMM / 2, sdMM)
}

export const DISP_N = 1024

/** Alpha channel of an RGBA raster as 0..1 coverage. */
export function coverageFromRgba(rgba: Uint8ClampedArray, n: number): Float32Array {
  const cov = new Float32Array(n * n)
  for (let i = 0; i < n * n; i++) cov[i] = rgba[i * 4 + 3]! / 255
  return cov
}

/** Coverage (0..1, n², rows top→bottom) → the full height field. */
export function buildHeightField(cov: Float32Array, n: number, spanMM: number, p: ReliefParams): HeightField {
  const mmPerPx = spanMM / n
  const V = spanMM / 2
  const sd = signedDistance(cov, n, mmPerPx)
  // ~1.6 px sigma: kills pixel-lattice terracing on diagonal walls
  boxBlur(sd, n, 2)
  boxBlur(sd, n, 2)

  const sign = p.relief === 'raised' ? 1 : -1
  // F: 1 on the HIGH ground, 0 on the low (for recessed art the field is high)
  const F = new Float32Array(n * n)
  const h = new Float32Array(n * n)
  for (let i = 0; i < n * n; i++) {
    const occ = wallProfile(sd[i]!, p.wallMM)
    h[i] = sign * p.depthMM * occ
    F[i] = p.relief === 'raised' ? occ : 1 - occ
  }

  // neighbourhood height (~0.12 mm sigma) → cavity = enclosed by higher ground
  const nb = Float32Array.from(F)
  const rb = Math.max(1, Math.round(0.07 / mmPerPx))
  boxBlur(nb, n, rb)
  boxBlur(nb, n, rb)
  boxBlur(nb, n, rb)

  const normal = new Uint8Array(n * n * 4)
  const occl = new Uint8Array(n * n * 4)
  const at = (x: number, y: number) => h[(y < 0 ? 0 : y >= n ? n - 1 : y) * n + (x < 0 ? 0 : x >= n ? n - 1 : x)]!
  for (let y = 0; y < n; y++) {
    const wy = -V + (y + 0.5) * mmPerPx
    for (let x = 0; x < n; x++) {
      const i = y * n + x
      const wx = -V + (x + 0.5) * mmPerPx
      const r = Math.hypot(wx, wy)
      // design gradient (central differences) + the cap profile's radial slope
      let gx = (at(x + 1, y) - at(x - 1, y)) / (2 * mmPerPx)
      let gy = (at(x, y + 1) - at(x, y - 1)) / (2 * mmPerPx)
      const { dydr } = baseProfile(Math.min(r, p.faceR), p)
      if (r > 1e-6) {
        gx += (dydr * wx) / r
        gy += (dydr * wy) / r
      }
      // three.js object space: face in XZ, Y up, design y → +Z
      const nx = -gx
      const ny = 1
      const nz = -gy
      const len = Math.hypot(nx, ny, nz)
      const o = i * 4
      normal[o] = Math.round(((nx / len) * 0.5 + 0.5) * 255)
      normal[o + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255)
      normal[o + 2] = Math.round(((nz / len) * 0.5 + 0.5) * 255)
      normal[o + 3] = 255

      occl[o] = Math.round(Math.min(1, Math.max(0, (nb[i]! - F[i]!) * 1.6)) * 255) // cavity
      occl[o + 1] = Math.round((1 - F[i]!) * 255) // lowness
      occl[o + 3] = 255
    }
  }

  // displacement at DISP_N² — box-downsampled so vertex sampling doesn't alias
  const f = n / DISP_N
  const disp = new Float32Array(DISP_N * DISP_N)
  if (Number.isInteger(f) && f >= 1) {
    for (let y = 0; y < DISP_N; y++) {
      for (let x = 0; x < DISP_N; x++) {
        let acc = 0
        for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) acc += h[(y * f + dy) * n + x * f + dx]!
        disp[y * DISP_N + x] = acc / (f * f)
      }
    }
  } else {
    for (let y = 0; y < DISP_N; y++) {
      for (let x = 0; x < DISP_N; x++) disp[y * DISP_N + x] = at(Math.floor((x + 0.5) * f), Math.floor((y + 0.5) * f))
    }
  }

  return { n, spanMM, disp, dispN: DISP_N, normal, occl }
}

/**
 * A finish's patina over the field's cavity/lowness: surface = R ambient
 * occlusion, G roughness multiplier (÷ ROUGH_HEADROOM); albedo = grey oxide
 * darkening. Cheap per-pixel pass (main thread, on field landing / finish change).
 */
export function finishMaps(field: HeightField, p: Patina): { surface: Uint8Array; albedo: Uint8Array } {
  const n = field.n
  const surface = new Uint8Array(n * n * 4)
  const albedo = new Uint8Array(n * n * 4)
  const occl = field.occl
  for (let i = 0; i < n * n; i++) {
    const o = i * 4
    const patina = Math.min(1, p.cavity * (occl[o]! / 255) + p.field * (occl[o + 1]! / 255))
    surface[o] = Math.round((1 - 0.7 * patina) * 255)
    surface[o + 1] = Math.round(((1 + (ROUGH_HEADROOM - 1) * patina) / ROUGH_HEADROOM) * 255)
    surface[o + 3] = 255
    const g = Math.round((1 - p.darken * patina) * 255)
    albedo[o] = g
    albedo[o + 1] = g
    albedo[o + 2] = g
    albedo[o + 3] = 255
  }
  return { surface, albedo }
}
