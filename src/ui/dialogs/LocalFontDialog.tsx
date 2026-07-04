import { useMemo, useState } from 'react'
import {
  isLocalFontsSupported,
  linkLocalFont,
  queryLocalFontList,
  type LocalFontItem,
  type LocalFontQueryFailure,
} from '../../io/localFonts'

type Phase =
  | { kind: 'intro' }
  | { kind: 'loading' }
  | { kind: 'list'; fonts: LocalFontItem[] }
  | { kind: 'failed'; reason: LocalFontQueryFailure; error: string }

const MAX_ROWS = 240

/**
 * Browse the machine's installed fonts (Local Font Access API). Previews are
 * plain CSS font-family — the font is installed, so the browser renders it
 * for free; only a chosen font's bytes are ever read.
 */
export function LocalFontDialog({
  onPick,
  onClose,
}: {
  onPick: (fontId: string) => void
  onClose: () => void
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'intro' })
  const [filter, setFilter] = useState('')
  const [rowError, setRowError] = useState<{ psName: string; message: string } | null>(null)
  const [linking, setLinking] = useState<string | null>(null)

  const browse = async () => {
    setPhase({ kind: 'loading' })
    const result = await queryLocalFontList()
    if (result.ok) setPhase({ kind: 'list', fonts: result.fonts })
    else setPhase({ kind: 'failed', reason: result.reason, error: result.error })
  }

  const pick = async (item: LocalFontItem) => {
    setRowError(null)
    setLinking(item.postscriptName)
    const result = await linkLocalFont(item)
    setLinking(null)
    if (result.ok) {
      onPick(result.fontId)
      onClose()
    } else {
      setRowError({ psName: item.postscriptName, message: result.error })
    }
  }

  const shown = useMemo(() => {
    if (phase.kind !== 'list') return []
    const q = filter.trim().toLowerCase()
    const matched = q
      ? phase.fonts.filter(
          (f) => f.family.toLowerCase().includes(q) || f.fullName.toLowerCase().includes(q),
        )
      : phase.fonts
    return matched.slice(0, MAX_ROWS)
  }, [phase, filter])

  const total = phase.kind === 'list' ? phase.fonts.length : 0

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal local-font-modal" onPointerDown={(e) => e.stopPropagation()}>
        <div className="modal-title">Use a local font</div>

        {phase.kind === 'intro' && (
          <>
            <p className="modal-blurb">
              Buttonic can list the fonts installed on this machine and engrave with them. The
              browser will ask permission once; font data is read only for fonts you pick, and
              nothing leaves your computer.
            </p>
            <p className="modal-blurb">
              Projects store local fonts as <em>references</em> — on machines without the font,
              the design keeps its settings but that text won’t render until re-linked.
              Exported SVG/PNG always contain outlines and work everywhere.
            </p>
            {!isLocalFontsSupported() && (
              <p className="warning-note" style={{ padding: 0 }}>
                This browser doesn’t support local font access (Chrome and Edge do). You can
                upload a .ttf/.otf file from the font picker instead.
              </p>
            )}
            <div className="modal-actions">
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="button-primary"
                disabled={!isLocalFontsSupported()}
                onClick={browse}
              >
                Allow &amp; browse fonts
              </button>
            </div>
          </>
        )}

        {phase.kind === 'loading' && <p className="modal-blurb">Reading the font list…</p>}

        {phase.kind === 'failed' && (
          <>
            <p className="warning-note" style={{ padding: 0 }}>
              {phase.error}
            </p>
            <div className="modal-actions">
              <button type="button" onClick={onClose}>
                Close
              </button>
              {phase.reason === 'gesture' && (
                <button type="button" className="button-primary" onClick={browse}>
                  Try again
                </button>
              )}
            </div>
          </>
        )}

        {phase.kind === 'list' && (
          <>
            <div className="field">
              <span className="field-label">Search</span>
              <span className="field-input">
                <input
                  autoFocus
                  type="text"
                  value={filter}
                  placeholder={`${total} fonts…`}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </span>
            </div>
            <div className="local-font-list">
              {shown.map((item) => (
                <div key={item.postscriptName}>
                  <button
                    type="button"
                    className="local-font-row"
                    disabled={linking !== null}
                    onClick={() => void pick(item)}
                  >
                    <span className="local-font-preview" style={{ fontFamily: `"${item.family}"` }}>
                      {item.family}
                    </span>
                    <span className="local-font-style">{item.style}</span>
                    {linking === item.postscriptName && <span className="local-font-style">…</span>}
                  </button>
                  {rowError?.psName === item.postscriptName && (
                    <div className="warning-note" style={{ paddingLeft: 10 }}>
                      {rowError.message}
                    </div>
                  )}
                </div>
              ))}
              {shown.length === 0 && <div className="empty-note">No fonts match.</div>}
              {phase.fonts.length > MAX_ROWS && shown.length === MAX_ROWS && (
                <div className="empty-note">Showing the first {MAX_ROWS} — keep typing to narrow.</div>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
