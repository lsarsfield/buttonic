import {
  CENTRE_LABELS,
  centreKindOf,
  FINISH_LABELS,
  LOGO_DISPLAYS,
  MATERIALS,
  PRODUCTS,
  STYLES,
} from '../model/product'
import type { ButtonDoc } from '../model/types'

/**
 * A plain-text order spec for the hardware maker — the product options in
 * the trade's own terms, next to the vector artwork. Supplier-neutral: no
 * quantities, prices or lead times.
 */
export function specSheet(doc: ButtonDoc): string {
  const centre = centreKindOf(doc)
  const product = doc.product === 'rivet' ? 'Jeans rivet' : 'Jeans button'
  const size = PRODUCTS[doc.product].sizes.find((z) => Math.abs(z.mm - doc.diameterMM) < 1e-6)
  const mm = (v: number) => `${Number(v.toFixed(2))} mm`
  const lines: [string, string][] = [
    ['Product', product],
    ['Shape', STYLES[doc.style].label],
    ['Size', `${mm(doc.diameterMM)} diameter${size && doc.product === 'button' ? ` (${size.label.split(' ')[0]!.toLowerCase()})` : ''}`],
  ]
  if (centre !== 'none') lines.push([CENTRE_LABELS[centre], `${mm(doc.holeDiameterMM)} diameter`])
  lines.push(
    ['Material', MATERIALS[doc.material].label === 'Die-cast' ? 'Die-cast alloy' : 'Brass'],
    ['Logo display', LOGO_DISPLAYS.find((l) => l.value === doc.logoDisplay)!.label],
    ['Finish', `${FINISH_LABELS[doc.finish]}${doc.distressed ? ', distressed' : ''}`],
    ['Artwork', 'Vector outlines, mm-true (SVG; text converted to outlines). Convert to AI / PDF / EPS if required.'],
  )
  const w = Math.max(...lines.map(([k]) => k.length))
  return [`${doc.name} — ${product.toLowerCase()} spec`, '', ...lines.map(([k, v]) => `${k.padEnd(w)}  ${v}`)].join('\n')
}
