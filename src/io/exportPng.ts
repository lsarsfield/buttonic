import type { ButtonDoc } from '../model/types'
import { FINISHES } from '../render/MetalPreview'
import { polarToXY } from '../geometry/polar'
import { exportSvg } from './exportSvg'

/**
 * PNG mockups: rasterize a self-contained SVG (no CSS variables, no DOM
 * cloning) at a chosen pixel size. Metal mode re-creates the preview's plate
 * gradient + engrave filter inline so the PNG matches the on-screen look.
 */

export interface PngExportOptions {
  px: number
  mode: 'flat' | 'metal'
  lightDeg: number
  /** Flat mode: dark artwork on transparent (true) or light-on-dark plate (false). */
  transparent: boolean
}

export const DEFAULT_PNG_OPTIONS: PngExportOptions = {
  px: 2048,
  mode: 'metal',
  lightDeg: 315,
  transparent: false,
}

function metalWrap(doc: ButtonDoc, engravingMarkup: string, lightDeg: number): string {
  const R = doc.diameterMM / 2
  const pal = FINISHES[doc.finish]
  const pad = R * 0.04
  const view = R + pad
  const lightPos = polarToXY(lightDeg, R)
  const off = polarToXY(lightDeg, 0.07)
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-view} ${-view} ${2 * view} ${2 * view}">
<defs>
<linearGradient id="p" gradientUnits="userSpaceOnUse" x1="${lightPos.x}" y1="${lightPos.y}" x2="${-lightPos.x}" y2="${-lightPos.y}">
<stop offset="0%" stop-color="${pal.light}"/><stop offset="55%" stop-color="${pal.base}"/><stop offset="100%" stop-color="${pal.dark}"/>
</linearGradient>
<radialGradient id="s" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="${R}">
<stop offset="72%" stop-color="rgba(255,255,255,0)"/><stop offset="92%" stop-color="rgba(255,255,255,0.10)"/><stop offset="100%" stop-color="rgba(0,0,0,0.28)"/>
</radialGradient>
<filter id="g" filterUnits="userSpaceOnUse" x="${-view}" y="${-view}" width="${2 * view}" height="${2 * view}">
<feTurbulence type="fractalNoise" baseFrequency="${pal.brushed ? '0.012 1.1' : '0.9 0.9'}" numOctaves="2" seed="7" result="n"/>
<feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.6 0.6 0.6 0 0" result="m"/>
<feComposite in="m" in2="SourceAlpha" operator="in"/>
</filter>
<filter id="e" filterUnits="userSpaceOnUse" x="${-view}" y="${-view}" width="${2 * view}" height="${2 * view}">
<feGaussianBlur in="SourceAlpha" stdDeviation="0.035" result="soft"/>
<feOffset in="soft" dx="${off.x}" dy="${off.y}" result="sl"/>
<feComposite in="sl" in2="SourceAlpha" operator="in" result="is"/>
<feFlood flood-color="rgba(0,0,0,0.75)" result="sc"/>
<feComposite in="sc" in2="is" operator="in" result="ish"/>
<feOffset in="soft" dx="${-off.x * 1.2}" dy="${-off.y * 1.2}" result="sf"/>
<feComposite in="sf" in2="SourceAlpha" operator="out" result="rim"/>
<feFlood flood-color="${pal.glint}" result="gc"/>
<feComposite in="gc" in2="rim" operator="in" result="gr"/>
<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="ish"/><feMergeNode in="gr"/></feMerge>
</filter>
<clipPath id="face"><circle r="${R}"/></clipPath>
</defs>
<circle r="${R}" fill="url(#p)"/>
<circle r="${R}" filter="url(#g)" opacity="${pal.grainOpacity}"/>
<g clip-path="url(#face)" filter="url(#e)" style="color:${pal.engrave}">
${engravingMarkup}
</g>
<circle r="${R}" fill="url(#s)"/>
</svg>`
}

/** Pull the inner engraving group out of the die-file SVG and recolor it. */
function engravingGroupFrom(svgText: string, color: string): string {
  const m = svgText.match(/<g id="engraving"[\s\S]*<\/g>/)
  const inner = m ? m[0] : ''
  return inner.replace(/#000000/g, color)
}

export async function exportPng(doc: ButtonDoc, options: PngExportOptions): Promise<Blob> {
  const die = exportSvg(doc, { expandInstances: true, mirrorForDie: false, includeBlankOutline: false })

  let svgText: string
  if (options.mode === 'metal') {
    svgText = metalWrap(doc, engravingGroupFrom(die.svg, 'currentColor'), options.lightDeg)
  } else {
    const R = doc.diameterMM / 2
    const color = options.transparent ? '#101114' : '#e9e7df'
    const plate = options.transparent ? '' : `<circle r="${R}" fill="#24262b"/>`
    svgText = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-R} ${-R} ${2 * R} ${2 * R}">${plate}${engravingGroupFrom(
      die.svg,
      color,
    )}</svg>`
  }

  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }))
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('The browser could not rasterize the SVG (filter support).'))
      image.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = options.px
    canvas.height = options.px
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) throw new Error('No 2D canvas available.')
    ctx2d.drawImage(img, 0, 0, options.px, options.px)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('PNG encoding failed.')
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}
