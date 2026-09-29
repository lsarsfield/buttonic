import {
  CENTRE_LABELS,
  centreKindOf,
  FINISH_LABELS,
  LOGO_DISPLAYS,
  MATERIALS,
  PRODUCTS,
  reliefGroups,
  STYLES,
} from '../model/product'
import type { ButtonDoc } from '../model/types'

/**
 * A plain-text order spec for the hardware maker — the product options in
 * the trade's own terms, next to the vector artwork. Supplier-neutral: no
 * quantities, prices or lead times.
 */
/** Single relief: its name. Mixed relief: each depth with the layers struck that way. */
function logoLine(doc: ButtonDoc): string {
  const groups = reliefGroups(doc)
  const label = (r: string) => LOGO_DISPLAYS.find((l) => l.value === r)!.label
  if (groups.size <= 1) return label([...groups.keys()][0] ?? doc.logoDisplay)
  return (
    'Mixed relief — ' +
    [...groups.entries()].map(([r, ls]) => `${label(r).toLowerCase()}: ${ls.map((l) => l.name).join(', ')}`).join('; ')
  )
}

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
  if (centre === 'hole') lines.push(['Post', FINISH_LABELS[doc.postFinish]])
  lines.push(
    ['Material', MATERIALS[doc.material].label === 'Die-cast' ? 'Die-cast alloy' : 'Brass'],
    ['Logo display', logoLine(doc)],
    ['Finish', `${FINISH_LABELS[doc.finish]}${doc.distressed ? ', distressed' : ''}`],
    ['Artwork', 'Vector outlines, mm-true (SVG; text converted to outlines). Convert to AI / PDF / EPS if required.'],
  )
  const w = Math.max(...lines.map(([k]) => k.length))
  return [`${doc.name} — ${product.toLowerCase()} spec`, '', ...lines.map(([k, v]) => `${k.padEnd(w)}  ${v}`)].join('\n')
}
