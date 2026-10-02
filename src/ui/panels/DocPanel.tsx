import {
  CENTRE_LABELS,
  defaultCentreMM,
  FINISH_GROUPS,
  FINISH_LABELS,
  LOGO_DISPLAYS,
  MATERIALS,
  PRODUCTS,
  STYLES,
} from '../../model/product'
import { useEngraver } from '../../state/store'
import { NumberField } from '../controls/NumberField'
import { SegmentedControl } from '../controls/SegmentedControl'
import { GroupedSelect, Select } from '../controls/Select'
import { Toggle } from '../controls/Toggle'

const FINISH_OPTION_GROUPS = FINISH_GROUPS.map((g) => ({
  label: g.label,
  options: g.options.map((f) => ({ value: f, label: FINISH_LABELS[f] })),
}))

/**
 * The button itself (no layer selected): what's being struck — product, cap
 * shape, size, centre feature, material, logo display and metal finish — plus
 * view settings. Product options shape the 3D view and the spec sheet, never
 * the die geometry.
 */
export function DocPanel() {
  const doc = useEngraver((s) => s.doc)
  const view = useEngraver((s) => s.view)
  const updateDocMeta = useEngraver((s) => s.updateDocMeta)
  const setProduct = useEngraver((s) => s.setProduct)
  const setStyle = useEngraver((s) => s.setStyle)
  const setView = useEngraver((s) => s.setView)

  const product = PRODUCTS[doc.product]
  const style = STYLES[doc.style]
  const sizeMatch = product.sizes.find((z) => Math.abs(z.mm - doc.diameterMM) < 1e-6)

  const setDiameter = (diameterMM: number) =>
    updateDocMeta(
      style.centre === 'none'
        ? { diameterMM }
        : { diameterMM, holeDiameterMM: defaultCentreMM(doc.style, diameterMM) },
    )

  return (
    <>
      <div className="field-group">
        <SegmentedControl
          label="Product"
          value={doc.product}
          options={[
            { value: 'button', label: 'Button', title: 'Jeans button (cap on a tack or shank)' },
            { value: 'rivet', label: 'Rivet', title: 'Jeans rivet (cap on a nail)' },
          ]}
          onChange={setProduct}
        />
        <Select
          label="Shape"
          value={doc.style}
          options={product.styles.map((s) => ({ value: s, label: STYLES[s].label }))}
          onChange={setStyle}
        />
        <NumberField
          label="Diameter"
          value={doc.diameterMM}
          min={8}
          max={30}
          step={0.1}
          unit="mm"
          onChange={setDiameter}
        />
        <SegmentedControl
          label="Size"
          value={sizeMatch ? String(sizeMatch.mm) : ''}
          options={product.sizes.map((z) => ({ value: String(z.mm), label: z.label, title: `${z.mm} mm` }))}
          onChange={(v) => setDiameter(Number(v))}
        />
        {style.centre !== 'none' && (
          <NumberField
            label={CENTRE_LABELS[style.centre]}
            value={doc.holeDiameterMM}
            min={0}
            max={Math.max(0, doc.diameterMM - 4)}
            step={0.1}
            unit="mm"
            onChange={(holeDiameterMM) => updateDocMeta({ holeDiameterMM })}
          />
        )}
        {style.centre === 'hole' && (
          <GroupedSelect
            label="Post finish"
            value={doc.postFinish}
            groups={FINISH_OPTION_GROUPS}
            onChange={(postFinish) => updateDocMeta({ postFinish })}
          />
        )}
        {style.centre === 'hole' && (
          <SegmentedControl
            label="Tack"
            value={doc.tack}
            options={[
              { value: 'solid', label: 'Solid head', title: 'A polished tack head fills the opening (most modern open tops)' },
              { value: 'hollow', label: 'Tack tip', title: 'An open well lined in the post finish, the tack’s curled tip at the bottom (Stevenson, vintage donuts)' },
            ]}
            onChange={(tack) => updateDocMeta({ tack })}
          />
        )}
        <div className="readout">{style.blurb}</div>
      </div>
      <div className="field-group">
        <SegmentedControl
          label="Material"
          value={doc.material}
          options={[
            { value: 'brass', label: 'Brass', title: MATERIALS.brass.blurb },
            { value: 'die-cast', label: 'Die-cast', title: MATERIALS['die-cast'].blurb },
          ]}
          onChange={(material) => updateDocMeta({ material })}
        />
        <SegmentedControl
          label="Logo"
          stack
          value={doc.logoDisplay}
          options={LOGO_DISPLAYS}
          onChange={(logoDisplay) => updateDocMeta({ logoDisplay })}
        />
        <GroupedSelect
          label="Finish"
          value={doc.finish}
          groups={FINISH_OPTION_GROUPS}
          onChange={(finish) => updateDocMeta({ finish })}
        />
        <Toggle label="Distressed" value={doc.distressed} onChange={(distressed) => updateDocMeta({ distressed })} />
        <div className="readout">
          {MATERIALS[doc.material].blurb} Product options shape the 3D view and the spec sheet — never the die geometry.
        </div>
      </div>
      <div className="field-group">
        <Toggle label="Guides" value={view.showGuides} onChange={(showGuides) => setView({ showGuides })} />
        <Toggle
          label="Light artboard"
          value={view.artboardLight}
          onChange={(artboardLight) => setView({ artboardLight })}
        />
        <SegmentedControl
          label="3D backdrop"
          stack
          value={view.backdrop}
          options={[
            { value: 'raw', label: 'Raw', title: 'Raw indigo denim' },
            { value: 'ecru', label: 'Ecru', title: 'Undyed ecru denim' },
            { value: 'studio', label: 'Studio', title: 'White sweep — the button stands on its shank' },
            { value: 'none', label: 'None', title: 'No backdrop' },
          ]}
          onChange={(backdrop) => setView({ backdrop })}
        />
      </div>
      <p className="coming-soon">
        Select a layer to edit its parameters. Every layer is computed from the centre axis —
        counts, radii and angles, never manual duplication.
      </p>
    </>
  )
}
