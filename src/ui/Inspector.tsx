import type { Layer } from '../model/types'
import { LAYER_TYPE_LABELS } from '../model/types'
import { useEngraver } from '../state/store'
import { useSelectedLayer } from '../state/selectors'
import { LAYER_RELIEFS, LOGO_DISPLAYS } from '../model/product'
import { NumberField } from './controls/NumberField'
import { SegmentedControl } from './controls/SegmentedControl'
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
  const logoDisplay = useEngraver((s) => s.doc.logoDisplay)
  const isMask = 'booleanRole' in layer && layer.booleanRole === 'mask'
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
      {/* a mask is a window, never struck — relief doesn't apply */}
      {!isMask && (
        <div className="field-group">
          <SegmentedControl
            label="Relief"
            stack
            value={layer.relief}
            options={LAYER_RELIEFS}
            onChange={(relief) => updateLayer(layer.id, { relief })}
          />
          <div className="readout">
            {layer.relief === 'inherit'
              ? `Follows the button's logo display (${LOGO_DISPLAYS.find((l) => l.value === logoDisplay)!.label.toLowerCase()}). Set raised / sunk per layer for a mixed-relief die.`
              : 'Struck differently from the button default — the die file groups each depth separately.'}
          </div>
        </div>
      )}
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
