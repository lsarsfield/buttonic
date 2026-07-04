export interface SelectProps<T extends string> {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}

export function Select<T extends string>({ label, value, options, onChange }: SelectProps<T>) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
