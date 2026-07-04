import { useRef, useState } from 'react'
import { fontOptions, getFontError, getLoadedFont, uploadFont } from '../../io/fonts'
import { embedLocalFont, resolveLocalFonts } from '../../io/localFonts'
import { isLocalFontId } from '../../model/types'
import { useEngraver } from '../../state/store'
import { LocalFontDialog } from '../dialogs/LocalFontDialog'

export interface FontPickerProps {
  value: string
  onChange: (fontId: string) => void
}

/** Bundled + doc-embedded + machine-local fonts, with upload and local browse. */
export function FontPicker({ value, onChange }: FontPickerProps) {
  const doc = useEngraver((s) => s.doc)
  const fontsRevision = useEngraver((s) => s.fontsRevision)
  void fontsRevision // re-render when async font loads land
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [localDialog, setLocalDialog] = useState(false)
  const [relinking, setRelinking] = useState(false)

  const options = fontOptions(doc)
  const known = options.some((o) => o.value === value)
  const isLocal = isLocalFontId(value)
  const localLoaded = isLocal && getLoadedFont(value) !== null
  const localMissing = isLocal && !localLoaded
  const missingDetail = localMissing ? getFontError(value) : null

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    const result = await uploadFont(file)
    if (result.ok) onChange(result.fontId)
    else setError(result.error)
  }

  const relink = async () => {
    setRelinking(true)
    setError(null)
    const outcome = await resolveLocalFonts(doc, { interactive: true })
    setRelinking(false)
    if (outcome.missing.length > 0 && outcome.resolved === 0) {
      setError(getFontError(value) ?? 'Some local fonts are still unavailable.')
    }
  }

  const embed = () => {
    setError(null)
    const result = embedLocalFont(value, doc)
    if (result.ok) {
      // layers were repointed to the new embedded asset id; follow along
      const layer = useEngraver
        .getState()
        .doc.layers.find((l) => (l.type === 'ringText' || l.type === 'center') && l.fontId !== value)
      if (layer && (layer.type === 'ringText' || layer.type === 'center')) onChange(layer.fontId)
    } else {
      setError(result.error)
    }
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
        <button
          type="button"
          title="Browse fonts installed on this machine"
          onClick={() => setLocalDialog(true)}
        >
          Local…
        </button>
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
      {localMissing && (
        <div className="field">
          <span className="field-label" />
          <span className="local-missing">
            <span className="warning-note" style={{ padding: 0 }}>
              {missingDetail ?? 'This local font isn’t loaded on this machine.'}
            </span>
            <button type="button" disabled={relinking} onClick={() => void relink()}>
              {relinking ? 'Re-linking…' : 'Re-link local fonts'}
            </button>
          </span>
        </div>
      )}
      {localLoaded && (
        <div className="field">
          <span className="field-label" />
          <span className="local-missing">
            <span className="readout" style={{ padding: 0 }}>
              Local reference — renders only where this font is installed.
            </span>
            <button
              type="button"
              title="Copy the font into the project so it renders everywhere (mind the font’s license)"
              onClick={embed}
            >
              Embed
            </button>
          </span>
        </div>
      )}
      {error && <div className="warning-note">{error}</div>}
      {localDialog && <LocalFontDialog onPick={onChange} onClose={() => setLocalDialog(false)} />}
    </>
  )
}
