export interface SegmentedControlProps<T extends string> {
  label?: string
  value: T
  options: readonly { value: T; label: string; disabled?: boolean; title?: string }[]
  onChange: (value: T) => void
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedControlProps<T>) {
  const control = (
    <span className="segmented">
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
    <label className="field">
      <span className="field-label">{label}</span>
      {control}
    </label>
  )
}
