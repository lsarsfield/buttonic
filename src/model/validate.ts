import type { Asset, ButtonDoc, Layer, LayerType } from './types'
import { LAYER_TYPE_LABELS } from './types'

export type ValidationResult =
  | { ok: true; doc: ButtonDoc }
  | { ok: false; error: string }

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isBool = (v: unknown): v is boolean => typeof v === 'boolean'

const LAYER_TYPES = Object.keys(LAYER_TYPE_LABELS) as LayerType[]

/**
 * Per-type required fields beyond the common base. Values are checked by kind:
 * n = finite number, s = string, b = boolean. Enum and union fields are
 * spot-checked separately where getting them wrong would crash a compiler.
 */
const REQUIRED: Record<LayerType, Record<string, 'n' | 's' | 'b'>> = {
  ring: { radiusMM: 'n', strokeMM: 'n', rInnerMM: 'n', rOuterMM: 'n', mode: 's' },
  hatch: { count: 'n', rInnerMM: 'n', rOuterMM: 'n', strokeMM: 'n', twistDeg: 'n', cap: 's' },
  repeat: {
    count: 'n', radiusMM: 'n', sizeMM: 'n', align: 's', rotationOffsetDeg: 'n',
    alternateFlip: 'b', rows: 'n', rowGapMM: 'n', staggerRow2: 'b', flipRow2: 'b', strokeMM: 'n',
  },
  ringText: {
    text: 's', fontId: 's', sizeMM: 'n', radiusMM: 'n', anchorDeg: 'n', anchorAlign: 's',
    letterSpacingMM: 'n', direction: 's', mode: 's', useKerning: 'b',
  },
  center: {
    sourceType: 's', text: 's', fontId: 's', sizeMM: 'n', rotationDeg: 'n',
    offsetXMM: 'n', offsetYMM: 'n', render: 's', strokeMM: 'n', clearanceMM: 'n',
  },
  bend: {
    rInnerMM: 'n', rOuterMM: 'n', startDeg: 'n', sweepMode: 's', sweepDeg: 'n',
    repeat: 'n', gapDeg: 'n', flipRadial: 'b', alternateMirror: 'b', strokeHandling: 's', strokeMM: 'n',
  },
}

function checkLayer(value: unknown, index: number): string | null {
  if (!isObj(value)) return `layer ${index} is not an object`
  const type = value.type
  if (!isStr(type) || !(LAYER_TYPES as string[]).includes(type)) {
    return `layer ${index} has unknown type "${String(type)}"`
  }
  if (!isStr(value.id) || value.id.length === 0) return `layer ${index} is missing an id`
  if (!isStr(value.name)) return `layer ${index} is missing a name`
  if (!isBool(value.visible)) return `layer ${index} ("${value.name}") is missing "visible"`
  if (!isNum(value.phaseDeg)) return `layer ${index} ("${value.name}") is missing "phaseDeg"`

  const required = REQUIRED[type as LayerType]
  for (const [field, kind] of Object.entries(required)) {
    const v = value[field]
    const ok = kind === 'n' ? isNum(v) : kind === 's' ? isStr(v) : isBool(v)
    if (!ok) return `layer ${index} ("${value.name}", ${type}) has a missing or invalid "${field}"`
  }

  if (type === 'repeat') {
    const src = value.source
    if (!isObj(src) || (src.kind !== 'builtin' && src.kind !== 'asset')) {
      return `layer ${index} ("${value.name}") has an invalid motif source`
    }
  }
  return null
}

function checkAsset(id: string, value: unknown): string | null {
  if (!isObj(value)) return `asset "${id}" is not an object`
  if (value.kind !== 'svg' && value.kind !== 'font') return `asset "${id}" has an unknown kind`
  if (!isStr(value.name) || !isStr(value.dataBase64)) return `asset "${id}" is malformed`
  return null
}

/**
 * Structural validation of an untrusted parsed JSON value. Deliberately
 * hand-rolled (no schema library): checks everything a compiler or renderer
 * would crash on, tolerates unknown extra fields so newer docs degrade softly.
 */
export function validateDoc(value: unknown): ValidationResult {
  if (!isObj(value)) return { ok: false, error: 'document is not an object' }
  if (!isNum(value.version)) return { ok: false, error: 'document has no version number' }
  if (!isStr(value.name)) return { ok: false, error: 'document has no name' }
  if (!isNum(value.diameterMM) || value.diameterMM <= 0) {
    return { ok: false, error: 'document has an invalid diameter' }
  }
  if (!isStr(value.finish)) return { ok: false, error: 'document has no finish' }
  if (!Array.isArray(value.layers)) return { ok: false, error: 'document has no layer list' }

  const seen = new Set<string>()
  for (let i = 0; i < value.layers.length; i++) {
    const err = checkLayer(value.layers[i], i)
    if (err) return { ok: false, error: err }
    const id = (value.layers[i] as Layer).id
    if (seen.has(id)) return { ok: false, error: `duplicate layer id "${id}"` }
    seen.add(id)
  }

  const assets = value.assets ?? {}
  if (!isObj(assets)) return { ok: false, error: 'document assets are malformed' }
  for (const [id, asset] of Object.entries(assets)) {
    const err = checkAsset(id, asset)
    if (err) return { ok: false, error: err }
  }

  return {
    ok: true,
    doc: {
      version: value.version,
      name: value.name,
      diameterMM: value.diameterMM,
      finish: value.finish as ButtonDoc['finish'],
      layers: value.layers as Layer[],
      assets: assets as Record<string, Asset>,
    },
  }
}
