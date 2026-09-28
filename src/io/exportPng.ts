import type { ButtonDoc } from '../model/types'
import type { Backdrop } from '../state/store'
import { exportSvg } from './exportSvg'

/**
 * PNG mockups. Flat: rasterize a self-contained SVG (no CSS variables, no DOM
 * cloning) at a chosen pixel size. 3D: the 3D view's scene rendered offscreen
 * (lazy — three.js loads only when a 3D PNG is asked for).
 */

export interface PngExportOptions {
  px: number
  mode: 'flat' | '3d'
  lightDeg: number
  /** 3D: ground under the button. */
  backdrop: Backdrop
  /** Flat: dark artwork on transparent (true) or light-on-dark plate (false). 3D: no backdrop. */
  transparent: boolean
  fontsRevision: number
  assetsRevision: number
}

/** Pull the inner engraving group out of the die-file SVG and recolor it. */
function engravingGroupFrom(svgText: string, color: string): string {
  const m = svgText.match(/<g id="engraving"[\s\S]*<\/g>/)
  const inner = m ? m[0] : ''
  return inner.replace(/#000000/g, color)
}

export async function exportPng(doc: ButtonDoc, options: PngExportOptions): Promise<Blob> {
  if (options.mode === '3d') {
    const { renderButtonPng } = await import('../render/relief/renderPng')
    return renderButtonPng(doc, {
      px: options.px,
      lightDeg: options.lightDeg,
      backdrop: options.transparent ? 'none' : options.backdrop,
      fontsRevision: options.fontsRevision,
      assetsRevision: options.assetsRevision,
    })
  }
  const die = exportSvg(doc, { expandInstances: true, mirrorForDie: false, includeBlankOutline: false })
  const R = doc.diameterMM / 2
  const color = options.transparent ? '#101114' : '#e9e7df'
  const plate = options.transparent ? '' : `<circle r="${R}" fill="#24262b"/>`
  const svgText = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-R} ${-R} ${2 * R} ${2 * R}">${plate}${engravingGroupFrom(
    die.svg,
    color,
  )}</svg>`

  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }))
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('The browser could not rasterize the SVG.'))
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
