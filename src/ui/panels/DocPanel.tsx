import type { Finish } from '../../model/types'
import { useEngraver } from '../../state/store'
import { NumberField } from '../controls/NumberField'
import { Select } from '../controls/Select'
import { Toggle } from '../controls/Toggle'

const FINISHES: readonly { value: Finish; label: string }[] = [
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
        <Select
          label="Finish"
          value={doc.finish}
          options={FINISHES}
          onChange={(finish) => updateDocMeta({ finish })}
        />
      </div>
      <div className="field-group">
        <Toggle label="Guides" value={view.showGuides} onChange={(showGuides) => setView({ showGuides })} />
        <Toggle
          label="Light artboard"
          value={view.artboardLight}
          onChange={(artboardLight) => setView({ artboardLight })}
        />
      </div>
      <p className="coming-soon">
        Select a layer to edit its parameters. Every layer is computed from the centre axis —
        counts, radii and angles, never manual duplication.
      </p>
    </>
  )
}
