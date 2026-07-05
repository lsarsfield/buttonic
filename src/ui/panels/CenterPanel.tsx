import type { CenterLayer } from '../../model/types'
import { useEngraver } from '../../state/store'
import { FontPicker } from '../controls/FontPicker'
import { NumberField } from '../controls/NumberField'
import { SegmentedControl } from '../controls/SegmentedControl'
import { SvgAssetPicker } from '../controls/SvgAssetPicker'
import { TextField } from '../controls/TextField'
import { BooleanModeControl, HaloControls } from './BooleanControls'

export function CenterPanel({ layer }: { layer: CenterLayer }) {
  const updateLayer = useEngraver((s) => s.updateLayer)
  const maxD = useEngraver((s) => s.doc.diameterMM)
  const update = (patch: Partial<CenterLayer>) => updateLayer(layer.id, patch)

  return (
    <>
      <div className="field-group">
        <SegmentedControl
          label="Source"
          value={layer.sourceType}
          options={[
            { value: 'glyph', label: 'Monogram' },
            { value: 'asset', label: 'SVG' },
          ]}
          onChange={(sourceType) => update({ sourceType })}
        />
        {layer.sourceType === 'glyph' ? (
          <>
            <TextField
              label="Letters"
              value={layer.text}
              maxLength={3}
              onChange={(text) => update({ text })}
            />
            <FontPicker value={layer.fontId} onChange={(fontId) => update({ fontId })} />
          </>
        ) : (
          <SvgAssetPicker value={layer.assetId} onChange={(assetId) => update({ assetId })} />
        )}
      </div>
      <div className="field-group">
        <NumberField
          label="Size"
          value={layer.sizeMM}
          min={0.5}
          max={maxD}
          step={0.1}
          unit="mm"
          onChange={(sizeMM) => update({ sizeMM })}
        />
        <NumberField
          label="Rotation"
          value={layer.rotationDeg}
          min={-180}
          max={180}
          step={1}
          unit="°"
          onChange={(rotationDeg) => update({ rotationDeg })}
        />
        <NumberField
          label="Offset X"
          value={layer.offsetXMM}
          min={-3}
          max={3}
          step={0.05}
          unit="mm"
          onChange={(offsetXMM) => update({ offsetXMM })}
        />
        <NumberField
          label="Offset Y"
          value={layer.offsetYMM}
          min={-3}
          max={3}
          step={0.05}
          unit="mm"
          onChange={(offsetYMM) => update({ offsetYMM })}
        />
      </div>
      <div className="field-group">
        <SegmentedControl
          label="Render"
          value={layer.render}
          options={[
            { value: 'fill', label: 'Fill' },
            { value: 'stroke', label: 'Stroke' },
          ]}
          onChange={(render) => update({ render })}
        />
        {layer.render === 'stroke' && (
          <NumberField
            label="Stroke"
            value={layer.strokeMM}
            min={0.02}
            max={1}
            step={0.01}
            unit="mm"
            onChange={(strokeMM) => update({ strokeMM })}
          />
        )}
        <NumberField
          label="Clearance"
          value={layer.clearanceMM}
          min={0}
          max={3}
          step={0.05}
          unit="mm"
          onChange={(clearanceMM) => update({ clearanceMM })}
        />
        <div className="readout">Clearance is a simple circle; the halo below follows the shape.</div>
      </div>
      <div className="field-group">
        <BooleanModeControl role={layer.booleanRole} onChange={(booleanRole) => update({ booleanRole })} />
        <HaloControls
          values={{ haloMM: layer.haloMM, haloMode: layer.haloMode, haloStrokeMM: layer.haloStrokeMM }}
          onChange={(patch) => update(patch)}
        />
        <div className="readout">Cut out = reversed monogram (raised metal in an engraved field); halo clears a shape-following margin.</div>
      </div>
    </>
  )
}
