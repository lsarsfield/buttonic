import type { ButtonDoc } from '../model/types'
import { exportSvg } from './exportSvg'

/**
 * Switcher thumbnails: the compact <use>-based export (no project metadata,
 * no blank outline), recolored for the dark UI. The whole string is recolored
 * — never extract the engraving group, because <defs> sits outside it and
 * instanced layers would render empty. Rendered via
 * `data:image/svg+xml,${encodeURIComponent(...)}`; colors are baked literals
 * because currentColor doesn't inherit into <img>.
 */

export const THUMB_COLOR = '#dfe2e6'
export const THUMB_MAX_BYTES = 300_000

export function renderThumbSvg(doc: ButtonDoc, maxBytes = THUMB_MAX_BYTES): string | null {
  let svg: string
  try {
    svg = exportSvg(doc, {
      expandInstances: false,
      mirrorForDie: false,
      includeBlankOutline: false,
      embedProject: false,
    }).svg
  } catch {
    return null
  }
  const recolored = svg.replace(/#000000/g, THUMB_COLOR)
  return recolored.length > maxBytes ? null : recolored
}
