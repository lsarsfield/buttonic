import type { CenterLayer } from '../../model/types'
import { STAR_MAX_POINTS, STAR_MIN_POINTS } from '../../geometry/star'
import { useEngraver } from '../../state/store'
import { FontPicker } from '../controls/FontPicker'
import { MotifPicker } from '../controls/MotifPicker'
import { NumberField } from '../controls/NumberField'
import { SegmentedControl } from '../controls/SegmentedControl'
import { SvgAssetPicker } from '../controls/SvgAssetPicker'
import { TextField } from '../controls/TextField'
import { OverlayControls } from './BooleanControls'

export function CenterPanel({ layer }: { layer: CenterLayer }) {
  const updateLayer = useEngraver((s) => s.updateLayer)
  const maxD = useEngraver((s) => s.doc.diameterMM)
  const update = (patch: Partial<CenterLayer>) => updateLayer(layer.id, patch)

  return (
    <>
      <div className="field-group">
        <SegmentedControl
          label="Source"
          stack
          value={layer.sourceType}
          options={[
            { value: 'glyph', label: 'Letters' },
            { value: 'builtin', label: 'Motif' },
            { value: 'star', label: 'Star' },
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
        ) : layer.sourceType === 'builtin' ? (
          <MotifPicker value={layer.motifId} onChange={(motifId) => update({ motifId })} />
        ) : layer.sourceType === 'star' ? (
          <StarFields layer={layer} update={update} />
        ) : (
          <SvgAssetPicker value={layer.assetId} onChange={(assetId) => update({ assetId })} />
        )}
      </div>
      <div className="field-group">
        <NumberField
          label="Size"
          value={layer.sizeMM}
          min={0.5}
          max={layer.sourceType === 'star' ? 2 * maxD : maxD}
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
        <div className="readout">Clearance is a simple circle; the gap below follows the shape.</div>
      </div>
      <div className="field-group">
        <OverlayControls
          values={{
            booleanRole: layer.booleanRole,
            haloMM: layer.haloMM,
            haloMode: layer.haloMode,
            haloStrokeMM: layer.haloStrokeMM,
            invertOverBare: layer.invertOverBare,
          }}
          noun="shape"
          onChange={(patch) => update(patch)}
        />
      </div>
    </>
  )
}

/** Parametric star: points, valley depth, side curvature (geometry/star.ts). */
function StarFields({ layer, update }: { layer: CenterLayer; update: (patch: Partial<CenterLayer>) => void }) {
  const polygon = Math.round(100 * Math.cos(Math.PI / Math.max(2, Math.round(layer.starPoints))))
  return (
    <>
      <NumberField
        label="Points"
        value={layer.starPoints}
        min={STAR_MIN_POINTS}
        max={STAR_MAX_POINTS}
        step={1}
        onChange={(starPoints) => update({ starPoints: Math.round(starPoints) })}
      />
      <NumberField
        label="Inner"
        value={Math.round(layer.starInner * 1000) / 10}
        min={1}
        max={100}
        step={1}
        unit="%"
        onChange={(v) => update({ starInner: v / 100 })}
      />
      <NumberField
        label="Curve"
        value={Math.round(layer.starBulge * 1000) / 10}
        min={-100}
        max={100}
        step={5}
        unit="%"
        onChange={(v) => update({ starBulge: v / 100 })}
      />
      <div className="readout">
        {`Size is point to point. Inner ${polygon}% makes a regular polygon. Curve bows each side: + swells, − caves in (±100% = semicircles).`}
      </div>
    </>
  )
}
