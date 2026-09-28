import type { Finish } from '../../model/types'
import { useEngraver } from '../../state/store'
import { NumberField } from '../controls/NumberField'
import { SegmentedControl } from '../controls/SegmentedControl'
import { Select } from '../controls/Select'
import { Toggle } from '../controls/Toggle'

const FINISHES: readonly { value: Finish; label: string }[] = [
  { value: 'nickel', label: 'Nickel' },
  { value: 'antique-brass', label: 'Antique brass' },
  { value: 'gunmetal', label: 'Gunmetal' },
  { value: 'steel', label: 'Steel' },
  { value: 'brass', label: 'Brass' },
]

export function DocPanel() {
  const doc = useEngraver((s) => s.doc)
  const view = useEngraver((s) => s.view)
  const updateDocMeta = useEngraver((s) => s.updateDocMeta)
  const setView = useEngraver((s) => s.setView)

  return (
    <>
      <div className="field-group">
        <NumberField
          label="Diameter"
          value={doc.diameterMM}
          min={8}
          max={30}
          step={0.1}
          unit="mm"
          onChange={(diameterMM) => updateDocMeta({ diameterMM })}
        />
        <NumberField
          label="Centre hole"
          value={doc.holeDiameterMM}
          min={0}
          max={Math.max(0, doc.diameterMM - 4)}
          step={0.1}
          unit="mm"
          onChange={(holeDiameterMM) => updateDocMeta({ holeDiameterMM })}
        />
        <SegmentedControl
          label="Relief"
          value={doc.relief}
          options={[
            { value: 'raised', label: 'Raised', title: 'The die cut stands proud on the button (die-struck)' },
            { value: 'recessed', label: 'Recessed', title: 'The die cut sinks into the button face' },
          ]}
          onChange={(relief) => updateDocMeta({ relief })}
        />
        <Select
          label="Finish"
          value={doc.finish}
          options={FINISHES}
          onChange={(finish) => updateDocMeta({ finish })}
        />
        <div className="readout">Centre hole, relief and finish describe the struck button — they shape the 3D view, not the die geometry.</div>
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
          value={view.backdrop}
          options={[
            { value: 'raw', label: 'Raw', title: 'Raw indigo denim' },
            { value: 'ecru', label: 'Ecru', title: 'Undyed ecru denim' },
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
