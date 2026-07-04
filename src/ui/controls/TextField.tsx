import { useState } from 'react'

export interface TextFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  maxLength?: number
  placeholder?: string
}

/** Text input that commits on Enter/blur — one undo step per edit, not per keystroke. */
export function TextField({ label, value, onChange, maxLength, placeholder }: TextFieldProps) {
  const [draft, setDraft] = useState<string | null>(null)

  const commit = () => {
    if (draft !== null && draft !== value) onChange(draft)
    setDraft(null)
  }

  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          type="text"
          value={draft ?? value}
          maxLength={maxLength}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit()
              e.currentTarget.blur()
            } else if (e.key === 'Escape') {
              setDraft(null)
              e.currentTarget.blur()
            }
          }}
        />
      </span>
    </label>
  )
}
