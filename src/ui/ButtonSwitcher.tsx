import { useEffect, useState } from 'react'
import {
  currentId,
  downloadEntry,
  duplicate,
  list,
  open as openEntry,
  remove,
  type WorkspaceMeta,
} from '../io/workspace'
import { useEngraver } from '../state/store'

function relTime(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

/**
 * Toolbar document control: the name input plus a popover listing every
 * button cached in the local workspace.
 */
export function ButtonSwitcher({ onNew }: { onNew: () => void }) {
  const docName = useEngraver((s) => s.doc.name)
  const updateDocMeta = useEngraver((s) => s.updateDocMeta)
  const [open, setOpen] = useState(false)
  const [metas, setMetas] = useState<WorkspaceMeta[] | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [errorId, setErrorId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setMetas(null)
      setConfirmId(null)
      setErrorId(null)
      return
    }
    let alive = true
    void list().then((m) => {
      if (alive) setMetas(m)
    })
    return () => {
      alive = false
    }
  }, [open])

  const refresh = () => void list().then(setMetas)
  const active = currentId()

  return (
    <div className="doc-switcher">
      <input
        className="doc-name"
        value={docName}
        onChange={(e) => updateDocMeta({ name: e.target.value })}
        spellCheck={false}
      />
      <button
        type="button"
        className={`switcher-chevron${open ? ' active' : ''}`}
        title="Your buttons"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ▾
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onPointerDown={() => setOpen(false)} />
          <div
            className="switcher-popover"
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation() // AppShell's Escape would deselect the canvas
                setOpen(false)
              }
            }}
          >
            {metas === null && <div className="empty-note">Loading…</div>}
            {metas?.length === 0 && <div className="empty-note">No cached buttons yet.</div>}
            {metas?.map((meta) => {
              const isActive = meta.id === active
              if (confirmId === meta.id) {
                return (
                  <div key={meta.id} className="switcher-row confirm">
                    <span className="switcher-confirm-text">Delete “{meta.name}”?</span>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        setConfirmId(null)
                        void remove(meta.id).then(refresh)
                      }}
                    >
                      Delete
                    </button>
                    <button type="button" onClick={() => setConfirmId(null)}>
                      Cancel
                    </button>
                  </div>
                )
              }
              return (
                <div
                  key={meta.id}
                  className={`switcher-row${isActive ? ' active' : ''}`}
                  onClick={() => {
                    if (isActive) return
                    void openEntry(meta.id).then((ok) => {
                      if (ok) setOpen(false)
                      else setErrorId(meta.id)
                    })
                  }}
                >
                  {meta.thumbSvg ? (
                    <img
                      className="switcher-thumb"
                      alt=""
                      src={`data:image/svg+xml,${encodeURIComponent(meta.thumbSvg)}`}
                    />
                  ) : (
                    <span className="switcher-thumb placeholder">◉</span>
                  )}
                  <span className="switcher-name">
                    {meta.name}
                    {errorId === meta.id && (
                      <span className="switcher-error"> — couldn’t open</span>
                    )}
                  </span>
                  <span className="switcher-time">{relTime(meta.updatedAt)}</span>
                  <span className="switcher-actions">
                    <button
                      type="button"
                      title="Duplicate"
                      onClick={(e) => {
                        e.stopPropagation()
                        void duplicate(meta.id).then(() => setOpen(false))
                      }}
                    >
                      ⧉
                    </button>
                    <button
                      type="button"
                      title="Download .json"
                      onClick={(e) => {
                        e.stopPropagation()
                        void downloadEntry(meta.id)
                      }}
                    >
                      ⬇
                    </button>
                    <button
                      type="button"
                      title="Delete"
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmId(meta.id)
                      }}
                    >
                      ✕
                    </button>
                  </span>
                </div>
              )
            })}
            <button
              type="button"
              className="switcher-new"
              onClick={() => {
                setOpen(false)
                onNew()
              }}
            >
              + New button…
            </button>
          </div>
        </>
      )}
    </div>
  )
}
