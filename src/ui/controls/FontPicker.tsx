import { useRef, useState } from 'react'
import { fontOptions, uploadFont } from '../../io/fonts'
import { useEngraver } from '../../state/store'

export interface FontPickerProps {
  value: string
  onChange: (fontId: string) => void
}

/** Bundled + doc-embedded fonts, with .ttf/.otf upload. */
export function FontPicker({ value, onChange }: FontPickerProps) {
  const doc = useEngraver((s) => s.doc)
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  const options = fontOptions(doc)
  const known = options.some((o) => o.value === value)

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    const result = await uploadFont(file)
    if (result.ok) onChange(result.fontId)
    else setError(result.error)
  }

  return (
    <>
      <label className="field">
        <span className="field-label">Font</span>
        <select value={known ? value : ''} onChange={(e) => onChange(e.target.value)}>
          {!known && <option value="">— missing font —</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button type="button" title="Upload a .ttf or .otf font" onClick={() => fileRef.current?.click()}>
          ⤒
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".ttf,.otf,font/ttf,font/otf"
          style={{ display: 'none' }}
          onChange={onFile}
        />
      </label>
      {error && <div className="warning-note">{error}</div>}
    </>
  )
}
