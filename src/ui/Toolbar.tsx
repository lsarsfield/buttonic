import { redo, undo, useCanRedo, useCanUndo, useEngraver } from '../state/store'
import { useViewport } from '../state/viewport'
import { SegmentedControl } from './controls/SegmentedControl'

export function Toolbar({ onExport, onNew }: { onExport: () => void; onNew: () => void }) {
  const doc = useEngraver((s) => s.doc)
  const view = useEngraver((s) => s.view)
  const setView = useEngraver((s) => s.setView)
  const updateDocMeta = useEngraver((s) => s.updateDocMeta)
  const canUndo = useCanUndo()
  const canRedo = useCanRedo()

  return (
    <div className="toolbar">
      <span className="wordmark">◉ Buttonic</span>
      <button type="button" onClick={onNew} title="New from template">
        New
      </button>
      <input
        className="doc-name"
        value={doc.name}
        onChange={(e) => updateDocMeta({ name: e.target.value })}
        spellCheck={false}
      />
      <span className="toolbar-spacer" />
      <div className="toolbar-group">
        <button type="button" disabled={!canUndo} onClick={undo} title="Undo (⌘Z)">
          ↩
        </button>
        <button type="button" disabled={!canRedo} onClick={redo} title="Redo (⇧⌘Z)">
          ↪
        </button>
      </div>
      <div className="toolbar-group">
        <button type="button" onClick={() => useViewport.getState().zoomBy(1 / 1.3)} title="Zoom out (−)">
          −
        </button>
        <button
          type="button"
          onClick={() => useViewport.getState().zoomFit(useEngraver.getState().doc.diameterMM)}
          title="Zoom to fit (0)"
        >
          fit
        </button>
        <button type="button" onClick={() => useViewport.getState().zoomBy(1.3)} title="Zoom in (=)">
          +
        </button>
      </div>
      <div className="toolbar-group">
        <button
          type="button"
          className={view.showGuides ? 'active' : ''}
          onClick={() => setView({ showGuides: !view.showGuides })}
          title="Toggle guides"
        >
          ◔
        </button>
        <button
          type="button"
          className={view.snapping ? 'active' : ''}
          onClick={() => setView({ snapping: !view.snapping })}
          title="Toggle snapping (Alt bypasses while dragging)"
        >
          snap
        </button>
      </div>
      <SegmentedControl
        value={view.mode}
        options={[
          { value: 'flat', label: 'Flat' },
          { value: 'metal', label: 'Metal', title: 'Embossed metal preview (M)' },
        ]}
        onChange={(mode) => setView({ mode })}
      />
      {view.mode === 'metal' && (
        <span className="light-control" title="Light angle">
          <span className="light-icon">☀</span>
          <input
            type="range"
            min={0}
            max={360}
            step={1}
            value={view.lightDeg}
            onChange={(e) => setView({ lightDeg: Number(e.target.value) })}
          />
        </span>
      )}
      <button type="button" className="button-primary" onClick={onExport}>
        Export
      </button>
    </div>
  )
}
