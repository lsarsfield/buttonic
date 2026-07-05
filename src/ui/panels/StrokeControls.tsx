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
  allowPoint = false,
  onChange,
}: {
  cap: StrokeCap
  join?: StrokeJoin
  /** Offer a 'point' cap (hatch only — synthesized as filled tapered geometry). */
  allowPoint?: boolean
  onChange: (patch: { cap?: StrokeCap; join?: StrokeJoin }) => void
}) {
  const capOptions: { value: StrokeCap; label: string; title: string }[] = [
    { value: 'butt', label: 'Butt', title: 'No end cap' },
    { value: 'round', label: 'Round', title: 'Rounded ends' },
    { value: 'square', label: 'Square', title: 'Square ends' },
    ...(allowPoint ? [{ value: 'point' as const, label: 'Point', title: 'Taper to a point' }] : []),
  ]
  return (
    <>
      <SegmentedControl label="Cap" value={cap} options={capOptions} onChange={(cap) => onChange({ cap })} />
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
