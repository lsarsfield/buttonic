import type { RepeatLayer } from '../../model/types'
import { BUILTIN_MOTIFS, getBuiltinMotif } from '../../geometry/motifs/builtins'
import { useEngraver } from '../../state/store'
import { NumberField } from '../controls/NumberField'
import { SegmentedControl } from '../controls/SegmentedControl'
import { Select } from '../controls/Select'
import { Slider } from '../controls/Slider'
import { SvgAssetPicker } from '../controls/SvgAssetPicker'
import { Toggle } from '../controls/Toggle'

export function RepeatPanel({ layer }: { layer: RepeatLayer }) {
  const updateLayer = useEngraver((s) => s.updateLayer)
  const maxR = useEngraver((s) => s.doc.diameterMM / 2)
  const update = (patch: Partial<RepeatLayer>) => updateLayer(layer.id, patch)

  const motifId = layer.source.kind === 'builtin' ? layer.source.motifId : ''
  const motif = getBuiltinMotif(motifId)

  return (
    <>
      <div className="field-group">
        <SegmentedControl
          label="Source"
          value={layer.source.kind}
          options={[
            { value: 'builtin', label: 'Library' },
            { value: 'asset', label: 'SVG' },
          ]}
          onChange={(kind) =>
            update({
              source:
                kind === 'builtin' ? { kind: 'builtin', motifId: 'chevron' } : { kind: 'asset', assetId: '' },
            })
          }
        />
        {layer.source.kind === 'builtin' ? (
          <Select
            label="Motif"
            value={motifId}
            options={BUILTIN_MOTIFS.map((m) => ({ value: m.id, label: m.label }))}
            onChange={(id) => update({ source: { kind: 'builtin', motifId: id } })}
          />
        ) : (
          <SvgAssetPicker
            label="Motif"
            value={layer.source.assetId || null}
            onChange={(assetId) => update({ source: { kind: 'asset', assetId } })}
          />
        )}
        <NumberField
          label="Count"
          value={layer.count}
          min={1}
          max={360}
          step={1}
          onChange={(count) => update({ count: Math.round(count) })}
        />
        <Slider label="" value={layer.count} min={1} max={120} step={1} onChange={(count) => update({ count })} />
      </div>
      <div className="field-group">
        <NumberField
          label="Radius"
          value={layer.radiusMM}
          min={0.1}
          max={maxR}
          step={0.05}
          unit="mm"
          onChange={(radiusMM) => update({ radiusMM })}
        />
        <NumberField
          label="Size"
          value={layer.sizeMM}
          min={0.2}
          max={maxR}
          step={0.05}
          unit="mm"
          onChange={(sizeMM) => update({ sizeMM })}
        />
        {motif?.paintType === 'stroke' && (
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
      </div>
      <div className="field-group">
        <SegmentedControl
          label="Align"
          value={layer.align}
          options={[
            { value: 'radial-out', label: 'Out' },
            { value: 'radial-in', label: 'In' },
            { value: 'upright', label: 'Up' },
            { value: 'custom', label: '…' },
          ]}
          onChange={(align) => update({ align })}
        />
        <NumberField
          label="Rotate"
          value={layer.rotationOffsetDeg}
          min={-180}
          max={180}
          step={1}
          unit="°"
          onChange={(rotationOffsetDeg) => update({ rotationOffsetDeg })}
        />
        <Toggle
          label="Alt. flip"
          value={layer.alternateFlip}
          onChange={(alternateFlip) => update({ alternateFlip })}
        />
      </div>
      <div className="field-group">
        <SegmentedControl
          label="Rows"
          value={String(layer.rows) as '1' | '2'}
          options={[
            { value: '1', label: 'Single' },
            { value: '2', label: 'Double' },
          ]}
          onChange={(rows) => update({ rows: rows === '2' ? 2 : 1 })}
        />
        {layer.rows === 2 && (
          <>
            <NumberField
              label="Row gap"
              value={layer.rowGapMM}
              min={0.1}
              max={5}
              step={0.05}
              unit="mm"
              onChange={(rowGapMM) => update({ rowGapMM })}
            />
            <Toggle
              label="Stagger"
              value={layer.staggerRow2}
              onChange={(staggerRow2) => update({ staggerRow2 })}
            />
            <Toggle label="Flip row 2" value={layer.flipRow2} onChange={(flipRow2) => update({ flipRow2 })} />
          </>
        )}
      </div>
    </>
  )
}
