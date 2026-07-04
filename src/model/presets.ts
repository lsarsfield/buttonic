import type { ButtonDoc } from './types'
import { DOC_VERSION } from './types'

/**
 * Starter templates. A and B recreate the user's two reference buttons and
 * double as the acceptance test (golden-snapshot compiled in tests).
 * Fixed layer ids keep snapshots and tutorials stable.
 */

export function presetBlank(): ButtonDoc {
  return {
    version: DOC_VERSION,
    name: 'Untitled button',
    diameterMM: 17,
    finish: 'steel',
    layers: [
      {
        id: 'blank-rim', type: 'ring', name: 'Rim', visible: true, phaseDeg: 0,
        mode: 'stroke', radiusMM: 8.2, strokeMM: 0.3, rInnerMM: 7.9, rOuterMM: 8.5,
      },
    ],
    assets: {},
  }
}

/** Reference A — "engine-turned": dense radial hatch bands, centre emblem with a clearance moat. */
export function presetReferenceA(): ButtonDoc {
  return {
    version: DOC_VERSION,
    name: 'Engine turned',
    diameterMM: 17,
    finish: 'gunmetal',
    layers: [
      {
        id: 'refA-band1', type: 'hatch', name: 'Band 1 · fine', visible: true, phaseDeg: 0,
        count: 140, rInnerMM: 1.3, rOuterMM: 3.6, strokeMM: 0.07, twistDeg: 0, cap: 'butt',
      },
      {
        id: 'refA-sep1', type: 'ring', name: 'Separator 1', visible: true, phaseDeg: 0,
        mode: 'stroke', radiusMM: 3.7, strokeMM: 0.1, rInnerMM: 3.6, rOuterMM: 3.8,
      },
      {
        id: 'refA-band2', type: 'hatch', name: 'Band 2 · medium', visible: true, phaseDeg: 0,
        count: 220, rInnerMM: 3.8, rOuterMM: 5.4, strokeMM: 0.07, twistDeg: 0, cap: 'butt',
      },
      {
        id: 'refA-sep2', type: 'ring', name: 'Separator 2', visible: true, phaseDeg: 0,
        mode: 'stroke', radiusMM: 5.5, strokeMM: 0.1, rInnerMM: 5.4, rOuterMM: 5.6,
      },
      {
        id: 'refA-band3', type: 'hatch', name: 'Band 3 · dense', visible: true, phaseDeg: 0,
        count: 300, rInnerMM: 5.6, rOuterMM: 7.4, strokeMM: 0.07, twistDeg: 0, cap: 'butt',
      },
      {
        id: 'refA-sep3', type: 'ring', name: 'Separator 3', visible: true, phaseDeg: 0,
        mode: 'stroke', radiusMM: 7.5, strokeMM: 0.12, rInnerMM: 7.4, rOuterMM: 7.6,
      },
      {
        id: 'refA-outer', type: 'hatch', name: 'Outer reeding', visible: true, phaseDeg: 0,
        count: 360, rInnerMM: 7.65, rOuterMM: 8.15, strokeMM: 0.06, twistDeg: 0, cap: 'butt',
      },
      {
        id: 'refA-rim', type: 'ring', name: 'Rim', visible: true, phaseDeg: 0,
        mode: 'stroke', radiusMM: 8.33, strokeMM: 0.28, rInnerMM: 8.2, rOuterMM: 8.46,
      },
      {
        id: 'refA-emblem-ring', type: 'ring', name: 'Emblem border', visible: true, phaseDeg: 0,
        mode: 'stroke', radiusMM: 1.9, strokeMM: 0.12, rInnerMM: 1.8, rOuterMM: 2.0,
      },
      {
        id: 'refA-emblem', type: 'center', name: 'Emblem', visible: true, phaseDeg: 0,
        sourceType: 'glyph', text: 'F', fontId: 'garamond', assetId: null,
        sizeMM: 2.1, rotationDeg: 0, offsetXMM: 0, offsetYMM: 0,
        render: 'fill', strokeMM: 0.12, clearanceMM: 2.3,
      },
    ],
    assets: {},
  }
}

/** Reference B — "monogram": blackletter D, circle border, herringbone chevron band. */
export function presetReferenceB(): ButtonDoc {
  return {
    version: DOC_VERSION,
    name: 'Blackletter monogram',
    diameterMM: 17,
    finish: 'steel',
    layers: [
      {
        id: 'refB-monogram', type: 'center', name: 'Monogram D', visible: true, phaseDeg: 0,
        sourceType: 'glyph', text: 'D', fontId: 'unifraktur', assetId: null,
        sizeMM: 5.6, rotationDeg: 0, offsetXMM: 0, offsetYMM: 0,
        render: 'fill', strokeMM: 0.12, clearanceMM: 0,
      },
      {
        id: 'refB-border', type: 'ring', name: 'Inner border', visible: true, phaseDeg: 0,
        mode: 'stroke', radiusMM: 4.3, strokeMM: 0.28, rInnerMM: 4.1, rOuterMM: 4.5,
      },
      {
        id: 'refB-band', type: 'repeat', name: 'Herringbone band', visible: true, phaseDeg: 0,
        source: { kind: 'builtin', motifId: 'chevron' }, count: 46, radiusMM: 6.55, sizeMM: 0.95,
        align: 'radial-out', rotationOffsetDeg: 0, alternateFlip: false,
        rows: 2, rowGapMM: 1.05, staggerRow2: true, flipRow2: true, strokeMM: 0.15,
      },
      {
        id: 'refB-rim', type: 'ring', name: 'Rim', visible: true, phaseDeg: 0,
        mode: 'stroke', radiusMM: 8.05, strokeMM: 0.12, rInnerMM: 7.95, rOuterMM: 8.15,
      },
    ],
    assets: {},
  }
}

export interface TemplateInfo {
  id: string
  name: string
  blurb: string
  make: () => ButtonDoc
}

export const TEMPLATES: TemplateInfo[] = [
  {
    id: 'blank',
    name: 'Blank button',
    blurb: 'A 17 mm blank with a rim ring — start from nothing.',
    make: presetBlank,
  },
  {
    id: 'referenceA',
    name: 'Engine turned',
    blurb: 'Guilloche-style radial hatch bands with a centre emblem and clearance moat.',
    make: presetReferenceA,
  },
  {
    id: 'referenceB',
    name: 'Blackletter monogram',
    blurb: 'Ornate blackletter D, circle border, herringbone chevron band.',
    make: presetReferenceB,
  },
]
