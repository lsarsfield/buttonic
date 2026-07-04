import { useEffect, useRef, useState } from 'react'
import { presetReferenceA } from '../model/presets'
import { readAutosave, saveProject, startAutosave } from '../io/project'
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

export function AppShell() {
  const [dialog, setDialog] = useState<Dialog>('none')
  const [restored, setRestored] = useState(false)
  const booted = useRef(false)

  // Boot: restore the autosaved session, or open Reference A as the first-run
  // showcase; autosave from then on.
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    const saved = readAutosave()
    if (saved) {
      useEngraver.getState().setDoc(saved)
      useEngraver.temporal.getState().clear()
      setRestored(true)
    } else {
      useEngraver.getState().setDoc(presetReferenceA())
      useEngraver.temporal.getState().clear()
    }
    return startAutosave()
  }, [])

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

  return (
    <div className="shell">
      <Toolbar onExport={() => setDialog('export')} onNew={() => setDialog('templates')} />
      <LayerList />
      <div className="stage-pane">
        <SvgStage />
        {restored && (
          <div className="restore-banner">
            Restored your last session.
            <button type="button" onClick={() => setRestored(false)}>
              OK
            </button>
            <button
              type="button"
              onClick={() => {
                setRestored(false)
                setDialog('templates')
              }}
            >
              Start fresh…
            </button>
          </div>
        )}
      </div>
      <Inspector />
      <StatusBar />
      {dialog === 'export' && <ExportDialog onClose={() => setDialog('none')} />}
      {dialog === 'templates' && <TemplatePicker onClose={() => setDialog('none')} />}
    </div>
  )
}
