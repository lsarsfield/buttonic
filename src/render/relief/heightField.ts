import { capProportions, centreKindOf, STYLES, type CentreKind } from '../../model/product'
import type { LogoDisplay, Material, Product, ProductStyle } from '../../model/types'

/**
 * Height field of the struck button, from the die file's rasterized coverage.
 * Pure and worker-safe (no DOM, no three.js) — node-tested.
 *
 * Pipeline (all lengths mm, image rows top→bottom = design y −V → +V):
 *  1. coverage (alpha of the black die art) → exact signed distance to the
 *     art edge (Felzenszwalb–Huttenlocher EDT, sub-pixel on boundary pixels,
 *     lightly smoothed so diagonal walls don't terrace on the pixel lattice)
 *  2. design height = depth · smoothstep over a finite wall — embossed (die-
 *     struck: what's cut into the die stands proud), debossed, or lasered
 *     (flat: no relief, a marking — located by the art-occupancy channel)
 *  3. cavity = how enclosed a point is by higher ground (blurred coverage vs
 *     local height), plus plain lowness — raw inputs; each FINISH turns them
 *     into its own patina (finishMaps: nickel greys only tight recesses,
 *     antique brass fills the whole low ground with brown oxide) so switching
 *     finish never re-runs the EDT
 *  4. object-space normals of the WHOLE surface: cap profile (flat, domed or
 *     dished face, rolled outer edge, the style's centre feature — hole lip,
 *     nipple knob, sunk cup or pin hole) + design relief
 */

export interface ReliefParams {
  display: LogoDisplay
  /** Relief height of the design, mm (unused when lasered). */
  depthMM: number
  /** Width of the sloped wall between field and design, mm. */
  wallMM: number
  faceR: number
  /** The style's centre feature ('none' when absent or zero-sized). */
  centre: CentreKind
  /** Centre feature radius, mm. */
  centreR: number
  /** Radius of the rolled outer shoulder, mm. */
  rollMM: number
  /** Radius of the rolled lip into a hole / pin hole, mm. */
  lipMM: number
  /** Face dome height at the axis, mm (0 = flat). */
  domeMM: number
  /** Dish depth falling toward the centre feature, mm (concave open tops). */
  concaveMM: number
  /** Cap body height (face to underside), mm — scene geometry. */
  capH: number
  /** Raised central plateau (die-cast rivet): radius and step height, mm (0 = none). */
  plateauR: number
  plateauH: number
}

/** Drafted relief wall width: dies are cut with draft, so struck walls slope (and catch light). */
export const WALL_MM = 0.1

/** The physical cap for a product spec (doc-level fields). */
export function reliefParamsOf(d: {
  diameterMM: number
  holeDiameterMM: number
  product: Product
  style: ProductStyle
  material: Material
  logoDisplay: LogoDisplay
}): ReliefParams {
  const st = STYLES[d.style]
  const { capH, roll, depthMM } = capProportions(d.product, d.material, d.diameterMM, d.style)
  const centre = centreKindOf(d)
  const centreR = centre === 'none' ? 0 : d.holeDiameterMM / 2
  return {
    display: d.logoDisplay,
    depthMM,
    wallMM: WALL_MM,
    faceR: d.diameterMM / 2,
    centre,
    centreR,
    rollMM: roll,
    lipMM: centre === 'pin' ? Math.min(0.12, centreR * 0.4) : Math.min(0.3, centreR * 0.3),
    domeMM: st.domeFrac * d.diameterMM,
    concaveMM: st.concaveFrac * d.diameterMM,
    capH,
    plateauR: (st.plateauFrac ?? 0) * (d.diameterMM / 2),
    plateauH: (st.plateauHFrac ?? 0) * d.diameterMM,
  }
}

/** Where the face mesh starts: at a hole / pin hole's edge, else the axis. */
export const faceInnerR = (p: ReliefParams): number => (p.centre === 'hole' || p.centre === 'pin' ? p.centreR : 0)

export interface HeightField {
  n: number
  /** Full width (and height) of the square image in mm, centred on the axis. */
  spanMM: number
  /** Design displacement (mm, + up) at DISP_N² — vertex displacement input. */
  disp: Float32Array
  dispN: number
  /**
   * Object-space normals of the full surface, RGBA half-floats (xyz·0.5+0.5),
   * n². Half precision, not 8-bit: a polished face on a shallow dome only
   * spans a few 8-bit levels, which a mirror finish shows as blocky terraces.
   */
  normal: Uint16Array
  /** R = cavity (enclosed by higher ground), G = lowness (1 − high-ground occupancy), B = art occupancy, RGBA8 n². */
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

/** Nipple knob height as a fraction of its radius (a near-hemispherical nail head). */
export const NIPPLE_H = 0.95
/** Inverted nipple: bowl depth, the rolled ring around it, and the nail head at its bottom (fractions of the cup radius). */
export const CUP_D = 0.5
const CUP_RING_H = 0.14
const CUP_RING_W = 0.26
const CUP_HEAD_R = 0.36
const CUP_HEAD_H = 0.3

/** Cap surface height at radius r, before the design (see baseProfile). */
function profileY(r: number, p: ReliefParams): number {
  const R = p.faceR
  const a = R - p.rollMM // shoulder start
  const c = p.centreR
  const inner = p.centre === 'hole' || p.centre === 'pin' ? c + p.lipMM : p.centre === 'none' ? 0 : c
  const flat = (rr: number): number => {
    let y = p.domeMM > 0 ? p.domeMM * (1 - (rr * rr) / (R * R)) : 0
    if (p.concaveMM > 0 && a > inner) {
      const t = Math.min(1, Math.max(0, (a - rr) / (a - inner)))
      y -= p.concaveMM * t * t * (3 - 2 * t)
    }
    if (p.plateauR > 0 && p.plateauH > 0) {
      // die-cast step: a raised centre plateau with a short filleted riser
      const w = Math.max(0.08, p.plateauH * 1.5)
      const t = Math.min(1, Math.max(0, (p.plateauR - rr) / w))
      y += p.plateauH * t * t * (3 - 2 * t)
    }
    return y
  }
  if (p.rollMM > 0 && r > a) {
    const u = Math.min(r - a, p.rollMM * 0.9995)
    return flat(a) - p.rollMM + Math.sqrt(p.rollMM * p.rollMM - u * u)
  }
  switch (p.centre) {
    case 'hole': {
      const b = c + p.lipMM
      if (p.lipMM > 0 && r < b) {
        const u = Math.min(b - r, p.lipMM * 0.9995)
        return flat(b) - p.lipMM + Math.sqrt(p.lipMM * p.lipMM - u * u)
      }
      break
    }
    case 'pin': {
      // die-cast pin hole: a raised collar around a rolled-in bore
      const b = c + p.lipMM
      const collarW = Math.max(0.12, c * 0.6)
      const collarH = Math.min(0.1, c * 0.18)
      if (p.lipMM > 0 && r < b) {
        const u = Math.min(b - r, p.lipMM * 0.9995)
        return flat(b) + collarH - p.lipMM + Math.sqrt(p.lipMM * p.lipMM - u * u)
      }
      if (r < b + collarW) {
        const t = (r - b) / collarW
        return flat(r) + collarH * Math.cos((t * Math.PI) / 2) ** 2
      }
      break
    }
    case 'nipple':
      if (r < c) return flat(c) + NIPPLE_H * c * Math.sqrt(Math.max(0, 1 - (r * r) / (c * c)))
      break
    case 'cup': {
      // inverted nipple: a rolled ring, a bowl, and the nail head sitting in it
      const ringW = CUP_RING_W * c
      const ring = Math.abs(r - c) < ringW ? CUP_RING_H * c * Math.cos(((r - c) / ringW) * (Math.PI / 2)) ** 2 : 0
      if (r < c) {
        const bowl = flat(c) - CUP_D * c * (1 - (r * r) / (c * c))
        const hr = CUP_HEAD_R * c
        const head = r < hr ? CUP_HEAD_H * c * Math.sqrt(1 - (r * r) / (hr * hr)) : 0
        return bowl + head + ring
      }
      return flat(r) + ring
    }
  }
  return flat(r)
}

/**
 * Height of the bare cap surface at radius r (before the design): the face —
 * flat, domed, or dished toward the centre — a quarter-round shoulder rolling
 * down to vertical at faceR, and the style's centre feature: a quarter-round
 * lip rolling into a hole / pin hole, a nipple knob, or a sunk cup. Slope by
 * central difference, clamped so vertical tangents stay finite.
 */
export function baseProfile(r: number, p: ReliefParams): { y: number; dydr: number } {
  const MAX_SLOPE = 40
  const h = 1e-4
  const y = profileY(r, p)
  // the rolled curves meet vertical at their ends, where the value is clamped
  // (a central difference would read 0 there) — pin those tangents
  if (p.rollMM > 0 && r >= p.faceR - p.rollMM * 0.001) return { y, dydr: -MAX_SLOPE }
  if ((p.centre === 'hole' || p.centre === 'pin') && p.lipMM > 0 && r <= p.centreR + p.lipMM * 0.001) {
    return { y, dydr: MAX_SLOPE }
  }
  const d = (profileY(r + h, p) - profileY(Math.max(0, r - h), p)) / (r + h - Math.max(0, r - h))
  return { y, dydr: Math.max(-MAX_SLOPE, Math.min(MAX_SLOPE, d)) }
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

const f32 = new Float32Array(1)
const u32 = new Uint32Array(f32.buffer)
/** IEEE 754 half-float bits for a value in [0, 1] (round-to-nearest; no NaN/Inf needed). */
export function toHalf(v: number): number {
  f32[0] = v
  const x = u32[0]!
  const e = ((x >>> 23) & 0xff) - 127 + 15
  if (e <= 0) return 0 // below half's normal range: effectively 0 at our scale
  const m = x & 0x7fffff
  let h = (e << 10) | (m >>> 13)
  if (m & 0x1000) h++ // round
  return h
}
export const HALF_ONE = 0x3c00
/** Half-float bits → number (tests / debugging). */
export function fromHalf(h: number): number {
  const e = (h >>> 10) & 0x1f
  const m = h & 0x3ff
  return e === 0 ? (m / 1024) * 2 ** -14 : (1 + m / 1024) * 2 ** (e - 15)
}

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

  const sign = p.display === 'embossed' ? 1 : p.display === 'debossed' ? -1 : 0
  // F: 1 on the HIGH ground, 0 on the low (for debossed art the field is high;
  // lasered art is flush, so everything is high ground)
  const F = new Float32Array(n * n)
  const h = new Float32Array(n * n)
  const art = new Float32Array(n * n)
  for (let i = 0; i < n * n; i++) {
    const occ = wallProfile(sd[i]!, p.wallMM)
    art[i] = occ
    h[i] = sign * p.depthMM * occ
    F[i] = sign > 0 ? occ : sign < 0 ? 1 - occ : 1
  }

  // neighbourhood height (~0.12 mm sigma) → cavity = enclosed by higher ground
  const nb = Float32Array.from(F)
  const rb = Math.max(1, Math.round(0.07 / mmPerPx))
  boxBlur(nb, n, rb)
  boxBlur(nb, n, rb)
  boxBlur(nb, n, rb)

  const normal = new Uint16Array(n * n * 4)
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
      normal[o] = toHalf((nx / len) * 0.5 + 0.5)
      normal[o + 1] = toHalf((ny / len) * 0.5 + 0.5)
      normal[o + 2] = toHalf((nz / len) * 0.5 + 0.5)
      normal[o + 3] = HALF_ONE

      occl[o] = Math.round(Math.min(1, Math.max(0, (nb[i]! - F[i]!) * 1.6)) * 255) // cavity
      occl[o + 1] = Math.round((1 - F[i]!) * 255) // lowness
      occl[o + 2] = Math.round(art[i]! * 255) // art occupancy
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

/** How a finish is worn: its patina, plus the logo display and distressing. */
export interface SurfaceLook {
  patina: Patina
  /** Laser-marked art: a dark, matte marking in the art region. */
  lasered: boolean
  distressed: boolean
}

const hash2 = (x: number, y: number, seed: number): number => {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

/** Smooth 2D value noise on an integer lattice (deterministic). */
function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const fx = x - xi
  const fy = y - yi
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const a = hash2(xi, yi, seed)
  const b = hash2(xi + 1, yi, seed)
  const c = hash2(xi, yi + 1, seed)
  const d = hash2(xi + 1, yi + 1, seed)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}

/**
 * Distressed wear mask at a point in mm, 0..1: mottled oxide with soft,
 * ragged margins (broad blotches broken up by finer grain and pitting) —
 * not hard-edged decals.
 */
export function distressMask(xMM: number, yMM: number): number {
  const broad = 0.6 * valueNoise(xMM / 1.4, yMM / 1.4, 21) + 0.4 * valueNoise(xMM / 0.55, yMM / 0.55, 22)
  const t = Math.min(1, Math.max(0, (broad - 0.3) / 0.38))
  const blotch = t * t * (3 - 2 * t)
  const grain = 0.5 * valueNoise(xMM / 0.14, yMM / 0.14, 23) + 0.5 * valueNoise(xMM / 0.05, yMM / 0.05, 24)
  return Math.min(1, Math.max(0, blotch * (0.65 + 0.55 * grain) + 0.18 * (grain - 0.5)))
}

/**
 * A finish's look over the field's cavity/lowness/art: surface = R ambient
 * occlusion, G roughness multiplier (÷ ROUGH_HEADROOM), B metalness; albedo =
 * grey oxide / marking darkening. Oxide is a dark DIELECTRIC film, not dimmer
 * metal — so where it's heavy, metalness drops too (otherwise a bright studio
 * still mirrors off the "blackened" field). Cheap per-pixel pass (main thread, on field landing or a
 * finish/look change) — never re-runs the EDT.
 *
 *  - patina: oxide settles in cavities and (per finish) over the low field
 *  - lasered: the art is a dark, matte heat-marking, flush with the face
 *  - distressed: blotchy heavy oxide worn back to bright metal on the high
 *    points — the washed-and-worn workwear look
 */
export function finishMaps(field: HeightField, look: SurfaceLook | Patina): { surface: Uint8Array; albedo: Uint8Array } {
  const L: SurfaceLook = 'patina' in look ? look : { patina: look, lasered: false, distressed: false }
  const p = L.patina
  const n = field.n
  const mmPerPx = field.spanMM / n
  const V = field.spanMM / 2
  const surface = new Uint8Array(n * n * 4)
  const albedo = new Uint8Array(n * n * 4)
  const occl = field.occl
  for (let i = 0; i < n * n; i++) {
    const o = i * 4
    const cav = occl[o]! / 255
    const low = occl[o + 1]! / 255
    const art = occl[o + 2]! / 255
    let patina = Math.min(1, p.cavity * cav + p.field * low)
    let dark = p.darken * patina
    let rough = (1 + (ROUGH_HEADROOM - 1) * patina) / ROUGH_HEADROOM
    if (L.distressed) {
      const x = -V + ((i % n) + 0.5) * mmPerPx
      const y = -V + (Math.floor(i / n) + 0.5) * mmPerPx
      // worn back to bright metal where it stands proud, oxide clings low down
      // oxide clings in the low ground; raised work and edges are rubbed bright
      const wear = distressMask(x, y) * (0.25 + 0.75 * Math.max(low, cav))
      patina = Math.max(patina, wear)
      dark = Math.max(dark, 0.9 * wear)
      rough = Math.max(rough, (1 + (ROUGH_HEADROOM - 1) * wear) / ROUGH_HEADROOM)
    }
    if (L.lasered && art > 0) {
      dark = dark + (0.78 - dark) * art
      rough = rough + (1 - rough) * art
      patina = Math.max(patina, 0.4 * art)
    }
    surface[o] = Math.round((1 - 0.7 * patina) * 255)
    surface[o + 1] = Math.round(rough * 255)
    surface[o + 2] = Math.round((1 - 0.85 * Math.min(1, dark / 0.9)) * 255) // metalness
    surface[o + 3] = 255
    const g = Math.round((1 - dark) * 255)
    albedo[o] = g
    albedo[o + 1] = g
    albedo[o + 2] = g
    albedo[o + 3] = 255
  }
  return { surface, albedo }
}
