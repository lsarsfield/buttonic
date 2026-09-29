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

/** Polished plating: a mirror face that only greys in the tightest recesses. */
const POLISHED_PATINA: Patina = { cavity: 0.8, field: 0.04, darken: 0.5 }

export const METAL_FINISHES: Record<Finish, MetalFinish> = {
  // dull (satin) nickel — the Stevenson reference
  nickel: { color: [0.68, 0.68, 0.66], roughness: 0.34, oxide: 0.9, patina: LIGHT_PATINA },
  'polished-nickel': { color: [0.66, 0.65, 0.62], roughness: 0.1, oxide: 0.8, patina: POLISHED_PATINA },
  'polished-gold': { color: [0.95, 0.74, 0.36], roughness: 0.1, oxide: 0.8, patina: POLISHED_PATINA },
  steel: { color: [0.56, 0.57, 0.58], roughness: 0.3, oxide: 0.7, patina: LIGHT_PATINA },
  gunmetal: { color: [0.2, 0.2, 0.22], roughness: 0.2, oxide: 0.9, patina: LIGHT_PATINA },
  brass: { color: [0.86, 0.72, 0.4], roughness: 0.3, oxide: 1, patina: LIGHT_PATINA },
  // tin-lead grey, satin, soft grey fill in the low ground
  pewter: { color: [0.32, 0.33, 0.35], roughness: 0.48, oxide: 1, patina: { cavity: 1, field: 0.35, darken: 0.72 } },
  'dark-pewter': { color: [0.25, 0.26, 0.28], roughness: 0.38, oxide: 1, patina: { cavity: 1, field: 0.45, darken: 0.8 } },
  'antique-copper': {
    color: [0.74, 0.43, 0.28],
    roughness: 0.3,
    oxide: 1,
    patina: { cavity: 1, field: 0.55, darken: 0.82 },
  },
  // copper darkened almost to black-brown, bright copper only where it's rubbed
  'copper-oxide': {
    color: [0.62, 0.35, 0.22],
    roughness: 0.42,
    oxide: 1,
    patina: { cavity: 1, field: 0.92, darken: 0.93 },
  },
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
