import type { BendLayer } from '../../model/types'
import { useEngraver } from '../../state/store'
import { NumberField } from '../controls/NumberField'
import { SegmentedControl } from '../controls/SegmentedControl'
import { SvgAssetPicker } from '../controls/SvgAssetPicker'
import { Toggle } from '../controls/Toggle'
import { BooleanModeControl } from './BooleanControls'

export function BendPanel({ layer }: { layer: BendLayer }) {
  const updateLayer = useEngraver((s) => s.updateLayer)
  const maxR = useEngraver((s) => s.doc.diameterMM / 2)
  const update = (patch: Partial<BendLayer>) => updateLayer(layer.id, patch)

  return (
    <>
      <div className="field-group">
        <SvgAssetPicker value={layer.assetId} onChange={(assetId) => update({ assetId })} />
      </div>
      <div className="field-group">
        <NumberField
          label="Inner r"
          value={layer.rInnerMM}
          min={0}
          max={maxR}
          step={0.05}
          unit="mm"
          onChange={(rInnerMM) => update({ rInnerMM: Math.min(rInnerMM, layer.rOuterMM - 0.05) })}
        />
        <NumberField
          label="Outer r"
          value={layer.rOuterMM}
          min={0.1}
          max={maxR}
          step={0.05}
          unit="mm"
          onChange={(rOuterMM) => update({ rOuterMM: Math.max(rOuterMM, layer.rInnerMM + 0.05) })}
        />
        <Toggle label="Flip radial" value={layer.flipRadial} onChange={(flipRadial) => update({ flipRadial })} />
      </div>
      <div className="field-group">
        <NumberField
          label="Start"
          value={layer.startDeg}
          min={0}
          max={360}
          step={1}
          unit="°"
          onChange={(startDeg) => update({ startDeg })}
        />
        <SegmentedControl
          label="Sweep"
          value={layer.sweepMode}
          options={[
            { value: 'fixed', label: 'Fixed' },
            { value: 'auto', label: 'Auto', title: 'Undistorted at mid-radius' },
          ]}
          onChange={(sweepMode) => update({ sweepMode })}
        />
        {layer.sweepMode === 'fixed' && (
          <NumberField
            label="Angle"
            value={layer.sweepDeg}
            min={1}
            max={360}
            step={1}
            unit="°"
            onChange={(sweepDeg) => update({ sweepDeg })}
          />
        )}
      </div>
      <div className="field-group">
        <NumberField
          label="Repeat"
          value={layer.repeat}
          min={1}
          max={72}
          step={1}
          onChange={(repeat) => update({ repeat: Math.round(repeat) })}
        />
        <NumberField
          label="Gap"
          value={layer.gapDeg}
          min={0}
          max={90}
          step={0.5}
          unit="°"
          onChange={(gapDeg) => update({ gapDeg })}
        />
        <Toggle
          label="Alt. mirror"
          value={layer.alternateMirror}
          onChange={(alternateMirror) => update({ alternateMirror })}
        />
      </div>
      <div className="field-group">
        <SegmentedControl
          label="Strokes"
          value={layer.strokeHandling}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'centerline', label: 'Line' },
            { value: 'outline', label: 'Fill' },
          ]}
          onChange={(strokeHandling) => update({ strokeHandling })}
        />
        <NumberField
          label="Stroke"
          value={layer.strokeMM}
          min={0.02}
          max={1}
          step={0.01}
          unit="mm"
          onChange={(strokeMM) => update({ strokeMM })}
        />
        <div className="readout">Stroked art keeps constant cut width; fills warp their outline.</div>
      </div>
      <div className="field-group">
        <BooleanModeControl role={layer.booleanRole} onChange={(booleanRole) => update({ booleanRole })} />
        <div className="readout">Cut out knocks the warped art out of filled layers below.</div>
      </div>
    </>
  )
}
