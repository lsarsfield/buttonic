import type { HatchLayer } from '../../model/types'
import { useEngraver } from '../../state/store'
import { NumberField } from '../controls/NumberField'
import { SegmentedControl } from '../controls/SegmentedControl'
import { Slider } from '../controls/Slider'
import { StrokeStyleControls } from './StrokeControls'

export function HatchPanel({ layer }: { layer: HatchLayer }) {
  const updateLayer = useEngraver((s) => s.updateLayer)
  const maxR = useEngraver((s) => s.doc.diameterMM / 2)
  const update = (patch: Partial<HatchLayer>) => updateLayer(layer.id, patch)

  const rMid = (layer.rInnerMM + layer.rOuterMM) / 2
  const arcLenMM = (layer.sweepDeg / 360) * 2 * Math.PI * rMid
  const density = arcLenMM > 0 ? layer.count / arcLenMM : 0
  const coveragePct = Math.min(100, ((layer.sweepDeg * layer.repeats) / 360) * 100)

  return (
    <>
      <div className="field-group">
        <NumberField
          label="Count"
          value={layer.count}
          min={4}
          max={720}
          step={1}
          onChange={(count) => update({ count: Math.round(count) })}
        />
        <Slider
          label=""
          value={layer.count}
          min={4}
          max={480}
          step={1}
          onChange={(count) => update({ count })}
        />
        <div className="readout">
          {density.toFixed(2)} ticks/mm · {coveragePct.toFixed(0)}% of ring
        </div>
      </div>
      <div className="field-group">
        <NumberField
          label="Arc"
          value={layer.sweepDeg}
          min={5}
          max={360}
          step={1}
          unit="°"
          onChange={(sweepDeg) => update({ sweepDeg })}
        />
        <Slider
          label=""
          value={layer.sweepDeg}
          min={5}
          max={360}
          step={1}
          unit="°"
          onChange={(sweepDeg) => update({ sweepDeg })}
        />
        <NumberField
          label="Repeats"
          value={layer.repeats}
          min={1}
          max={24}
          step={1}
          onChange={(repeats) => update({ repeats: Math.round(repeats) })}
        />
        <div className="readout">Position the arc(s) with the phase handle.</div>
      </div>
      <div className="field-group">
        <NumberField
          label="Inner r"
          value={layer.rInnerMM}
          diameter
          min={0}
          max={maxR}
          step={0.05}
          unit="mm"
          onChange={(rInnerMM) => update({ rInnerMM: Math.min(rInnerMM, layer.rOuterMM - 0.05) })}
        />
        <NumberField
          label="Outer r"
          value={layer.rOuterMM}
          diameter
          min={0.1}
          max={maxR}
          step={0.05}
          unit="mm"
          onChange={(rOuterMM) => update({ rOuterMM: Math.max(rOuterMM, layer.rInnerMM + 0.05) })}
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
      </div>
      <div className="field-group">
        <NumberField
          label="Twist"
          value={layer.twistDeg}
          min={-90}
          max={90}
          step={0.5}
          unit="°"
          onChange={(twistDeg) => update({ twistDeg })}
        />
        <Slider
          label=""
          value={layer.twistDeg}
          min={-90}
          max={90}
          step={0.5}
          unit="°"
          onChange={(twistDeg) => update({ twistDeg })}
        />
        <StrokeStyleControls cap={layer.cap} allowPoint onChange={update} />
        {layer.cap === 'point' && (
          <>
            <NumberField
              label="Point"
              value={layer.capPointMM}
              min={0.05}
              max={3}
              step={0.05}
              unit="mm"
              onChange={(capPointMM) => update({ capPointMM })}
            />
            <Slider
              label=""
              value={layer.capPointMM}
              min={0.05}
              max={3}
              step={0.05}
              unit="mm"
              onChange={(capPointMM) => update({ capPointMM })}
            />
            <SegmentedControl
              label="Point at"
              value={layer.pointEnds}
              options={[
                { value: 'outer', label: 'Outer', title: 'Point the outer end only' },
                { value: 'both', label: 'Both', title: 'Point both ends (spindle)' },
              ]}
              onChange={(pointEnds) => update({ pointEnds })}
            />
          </>
        )}
      </div>
    </>
  )
}
