import type { Font } from 'opentype.js'
import type { RingTextLayer } from '../model/types'
import { flattenSegs } from './flatten'
import { glyphPathD, opentypePathToSegs } from './glyphs'
import { rotateThenTranslate } from './mat2d'
import { getBuiltinMotif } from './motifs/builtins'
import { polarToXY, RAD2DEG } from './polar'
import type { ParsedSvgAsset, UnitMotifPath } from './svgAsset'
import { assetToUnitMotif } from './svgAsset'
import type { CompiledLayer, InstanceTransform, Shape } from './shapes'
import { fillPaint, strokePaint } from './shapes'
import { baselineWarp, subPathsToD, warpSubPaths } from './warp'

/**
 * Classic coin-style ring text: each glyph is placed by its advance midpoint
 * on the circular baseline and rotated tangent to it. Outward direction reads
 * left-to-right at the top of the button; inward flips each glyph 180° and
 * reverses the advance so text reads left-to-right at the bottom.
 *
 * Symmetric layouts: the whole run is placed `repeats` times at exact 360/N
 * anchors (the lower runs keep ring orientation — the vintage stamp look),
 * with an optional divider motif at the midpoints between runs. Dividers are
 * font-independent: they render even while a font is loading or missing.
 */
export function compileRingText(
  layer: RingTextLayer,
  font: Font | null,
  toleranceMM = 0.01,
  getSvgAsset: (assetId: string) => ParsedSvgAsset | null = () => null,
): CompiledLayer {
  const warnings: string[] = []
  const shapes: Shape[] = []
  const repeats = Math.max(1, Math.round(layer.repeats))
  const r = Math.max(0.1, layer.radiusMM)
  const dir = layer.direction === 'outward' ? 1 : -1

  if (!font) {
    // dividers are font-independent; without metrics they assume centred runs
    compileDividers(layer, repeats, r, dir, 0, getSvgAsset, shapes, warnings)
    warnings.push('Font unavailable — text not rendered (loading, or a missing local font).')
    return { shapes, warnings }
  }

  const scale = layer.sizeMM / font.unitsPerEm
  const glyphs = layer.text.length > 0 ? font.stringToGlyphs(layer.text) : []

  const advanceMM = glyphs.map((g) => (g.advanceWidth ?? 0) * scale)
  const gapMM = glyphs.map((g, i) => {
    if (i === glyphs.length - 1) return 0
    const kern = layer.useKerning ? font.getKerningValue(g, glyphs[i + 1]!) * scale : 0
    return kern + layer.letterSpacingMM
  })

  const angleOf = (mm: number) => (mm / r) * RAD2DEG
  const totalMM = advanceMM.reduce((s, a) => s + a, 0) + gapMM.reduce((s, k) => s + k, 0)
  const totalArc = angleOf(totalMM)

  // Dividers sit midway between RUN CENTRES. Start/End alignment shifts every
  // run centre off its anchor by ±totalArc/2 — dividers must follow, or they
  // land near the end of each run instead of the middle of the gap.
  const alignShift =
    layer.anchorAlign === 'start'
      ? (dir * totalArc) / 2
      : layer.anchorAlign === 'end'
        ? (-dir * totalArc) / 2
        : 0
  compileDividers(layer, repeats, r, dir, alignShift, getSvgAsset, shapes, warnings)
  if (glyphs.length === 0) return { shapes, warnings }

  if (totalArc * repeats > 360) {
    warnings.push(
      repeats > 1
        ? `${repeats} repeats of this text span ${(totalArc * repeats).toFixed(0)}° — runs overlap.`
        : `Text spans ${totalArc.toFixed(0)}° — more than a full circle.`,
    )
  }
  if (layer.sizeMM > layer.radiusMM) warnings.push('Text size exceeds its radius — glyphs will collide.')

  const parts: string[] = []
  for (let run = 0; run < repeats; run++) {
    // exact multiples — no accumulation drift between runs
    const anchor = layer.anchorDeg + (run * 360) / repeats
    let cursor: number
    switch (layer.anchorAlign) {
      case 'start':
        cursor = anchor
        break
      case 'center':
        cursor = anchor - (dir * totalArc) / 2
        break
      case 'end':
        cursor = anchor - dir * totalArc
        break
    }

    if (layer.mode === 'warp') {
      // Warp mode: lay glyphs on a straight baseline, then bend the outlines
      // through the baseline warp — glyph stems genuinely curve.
      const warpFn = baselineWarp(r, cursor, layer.direction)
      let xMM = 0
      for (let i = 0; i < glyphs.length; i++) {
        const glyph = glyphs[i]!
        const segs = opentypePathToSegs(glyph.getPath(xMM, 0, layer.sizeMM))
        const subs = warpSubPaths(flattenSegs(segs, toleranceMM), warpFn, toleranceMM)
        const d = subPathsToD(subs)
        if (d.length > 0) parts.push(d)
        xMM += advanceMM[i]! + gapMM[i]!
      }
    } else {
      for (let i = 0; i < glyphs.length; i++) {
        const glyph = glyphs[i]!
        const w = angleOf(advanceMM[i]!)
        const thetaCenter = cursor + (dir * w) / 2
        const rotationDeg = thetaCenter + (dir === 1 ? 0 : 180)
        const pos = polarToXY(thetaCenter, r)
        // glyph drawn with its advance midpoint at the origin, baseline at y=0
        const path = glyph.getPath(-advanceMM[i]! / 2, 0, layer.sizeMM)
        const d = glyphPathD(path, rotateThenTranslate(rotationDeg, pos.x, pos.y))
        if (d.length > 0) parts.push(d)
        cursor += dir * (w + angleOf(gapMM[i]!))
      }
    }
  }

  if (parts.length > 0) shapes.push({ kind: 'path', d: parts.join(' '), paint: fillPaint() })
  return { shapes, warnings }
}

/**
 * Divider motifs at the midpoints between runs, vertically centred on the
 * text's optical middle (baseline + ~0.32 em toward the glyph bodies).
 */
function compileDividers(
  layer: RingTextLayer,
  repeats: number,
  r: number,
  dir: number,
  alignShiftDeg: number,
  getSvgAsset: (assetId: string) => ParsedSvgAsset | null,
  shapes: Shape[],
  warnings: string[],
): void {
  if (!layer.dividerSource || layer.dividerSizeMM <= 0) return

  let motifPaths: UnitMotifPath[]
  if (layer.dividerSource.kind === 'asset') {
    const asset = getSvgAsset(layer.dividerSource.assetId)
    if (!asset) {
      warnings.push('Parsing divider SVG…')
      return
    }
    motifPaths = assetToUnitMotif(asset)
    if (motifPaths.length === 0) {
      warnings.push('The divider SVG contains no drawable geometry.')
      return
    }
  } else {
    const motif = getBuiltinMotif(layer.dividerSource.motifId)
    if (!motif) {
      warnings.push(`Unknown divider motif "${layer.dividerSource.motifId}".`)
      return
    }
    motifPaths = [{ d: motif.d, paintType: motif.paintType }]
  }

  const dividerR = r + dir * 0.32 * layer.sizeMM
  const transforms: InstanceTransform[] = Array.from({ length: repeats }, (_, k) => ({
    rotateDeg: layer.anchorDeg + alignShiftDeg + ((k + 0.5) * 360) / repeats,
    dx: 0,
    dy: 0,
    mirrorX: false,
  }))

  for (const mp of motifPaths) {
    shapes.push({
      kind: 'instanced',
      def: {
        d: mp.d,
        dx: 0,
        dy: -dividerR,
        rotateDeg: 0,
        scale: Math.max(0.01, layer.dividerSizeMM),
        flipY: 1,
      },
      paint: mp.paintType === 'fill' ? fillPaint() : strokePaint(layer.dividerStrokeMM, 'round'),
      transforms,
    })
  }
}

/** Layout metadata used by tests and (later) warp-mode text. */
export function ringTextArcDeg(layer: RingTextLayer, font: Font): number {
  const scale = layer.sizeMM / font.unitsPerEm
  const glyphs = font.stringToGlyphs(layer.text)
  let mm = 0
  for (let i = 0; i < glyphs.length; i++) {
    mm += (glyphs[i]!.advanceWidth ?? 0) * scale
    if (i < glyphs.length - 1) {
      mm += layer.letterSpacingMM
      if (layer.useKerning) mm += font.getKerningValue(glyphs[i]!, glyphs[i + 1]!) * scale
    }
  }
  return (mm / Math.max(0.1, layer.radiusMM)) * RAD2DEG
}
