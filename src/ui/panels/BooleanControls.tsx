import type { BooleanRole, HaloMode } from '../../model/types'
import { NumberField } from '../controls/NumberField'
import { SegmentedControl } from '../controls/SegmentedControl'

/** Engrave vs Cut-out — shared by the four content-layer panels. */
export function BooleanModeControl({
  role,
  onChange,
}: {
  role: BooleanRole
  onChange: (role: BooleanRole) => void
}) {
  return (
    <SegmentedControl
      label="Mode"
      value={role}
      options={[
        { value: 'draw', label: 'Engrave', title: 'Engrave this layer' },
        { value: 'subtract', label: 'Cut out', title: 'Knock this shape out of filled layers below' },
      ]}
      onChange={onChange}
    />
  )
}

export interface HaloValues {
  haloMM: number
  haloMode: HaloMode
  haloStrokeMM: number
}

/** Halo (shape-following keepout) — ringText + center only. */
export function HaloControls({
  values,
  onChange,
}: {
  values: HaloValues
  onChange: (patch: Partial<HaloValues>) => void
}) {
  return (
    <>
      <NumberField
        label="Halo"
        value={values.haloMM}
        min={0}
        max={3}
        step={0.05}
        unit="mm"
        onChange={(haloMM) => onChange({ haloMM })}
      />
      {values.haloMM > 0 && (
        <>
          <SegmentedControl
            label="Halo style"
            value={values.haloMode}
            options={[
              { value: 'clear', label: 'Clear', title: 'Clear the pattern beneath' },
              { value: 'outline', label: 'Outline', title: 'Also engrave the halo boundary' },
            ]}
            onChange={(haloMode) => onChange({ haloMode })}
          />
          {values.haloMode === 'outline' && (
            <NumberField
              label="Halo stroke"
              value={values.haloStrokeMM}
              min={0.05}
              max={1}
              step={0.01}
              unit="mm"
              onChange={(haloStrokeMM) => onChange({ haloStrokeMM })}
            />
          )}
        </>
      )}
    </>
  )
}
