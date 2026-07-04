import { useEffect, useRef, useState } from 'react'
import { loadProjectFile, saveProject } from '../io/project'
import {
  boot as workspaceBoot,
  getStatus,
  onStatusChange,
  startWorkspaceAutosave,
  type WorkspaceStatus,
} from '../io/workspace'
import { redo, undo, useEngraver } from '../state/store'
import { useViewport } from '../state/viewport'
import { SvgStage } from '../render/SvgStage'
import { ExportDialog } from './dialogs/ExportDialog'
import { TemplatePicker } from './dialogs/TemplatePicker'
import { Inspector } from './Inspector'
import { LayerList } from './LayerList'
import { StatusBar } from './StatusBar'
import { Toolbar } from './Toolbar'

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)

type Dialog = 'none' | 'export' | 'templates'

const STATUS_MESSAGES: Record<WorkspaceStatus['kind'], string | null> = {
  ok: null,
  memory: 'Local storage is unavailable — this session won’t persist after you close the tab.',
  quota: 'Couldn’t save — browser storage is full. Delete old buttons or download this one.',
}

export function AppShell() {
  const [dialog, setDialog] = useState<Dialog>('none')
  const [statusNote, setStatusNote] = useState<string | null>(STATUS_MESSAGES[getStatus().kind])
  const [flash, setFlash] = useState<string | null>(null)
  const [dropDepth, setDropDepth] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showFlash = (message: string) => {
    setFlash(message)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 4000)
  }

  // Boot the workspace, then start autosave. Restart-safe under StrictMode:
  // boot() is module-memoized (restore happens once); autosave always starts
  // after restore resolves and always stops in cleanup.
  useEffect(() => {
    let cancelled = false
    let stop: (() => void) | undefined
    void workspaceBoot().then(() => {
      if (!cancelled) stop = startWorkspaceAutosave()
    })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [])

  useEffect(() => onStatusChange((s) => setStatusNote(STATUS_MESSAGES[s.kind])), [])

  // A missed drop must never navigate the tab away from unsaved work.
  useEffect(() => {
    const guard = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    window.addEventListener('dragover', guard)
    window.addEventListener('drop', guard)
    return () => {
      window.removeEventListener('dragover', guard)
      window.removeEventListener('drop', guard)
    }
  }, [])

  const loadFiles = async (files: FileList | File[]) => {
    let opened = 0
    let firstError: string | null = null
    for (const file of Array.from(files)) {
      const result = await loadProjectFile(file)
      if (result.ok) opened += 1
      else if (!firstError) firstError = result.error
    }
    if (opened > 0) showFlash(`Opened ${opened} button${opened === 1 ? '' : 's'}.`)
    if (firstError) showFlash(firstError)
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveProject(useEngraver.getState().doc)
        return
      }
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        fileRef.current?.click()
        return
      }
      if (e.key === 'Escape') {
        if (dialog !== 'none') setDialog('none')
        else useEngraver.getState().select(null)
        return
      }
      if (isTyping(e.target)) return
      const state = useEngraver.getState()
      if (mod && e.key.toLowerCase() === 'd') {
        if (state.selection) {
          e.preventDefault()
          state.duplicateLayer(state.selection)
        }
        return
      }
      switch (e.key) {
        case 'Delete':
        case 'Backspace':
          if (state.selection) state.removeLayer(state.selection)
          break
        case '[':
          if (state.selection) state.moveLayer(state.selection, -1)
          break
        case ']':
          if (state.selection) state.moveLayer(state.selection, 1)
          break
        case '0':
          useViewport.getState().zoomFit(state.doc.diameterMM)
          break
        case '=':
          useViewport.getState().zoomBy(1.3)
          break
        case '-':
          useViewport.getState().zoomBy(1 / 1.3)
          break
        case 'm':
        case 'M':
          state.setView({ mode: state.view.mode === 'metal' ? 'flat' : 'metal' })
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dialog])

  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files')
  const banner = flash ?? statusNote

  return (
    <div className="shell">
      <Toolbar
        onExport={() => setDialog('export')}
        onNew={() => setDialog('templates')}
        onOpen={() => fileRef.current?.click()}
      />
      <LayerList />
      <div
        className={`stage-pane${dropDepth > 0 ? ' drop-target' : ''}`}
        onDragEnter={(e) => {
          if (hasFiles(e)) setDropDepth((d) => d + 1)
        }}
        onDragLeave={(e) => {
          if (hasFiles(e)) setDropDepth((d) => Math.max(0, d - 1))
        }}
        onDragOver={(e) => {
          if (hasFiles(e)) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }
        }}
        onDrop={(e) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          setDropDepth(0)
          void loadFiles(e.dataTransfer.files)
        }}
      >
        <SvgStage />
        {dropDepth > 0 && <div className="drop-overlay">Drop to open</div>}
        {banner && (
          <div className="stage-banner">
            {banner}
            <button type="button" onClick={() => (flash ? setFlash(null) : setStatusNote(null))}>
              ✕
            </button>
          </div>
        )}
      </div>
      <Inspector />
      <StatusBar />
      <input
        ref={fileRef}
        type="file"
        accept=".json,.svg,application/json,image/svg+xml"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = e.target.files
          if (files && files.length > 0) void loadFiles(files)
          e.target.value = ''
        }}
      />
      {dialog === 'export' && <ExportDialog onClose={() => setDialog('none')} />}
      {dialog === 'templates' && <TemplatePicker onClose={() => setDialog('none')} />}
    </div>
  )
}
