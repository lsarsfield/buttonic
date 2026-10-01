import { describe, expect, it } from 'vitest'
import { METAL_FINISHES } from './finishes'
import {
  baseProfile,
  buildHeightField,
  capGeometry,
  maxFilter,
  distressMask,
  finishMaps,
  fromHalf,
  LASER_DEPTH_MM,
  reliefParamsOf,
  ROUGH_HEADROOM,
  toHalf,
  signedDistance,
  WALL_MM,
  wallProfile,
  type ReliefParams,
} from './heightField'

// 0.03 mm/px: the kernel's pixel-sized smoothing is tuned for fine rasters (0.008 mm/px live)
const N = 512
const SPAN = 16
const MMPX = SPAN / N

/** Coverage of an analytic disc (radius mm, centred), 4×4 supersampled per pixel. */
function discCoverage(rMM: number, cx = 0, cy = 0): Float32Array {
  const cov = new Float32Array(N * N)
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let hit = 0
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const wx = -SPAN / 2 + (x + (sx + 0.5) / 4) * MMPX - cx
          const wy = -SPAN / 2 + (y + (sy + 0.5) / 4) * MMPX - cy
          if (wx * wx + wy * wy <= rMM * rMM) hit++
        }
      }
      cov[y * N + x] = hit / 16
    }
  }
  return cov
}

const px = (xMM: number, yMM: number) => {
  const x = Math.floor((xMM + SPAN / 2) / MMPX)
  const y = Math.floor((yMM + SPAN / 2) / MMPX)
  return y * N + x
}
const pxCentre = (i: number) => ({
  x: -SPAN / 2 + ((i % N) + 0.5) * MMPX,
  y: -SPAN / 2 + (Math.floor(i / N) + 0.5) * MMPX,
})

const DEPTH = 0.15
const params = (patch: Partial<ReliefParams> = {}): ReliefParams => ({
  display: 'embossed',
  depthMM: DEPTH,
  wallMM: WALL_MM,
  faceR: 7.5,
  centre: 'none',
  centreR: 0,
  rollMM: 0.45,
  lipMM: 0.3,
  domeMM: 0,
  concaveMM: 0,
  capH: 1.15,
  plateauR: 0,
  plateauH: 0,
  ...patch,
})

/** Params for a trade style at a size (the app's own mapping). */
const styleParams = (style: Parameters<typeof reliefParamsOf>[0]['style'], d: number, hole: number) =>
  reliefParamsOf({
    diameterMM: d,
    holeDiameterMM: hole,
    product: style === 'capped' || style === 'nipple' || style === 'inverted-nipple' || style === 'die-cast' ? 'rivet' : 'button',
    style,
    material: 'brass',
    logoDisplay: 'embossed',
  })

describe('signed distance', { timeout: 30_000 }, () => {
  it('matches the analytic distance to a disc edge within a pixel, positive inside', () => {
    const R = 3
    const sd = signedDistance(discCoverage(R), N, MMPX)
    for (const [x, y] of [
      [0, 0],
      [1.2, -0.7],
      [4.5, 0.3],
      [-5.1, 2.2],
      [2.9, 0.4],
    ] as const) {
      const i = px(x, y)
      const c = pxCentre(i)
      const truth = R - Math.hypot(c.x, c.y)
      expect(Math.abs(sd[i]! - truth)).toBeLessThan(MMPX)
    }
  })
})

describe('wall profile', () => {
  it('is 0 on the field, 1 on the art, ½ at the edge', () => {
    expect(wallProfile(-0.03, 0.06)).toBe(0)
    expect(wallProfile(0.03, 0.06)).toBe(1)
    expect(wallProfile(0, 0.06)).toBeCloseTo(0.5, 6)
  })
})

describe('cap profile', () => {
  it('is flat on the face, rolls down at the rim and into the hole', () => {
    const p = params({ centre: 'hole', centreR: 2 })
    expect(baseProfile(4, p).y).toBe(0)
    expect(Math.abs(baseProfile(4, p).dydr)).toBeLessThan(1e-6)
    const rim = baseProfile(p.faceR, p)
    expect(rim.y).toBeCloseTo(-p.rollMM, 1)
    expect(rim.dydr).toBeLessThan(-10) // near-vertical
    const lip = baseProfile(p.centreR, p)
    expect(lip.y).toBeCloseTo(-p.lipMM, 1)
    expect(lip.dydr).toBeGreaterThan(10)
  })

  it('flat cap is flat; domed cap peaks at the axis and falls monotonically', () => {
    const flat = styleParams('flat-cap', 17, 0)
    for (const r of [0, 2, 5, 7.5]) expect(baseProfile(r, flat).y).toBe(0)
    const dome = styleParams('domed-cap', 17, 0)
    let prev = Infinity
    for (let r = 0; r < 8; r += 0.5) {
      const y = baseProfile(r, dome).y
      expect(y).toBeLessThan(prev)
      prev = y
    }
    expect(baseProfile(0, dome).y).toBeCloseTo(0.2 * 17, 6)
  })

  it('open top concave dishes down toward the hole', () => {
    const p = styleParams('open-top-concave', 17, 6.5)
    let prev = -Infinity
    for (let r = 3.8; r < 8; r += 0.4) {
      const y = baseProfile(r, p).y
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9) // rises outward from the lip to the shoulder
      prev = y
    }
    expect(baseProfile(3.8, p).y).toBeLessThan(-0.3)
  })

  it('nipple rivet: a knob peaking at the axis; inverted nipple: a cup lowest at the axis', () => {
    const nip = styleParams('nipple', 9, 2.7)
    expect(baseProfile(0, nip).y).toBeGreaterThan(baseProfile(1, nip).y)
    expect(baseProfile(1, nip).y).toBeGreaterThan(baseProfile(2.5, nip).y)
    const cup = styleParams('inverted-nipple', 9, 3.8)
    const c = 1.9
    // the bowl sinks below the face; the nail head rises inside it; a rolled ring rims it
    expect(baseProfile(0.9, cup).y).toBeLessThan(baseProfile(3.5, cup).y - 0.3)
    expect(baseProfile(0, cup).y).toBeGreaterThan(baseProfile(0.9, cup).y)
    expect(baseProfile(c, cup).y).toBeGreaterThan(baseProfile(3.5, cup).y)
  })

  it('die-cast rivet: a raised centre plateau and a collared pin hole', () => {
    const p = reliefParamsOf({ diameterMM: 9, holeDiameterMM: 1.2, product: 'rivet', style: 'die-cast', material: 'die-cast', logoDisplay: 'embossed' })
    const plateau = baseProfile(2, p).y
    const ring = baseProfile(4.0, p).y
    expect(plateau - ring).toBeCloseTo(0.035 * 9, 2)
    expect(baseProfile(p.centreR + p.lipMM + 0.02, p).y).toBeGreaterThan(plateau) // collar
  })

  it('die-cast is thicker with deeper relief than brass', () => {
    const base = { diameterMM: 17, holeDiameterMM: 0, product: 'button', style: 'flat-cap', logoDisplay: 'embossed' } as const
    const brass = reliefParamsOf({ ...base, material: 'brass' })
    const cast = reliefParamsOf({ ...base, material: 'die-cast' })
    expect(cast.capH).toBeGreaterThan(brass.capH)
    expect(cast.depthMM).toBeGreaterThan(brass.depthMM)
  })
})

// building a full height field (EDT + normals at 512²) is heavy by nature; CI
// runners are slow and shared — give these groups an explicit budget
describe('height field', { timeout: 30_000 }, () => {
  const cov = discCoverage(2)

  it('embossed art stands proud; debossed is its negative; lasered is a shallow laser cut', () => {
    const up = buildHeightField(cov, N, SPAN, params())
    const down = buildHeightField(cov, N, SPAN, params({ display: 'debossed' }))
    const laser = buildHeightField(cov, N, SPAN, params({ display: 'lasered' }))
    // disp is DISP_N² — sample its centre and a far corner
    const n = up.dispN
    const centre = (n / 2) * n + n / 2
    const corner = 10 * n + 10
    expect(laser.disp[centre]).toBeCloseTo(-LASER_DEPTH_MM, 4)
    expect(laser.disp[corner]).toBe(0)
    expect(up.disp[centre]).toBeCloseTo(DEPTH, 3)
    expect(up.disp[corner]).toBeCloseTo(0, 6)
    expect(down.disp[centre]).toBeCloseTo(-DEPTH, 3)
    for (let i = 0; i < n * n; i += 997) expect(down.disp[i]).toBeCloseTo(-up.disp[i]!, 6)
  })

  it('normals point up on flat ground and tilt outward on a raised wall', () => {
    const f = buildHeightField(cov, N, SPAN, params())
    const nrm = (i: number) => [0, 1, 2].map((c) => fromHalf(f.normal[i * 4 + c]!) * 2 - 1)
    const flat = nrm(px(4, 4)) // on the flat face, clear of the rolled shoulder
    expect(flat[1]).toBeGreaterThan(0.99)
    // on the +x wall of a raised disc the surface falls away toward +x → normal leans +x
    const wall = nrm(px(2, 0.01))
    expect(wall[0]).toBeGreaterThan(0.2)
  })

  it('cavity darkens the low ground hemmed in by art, not open ground', () => {
    // a narrow ring slot: art between r 1.5 and 3 with a 0.25 mm gap at r ≈ 2.2
    const ring = new Float32Array(N * N)
    const a = discCoverage(3)
    const b = discCoverage(2.35)
    const c = discCoverage(2.1)
    for (let i = 0; i < N * N; i++) ring[i] = Math.min(1, Math.max(0, a[i]! - b[i]! + c[i]!))
    const f = buildHeightField(ring, N, SPAN, params())
    const { surface } = finishMaps(f, METAL_FINISHES.nickel.patina)
    const ao = (i: number) => surface[i * 4]!
    expect(ao(px(2.22, 0.05))).toBeLessThan(ao(px(6, 6)) - 20)
  })

  it('antique brass fills the whole low ground with oxide; the high points stay burnished', () => {
    const f = buildHeightField(discCoverage(2), N, SPAN, params())
    const nickel = finishMaps(f, METAL_FINISHES.nickel.patina).albedo
    const antique = finishMaps(f, METAL_FINISHES['antique-brass'].patina).albedo
    const field = px(5, 3) // open low ground, far from the raised disc
    const top = px(0, 0) // on the raised disc
    expect(antique[field * 4]!).toBeLessThan(nickel[field * 4]! - 80)
    expect(antique[field * 4]!).toBeLessThan(140)
    expect(antique[top * 4]!).toBe(255)
    // the patina is a finish choice over the SAME field — no rebuild
    expect(finishMaps(f, METAL_FINISHES.nickel.patina).albedo).toEqual(nickel)
  })
})

describe('finish looks', { timeout: 30_000 }, () => {
  const f = buildHeightField(discCoverage(2), N, SPAN, params({ display: 'lasered' }))
  const art = px(0, 0)
  const bare = px(5, 3)

  // final roughness at a pixel = base × ROUGH_HEADROOM × map
  const roughAt = (m: Uint8Array, i: number, base: number) => Math.min(1, base * ROUGH_HEADROOM * (m[i * 4 + 1]! / 255))

  it('a laser frost is tone-on-tone: the metal keeps its colour, the sheen goes satin', () => {
    const fin = METAL_FINISHES['polished-nickel']
    const look = { patina: fin.patina, roughness: fin.roughness, distressed: false }
    const plain = finishMaps(f, { ...look, lasered: false })
    const laser = finishMaps(f, { ...look, lasered: true })
    // barely dimmed — never a painted-on dark mark
    expect(laser.albedo[art * 4]!).toBeGreaterThan(plain.albedo[art * 4]! * 0.7)
    // still metal
    expect(laser.surface[art * 4 + 2]!).toBeGreaterThan(200)
    // a mirror face frosts to satin; the bare face keeps its polish
    expect(roughAt(laser.surface, art, fin.roughness)).toBeGreaterThan(0.35)
    expect(roughAt(laser.surface, bare, fin.roughness)).toBeCloseTo(fin.roughness, 1)
    expect(laser.albedo[bare * 4]).toBe(plain.albedo[bare * 4])
  })

  it('on an antiqued finish the laser burns through the oxide to bright metal', () => {
    const fin = METAL_FINISHES['antique-brass']
    expect(fin.laser).toBe('reveal')
    const laser = finishMaps(f, { patina: fin.patina, roughness: fin.roughness, laser: 'reveal', lasered: true, distressed: false })
    // a lasered-only face has no relief to burnish: it keeps its antiquing…
    expect(laser.albedo[bare * 4]!).toBeLessThan(200)
    // …and the mark is the clean metal beneath, brighter than the face
    expect(laser.albedo[art * 4]!).toBeGreaterThan(laser.albedo[bare * 4]! + 50)
  })

  it('the laser fill tilts the normals along its scan lines; the bare face stays flat', () => {
    const nz = (i: number) => fromHalf(f.normal[i * 4 + 1]!) * 2 - 1
    let minInside = 1
    for (let k = 0; k < 40; k++) minInside = Math.min(minInside, nz(px(-1 + k * 0.05, 0.3)))
    expect(minInside).toBeLessThan(0.999)
    expect(nz(bare)).toBeGreaterThan(0.9999)
  })

  it('distressed wear is deterministic and actually blotchy', () => {
    const look = { patina: METAL_FINISHES['antique-brass'].patina, lasered: false, distressed: true }
    const a = finishMaps(f, look).albedo
    expect(finishMaps(f, look).albedo).toEqual(a)
    let hits = 0
    let samples = 0
    for (let y = -6; y <= 6; y += 0.25) {
      for (let x = -6; x <= 6; x += 0.25) {
        samples++
        if (distressMask(x, y) > 0.5) hits++
      }
    }
    expect(hits / samples).toBeGreaterThan(0.1)
    expect(hits / samples).toBeLessThan(0.7)
  })
})

describe('half-float normals', () => {
  it('round-trips [0,1] to ~3 significant digits (8-bit managed only 1/255)', () => {
    for (const v of [0, 0.25, 0.4999, 0.5, 0.5003, 0.75, 1]) expect(Math.abs(fromHalf(toHalf(v)) - v)).toBeLessThan(5e-4)
    expect(toHalf(0.5)).not.toBe(toHalf(0.5006))
  })
})

describe('shape realism (adversarial review fixes)', { timeout: 30_000 }, () => {
  const slopeJump = (p: ReliefParams, r: number) => {
    const d = 0.002
    const left = (baseProfile(r - d, p).y - baseProfile(r - 2 * d, p).y) / d
    const right = (baseProfile(r + 2 * d, p).y - baseProfile(r + d, p).y) / d
    return Math.abs(right - left)
  }

  it('a domed face rolls into its edge with no crease: the slope is continuous where the fillet starts', () => {
    const p = styleParams('domed-cap', 17, 0)
    const f = capGeometry(p).outer!
    expect(f.theta0).toBeLessThan(-0.3) // the fillet leaves on the dome's slope, not horizontally
    expect(slopeJump(p, f.start)).toBeLessThan(0.05)
    expect(baseProfile(p.faceR - 1e-4, p).dydr).toBeLessThan(-10) // and still ends vertical
  })

  it('the concave dish rolls into the hole tangentially too', () => {
    const p = styleParams('open-top-concave', 17, 6.5)
    const f = capGeometry(p).lip!
    expect(slopeJump(p, f.start)).toBeLessThan(0.05)
  })

  it('nipple: a domed nail head ~0.6–0.85 × as tall as it is wide (the P&C photo)', () => {
    const p = styleParams('nipple', 9, 3.8)
    const h = baseProfile(0, p).y - baseProfile(p.centreR * 1.2, p).y
    expect(h / (2 * p.centreR)).toBeGreaterThan(0.6)
    expect(h / (2 * p.centreR)).toBeLessThan(0.85)
  })

  it('no rolled curve reaches below the cap underside (domed edge, concave funnel)', () => {
    for (const [style, d, hole] of [
      ['domed-cap', 17, 0],
      ['domed-cap', 14, 0],
      ['open-top-concave', 17, 6.5],
      ['moveable-shank', 17, 0],
    ] as const) {
      const p = styleParams(style, d, hole)
      const g = capGeometry(p)
      const lowest = Math.min(g.outer?.cy ?? 0, g.lip?.cy ?? 0)
      expect(lowest).toBeGreaterThan(-p.capH + 0.1)
    }
  })

  it('inverted nipple: a pronounced rolled ring (~0.28 c) rims the bowl', () => {
    const p = styleParams('inverted-nipple', 9, 3.8)
    const ring = baseProfile(p.centreR, p).y - baseProfile(p.centreR + 0.8, p).y
    expect(ring / p.centreR).toBeGreaterThan(0.25)
  })

  it('maxFilter: running max over the window, O(n)', () => {
    const n = 32
    const a = new Float32Array(n * n)
    a[10 * n + 10] = 5
    maxFilter(a, n, 3)
    expect(a[13 * n + 7]).toBe(5)
    expect(a[14 * n + 10]).toBe(0)
  })

  it('small art keeps a flat top: the wall shrinks to the feature', () => {
    // a 0.2 mm wide dot is narrower than two full walls (0.3 mm)
    const f = buildHeightField(discCoverage(0.1), N, SPAN, params({ wallMM: WALL_MM }))
    const n = f.dispN
    expect(f.disp[(n / 2) * n + n / 2]).toBeCloseTo(DEPTH, 2) // reaches full height, not a tent
  })
})

describe('relief walls', { timeout: 60_000 }, () => {
  it('a large feature gets the full drafted wall, the same shape at 0°, 22.5° and 45° edges', () => {
    // a big square rotated to each angle: sample the height across its edge
    const n = 512
    const span = 8
    const mmpx = span / n
    for (const deg of [0, 22.5, 45]) {
      const a = (deg * Math.PI) / 180
      const cov = new Float32Array(n * n)
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          let hit = 0
          for (let sy = 0; sy < 4; sy++) {
            for (let sx = 0; sx < 4; sx++) {
              const wx = -span / 2 + (x + (sx + 0.5) / 4) * mmpx
              const wy = -span / 2 + (y + (sy + 0.5) / 4) * mmpx
              const u = wx * Math.cos(a) + wy * Math.sin(a)
              const v = -wx * Math.sin(a) + wy * Math.cos(a)
              if (Math.abs(u) < 2 && Math.abs(v) < 2) hit++
            }
          }
          cov[y * n + x] = hit / 16
        }
      }
      const f = buildHeightField(cov, n, span, params({ faceR: 3.9, wallMM: WALL_MM }))
      const dn = f.dispN
      for (const off of [-0.06, -0.03, 0, 0.03, 0.06]) {
        // along the square's u axis, through the middle of one edge
        const u = 2 + off
        const wx = u * Math.cos(a)
        const wy = u * Math.sin(a)
        const px = Math.floor(((wx + span / 2) / span) * dn)
        const py = Math.floor(((wy + span / 2) / span) * dn)
        const got = f.disp[py * dn + px]! / DEPTH
        // compare at the texel's TRUE distance from the edge (it snaps off the nominal point)
        const tx = -span / 2 + ((px + 0.5) / dn) * span
        const ty = -span / 2 + ((py + 0.5) / dn) * span
        const uTrue = tx * Math.cos(a) + ty * Math.sin(a)
        const want = wallProfile(2 - uTrue, WALL_MM)
        // 0.13 ≈ 10 µm of edge shift — the EDT's sub-pixel accuracy at this 16 µm/px
        // test raster (live is 8 µm/px). A halved or kinked wall misses by 0.2–0.35.
        expect(Math.abs(got - want)).toBeLessThan(0.13)
      }
    }
  })
})

describe('mixed relief', { timeout: 60_000 }, () => {
  it('raised and sunk art on one die: +depth, −depth, the field between them at 0', () => {
    const raised = discCoverage(1.2)
    // a ring well away from the disc: sunk
    const outer = discCoverage(4)
    const inner = discCoverage(3)
    const sunk = new Float32Array(N * N)
    for (let i = 0; i < N * N; i++) sunk[i] = Math.max(0, outer[i]! - inner[i]!)
    const f = buildHeightField({ raised, sunk }, N, SPAN, params())
    const n = f.dispN
    const at = (xMM: number, yMM: number) =>
      f.disp[Math.floor(((yMM + SPAN / 2) / SPAN) * n) * n + Math.floor(((xMM + SPAN / 2) / SPAN) * n)]!
    expect(at(0, 0)).toBeCloseTo(DEPTH, 2) // raised disc
    expect(at(3.5, 0)).toBeCloseTo(-DEPTH, 2) // sunk ring
    expect(at(2.2, 0)).toBeCloseTo(0, 4) // the field
    // the field sits midway: neither "low" (raised-only) nor "high" (sunk-only)
    const lowness = f.occl[px(2.2, 0) * 4 + 1]! / 255
    expect(lowness).toBeCloseTo(0.5, 1)
  })

  it('lasered layers are located by the art mask', () => {
    const f = buildHeightField({ raised: discCoverage(1), lasered: discCoverage(0.6, 4, 0) }, N, SPAN, params())
    expect(f.occl[px(4, 0) * 4 + 2]!).toBeGreaterThan(200)
    expect(f.occl[px(0, 0) * 4 + 2]!).toBe(0)
  })
})
