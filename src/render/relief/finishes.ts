import type { Finish } from '../../model/types'
import type { Patina } from './heightField'

/**
 * Physically based metal finishes for the 3D view. `color` is the linear
 * specular reflectance F0 (metals have no diffuse), `roughness` the polished
 * face; recesses get rougher and oxidised via the height field's maps.
 * nickel is tuned against the Stevenson Overall Co. tack-button reference
 * (satin tin-white, soft sheen, faint grey in the low areas); antique brass
 * is the classic workwear finish — burnished highs over a dark brown field.
 */
export interface MetalFinish {
  color: [number, number, number]
  roughness: number
  /** Strength of the cavity oxide / occlusion (aoMapIntensity). */
  oxide: number
  /** Where oxide settles and how dark it gets (see heightField.finishMaps). */
  patina: Patina
}

const LIGHT_PATINA: Patina = { cavity: 1, field: 0.12, darken: 0.62 }

export const METAL_FINISHES: Record<Finish, MetalFinish> = {
  nickel: { color: [0.68, 0.68, 0.66], roughness: 0.34, oxide: 0.9, patina: LIGHT_PATINA },
  steel: { color: [0.56, 0.57, 0.58], roughness: 0.3, oxide: 0.7, patina: LIGHT_PATINA },
  gunmetal: { color: [0.2, 0.2, 0.22], roughness: 0.32, oxide: 0.9, patina: LIGHT_PATINA },
  brass: { color: [0.86, 0.72, 0.4], roughness: 0.3, oxide: 1, patina: LIGHT_PATINA },
  // chemically darkened brass, relieved by polishing: the high points burnished
  // bright, the whole low ground and every recess filled with brown-black oxide
  'antique-brass': {
    color: [0.64, 0.44, 0.18],
    roughness: 0.27,
    oxide: 1,
    patina: { cavity: 1, field: 0.8, darken: 0.9 },
  },
}

/** The tack post seen through a donut cap's hole. */
export const COPPER: MetalFinish = { color: [0.55, 0.24, 0.1], roughness: 0.5, oxide: 1, patina: LIGHT_PATINA }

export const finishOf = (f: Finish): MetalFinish => METAL_FINISHES[f] ?? METAL_FINISHES.steel
