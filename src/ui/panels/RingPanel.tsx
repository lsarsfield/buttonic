import type { RingLayer } from '../../model/types'
import { useEngraver } from '../../state/store'
import { NumberField } from '../controls/NumberField'
import { SegmentedControl } from '../controls/SegmentedControl'

export function RingPanel({ layer }: { layer: RingLayer }) {
  const updateLayer = useEngraver((s) => s.updateLayer)
  const update = (patch: Partial<RingLayer>) => updateLayer(layer.id, patch)
  const maxR = useEngraver((s) => s.doc.diameterMM / 2)

  return (
    <>
      <div className="field-group">
        <SegmentedControl
          label="Mode"
          value={layer.mode}
          options={[
            { value: 'stroke', label: 'Stroke' },
            { value: 'annulus', label: 'Annulus' },
          ]}
          onChange={(mode) => update({ mode })}
        />
      </div>
      {layer.mode === 'stroke' ? (
        <div className="field-group">
          <NumberField
            label="Radius"
            value={layer.radiusMM}
            min={0.2}
            max={maxR}
            step={0.05}
            unit="mm"
            onChange={(radiusMM) => update({ radiusMM })}
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
      ) : (
        <div className="field-group">
          <NumberField
            label="Inner r"
            value={layer.rInnerMM}
            min={0}
            max={maxR}
            step={0.05}
            unit="mm"
            onChange={(rInnerMM) => update({ rInnerMM: Math.min(rInnerMM, layer.rOuterMM - 0.02) })}
          />
          <NumberField
            label="Outer r"
            value={layer.rOuterMM}
            min={0.1}
            max={maxR}
            step={0.05}
            unit="mm"
            onChange={(rOuterMM) => update({ rOuterMM: Math.max(rOuterMM, layer.rInnerMM + 0.02) })}
          />
        </div>
      )}
    </>
  )
}
