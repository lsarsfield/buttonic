import type { StrokeCap, StrokeJoin } from '../../model/types'
import { SegmentedControl } from '../controls/SegmentedControl'

/**
 * Stroke end style (cap) + corner style (join) — shared by the repeat and hatch
 * panels. Pass `join`/handler only for layers with corners (hatch ticks are
 * straight, so it omits the corner control).
 */
export function StrokeStyleControls({
  cap,
  join,
  onChange,
}: {
  cap: StrokeCap
  join?: StrokeJoin
  onChange: (patch: { cap?: StrokeCap; join?: StrokeJoin }) => void
}) {
  return (
    <>
      <SegmentedControl
        label="Cap"
        value={cap}
        options={[
          { value: 'butt', label: 'Butt', title: 'No end cap' },
          { value: 'round', label: 'Round', title: 'Rounded ends' },
          { value: 'square', label: 'Square', title: 'Square ends' },
        ]}
        onChange={(cap) => onChange({ cap })}
      />
      {join !== undefined && (
        <SegmentedControl
          label="Corners"
          value={join}
          options={[
            { value: 'miter', label: 'Sharp', title: 'Sharp mitred corners' },
            { value: 'round', label: 'Round', title: 'Rounded corners' },
            { value: 'bevel', label: 'Bevel', title: 'Flattened corners' },
          ]}
          onChange={(join) => onChange({ join })}
        />
      )}
    </>
  )
}
