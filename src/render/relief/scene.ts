import * as THREE from 'three'
import { STYLES } from '../../model/product'
import type { Finish, LogoDisplay, Material, Product, ProductStyle } from '../../model/types'
import { makeDenim, TILE_MM, type DenimKind } from './denim'
import { finishOf, METAL_FINISHES, type MetalFinish } from './finishes'
import {
  baseProfile,
  capGeometry,
  faceInnerR,
  filletPoint,
  finishMaps,
  reliefParamsOf,
  ROUGH_HEADROOM,
  type HeightField,
  type ReliefParams,
} from './heightField'

/**
 * The struck button or rivet as a three.js scene, in millimetres. three is
 * Y-up; the face lies in the XZ plane and design (x, y-down) maps to
 * (x, 0, y), so looking straight down with screen-up = −Z shows the design
 * as drawn.
 *
 * Parts: the face (a polar grid carrying the style's cap profile — flat,
 * domed or dished, rolled edge, and its centre feature: hole lip, nipple
 * knob, sunk cup or pin hole — displaced by the design relief and shaded by
 * the height field's object-space normals / patina maps), the lathed cap
 * body (thicker for die-cast), the copper tack post in an open top, and the
 * back part (tack shank, swivel shank or rivet nail) seen in the studio
 * product shot. Ground: denim (raw / ecru) with a contact shadow, or a white
 * studio sweep with the button standing on its shank. Lighting: a procedural
 * product studio (PMREM) plus a key light whose azimuth is the app's light
 * angle (0° = 12 o'clock, clockwise).
 *
 * Shared by the interactive 3D stage and the PNG mockup export.
 */

export type Backdrop = DenimKind | 'studio' | 'none'
export type Pose = 'photo' | 'top'

export interface ButtonSpec {
  diameterMM: number
  holeDiameterMM: number
  product: Product
  style: ProductStyle
  material: Material
  logoDisplay: LogoDisplay
  distressed: boolean
  postFinish: Finish
  finish: Finish
  lightDeg: number
  backdrop: Backdrop
}

const FOV = 22
/** Visible height at the fit distance, in button radii (margin around the cap). */
const FRAME = 2.6

const DEG = Math.PI / 180

function metalMaterial(f: MetalFinish): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(f.color[0], f.color[1], f.color[2]),
    metalness: 1,
    roughness: f.roughness,
  })
}

/** Where the face mesh hands over to the body: halfway round the rolled edge. */
function faceOuterEnd(p: ReliefParams): { r: number; phi: number } {
  const f = capGeometry(p).outer
  if (!f) return { r: p.faceR, phi: -Math.PI / 2 }
  const phi = (f.theta0 - Math.PI / 2) / 2
  return { r: filletPoint(f, phi).r, phi }
}

/** Radii for the face grid: dense enough for 0.05 mm art, extra samples on every curve. */
function faceRadii(p: ReliefParams, stepOverride?: number): number[] {
  const pts: number[] = []
  const g = capGeometry(p)
  const r0 = faceInnerR(p)
  const end = faceOuterEnd(p)
  // ~0.02 mm rings: a 0.1 mm relief wall gets 5+ vertices, not 2–3 (saw-tooth wall bases)
  const step = stepOverride ?? Math.min(0.02, p.faceR / 300)
  pts.push(r0, end.r)
  const n = Math.max(1, Math.ceil((end.r - r0) / step))
  for (let k = 1; k < n; k++) pts.push(r0 + ((end.r - r0) * k) / n)
  if (g.outer) for (let k = 0; k <= 16; k++) pts.push(filletPoint(g.outer, g.outer.theta0 + ((end.phi - g.outer.theta0) * k) / 16).r)
  if (g.lip) for (let k = 0; k <= 20; k++) pts.push(filletPoint(g.lip, g.lip.theta0 + ((-Math.PI / 2 - g.lip.theta0) * k) / 20).r)
  const c = p.centreR
  if (p.centre === 'nipple') {
    for (let k = 0; k <= 24; k++) pts.push(c * (0.88 + (0.12 * k) / 24)) // the drafted wall
    for (let k = 0; k <= 24; k++) pts.push(0.9 * c * Math.sin((k / 24) * (Math.PI / 2))) // the head
  } else if (p.centre === 'cup') {
    for (let k = 0; k <= 80; k++) pts.push((c * 1.3 * k) / 80) // bowl, nail head, rolled ring
  }
  if (p.centre === 'pin') for (let k = 0; k <= 16; k++) pts.push(c + (Math.max(0.12, c * 0.6) * k) / 16) // collar
  if (p.plateauR > 0) {
    const w = Math.max(0.08, p.plateauH * 1.5)
    for (let k = 0; k <= 12; k++) pts.push(p.plateauR - (w * k) / 12) // the riser
  }
  pts.sort((a, b) => a - b)
  const out: number[] = []
  for (const r of pts) if (r >= r0 - 1e-9 && r <= end.r + 1e-9 && (out.length === 0 || r - out[out.length - 1]! > 1e-5)) out.push(r)
  return out
}

function buildFaceGeometry(p: ReliefParams, segments = 1024, step?: number): THREE.BufferGeometry {
  const radii = faceRadii(p, step)
  const rows = radii.length
  const cols = segments + 1
  const pos = new Float32Array(rows * cols * 3)
  const nor = new Float32Array(rows * cols * 3)
  const uv = new Float32Array(rows * cols * 2)
  const R = p.faceR
  for (let i = 0; i < rows; i++) {
    const r = radii[i]!
    const y = baseProfile(r, p).y
    for (let j = 0; j < cols; j++) {
      const a = (j / segments) * Math.PI * 2
      const x = r * Math.sin(a)
      const z = -r * Math.cos(a)
      const k = i * cols + j
      pos.set([x, y, z], k * 3)
      nor.set([0, 1, 0], k * 3) // displacement is vertical; shading comes from the normal map
      uv.set([(x + R) / (2 * R), (z + R) / (2 * R)], k * 2)
    }
  }
  const index: number[] = []
  for (let i = 0; i + 1 < rows; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * cols + j
      const b = a + 1
      const c = a + cols
      const d = c + 1
      index.push(a, b, c, b, d, c) // counter-clockwise seen from above (+Y)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.setIndex(index)
  return g
}

/**
 * Cap body: the rest of the rolled edge (from where the face mesh hands over)
 * down the side wall and curled under — one dull band, as photographed —
 * plus the wall of a hole / pin hole.
 */
function buildBodyGeometries(p: ReliefParams): { outer: THREE.BufferGeometry; inner: THREE.BufferGeometry | null } {
  const R = p.faceR
  const H = p.capH
  const g = capGeometry(p)
  const end = faceOuterEnd(p)
  const outer: THREE.Vector2[] = []
  if (g.outer) {
    for (let k = 0; k <= 10; k++) {
      const q = filletPoint(g.outer, end.phi + ((-Math.PI / 2 - end.phi) * k) / 10)
      outer.push(new THREE.Vector2(q.r, q.y))
    }
  } else outer.push(new THREE.Vector2(R, baseProfile(R, p).y))
  const yEdge = outer[outer.length - 1]!.y
  const curl = Math.min(0.5, Math.max(0.05, (H + yEdge) * 0.45))
  for (let k = 0; k <= 8; k++) {
    const a = (k / 8) * (Math.PI / 2)
    outer.push(new THREE.Vector2(R - curl + curl * Math.cos(a), -H + curl - curl * Math.sin(a)))
  }
  const r0 = faceInnerR(p)
  outer.push(new THREE.Vector2(r0, -H))
  let inner: THREE.BufferGeometry | null = null
  if (r0 > 0) {
    const yLip = baseProfile(r0, p).y
    inner = new THREE.LatheGeometry([new THREE.Vector2(r0, -H), new THREE.Vector2(r0, yLip)], 128)
  }
  return { outer: new THREE.LatheGeometry(outer, 256), inner }
}

/**
 * The tack post seen through an open top: a wide eyelet — a deep tube whose
 * rolled mouth nearly fills the hole (the Stevenson reference reads as the
 * inside of a copper tube right up to the lip) — over a dished skirt, with a
 * dark bore. Seated BELOW the lip's lowest point, so a deep concave funnel is
 * never capped by a floating washer.
 */
function buildPostGeometries(
  holeR: number,
  capH: number,
  lipBottomY: number,
): { copper: THREE.BufferGeometry; bore: THREE.BufferGeometry } {
  const h = holeR
  const lipR = 0.78 * h
  const tube = 0.08 * h
  const top = lipBottomY - 0.12
  const skirt = Math.max(top - 0.35, -capH + 0.03)
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(h * 0.995, skirt),
    new THREE.Vector2(lipR + tube * 1.6, skirt + (top - tube - skirt) * 0.6),
  ]
  // rolled mouth: a half torus from the outside over the top into the bore
  for (let i = 0; i <= 16; i++) {
    const a = Math.PI * (i / 16) // 0 = outer side, π = inner side
    pts.push(new THREE.Vector2(lipR + tube * Math.cos(a), top - tube + tube * Math.sin(a)))
  }
  const floor = -capH * 0.97 // closed above the cap underside — never through the ground
  const bore = new THREE.LatheGeometry(
    [new THREE.Vector2(lipR - tube, top - tube), new THREE.Vector2(lipR - tube * 1.05, floor), new THREE.Vector2(0, floor)],
    96,
  )
  return { copper: new THREE.LatheGeometry(pts, 128), bore }
}

/**
 * What's under a button cap, for the studio product shot, as photographed:
 * a tack shank is a plain tube ~0.28 D wide with a slight flare where it
 * meets the cap; a moveable (swivel) shank is a squat stacked collar tucked
 * right under the cap. Profile runs bottom → top so LatheGeometry's normals
 * face OUTWARD (top → bottom rendered it inside-out: a black puck).
 * Returns the geometry and its height below the cap underside.
 */
function buildShank(R: number, capH: number, swivel: boolean): { geo: THREE.BufferGeometry; height: number } {
  const y0 = -capH
  const pts: THREE.Vector2[] = []
  let height: number
  if (swivel) {
    height = 0.4 * R // enough to show under the rim at a product-shot angle
    const w1 = 0.34 * R
    const w2 = 0.26 * R
    pts.push(
      new THREE.Vector2(0.001, y0 - height),
      new THREE.Vector2(w2, y0 - height),
      new THREE.Vector2(w2, y0 - height * 0.5),
      new THREE.Vector2(w1 * 0.97, y0 - height * 0.48),
      new THREE.Vector2(w1, y0 - height * 0.4),
      new THREE.Vector2(w1, y0 - height * 0.08),
      new THREE.Vector2(w1 * 0.9, y0),
    )
  } else {
    height = 0.7 * R
    const r = 0.28 * R
    pts.push(
      new THREE.Vector2(0.001, y0 - height),
      new THREE.Vector2(r * 0.96, y0 - height),
      new THREE.Vector2(r, y0 - height + 0.04 * R),
      new THREE.Vector2(r, y0 - 0.12 * R),
      new THREE.Vector2(r * 1.14, y0 - 0.03 * R),
      new THREE.Vector2(r * 1.22, y0),
    )
  }
  return { geo: new THREE.LatheGeometry(pts, 96), height }
}

/**
 * Product-photo studio for reflections: a dark room, a big key softbox (on
 * the key light's azimuth once rotated), an overhead diffuser that the face
 * mirrors at the photo angle, a cool strip fill opposite and a floor bounce.
 * Metals only look like metal when they have contrast to reflect — the stock
 * RoomEnvironment is evenly bright and made nickel read as porcelain.
 * Environment space: key at azimuth 0 = −Z.
 */
function studioScene(bright = false): THREE.Scene {
  const scene = new THREE.Scene()
  // bright = a white product table: the sweep and walls are paper, so polished
  // metal mirrors pale greys instead of a black room
  // not uniformly bright: curved metal needs dark to read its form against
  // dark room lifted off black so steep relief walls read grey, not pitch black;
  // bright room held below the white sweep so nickel doesn't outshine the paper
  const wall: [number, number, number] = bright ? [0.12, 0.12, 0.125] : [0.12, 0.12, 0.125]
  const room = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(wall[0], wall[1], wall[2]), side: THREE.BackSide }),
  )
  scene.add(room)
  if (bright) {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(49, 48),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.8, 0.79, 0.77), side: THREE.DoubleSide }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -6
    scene.add(floor)
  }
  const panel = (w: number, h: number, intensity: number, tint: [number, number, number], azDeg: number, elDeg: number, dist: number) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(tint[0] * intensity, tint[1] * intensity, tint[2] * intensity), side: THREE.DoubleSide }),
    )
    const az = azDeg * DEG
    const el = elDeg * DEG
    m.position.set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, -Math.cos(az) * Math.cos(el) * dist)
    m.lookAt(0, 0, 0)
    scene.add(m)
  }
  panel(34, 24, 5.5, [1, 0.985, 0.96], 0, 36, 40) // key softbox
  panel(40, 40, 1.15, [0.97, 0.98, 1], 180, 72, 38) // overhead diffuser, behind the button
  // cool strip fill — not on the white table: at the low product-shot angle
  // the face mirrors straight into it and nickel outshines the paper
  if (!bright) panel(8, 30, 2.2, [0.9, 0.95, 1], 165, 16, 40)
  panel(60, 20, 0.35, [1, 0.98, 0.95], 90, -8, 40) // low bounce card
  // a low ring of soft fill all round: relief walls face sideways and need it
  for (let az = 0; az < 360; az += 45) panel(22, 7, 1.1, [1, 1, 1], az, 12, 42)
  return scene
}

function contactShadowTexture(): THREE.Texture {
  const s = 256
  const c = Object.assign(document.createElement('canvas'), { width: s, height: s })
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  g.addColorStop(0, 'rgba(0,0,0,0.85)')
  g.addColorStop(0.62, 'rgba(0,0,0,0.7)')
  g.addColorStop(0.78, 'rgba(0,0,0,0.25)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, s, s)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

const denimCache = new Map<DenimKind, { color: THREE.Texture; bump: THREE.Texture }>()
function denimTextures(kind: DenimKind): { color: THREE.Texture; bump: THREE.Texture } {
  const hit = denimCache.get(kind)
  if (hit) return hit
  const { color, bump } = makeDenim(kind)
  const ct = new THREE.CanvasTexture(color)
  ct.colorSpace = THREE.SRGBColorSpace
  const bt = new THREE.CanvasTexture(bump)
  for (const t of [ct, bt]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.anisotropy = 8
  }
  const entry = { color: ct, bump: bt }
  denimCache.set(kind, entry)
  return entry
}

function dataTexture(
  data: Uint8Array | Uint16Array | Float32Array,
  n: number,
  format: THREE.PixelFormat,
  type: THREE.TextureDataType,
  mip: boolean,
): THREE.DataTexture {
  const t = new THREE.DataTexture(data, n, n, format, type)
  t.colorSpace = THREE.NoColorSpace
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  t.magFilter = THREE.LinearFilter
  t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter
  t.generateMipmaps = mip
  t.needsUpdate = true
  return t
}

// ---------------------------------------------------------------------------

export class ButtonScene {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 400)
  readonly target = new THREE.Vector3(0, -0.3, 0)

  private readonly renderer: THREE.WebGLRenderer
  private readonly pmrem: THREE.PMREMGenerator
  private readonly envTex: THREE.Texture
  /** The white product-table environment (studio backdrop), built on first use. */
  private brightEnv: THREE.Texture | null = null
  private readonly key = new THREE.DirectionalLight(0xfffaf2, 1.6)
  private readonly button = new THREE.Group()
  /** Parts shown only in the studio product shot (the shank under a button). */
  private readonly back = new THREE.Group()
  private readonly ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>
  private readonly contact: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>

  private faceMat: THREE.MeshPhysicalMaterial | null = null
  private bodyMat: THREE.MeshPhysicalMaterial | null = null
  /** The hole wall sits in its own shadow — darker, rougher than the face. */
  private holeMat: THREE.MeshPhysicalMaterial | null = null
  private depthMat: THREE.MeshDepthMaterial | null = null
  private extraMats: THREE.Material[] = []
  private field: HeightField | null = null
  private fieldTex: THREE.Texture[] = []
  /** Finish-dependent patina maps (rebuilt on a new field or a look change). */
  private patinaTex: THREE.Texture[] = []
  private patinaKey = ''
  private geoKey = ''
  private spec: ButtonSpec | null = null
  private params: ReliefParams | null = null
  private shankH = 0

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer
    renderer.outputColorSpace = THREE.SRGBColorSpace
    // Khronos PBR Neutral: keeps indigo saturated and metal hues true (AgX greyed the denim)
    renderer.toneMapping = THREE.NeutralToneMapping
    renderer.toneMappingExposure = 0.92
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap

    this.pmrem = new THREE.PMREMGenerator(renderer)
    const studio = studioScene()
    this.envTex = this.pmrem.fromScene(studio, 0.02).texture
    studio.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.geometry) m.geometry.dispose()
      ;(m.material as THREE.Material | undefined)?.dispose()
    })
    this.scene.environment = this.envTex
    this.scene.environmentIntensity = 1

    this.key.castShadow = true
    this.key.shadow.mapSize.set(4096, 4096)
    this.key.shadow.bias = -0.0002
    this.key.shadow.normalBias = 0.01
    this.key.shadow.radius = 6
    this.scene.add(this.key, this.key.target)

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 160),
      // denim: lit mostly by the key, barely by the studio (keeps it deep like the photo)
      new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, bumpScale: 1.2, envMapIntensity: 0.35 }),
    )
    this.ground.rotation.x = -Math.PI / 2
    this.ground.receiveShadow = true
    this.contact = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false }),
    )
    this.contact.rotation.x = -Math.PI / 2
    this.contact.renderOrder = 1
    this.button.add(this.back)
    this.scene.add(this.ground, this.contact, this.button)
  }

  setSpec(spec: ButtonSpec): void {
    const prev = this.spec
    this.spec = spec
    this.params = reliefParamsOf(spec)
    const geoKey = [spec.diameterMM, spec.holeDiameterMM, spec.product, spec.style, spec.material, spec.postFinish].join('|')
    if (geoKey !== this.geoKey) {
      this.geoKey = geoKey
      this.rebuildButton()
    } else if (
      !prev ||
      prev.finish !== spec.finish ||
      prev.distressed !== spec.distressed ||
      prev.logoDisplay !== spec.logoDisplay
    ) {
      this.applyFinish()
    }
    this.applyLight()
    this.applyBackdrop()
  }

  private rebuildButton(): void {
    for (const group of [this.button, this.back]) {
      for (const child of [...group.children]) {
        if (child === this.back) continue
        group.remove(child)
        ;(child as THREE.Mesh).geometry?.dispose()
      }
    }
    for (const m of this.extraMats) m.dispose()
    this.extraMats = []
    const p = this.params!
    const spec = this.spec!
    const f = finishOf(spec.finish)
    this.faceMat?.dispose()
    this.bodyMat?.dispose()
    this.holeMat?.dispose()
    this.depthMat?.dispose()
    this.faceMat = metalMaterial(f)
    this.bodyMat = metalMaterial(f)
    this.bodyMat.side = THREE.DoubleSide
    this.holeMat = metalMaterial(f)
    this.holeMat.side = THREE.DoubleSide
    this.depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })

    const face = new THREE.Mesh(buildFaceGeometry(p, p.faceR < 6 ? 1536 : 2048), this.faceMat)
    face.castShadow = false
    face.receiveShadow = true
    this.button.add(face)
    // the shadow pass doesn't need 16 µm: a ~4× lighter proxy casts the face's
    // shadow (drawn invisibly in the main pass) — the full mesh was drawn twice
    const proxyMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })
    this.extraMats.push(proxyMat)
    const proxy = new THREE.Mesh(buildFaceGeometry(p, 1024, 0.035), proxyMat)
    proxy.castShadow = true
    proxy.customDepthMaterial = this.depthMat
    this.button.add(proxy)
    const { outer, inner } = buildBodyGeometries(p)
    const om = new THREE.Mesh(outer, this.bodyMat)
    om.castShadow = om.receiveShadow = true
    this.button.add(om)
    if (inner) {
      const im = new THREE.Mesh(inner, this.holeMat)
      im.castShadow = im.receiveShadow = true // or the key light leaks through the hole onto the ground
      this.button.add(im)
    }
    const dark = () => {
      // a bore sees nothing but the inside of the part: no studio reflection
      const m = new THREE.MeshPhysicalMaterial({ color: 0x0c0a08, metalness: 0.5, roughness: 0.8, side: THREE.DoubleSide, envMapIntensity: 0.05 })
      this.extraMats.push(m)
      return m
    }
    if (p.centre === 'hole') {
      const lipBottom = capGeometry(p).lip?.cy ?? baseProfile(p.centreR, p).y
      const { copper, bore } = buildPostGeometries(p.centreR, p.capH, lipBottom)
      // the post takes any cap finish, darkened for sitting down a pit (and
      // oxidised like a side wall on antiqued finishes)
      const pf = finishOf(this.spec!.postFinish)
      const ox = pf.patina.field * pf.patina.darken
      const pk = 0.75 * (1 - 0.6 * ox)
      const cmat = metalMaterial({ ...pf, color: [pf.color[0] * pk, pf.color[1] * pk, pf.color[2] * pk], roughness: Math.min(1, pf.roughness + 0.1) })
      cmat.side = THREE.DoubleSide
      cmat.envMapIntensity = 0.3 // down a pit: it sees mostly the inside of the cap
      this.extraMats.push(cmat)
      const cm = new THREE.Mesh(copper, cmat)
      cm.castShadow = cm.receiveShadow = true
      const bm = new THREE.Mesh(bore, dark())
      bm.castShadow = true
      this.button.add(cm, bm)
    } else if (p.centre === 'pin') {
      // the pin hole's floor: dark, just above the cap underside
      const floor = new THREE.Mesh(new THREE.CircleGeometry(p.centreR, 48), dark())
      floor.rotation.x = -Math.PI / 2
      floor.position.y = -p.capH + 0.02
      floor.castShadow = true
      this.button.add(floor)
    }

    // studio shot: a button stands on its shank (rivets lie on their backs)
    this.shankH = 0
    const back = STYLES[this.spec!.style].back
    if (back !== 'nail') {
      // bright-drawn steel: dark enough to shade as a cylinder, glossy enough to
      // streak with the studio's vertical highlights (not frosted plastic)
      const shankMat = metalMaterial({ ...METAL_FINISHES.steel, color: [0.45, 0.45, 0.46], roughness: 0.15 })
      this.extraMats.push(shankMat)
      const { geo, height } = buildShank(p.faceR, p.capH, back === 'swivel')
      const sm = new THREE.Mesh(geo, shankMat)
      sm.castShadow = sm.receiveShadow = true
      this.back.add(sm)
      this.shankH = height
    }
    // new materials: re-attach the current relief (setHeightField re-applies the finish)
    this.setHeightField(this.field)
  }

  private applyFinish(): void {
    const f = finishOf(this.spec!.finish)
    if (this.faceMat) {
      this.faceMat.color.setRGB(f.color[0], f.color[1], f.color[2])
      this.faceMat.roughness = f.roughness
    }
    if (this.bodyMat) {
      // the side wall isn't burnished like the face: duller, a shade darker, and
      // carrying the finish's field oxide (antiqued caps are dark down the sides)
      const ox = f.patina.field * f.patina.darken
      const k = 0.78 * (1 - 0.75 * ox)
      this.bodyMat.color.setRGB(f.color[0] * k, f.color[1] * k, f.color[2] * k)
      this.bodyMat.roughness = Math.min(1, f.roughness * 1.5 + 0.08 + 0.3 * ox)
      this.bodyMat.metalness = 1 - 0.6 * ox
    }
    if (this.holeMat) {
      this.holeMat.color.setRGB(f.color[0] * 0.7, f.color[1] * 0.7, f.color[2] * 0.7)
      this.holeMat.roughness = Math.min(1, f.roughness * 1.4)
      this.holeMat.envMapIntensity = 0.35 // it sees mostly the inside of the cap
    }
    if (this.faceMat && this.field) {
      this.applyPatina()
      this.faceMat.roughness = Math.min(1, f.roughness * ROUGH_HEADROOM)
      this.faceMat.aoMapIntensity = f.oxide
    }
  }

  /** (Re)compose the finish's look over the current field — ~tens of ms, no EDT. */
  private applyPatina(): void {
    const m = this.faceMat
    const field = this.field
    if (!m || !field) return
    const spec = this.spec!
    const look = {
      patina: finishOf(spec.finish).patina,
      // lasered art (whole design or individual layers) is located by the field's art mask
      lasered: true,
      distressed: spec.distressed,
      grain: finishOf(spec.finish).grain ?? 0,
    }
    const key = JSON.stringify(look)
    if (key === this.patinaKey && this.patinaTex.length > 0) return
    for (const t of this.patinaTex) t.dispose()
    const { surface, albedo } = finishMaps(field, look)
    const st = dataTexture(surface, field.n, THREE.RGBAFormat, THREE.UnsignedByteType, true)
    const at = dataTexture(albedo, field.n, THREE.RGBAFormat, THREE.UnsignedByteType, true)
    st.anisotropy = at.anisotropy = 8
    this.patinaTex = [st, at]
    this.patinaKey = key
    const first = !m.map
    m.map = at
    m.roughnessMap = st
    m.aoMap = st
    m.metalnessMap = st
    if (first) m.needsUpdate = true
  }

  setHeightField(field: HeightField | null): void {
    this.field = field
    for (const t of [...this.fieldTex, ...this.patinaTex]) t.dispose()
    this.fieldTex = []
    this.patinaTex = []
    this.patinaKey = ''
    const m = this.faceMat
    if (!m || !this.depthMat) return
    if (!field) {
      m.map = m.normalMap = m.roughnessMap = m.aoMap = m.metalnessMap = m.displacementMap = null
      this.depthMat.displacementMap = null
    } else {
      const disp = dataTexture(field.disp, field.dispN, THREE.RedFormat, THREE.FloatType, false)
      // float32 linear filtering isn't universal — nearest steps show as jagged
      // relief walls at the new strike depth, so filter wherever it's supported
      const lin = this.renderer.extensions.has('OES_texture_float_linear')
      disp.minFilter = disp.magFilter = lin ? THREE.LinearFilter : THREE.NearestFilter
      const normal = dataTexture(field.normal, field.n, THREE.RGBAFormat, THREE.HalfFloatType, true)
      normal.anisotropy = 8
      this.fieldTex = [disp, normal]
      m.map = null // applyFinish → applyPatina attaches the finish's maps
      m.normalMap = normal
      m.normalMapType = THREE.ObjectSpaceNormalMap
      m.displacementMap = disp
      m.displacementScale = 1
      this.depthMat.displacementMap = disp
      this.depthMat.displacementScale = 1
      this.depthMat.needsUpdate = true
    }
    m.needsUpdate = true
    this.applyFinish()
  }

  private applyLight(): void {
    const s = this.spec!
    // app convention: 0° = 12 o'clock (−Z), clockwise seen from above (+X at 90°)
    const az = s.lightDeg * DEG
    // studio: high, soft key like a product table's overhead light
    const studio = s.backdrop === 'studio'
    const el = (studio ? 64 : 48) * DEG
    this.key.shadow.intensity = studio ? 0.5 : 1
    this.key.intensity = 1.6
    const d = 60
    this.key.position.set(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, -Math.cos(az) * Math.cos(el) * d)
    this.key.target.position.set(0, 0, 0)
    const R = s.diameterMM / 2
    const cam = this.key.shadow.camera
    cam.left = cam.bottom = -R * 2.2
    cam.right = cam.top = R * 2.2
    cam.near = 1
    cam.far = 140
    cam.updateProjectionMatrix()
    // turn the studio with the key so reflections follow the light
    this.scene.environmentRotation.set(0, -az, 0)
  }

  private applyBackdrop(): void {
    const b = this.spec!.backdrop
    const p = this.params!
    const studio = b === 'studio'
    if (studio && !this.brightEnv) {
      const sc = studioScene(true)
      this.brightEnv = this.pmrem.fromScene(sc, 0.02).texture
      sc.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.geometry) m.geometry.dispose()
        ;(m.material as THREE.Material | undefined)?.dispose()
      })
    }
    this.scene.environment = studio ? this.brightEnv : this.envTex
    // nickel mustn't outshine the white sweep: dim what the metal mirrors in
    // the studio, and let the paper take more of it back
    this.scene.environmentIntensity = studio ? 0.5 : 1
    this.back.visible = studio
    // a button in the studio stands on its shank; everything else sits on its back
    const groundY = -p.capH - (studio ? this.shankH : 0)
    this.ground.position.y = groundY - 0.002
    this.contact.position.y = groundY + 0.004
    // studio: a soft grey pool under the shank, not a black pad
    const cs = studio && this.shankH > 0 ? p.faceR * 1.7 : p.faceR * 2.25
    this.contact.scale.set(cs, cs, 1)
    this.contact.material.opacity = studio ? 0.35 : 1
    this.ground.visible = b !== 'none'
    this.contact.visible = b !== 'none'
    if (b === 'none') return
    const m = this.ground.material
    if (studio) {
      // white paper sweep, like a supplier's product shot
      if (m.map) {
        m.map = null
        m.bumpMap = null
        m.needsUpdate = true
      }
      m.color.setRGB(1, 0.99, 0.97) // white paper: it must read brighter than satin nickel
      m.envMapIntensity = 2.3
      return
    }
    const { color, bump } = denimTextures(b)
    const reps = 160 / TILE_MM
    color.repeat.set(reps, reps)
    bump.repeat.set(reps, reps)
    m.color.setRGB(1, 1, 1)
    m.envMapIntensity = 0.35
    if (m.map !== color) {
      m.map = color
      m.bumpMap = bump
      m.needsUpdate = true
    }
  }

  /** Camera framing: the reference-photo three-quarter view, or straight down. */
  setPose(pose: Pose, aspect: number): void {
    const R = (this.spec?.diameterMM ?? 17) / 2
    const fit = (R * FRAME) / Math.min(1, aspect)
    const dist = fit / (2 * Math.tan((FOV * DEG) / 2))
    // studio: shot low like a supplier's product photo, so the shank shows
    // (a swivel shank is squat — shot lower still, as the supplier does, or the rim hides it)
    const swivel = this.spec ? STYLES[this.spec.style].back === 'swivel' : false
    const photoPolar = this.spec?.backdrop === 'studio' && this.shankH > 0 ? (swivel ? 72 : 62) : 34
    const polar = pose === 'photo' ? photoPolar * DEG : 0.0001
    const az = pose === 'photo' ? 20 * DEG : 0
    const studioLift = this.spec?.backdrop === 'studio' ? this.shankH : 0
    this.target.set(0, -(this.params?.capH ?? 1.15) * 0.25 - studioLift * 0.45, 0)
    this.camera.aspect = aspect
    this.camera.position.set(
      this.target.x + dist * Math.sin(polar) * Math.sin(az),
      this.target.y + dist * Math.cos(polar),
      this.target.z + dist * Math.sin(polar) * Math.cos(az),
    )
    this.camera.up.set(0, 1, 0)
    this.camera.lookAt(this.target)
    this.camera.updateProjectionMatrix()
  }

  /** Fit distance at the current aspect — for orbit zoom limits. */
  fitDistance(): number {
    const R = (this.spec?.diameterMM ?? 17) / 2
    return (R * FRAME) / Math.min(1, this.camera.aspect) / (2 * Math.tan((FOV * DEG) / 2))
  }

  render(): void {
    const b = this.spec?.backdrop
    this.renderer.setClearColor(b === 'studio' ? 0xe6e4e0 : 0x000000, b === 'none' ? 0 : 1)
    this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    for (const t of [...this.fieldTex, ...this.patinaTex]) t.dispose()
    this.button.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.geometry) m.geometry.dispose()
    })
    for (const m of this.extraMats) m.dispose()
    this.faceMat?.dispose()
    this.bodyMat?.dispose()
    this.holeMat?.dispose()
    this.depthMat?.dispose()
    this.ground.geometry.dispose()
    this.ground.material.dispose()
    this.contact.geometry.dispose()
    this.contact.material.map?.dispose()
    this.contact.material.dispose()
    this.envTex.dispose()
    this.brightEnv?.dispose()
    this.pmrem.dispose()
  }
}

/** The doc-level product fields a scene needs (light and backdrop come from the view). */
export function specOfDoc(d: {
  diameterMM: number
  holeDiameterMM: number
  product: Product
  style: ProductStyle
  material: Material
  logoDisplay: LogoDisplay
  distressed: boolean
  postFinish: Finish
  finish: Finish
}): Omit<ButtonSpec, 'lightDeg' | 'backdrop'> {
  return {
    diameterMM: d.diameterMM,
    holeDiameterMM: d.holeDiameterMM,
    product: d.product,
    style: d.style,
    material: d.material,
    logoDisplay: d.logoDisplay,
    distressed: d.distressed,
    postFinish: d.postFinish,
    finish: d.finish,
  }
}

/** Last interactive camera pose, so the PNG export frames what the user sees. */
export const lastPose: { position: THREE.Vector3 | null; target: THREE.Vector3 | null; pose: Pose } = {
  position: null,
  target: null,
  pose: 'photo',
}
