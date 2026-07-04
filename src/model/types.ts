/**
 * Button Engraver document model.
 *
 * A ButtonDoc is the single source of truth: a button diameter plus an ordered
 * stack of parametric ring layers, every one computed from the centre axis
 * outward. Array order is paint order (later layers draw on top); presets are
 * authored centre → rim.
 *
 * All lengths are millimetres. All angles are degrees, 0° at 12 o'clock,
 * positive clockwise on screen (see geometry/polar.ts).
 */

export type AssetId = string
export type LayerId = string
export type FontId = string

export const DOC_VERSION = 1

export type AssetKind = 'svg' | 'font'

export interface Asset {
  kind: AssetKind
  name: string
  /** Raw file bytes, base64 — kept in the doc so project JSON is portable. */
  dataBase64: string
}

export type Finish = 'gunmetal' | 'steel' | 'brass'

export interface ButtonDoc {
  version: number
  name: string
  diameterMM: number
  /** Metal preview finish; has no effect on exported geometry. */
  finish: Finish
  layers: Layer[]
  assets: Record<AssetId, Asset>
}

/** Fields shared by every layer type. */
export interface LayerBase {
  id: LayerId
  name: string
  visible: boolean
  /** Whole-ring rotation, applied at render time — never part of compiled geometry. */
  phaseDeg: number
}

/** Circle stroke or filled annulus: borders, rims, grooves. */
export interface RingLayer extends LayerBase {
  type: 'ring'
  mode: 'stroke' | 'annulus'
  /** stroke mode */
  radiusMM: number
  strokeMM: number
  /** annulus mode */
  rInnerMM: number
  rOuterMM: number
}

/** N radial tick lines between two radii — reeding / engine-turned texture. */
export interface HatchLayer extends LayerBase {
  type: 'hatch'
  count: number
  rInnerMM: number
  rOuterMM: number
  strokeMM: number
  /** Outer endpoint is skewed by this many degrees relative to the inner one. */
  twistDeg: number
  cap: 'butt' | 'round'
}

export type MotifSource =
  | { kind: 'builtin'; motifId: string }
  | { kind: 'asset'; assetId: AssetId }

export type RepeatAlign = 'radial-out' | 'radial-in' | 'upright' | 'custom'

/** A motif instanced N times around the axis. */
export interface RepeatLayer extends LayerBase {
  type: 'repeat'
  source: MotifSource
  count: number
  /** Centre of the motif for row 1. */
  radiusMM: number
  /** Motif height in mm; width follows the motif's aspect ratio. */
  sizeMM: number
  align: RepeatAlign
  /** Added to the computed alignment rotation (the only rotation when align = custom). */
  rotationOffsetDeg: number
  /** Mirror every second instance. */
  alternateFlip: boolean
  rows: 1 | 2
  /** Radial distance between row centres (rows = 2). */
  rowGapMM: number
  /** Offset row 2 by half an instance step. */
  staggerRow2: boolean
  /** Radially mirror row 2 (chevrons pointing the other way = herringbone). */
  flipRow2: boolean
  /** Stroke width for stroke-type motifs. */
  strokeMM: number
}

/** Text set on a circular baseline as real glyph outlines. */
export interface RingTextLayer extends LayerBase {
  type: 'ringText'
  text: string
  fontId: FontId
  /** Em size. */
  sizeMM: number
  /** Baseline radius. */
  radiusMM: number
  anchorDeg: number
  anchorAlign: 'start' | 'center' | 'end'
  letterSpacingMM: number
  /** outward = readable at the top of the button; inward = readable at the bottom. */
  direction: 'outward' | 'inward'
  /** arc = classic per-glyph placement (coins); warp = glyph outlines bent through the polar warp. */
  mode: 'arc' | 'warp'
  useKerning: boolean
}

/** Monogram glyph or SVG asset placed at the axis. */
export interface CenterLayer extends LayerBase {
  type: 'center'
  sourceType: 'glyph' | 'asset'
  /** glyph source */
  text: string
  fontId: FontId
  /** asset source */
  assetId: AssetId | null
  sizeMM: number
  rotationDeg: number
  offsetXMM: number
  offsetYMM: number
  render: 'fill' | 'stroke'
  strokeMM: number
  /** > 0 clips line geometry of layers below inside this disc radius (the die "moat"). */
  clearanceMM: number
}

/** Arbitrary SVG warped into an annulus band — bbox x → angle, bbox y → radius. */
export interface BendLayer extends LayerBase {
  type: 'bend'
  assetId: AssetId | null
  rInnerMM: number
  rOuterMM: number
  startDeg: number
  /** auto = sweep chosen so the art is undistorted at mid-radius. */
  sweepMode: 'fixed' | 'auto'
  sweepDeg: number
  repeat: number
  /** Angular gap between repeats. */
  gapDeg: number
  /** Swap the radial mapping so the top of the art faces the centre (bottom-of-button placement). */
  flipRadial: boolean
  /** Mirror every second repeat. */
  alternateMirror: boolean
  strokeHandling: 'auto' | 'centerline' | 'outline'
  strokeMM: number
}

export type Layer =
  | RingLayer
  | HatchLayer
  | RepeatLayer
  | RingTextLayer
  | CenterLayer
  | BendLayer

export type LayerType = Layer['type']

export const LAYER_TYPE_LABELS: Record<LayerType, string> = {
  ring: 'Ring',
  hatch: 'Hatch',
  repeat: 'Repeat',
  ringText: 'Ring text',
  center: 'Centre',
  bend: 'Bend SVG',
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

export function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c?.randomUUID) return c.randomUUID()
  return 'id-' + Math.random().toString(36).slice(2, 12)
}

export function makeRingLayer(patch: Partial<RingLayer> = {}): RingLayer {
  return {
    id: newId(),
    type: 'ring',
    name: 'Ring',
    visible: true,
    phaseDeg: 0,
    mode: 'stroke',
    radiusMM: 8.2,
    strokeMM: 0.15,
    rInnerMM: 7.9,
    rOuterMM: 8.5,
    ...patch,
  }
}

export function makeHatchLayer(patch: Partial<HatchLayer> = {}): HatchLayer {
  return {
    id: newId(),
    type: 'hatch',
    name: 'Hatch',
    visible: true,
    phaseDeg: 0,
    count: 180,
    rInnerMM: 4,
    rOuterMM: 8,
    strokeMM: 0.08,
    twistDeg: 0,
    cap: 'butt',
    ...patch,
  }
}

export function makeRepeatLayer(patch: Partial<RepeatLayer> = {}): RepeatLayer {
  return {
    id: newId(),
    type: 'repeat',
    name: 'Repeat',
    visible: true,
    phaseDeg: 0,
    source: { kind: 'builtin', motifId: 'chevron' },
    count: 48,
    radiusMM: 6.5,
    sizeMM: 0.9,
    align: 'radial-out',
    rotationOffsetDeg: 0,
    alternateFlip: false,
    rows: 1,
    rowGapMM: 0.8,
    staggerRow2: true,
    flipRow2: true,
    strokeMM: 0.12,
    ...patch,
  }
}

export function makeRingTextLayer(patch: Partial<RingTextLayer> = {}): RingTextLayer {
  return {
    id: newId(),
    type: 'ringText',
    name: 'Ring text',
    visible: true,
    phaseDeg: 0,
    text: 'SPECIMEN',
    fontId: 'cinzel',
    sizeMM: 1.8,
    radiusMM: 6.2,
    anchorDeg: 0,
    anchorAlign: 'center',
    letterSpacingMM: 0.15,
    direction: 'outward',
    mode: 'arc',
    useKerning: true,
    ...patch,
  }
}

export function makeCenterLayer(patch: Partial<CenterLayer> = {}): CenterLayer {
  return {
    id: newId(),
    type: 'center',
    name: 'Centre',
    visible: true,
    phaseDeg: 0,
    sourceType: 'glyph',
    text: 'D',
    fontId: 'unifraktur',
    assetId: null,
    sizeMM: 6,
    rotationDeg: 0,
    offsetXMM: 0,
    offsetYMM: 0,
    render: 'fill',
    strokeMM: 0.12,
    clearanceMM: 0,
    ...patch,
  }
}

export function makeBendLayer(patch: Partial<BendLayer> = {}): BendLayer {
  return {
    id: newId(),
    type: 'bend',
    name: 'Bend SVG',
    visible: true,
    phaseDeg: 0,
    assetId: null,
    rInnerMM: 5.5,
    rOuterMM: 7.5,
    startDeg: 300,
    sweepMode: 'fixed',
    sweepDeg: 120,
    repeat: 1,
    gapDeg: 0,
    flipRadial: false,
    alternateMirror: false,
    strokeHandling: 'auto',
    strokeMM: 0.1,
    ...patch,
  }
}

export const LAYER_FACTORIES: Record<LayerType, (patch?: never) => Layer> = {
  ring: makeRingLayer,
  hatch: makeHatchLayer,
  repeat: makeRepeatLayer,
  ringText: makeRingTextLayer,
  center: makeCenterLayer,
  bend: makeBendLayer,
}

export function makeBlankDoc(): ButtonDoc {
  return {
    version: DOC_VERSION,
    name: 'Untitled button',
    diameterMM: 17,
    finish: 'steel',
    layers: [makeRingLayer({ name: 'Rim', radiusMM: 8.2, strokeMM: 0.3 })],
    assets: {},
  }
}
