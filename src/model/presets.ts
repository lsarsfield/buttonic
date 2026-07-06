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
    localFonts: {},
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
        count: 140, rInnerMM: 1.3, rOuterMM: 3.6, strokeMM: 0.07, twistDeg: 0, cap: 'butt', capPointMM: 0.3, pointEnds: 'outer', sweepDeg: 360, repeats: 1,
      },
      {
        id: 'refA-sep1', type: 'ring', name: 'Separator 1', visible: true, phaseDeg: 0,
        mode: 'stroke', radiusMM: 3.7, strokeMM: 0.1, rInnerMM: 3.6, rOuterMM: 3.8,
      },
      {
        id: 'refA-band2', type: 'hatch', name: 'Band 2 · medium', visible: true, phaseDeg: 0,
        count: 220, rInnerMM: 3.8, rOuterMM: 5.4, strokeMM: 0.07, twistDeg: 0, cap: 'butt', capPointMM: 0.3, pointEnds: 'outer', sweepDeg: 360, repeats: 1,
      },
      {
        id: 'refA-sep2', type: 'ring', name: 'Separator 2', visible: true, phaseDeg: 0,
        mode: 'stroke', radiusMM: 5.5, strokeMM: 0.1, rInnerMM: 5.4, rOuterMM: 5.6,
      },
      {
        id: 'refA-band3', type: 'hatch', name: 'Band 3 · dense', visible: true, phaseDeg: 0,
        count: 300, rInnerMM: 5.6, rOuterMM: 7.4, strokeMM: 0.07, twistDeg: 0, cap: 'butt', capPointMM: 0.3, pointEnds: 'outer', sweepDeg: 360, repeats: 1,
      },
      {
        id: 'refA-sep3', type: 'ring', name: 'Separator 3', visible: true, phaseDeg: 0,
        mode: 'stroke', radiusMM: 7.5, strokeMM: 0.12, rInnerMM: 7.4, rOuterMM: 7.6,
      },
      {
        id: 'refA-outer', type: 'hatch', name: 'Outer reeding', visible: true, phaseDeg: 0,
        count: 360, rInnerMM: 7.65, rOuterMM: 8.15, strokeMM: 0.06, twistDeg: 0, cap: 'butt', capPointMM: 0.3, pointEnds: 'outer', sweepDeg: 360, repeats: 1,
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
        sourceType: 'glyph', text: 'F', fontId: 'garamond', assetId: null, motifId: 'star',
        sizeMM: 2.1, rotationDeg: 0, offsetXMM: 0, offsetYMM: 0,
        render: 'fill', strokeMM: 0.12, clearanceMM: 2.3,
        booleanRole: 'draw', haloMM: 0, haloMode: 'clear', haloStrokeMM: 0.1,
      },
    ],
    assets: {},
    localFonts: {},
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
        sourceType: 'glyph', text: 'D', fontId: 'unifraktur', assetId: null, motifId: 'star',
        sizeMM: 5.6, rotationDeg: 0, offsetXMM: 0, offsetYMM: 0,
        render: 'fill', strokeMM: 0.12, clearanceMM: 0,
        booleanRole: 'draw', haloMM: 0, haloMode: 'clear', haloStrokeMM: 0.1,
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
        cap: 'round', join: 'miter', booleanRole: 'draw',
      },
      {
        id: 'refB-rim', type: 'ring', name: 'Rim', visible: true, phaseDeg: 0,
        mode: 'stroke', radiusMM: 8.05, strokeMM: 0.12, rInnerMM: 7.95, rOuterMM: 8.15,
      },
    ],
    assets: {},
    localFonts: {},
  }
}

/** Flower Power — 1970s groovy: centre sunburst, daisy band, heart-divided text. */
export function presetGroovy(): ButtonDoc {
  return {
    version: DOC_VERSION,
    name: 'Flower power',
    diameterMM: 17,
    finish: 'brass',
    layers: [
      {
        id: 'groovy-hero', type: 'repeat', name: 'Sunburst', visible: true, phaseDeg: 0,
        source: { kind: 'builtin', motifId: 'sunburst' }, count: 1, radiusMM: 0, sizeMM: 3.2,
        align: 'radial-out', rotationOffsetDeg: 0, alternateFlip: false,
        rows: 1, rowGapMM: 0.8, staggerRow2: true, flipRow2: true, strokeMM: 0.18, cap: 'round', join: 'miter', booleanRole: 'draw',
      },
      {
        id: 'groovy-inner', type: 'ring', name: 'Inner ring', visible: true, phaseDeg: 0,
        mode: 'stroke', radiusMM: 3.9, strokeMM: 0.12, rInnerMM: 3.8, rOuterMM: 4.0,
      },
      {
        id: 'groovy-daisies', type: 'repeat', name: 'Daisy band', visible: true, phaseDeg: 0,
        source: { kind: 'builtin', motifId: 'daisy' }, count: 9, radiusMM: 5.4, sizeMM: 1.7,
        align: 'radial-out', rotationOffsetDeg: 0, alternateFlip: false,
        rows: 1, rowGapMM: 0.8, staggerRow2: true, flipRow2: true, strokeMM: 0.12, cap: 'round', join: 'miter', booleanRole: 'draw',
      },
      {
        id: 'groovy-sep', type: 'ring', name: 'Separator', visible: true, phaseDeg: 0,
        mode: 'stroke', radiusMM: 6.4, strokeMM: 0.1, rInnerMM: 6.3, rOuterMM: 6.5,
      },
      {
        id: 'groovy-text', type: 'ringText', name: 'Groovy text', visible: true, phaseDeg: 0,
        text: 'GROOVY', fontId: 'bebas', sizeMM: 1.6, radiusMM: 7.1, anchorDeg: 0, anchorAlign: 'center',
        letterSpacingMM: 0.3, direction: 'outward', mode: 'arc', useKerning: true, repeats: 2,
        dividerSource: { kind: 'builtin', motifId: 'heart' }, dividerSizeMM: 1.0, dividerStrokeMM: 0.12,
        booleanRole: 'draw', haloMM: 0, haloMode: 'clear', haloStrokeMM: 0.1,
      },
      {
        id: 'groovy-rim', type: 'ring', name: 'Rim', visible: true, phaseDeg: 0,
        mode: 'stroke', radiusMM: 8.3, strokeMM: 0.28, rInnerMM: 8.16, rOuterMM: 8.44,
      },
    ],
    assets: {},
    localFonts: {},
  }
}

/** Old Book — printer's ornaments: centre fleur-de-lis, laurel wreath, fleuron-divided text. */
export function presetOldBook(): ButtonDoc {
  return {
    version: DOC_VERSION,
    name: 'Old book',
    diameterMM: 17,
    finish: 'gunmetal',
    layers: [
      {
        id: 'oldbook-hero', type: 'repeat', name: 'Fleur-de-lis', visible: true, phaseDeg: 0,
        source: { kind: 'builtin', motifId: 'fleurdelis' }, count: 1, radiusMM: 0, sizeMM: 4.2,
        align: 'radial-out', rotationOffsetDeg: 0, alternateFlip: false,
        rows: 1, rowGapMM: 0.8, staggerRow2: true, flipRow2: true, strokeMM: 0.12, cap: 'round', join: 'miter', booleanRole: 'draw',
      },
      {
        id: 'oldbook-inner', type: 'ring', name: 'Inner ring', visible: true, phaseDeg: 0,
        mode: 'stroke', radiusMM: 3.9, strokeMM: 0.14, rInnerMM: 3.78, rOuterMM: 4.02,
      },
      {
        id: 'oldbook-wreath', type: 'repeat', name: 'Laurel wreath', visible: true, phaseDeg: 0,
        source: { kind: 'builtin', motifId: 'laurel' }, count: 24, radiusMM: 5.3, sizeMM: 1.15,
        align: 'radial-out', rotationOffsetDeg: 0, alternateFlip: false,
        rows: 1, rowGapMM: 0.8, staggerRow2: true, flipRow2: true, strokeMM: 0.1, cap: 'round', join: 'miter', booleanRole: 'draw',
      },
      {
        id: 'oldbook-sep', type: 'ring', name: 'Separator', visible: true, phaseDeg: 0,
        mode: 'stroke', radiusMM: 6.4, strokeMM: 0.1, rInnerMM: 6.3, rOuterMM: 6.5,
      },
      {
        id: 'oldbook-text', type: 'ringText', name: 'Ex libris', visible: true, phaseDeg: 0,
        text: 'EX LIBRIS', fontId: 'garamond', sizeMM: 1.5, radiusMM: 7.1, anchorDeg: 0, anchorAlign: 'center',
        letterSpacingMM: 0.2, direction: 'outward', mode: 'arc', useKerning: true, repeats: 2,
        dividerSource: { kind: 'builtin', motifId: 'fleuron' }, dividerSizeMM: 0.9, dividerStrokeMM: 0.12,
        booleanRole: 'draw', haloMM: 0, haloMode: 'clear', haloStrokeMM: 0.1,
      },
      {
        id: 'oldbook-rim', type: 'ring', name: 'Rim', visible: true, phaseDeg: 0,
        mode: 'stroke', radiusMM: 8.3, strokeMM: 0.26, rInnerMM: 8.17, rOuterMM: 8.43,
      },
    ],
    assets: {},
    localFonts: {},
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
  {
    id: 'groovy',
    name: 'Flower power',
    blurb: '1970s groovy: a sunburst centre, daisy band, and heart-divided text.',
    make: presetGroovy,
  },
  {
    id: 'oldBook',
    name: 'Old book',
    blurb: "Printer's ornaments: fleur-de-lis centre, laurel wreath, fleuron dividers.",
    make: presetOldBook,
  },
]
