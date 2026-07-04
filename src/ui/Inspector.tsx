import type { Layer } from '../model/types'
import { LAYER_TYPE_LABELS } from '../model/types'
import { useEngraver } from '../state/store'
import { useSelectedLayer } from '../state/selectors'
import { NumberField } from './controls/NumberField'
import { Slider } from './controls/Slider'
import { BendPanel } from './panels/BendPanel'
import { CenterPanel } from './panels/CenterPanel'
import { DocPanel } from './panels/DocPanel'
import { HatchPanel } from './panels/HatchPanel'
import { RepeatPanel } from './panels/RepeatPanel'
import { RingPanel } from './panels/RingPanel'
import { RingTextPanel } from './panels/RingTextPanel'

export function Inspector() {
  const layer = useSelectedLayer()
  return (
    <div className="panel inspector-panel">
      <div className="panel-header">
        <span className="panel-title">
          {layer ? LAYER_TYPE_LABELS[layer.type] : 'Button'}
        </span>
      </div>
      <div className="inspector-body">{layer ? <LayerInspector layer={layer} /> : <DocPanel />}</div>
    </div>
  )
}

function LayerInspector({ layer }: { layer: Layer }) {
  const updateLayer = useEngraver((s) => s.updateLayer)
  return (
    <>
      <div className="field-group">
        <NumberField
          label="Phase"
          value={layer.phaseDeg}
          min={-180}
          max={180}
          step={1}
          unit="°"
          onChange={(phaseDeg) => updateLayer(layer.id, { phaseDeg })}
        />
        <Slider
          label=""
          value={layer.phaseDeg}
          min={-180}
          max={180}
          step={0.5}
          unit="°"
          onChange={(phaseDeg) => updateLayer(layer.id, { phaseDeg })}
        />
      </div>
      <TypePanel layer={layer} />
    </>
  )
}

function TypePanel({ layer }: { layer: Layer }) {
  switch (layer.type) {
    case 'ring':
      return <RingPanel layer={layer} />
    case 'hatch':
      return <HatchPanel layer={layer} />
    case 'repeat':
      return <RepeatPanel layer={layer} />
    case 'ringText':
      return <RingTextPanel layer={layer} />
    case 'center':
      return <CenterPanel layer={layer} />
    case 'bend':
      return <BendPanel layer={layer} />
  }
}
