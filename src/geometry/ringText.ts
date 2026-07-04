import type { Font } from 'opentype.js'
import type { RingTextLayer } from '../model/types'
import { flattenSegs } from './flatten'
import { glyphPathD, opentypePathToSegs } from './glyphs'
import { rotateThenTranslate } from './mat2d'
import { polarToXY, RAD2DEG } from './polar'
import type { CompiledLayer } from './shapes'
import { fillPaint } from './shapes'
import { baselineWarp, subPathsToD, warpSubPaths } from './warp'

/**
 * Classic coin-style ring text: each glyph is placed by its advance midpoint
 * on the circular baseline and rotated tangent to it. Outward direction reads
 * left-to-right at the top of the button; inward flips each glyph 180° and
 * reverses the advance so text reads left-to-right at the bottom.
 */
export function compileRingText(
  layer: RingTextLayer,
  font: Font | null,
  toleranceMM = 0.01,
): CompiledLayer {
  if (!font) return { shapes: [], warnings: ['Loading font…'] }
  if (layer.text.length === 0) return { shapes: [], warnings: [] }

  const r = Math.max(0.1, layer.radiusMM)
  const scale = layer.sizeMM / font.unitsPerEm
  const glyphs = font.stringToGlyphs(layer.text)
  if (glyphs.length === 0) return { shapes: [], warnings: [] }

  const advanceMM = glyphs.map((g) => (g.advanceWidth ?? 0) * scale)
  const gapMM = glyphs.map((g, i) => {
    if (i === glyphs.length - 1) return 0
    const kern = layer.useKerning ? font.getKerningValue(g, glyphs[i + 1]!) * scale : 0
    return kern + layer.letterSpacingMM
  })

  const angleOf = (mm: number) => (mm / r) * RAD2DEG
  const totalMM = advanceMM.reduce((s, a) => s + a, 0) + gapMM.reduce((s, k) => s + k, 0)
  const totalArc = angleOf(totalMM)

  const warnings: string[] = []
  if (totalArc > 360) warnings.push(`Text spans ${totalArc.toFixed(0)}° — more than a full circle.`)
  if (layer.sizeMM > layer.radiusMM) warnings.push('Text size exceeds its radius — glyphs will collide.')

  const dir = layer.direction === 'outward' ? 1 : -1
  let cursor: number
  switch (layer.anchorAlign) {
    case 'start':
      cursor = layer.anchorDeg
      break
    case 'center':
      cursor = layer.anchorDeg - (dir * totalArc) / 2
      break
    case 'end':
      cursor = layer.anchorDeg - dir * totalArc
      break
  }

  const parts: string[] = []

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

  return {
    shapes: parts.length > 0 ? [{ kind: 'path', d: parts.join(' '), paint: fillPaint() }] : [],
    warnings,
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
