export interface ToggleProps {
  label: string
  value: boolean
  onChange: (value: boolean) => void
}

export function Toggle({ label, value, onChange }: ToggleProps) {
  return (
    <label className="field field-toggle">
      <span className="field-label">{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}
