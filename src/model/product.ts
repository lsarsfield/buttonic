import type { Finish, LogoDisplay, Material, Product, ProductStyle } from './types'

/**
 * The trade's product options for jeans hardware — the vocabulary jeans-button
 * and rivet makers quote against (shape, size, material, logo display, metal
 * finish). One table read by the inspector, the 3D view and the spec sheet,
 * so every proportion lives here once. None of it touches die geometry.
 */

/** What sits at the centre of the cap face. */
export type CentreKind = 'none' | 'hole' | 'nipple' | 'cup' | 'pin'
/** What's under the cap (seen in the studio product shot). */
export type BackPart = 'tack' | 'swivel' | 'nail'

export interface StyleSpec {
  product: Product
  label: string
  blurb: string
  centre: CentreKind
  /** Default centre-feature diameter as a fraction of the cap diameter. */
  centreFrac: number
  /** Face dome height at the axis, fraction of diameter. */
  domeFrac: number
  /** Dish depth falling toward the centre (concave open tops), fraction of diameter. */
  concaveFrac: number
  back: BackPart
  /** A style that implies its material (the die-cast rivet). */
  material?: Material
  /** Overrides for this style's cap height / edge-roll radius (fractions of diameter). */
  capHFrac?: number
  rollFrac?: number
  /** A raised central plateau (die-cast rivets): radius as a fraction of the cap radius, step height as a fraction of diameter. */
  plateauFrac?: number
  plateauHFrac?: number
}

export const STYLES: Record<ProductStyle, StyleSpec> = {
  'flat-cap': {
    product: 'button', label: 'Flat cap', blurb: 'Flat face, rolled edge.',
    centre: 'none', centreFrac: 0, domeFrac: 0, concaveFrac: 0, back: 'tack',
  },
  'domed-cap': {
    product: 'button', label: 'Domed cap', blurb: 'Face domed to the centre.',
    centre: 'none', centreFrac: 0, domeFrac: 0.2, concaveFrac: 0, back: 'tack', capHFrac: 0.07,
  },
  'open-top': {
    product: 'button', label: 'Open top', blurb: 'Donut cap — the tack post shows through the hole.',
    centre: 'hole', centreFrac: 0.41, domeFrac: 0, concaveFrac: 0, back: 'tack',
  },
  'open-top-concave': {
    product: 'button', label: 'Open top concave', blurb: 'Donut cap dished down toward the hole.',
    centre: 'hole', centreFrac: 0.38, domeFrac: 0, concaveFrac: 0.05, back: 'tack',
  },
  'moveable-shank': {
    product: 'button', label: 'Moveable shank', blurb: 'Slightly domed cap on a swivelling shank.',
    centre: 'none', centreFrac: 0, domeFrac: 0.085, concaveFrac: 0, back: 'swivel',
  },
  capped: {
    product: 'rivet', label: 'Capped', blurb: 'Flat cap over the rivet nail.',
    centre: 'none', centreFrac: 0, domeFrac: 0.015, concaveFrac: 0, back: 'nail', rollFrac: 0.055,
  },
  nipple: {
    product: 'rivet', label: 'Nipple', blurb: 'The nail head stands up as a knob at the centre.',
    centre: 'nipple', centreFrac: 0.3, domeFrac: 0, concaveFrac: 0, back: 'nail', capHFrac: 0.07, rollFrac: 0.025,
  },
  'inverted-nipple': {
    product: 'rivet', label: 'Inverted nipple', blurb: 'A rolled ring around a sunk cup, the nail head at its bottom.',
    centre: 'cup', centreFrac: 0.42, domeFrac: 0, concaveFrac: 0, back: 'nail', rollFrac: 0.045,
  },
  'die-cast': {
    product: 'rivet', label: 'Die-cast', blurb: 'Thick cast cap: a raised centre plateau and a collared pin hole.',
    centre: 'pin', centreFrac: 0.13, domeFrac: 0, concaveFrac: 0, back: 'nail', material: 'die-cast',
    plateauFrac: 0.74, plateauHFrac: 0.035,
  },
}

export interface ProductSpec {
  label: string
  defaultStyle: ProductStyle
  defaultDiameterMM: number
  styles: ProductStyle[]
  /** The usual sizes (custom sizes are always allowed). */
  sizes: { label: string; mm: number }[]
}

export const PRODUCTS: Record<Product, ProductSpec> = {
  button: {
    label: 'Button',
    defaultStyle: 'flat-cap',
    defaultDiameterMM: 17,
    styles: ['flat-cap', 'domed-cap', 'open-top', 'open-top-concave', 'moveable-shank'],
    sizes: [
      { label: 'Top 17', mm: 17 },
      { label: 'Fly 14', mm: 14 },
    ],
  },
  rivet: {
    label: 'Rivet',
    defaultStyle: 'capped',
    defaultDiameterMM: 9,
    styles: ['capped', 'nipple', 'inverted-nipple', 'die-cast'],
    sizes: [
      { label: '8', mm: 8 },
      { label: '9', mm: 9 },
      { label: '10', mm: 10 },
    ],
  },
}

export const MATERIALS: Record<Material, { label: string; blurb: string }> = {
  brass: { label: 'Brass', blurb: 'Thin pressed brass — best for simple text designs.' },
  'die-cast': { label: 'Die-cast', blurb: 'Die-cast alloy — thicker and stronger, holds complex art.' },
}

/**
 * Physical cap proportions for the 3D view: body height, rolled-edge radius
 * and relief depth. Die-cast is thicker with a crisper edge and deeper
 * relief; rivets are proportionally thicker than buttons. Relief depth is
 * absolute (die sinking), eased down on small caps.
 */
export function capProportions(
  product: Product,
  material: Material,
  diameterMM: number,
  style?: ProductStyle,
): { capH: number; roll: number; depthMM: number } {
  const D = diameterMM
  const cast = material === 'die-cast'
  const st = style ? STYLES[style] : undefined
  // side-wall height from the face to the underside, as the trade photos show:
  // pressed brass ≈ D/10, die-cast chunkier; rivets proportionally thicker
  const baseH = product === 'rivet' ? (cast ? 0.2 : 0.12) : cast ? 0.13 : 0.1
  const capH = D * (st?.capHFrac !== undefined ? st.capHFrac * (cast ? 1.3 : 1) : baseH)
  const roll = D * (st?.rollFrac ?? (cast ? 0.03 : 0.04))
  // die-struck relief is deep — ~0.3 mm on pressed brass, ~0.45 on die-cast
  // (0.12 read as print, not a strike); eased down on small caps
  const depthMM = (cast ? 0.45 : 0.3) * Math.min(1.2, Math.max(0.55, D / 17))
  return { capH, roll, depthMM }
}

export const LOGO_DISPLAYS: readonly { value: LogoDisplay; label: string; title: string }[] = [
  { value: 'embossed', label: 'Embossed', title: 'The art stands raised from the face' },
  { value: 'debossed', label: 'Debossed', title: 'The art is sunk into the face' },
  { value: 'lasered', label: 'Lasered', title: 'The art is laser-marked flat onto the face' },
]

export const FINISH_LABELS: Record<Finish, string> = {
  'antique-brass': 'Antique brass',
  'antique-copper': 'Antique copper',
  'copper-oxide': 'Copper oxide',
  pewter: 'Pewter',
  'dark-pewter': 'Dark pewter',
  nickel: 'Dull nickel',
  'polished-nickel': 'Polished nickel',
  'polished-gold': 'Polished gold',
  gunmetal: 'Gunmetal',
  brass: 'Bright brass',
  steel: 'Steel',
}

export const FINISH_GROUPS: readonly { label: string; options: readonly Finish[] }[] = [
  { label: 'Standard', options: ['antique-brass', 'antique-copper', 'copper-oxide', 'pewter', 'dark-pewter', 'nickel'] },
  { label: 'Polished', options: ['polished-nickel', 'polished-gold', 'gunmetal', 'brass', 'steel'] },
]

/** A style's default centre-feature diameter for a cap of diameter D (0.1 mm steps). */
export function defaultCentreMM(style: ProductStyle, diameterMM: number): number {
  return Math.round(STYLES[style].centreFrac * diameterMM * 10) / 10
}

/** The centre feature actually present (a zero-size feature is none). */
export function centreKindOf(doc: { style: ProductStyle; holeDiameterMM: number }): CentreKind {
  const k = STYLES[doc.style]?.centre ?? 'none'
  return doc.holeDiameterMM > 0 ? k : 'none'
}

export const CENTRE_LABELS: Record<Exclude<CentreKind, 'none'>, string> = {
  hole: 'Centre hole',
  nipple: 'Nipple',
  cup: 'Cup',
  pin: 'Pin hole',
}

/** Is the centre feature a see-through opening (drawn as a cut-out on the flat canvas)? */
export const isOpening = (k: CentreKind): boolean => k === 'hole' || k === 'pin'

/** Soft validation: unknown or mismatched values fall back to sane defaults, never an error. */
export function coerceProductOptions(raw: {
  product: unknown
  style: unknown
  material: unknown
  logoDisplay: unknown
  distressed: unknown
}): { product: Product; style: ProductStyle; material: Material; logoDisplay: LogoDisplay; distressed: boolean } {
  const product: Product = raw.product === 'rivet' ? 'rivet' : 'button'
  const style =
    typeof raw.style === 'string' && raw.style in STYLES && STYLES[raw.style as ProductStyle].product === product
      ? (raw.style as ProductStyle)
      : PRODUCTS[product].defaultStyle
  const material: Material = raw.material === 'die-cast' ? 'die-cast' : 'brass'
  const logoDisplay: LogoDisplay =
    raw.logoDisplay === 'debossed' || raw.logoDisplay === 'lasered' ? raw.logoDisplay : 'embossed'
  return { product, style, material, logoDisplay, distressed: raw.distressed === true }
}
