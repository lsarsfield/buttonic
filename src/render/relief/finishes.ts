import type { Finish } from '../../model/types'

/**
 * Physically based metal finishes for the 3D view. `color` is the linear
 * specular reflectance F0 (metals have no diffuse), `roughness` the polished
 * face; recesses get rougher and oxidised via the height field's maps.
 * nickel is tuned against the Stevenson Overall Co. tack-button reference
 * (satin tin-white, soft sheen, faint grey in the low areas).
 */
export interface MetalFinish {
  color: [number, number, number]
  roughness: number
  /** Strength of the cavity oxide / occlusion (aoMapIntensity). */
  oxide: number
}

export const METAL_FINISHES: Record<Finish, MetalFinish> = {
  nickel: { color: [0.68, 0.68, 0.66], roughness: 0.34, oxide: 0.9 },
  steel: { color: [0.56, 0.57, 0.58], roughness: 0.3, oxide: 0.7 },
  gunmetal: { color: [0.2, 0.2, 0.22], roughness: 0.32, oxide: 0.9 },
  brass: { color: [0.86, 0.72, 0.4], roughness: 0.3, oxide: 1 },
}

/** The tack post seen through a donut cap's hole. */
export const COPPER: MetalFinish = { color: [0.55, 0.24, 0.1], roughness: 0.5, oxide: 1 }

export const finishOf = (f: Finish): MetalFinish => METAL_FINISHES[f] ?? METAL_FINISHES.steel
