import type { BooleanRole, HaloMode } from '../../model/types'
import { NumberField } from '../controls/NumberField'
import { SegmentedControl } from '../controls/SegmentedControl'

const MODE_OPTIONS: readonly { value: BooleanRole; label: string; title: string }[] = [
  { value: 'draw', label: 'Engrave', title: 'Engrave this layer' },
  { value: 'subtract', label: 'Cut out', title: 'Knock this shape out of the layers below' },
  { value: 'mask', label: 'Mask', title: 'Keep the layers below only inside this shape' },
]

/** Engrave / Cut out / Mask — shared by the four content-layer panels. */
export function BooleanModeControl({
  role,
  onChange,
}: {
  role: BooleanRole
  onChange: (role: BooleanRole) => void
}) {
  return (
    <>
      <SegmentedControl
        label="Mode"
        stack
        value={role}
        options={MODE_OPTIONS}
        onChange={onChange}
      />
      {role === 'mask' && <MaskReadout />}
    </>
  )
}

/** What a mask does — also names the stacking rule, since it isn't visible. */
function MaskReadout({ growMM = 0 }: { growMM?: number }) {
  return (
    <div className="readout">
      {`A window: draws nothing; every layer below is kept only inside this shape${
        growMM > 0 ? `, grown by ${growMM} mm` : ''
      }. Stacked masks intersect. Select it in the layer list.`}
    </div>
  )
}

export interface OverlayValues {
  booleanRole: BooleanRole
  haloMM: number
  haloMode: HaloMode
  haloStrokeMM: number
  invertOverBare: boolean
}

/**
 * How text (ring text, centre) sits over other layers — ringText + center.
 * Engrave: engraved, kept clear of the engraving beneath by a gap (the halo).
 * Cut out: knocked out of the engraving beneath; over bare metal it can
 * engrave instead (stamp reversal) so the shape never vanishes.
 * Mask: a window — the layers beneath survive only inside the shape (grown
 * by the halo); gap style and over-bare don't apply.
 */
export function OverlayControls({
  values,
  noun,
  onChange,
}: {
  values: OverlayValues
  /** 'text' | 'shape' — used in the explanatory readout. */
  noun: string
  onChange: (patch: Partial<OverlayValues>) => void
}) {
  const cut = values.booleanRole === 'subtract'
  const mode = (
    <SegmentedControl
      label="Mode"
      stack
      value={values.booleanRole}
      options={MODE_OPTIONS}
      onChange={(booleanRole) => onChange({ booleanRole })}
    />
  )
  if (values.booleanRole === 'mask') {
    return (
      <>
        {mode}
        <NumberField
          label="Grow"
          value={values.haloMM}
          min={0}
          max={3}
          step={0.05}
          unit="mm"
          onChange={(haloMM) => onChange({ haloMM })}
        />
        <MaskReadout growMM={values.haloMM} />
      </>
    )
  }
  return (
    <>
      {mode}
      <NumberField
        label={cut ? 'Grow' : 'Gap'}
        value={values.haloMM}
        min={0}
        max={3}
        step={0.05}
        unit="mm"
        onChange={(haloMM) => onChange({ haloMM })}
      />
      {cut ? (
        <SegmentedControl
          label="Over bare"
          value={values.invertOverBare ? 'engrave' : 'hide'}
          options={[
            { value: 'engrave', label: 'Engrave', title: 'Engrave the parts that cross bare metal (stamp reversal)' },
            { value: 'hide', label: 'Hide', title: 'Parts over bare metal have nothing to cut and vanish' },
          ]}
          onChange={(v) => onChange({ invertOverBare: v === 'engrave' })}
        />
      ) : (
        values.haloMM > 0 && (
          <>
            <SegmentedControl
              label="Gap style"
              value={values.haloMode}
              options={[
                { value: 'clear', label: 'Clear', title: 'Clear the engraving beneath' },
                { value: 'outline', label: 'Outline', title: 'Also engrave the gap boundary' },
              ]}
              onChange={(haloMode) => onChange({ haloMode })}
            />
            {values.haloMode === 'outline' && (
              <NumberField
                label="Outline"
                value={values.haloStrokeMM}
                min={0.05}
                max={1}
                step={0.01}
                unit="mm"
                onChange={(haloStrokeMM) => onChange({ haloStrokeMM })}
              />
            )}
          </>
        )
      )}
      <div className="readout">
        {cut
          ? `Knocked out of the engraving beneath${values.haloMM > 0 ? ', grown by the margin' : ''}; ${
              values.invertOverBare ? `where the ${noun} crosses bare metal it is engraved instead.` : `parts over bare metal vanish.`
            }`
          : values.haloMM > 0
            ? `Engraved on top; anything beneath is kept ${values.haloMM} mm clear so the ${noun} reads on fills and patterns.`
            : `Engraved on top with no gap — the ${noun} merges into any engraving beneath.`}
      </div>
    </>
  )
}
