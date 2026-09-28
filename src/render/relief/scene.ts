import * as THREE from 'three'
import type { Finish } from '../../model/types'
import { makeDenim, TILE_MM, type DenimKind } from './denim'
import { COPPER, finishOf, type MetalFinish } from './finishes'
import { baseProfile, ROUGH_HEADROOM, RELIEF_DEFAULTS, type HeightField, type ReliefParams } from './heightField'

/**
 * The struck button as a three.js scene, in millimetres. three is Y-up; the
 * button face lies in the XZ plane and design (x, y-down) maps to (x, 0, y),
 * so looking straight down with screen-up = −Z shows the design as drawn.
 *
 * Parts: the face (a polar grid carrying the cap profile, displaced by the
 * design relief and shaded by the height field's object-space normals /
 * cavity maps), the lathed cap body (rolled edge, side wall, hole wall), the
 * copper tack post seen through a donut hole, and a denim ground with a soft
 * contact shadow. Lighting: a neutral room environment (PMREM) plus a warm
 * key light whose azimuth is the app's light angle (0° = 12 o'clock, cw).
 *
 * Shared by the interactive 3D stage and the PNG mockup export.
 */

export type Backdrop = DenimKind | 'none'
export type Pose = 'photo' | 'top'

export interface ButtonSpec {
  diameterMM: number
  holeDiameterMM: number
  finish: Finish
  lightDeg: number
  backdrop: Backdrop
}

/** Cap height from the ground to the flat face, mm. */
const CAP_H = 1.15
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

/** Radii for the face grid: dense enough for 0.05 mm art, extra samples on the rolled curves. */
function faceRadii(p: ReliefParams): number[] {
  const out: number[] = []
  const r0 = p.holeR > 0 ? p.holeR : 0
  const push = (r: number) => {
    if (out.length === 0 || r - out[out.length - 1]! > 1e-5) out.push(r)
  }
  // hole lip: angular samples of the quarter round
  const lipEnd = p.holeR > 0 ? p.holeR + p.holeRollMM : 0
  if (p.holeR > 0) {
    for (let k = 0; k <= 16; k++) push(p.holeR + p.holeRollMM * (1 - Math.cos((k / 16) * (Math.PI / 2))))
  } else push(r0)
  const shoulder = p.faceR - p.rollMM
  const step = 0.03
  const n = Math.max(1, Math.ceil((shoulder - lipEnd) / step))
  for (let k = 1; k <= n; k++) push(lipEnd + ((shoulder - lipEnd) * k) / n)
  for (let k = 1; k <= 24; k++) push(shoulder + p.rollMM * Math.sin((k / 24) * (Math.PI / 2)))
  return out
}

function buildFaceGeometry(p: ReliefParams, segments = 1024): THREE.BufferGeometry {
  const radii = faceRadii(p)
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

/** Cap body below the face: side wall + curled base, and the hole wall. */
function buildBodyGeometries(p: ReliefParams): THREE.BufferGeometry[] {
  const R = p.faceR
  const yEdge = baseProfile(R, p).y
  const curl = 0.5
  const outer: THREE.Vector2[] = [new THREE.Vector2(R, yEdge)]
  for (let k = 0; k <= 8; k++) {
    const a = (k / 8) * (Math.PI / 2)
    outer.push(new THREE.Vector2(R - curl + curl * Math.cos(a), -CAP_H + curl - curl * Math.sin(a)))
  }
  outer.push(new THREE.Vector2(p.holeR > 0 ? p.holeR : 0, -CAP_H))
  const geos = [new THREE.LatheGeometry(outer, 256)]
  if (p.holeR > 0) {
    const yLip = baseProfile(p.holeR, p).y
    geos.push(
      new THREE.LatheGeometry([new THREE.Vector2(p.holeR, -CAP_H), new THREE.Vector2(p.holeR, yLip)], 256),
    )
  }
  return geos
}

/** The flared copper tack post under a donut hole: flange floor, rolled lip, hollow bore. */
function buildPostGeometries(holeR: number): { copper: THREE.BufferGeometry; bore: THREE.BufferGeometry } {
  const h = holeR
  const lipR = 0.5 * h
  const tube = 0.1 * h
  const pts: THREE.Vector2[] = [new THREE.Vector2(h * 0.995, -0.95), new THREE.Vector2(lipR + tube * 1.6, -0.9)]
  // rolled lip: a half torus section from the outside over the top into the bore
  for (let k = 0; k <= 16; k++) {
    const a = Math.PI * (k / 16) // 0 = outer side, π = inner side
    pts.push(new THREE.Vector2(lipR + tube * Math.cos(a), -0.72 + tube * Math.sin(a)))
  }
  pts.push(new THREE.Vector2(lipR - tube * 1.05, -0.95))
  const copper = new THREE.LatheGeometry(pts, 128)
  const bore = new THREE.LatheGeometry(
    [new THREE.Vector2(lipR - tube * 1.05, -0.95), new THREE.Vector2(lipR - tube * 1.1, -2.2), new THREE.Vector2(0, -2.2)],
    96,
  )
  return { copper, bore }
}

/**
 * Product-photo studio for reflections: a dark room, a big key softbox (on
 * the key light's azimuth once rotated), an overhead diffuser that the face
 * mirrors at the photo angle, a cool strip fill opposite and a floor bounce.
 * Metals only look like metal when they have contrast to reflect — the stock
 * RoomEnvironment is evenly bright and made nickel read as porcelain.
 * Environment space: key at azimuth 0 = −Z.
 */
function studioScene(): THREE.Scene {
  const scene = new THREE.Scene()
  const room = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.025, 0.025, 0.028), side: THREE.BackSide }),
  )
  scene.add(room)
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
  panel(8, 30, 2.2, [0.9, 0.95, 1], 165, 16, 40) // cool strip fill
  panel(60, 20, 0.35, [1, 0.98, 0.95], 90, -8, 40) // low bounce card
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
  data: Uint8Array | Float32Array,
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
  private readonly key = new THREE.DirectionalLight(0xfffaf2, 1.6)
  private readonly button = new THREE.Group()
  private readonly ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>
  private readonly contact: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>

  private faceMat: THREE.MeshPhysicalMaterial | null = null
  private bodyMat: THREE.MeshPhysicalMaterial | null = null
  /** The hole wall sits in its own shadow — darker, rougher than the face. */
  private holeMat: THREE.MeshPhysicalMaterial | null = null
  private depthMat: THREE.MeshDepthMaterial | null = null
  private field: HeightField | null = null
  private fieldTex: THREE.Texture[] = []
  private geoKey = ''
  private spec: ButtonSpec | null = null

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
    this.ground.position.y = -CAP_H - 0.002
    this.ground.receiveShadow = true
    this.contact = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false }),
    )
    this.contact.rotation.x = -Math.PI / 2
    this.contact.position.y = -CAP_H + 0.004
    this.contact.renderOrder = 1
    this.scene.add(this.ground, this.contact, this.button)
  }

  private params(): ReliefParams {
    const s = this.spec!
    return {
      relief: 'raised',
      faceR: s.diameterMM / 2,
      holeR: s.holeDiameterMM / 2,
      ...RELIEF_DEFAULTS,
    }
  }

  setSpec(spec: ButtonSpec): void {
    const prev = this.spec
    this.spec = spec
    const geoKey = `${spec.diameterMM}|${spec.holeDiameterMM}`
    if (geoKey !== this.geoKey) {
      this.geoKey = geoKey
      this.rebuildButton()
    } else if (!prev || prev.finish !== spec.finish) {
      this.applyFinish()
    }
    this.applyLight()
    this.applyBackdrop()
  }

  private rebuildButton(): void {
    for (const child of [...this.button.children]) {
      this.button.remove(child)
      ;(child as THREE.Mesh).geometry.dispose()
    }
    const p = this.params()
    const f = finishOf(this.spec!.finish)
    this.faceMat?.dispose()
    this.bodyMat?.dispose()
    this.holeMat?.dispose()
    this.depthMat?.dispose()
    this.faceMat = metalMaterial(f)
    this.bodyMat = metalMaterial(f)
    this.holeMat = metalMaterial(f)
    this.holeMat.side = THREE.DoubleSide
    this.depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })

    const face = new THREE.Mesh(buildFaceGeometry(p), this.faceMat)
    face.castShadow = true
    face.receiveShadow = true
    face.customDepthMaterial = this.depthMat
    this.button.add(face)
    buildBodyGeometries(p).forEach((g, k) => {
      const m = new THREE.Mesh(g, k === 0 ? this.bodyMat! : this.holeMat!)
      this.bodyMat!.side = THREE.DoubleSide
      m.castShadow = true
      m.receiveShadow = true
      this.button.add(m)
    })
    if (p.holeR > 0) {
      const { copper, bore } = buildPostGeometries(p.holeR)
      const cm = new THREE.Mesh(copper, metalMaterial(COPPER))
      const cmat = cm.material as THREE.MeshPhysicalMaterial
      cmat.side = THREE.DoubleSide
      cmat.envMapIntensity = 0.4 // down a pit: it sees mostly the inside of the cap
      cm.receiveShadow = true
      const bm = new THREE.Mesh(
        bore,
        new THREE.MeshPhysicalMaterial({ color: 0x2a1a12, metalness: 0.6, roughness: 0.7, side: THREE.DoubleSide }),
      )
      this.button.add(cm, bm)
    }
    this.contact.scale.set(p.faceR * 2.25, p.faceR * 2.25, 1)
    // new materials: re-attach the current relief (setHeightField re-applies the finish)
    this.setHeightField(this.field)
  }

  private applyFinish(): void {
    const f = finishOf(this.spec!.finish)
    for (const m of [this.faceMat, this.bodyMat]) {
      if (!m) continue
      m.color.setRGB(f.color[0], f.color[1], f.color[2])
      m.roughness = f.roughness
    }
    if (this.holeMat) {
      this.holeMat.color.setRGB(f.color[0] * 0.5, f.color[1] * 0.5, f.color[2] * 0.5)
      this.holeMat.roughness = Math.min(1, f.roughness * 1.6)
      this.holeMat.envMapIntensity = 0.12 // it sees mostly the inside of the cap
    }
    if (this.faceMat && this.field) {
      this.faceMat.roughness = Math.min(1, f.roughness * ROUGH_HEADROOM)
      this.faceMat.aoMapIntensity = f.oxide
    }
  }

  setHeightField(field: HeightField | null): void {
    this.field = field
    for (const t of this.fieldTex) t.dispose()
    this.fieldTex = []
    const m = this.faceMat
    if (!m || !this.depthMat) return
    if (!field) {
      m.map = m.normalMap = m.roughnessMap = m.aoMap = m.displacementMap = null
      this.depthMat.displacementMap = null
    } else {
      const disp = dataTexture(field.disp, field.dispN, THREE.RedFormat, THREE.FloatType, false)
      disp.minFilter = disp.magFilter = THREE.NearestFilter // float32 linear filtering isn't universal
      const normal = dataTexture(field.normal, field.n, THREE.RGBAFormat, THREE.UnsignedByteType, true)
      const surface = dataTexture(field.surface, field.n, THREE.RGBAFormat, THREE.UnsignedByteType, true)
      const albedo = dataTexture(field.albedo, field.n, THREE.RGBAFormat, THREE.UnsignedByteType, true)
      for (const t of [normal, surface, albedo]) t.anisotropy = 8
      this.fieldTex = [disp, normal, surface, albedo]
      m.map = albedo
      m.normalMap = normal
      m.normalMapType = THREE.ObjectSpaceNormalMap
      m.roughnessMap = surface
      m.aoMap = surface
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
    const el = 48 * DEG
    const d = 60
    this.key.position.set(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, -Math.cos(az) * Math.cos(el) * d)
    this.key.target.position.set(0, 0, 0)
    const R = s.diameterMM / 2
    const cam = this.key.shadow.camera
    cam.left = cam.bottom = -R * 1.8
    cam.right = cam.top = R * 1.8
    cam.near = 1
    cam.far = 140
    cam.updateProjectionMatrix()
    // turn the studio with the key so reflections follow the light
    this.scene.environmentRotation.set(0, -az, 0)
  }

  private applyBackdrop(): void {
    const b = this.spec!.backdrop
    this.ground.visible = b !== 'none'
    this.contact.visible = b !== 'none'
    if (b === 'none') return
    const { color, bump } = denimTextures(b)
    const reps = 160 / TILE_MM
    color.repeat.set(reps, reps)
    bump.repeat.set(reps, reps)
    const m = this.ground.material
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
    const polar = pose === 'photo' ? 34 * DEG : 0.0001
    const az = pose === 'photo' ? 20 * DEG : 0
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
    const transparent = this.spec?.backdrop === 'none'
    this.renderer.setClearColor(0x000000, transparent ? 0 : 1)
    this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    for (const t of this.fieldTex) t.dispose()
    this.button.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.geometry) m.geometry.dispose()
    })
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
    this.pmrem.dispose()
  }
}

/** Last interactive camera pose, so the PNG export frames what the user sees. */
export const lastPose: { position: THREE.Vector3 | null; target: THREE.Vector3 | null; pose: Pose } = {
  position: null,
  target: null,
  pose: 'photo',
}
