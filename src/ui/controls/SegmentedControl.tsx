export interface SegmentedControlProps<T extends string> {
  label?: string
  value: T
  options: readonly { value: T; label: string; disabled?: boolean; title?: string }[]
  onChange: (value: T) => void
  /** Put the label on its own line and let the segments fill the panel width. */
  stack?: boolean
  /** Wrap the segments into a grid this many columns wide (for options too long for one row). */
  columns?: number
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  stack = false,
  columns,
}: SegmentedControlProps<T>) {
  const control = (
    <span
      className={columns ? 'segmented segmented-grid' : 'segmented'}
      style={columns ? { gridTemplateColumns: `repeat(${columns}, 1fr)` } : undefined}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={o.value === value ? 'active' : ''}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </span>
  )
  if (!label) return control
  return (
    <label className={stack ? 'field field-stack' : 'field'}>
      <span className="field-label">{label}</span>
      {control}
    </label>
  )
}
