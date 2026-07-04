import type { RingTextLayer } from '../../model/types'
import { useEngraver } from '../../state/store'
import { FontPicker } from '../controls/FontPicker'
import { NumberField } from '../controls/NumberField'
import { SegmentedControl } from '../controls/SegmentedControl'
import { TextField } from '../controls/TextField'
import { Toggle } from '../controls/Toggle'

export function RingTextPanel({ layer }: { layer: RingTextLayer }) {
  const updateLayer = useEngraver((s) => s.updateLayer)
  const maxR = useEngraver((s) => s.doc.diameterMM / 2)
  const update = (patch: Partial<RingTextLayer>) => updateLayer(layer.id, patch)

  return (
    <>
      <div className="field-group">
        <TextField label="Text" value={layer.text} onChange={(text) => update({ text })} />
        <FontPicker value={layer.fontId} onChange={(fontId) => update({ fontId })} />
        <Toggle label="Kerning" value={layer.useKerning} onChange={(useKerning) => update({ useKerning })} />
      </div>
      <div className="field-group">
        <NumberField
          label="Size"
          value={layer.sizeMM}
          min={0.5}
          max={maxR}
          step={0.05}
          unit="mm"
          onChange={(sizeMM) => update({ sizeMM })}
        />
        <NumberField
          label="Radius"
          value={layer.radiusMM}
          min={0.5}
          max={maxR}
          step={0.05}
          unit="mm"
          onChange={(radiusMM) => update({ radiusMM })}
        />
        <NumberField
          label="Spacing"
          value={layer.letterSpacingMM}
          min={-0.5}
          max={2}
          step={0.01}
          unit="mm"
          onChange={(letterSpacingMM) => update({ letterSpacingMM })}
        />
      </div>
      <div className="field-group">
        <NumberField
          label="Anchor"
          value={layer.anchorDeg}
          min={0}
          max={360}
          step={1}
          unit="°"
          onChange={(anchorDeg) => update({ anchorDeg })}
        />
        <SegmentedControl
          label="Align"
          value={layer.anchorAlign}
          options={[
            { value: 'start', label: 'Start' },
            { value: 'center', label: 'Centre' },
            { value: 'end', label: 'End' },
          ]}
          onChange={(anchorAlign) => update({ anchorAlign })}
        />
        <SegmentedControl
          label="Direction"
          value={layer.direction}
          options={[
            { value: 'outward', label: 'Top ⌒' },
            { value: 'inward', label: 'Bottom ⌄' },
          ]}
          onChange={(direction) => update({ direction })}
        />
        <SegmentedControl
          label="Mode"
          value={layer.mode}
          options={[
            { value: 'arc', label: 'Arc', title: 'Classic per-glyph placement, like coins' },
            { value: 'warp', label: 'Warp', title: 'Glyph outlines bend through the polar warp' },
          ]}
          onChange={(mode) => update({ mode })}
        />
      </div>
    </>
  )
}
