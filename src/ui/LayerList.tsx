import { useRef, useState } from 'react'
import type { Layer, LayerType } from '../model/types'
import { LAYER_TYPE_LABELS } from '../model/types'
import { useEngraver } from '../state/store'

const TYPE_BADGES: Record<LayerType, string> = {
  ring: 'RG',
  hatch: 'HT',
  repeat: 'RP',
  ringText: 'TX',
  center: 'CT',
  bend: 'BD',
}

const ADDABLE: LayerType[] = ['ring', 'hatch', 'repeat', 'ringText', 'center', 'bend']

export function LayerList() {
  const layers = useEngraver((s) => s.doc.layers)
  const selection = useEngraver((s) => s.selection)
  const addLayer = useEngraver((s) => s.addLayer)
  const [menuOpen, setMenuOpen] = useState(false)
  const dragId = useRef<string | null>(null)

  return (
    <div className="panel layers-panel">
      <div className="panel-header">
        <span className="panel-title">Layers</span>
        <span className="panel-hint">centre → rim</span>
        <div className="add-layer">
          <button type="button" className="button-primary" onClick={() => setMenuOpen((o) => !o)}>
            + Add
          </button>
          {menuOpen && (
            <>
              <div className="menu-backdrop" onPointerDown={() => setMenuOpen(false)} />
              <div className="menu">
                {ADDABLE.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      addLayer(type)
                      setMenuOpen(false)
                    }}
                  >
                    <span className="badge">{TYPE_BADGES[type]}</span>
                    {LAYER_TYPE_LABELS[type]}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="layer-rows">
        {layers.length === 0 && <div className="empty-note">No layers yet — add one above.</div>}
        {layers.map((layer, index) => (
          <LayerRow
            key={layer.id}
            layer={layer}
            index={index}
            selected={layer.id === selection}
            dragId={dragId}
          />
        ))}
      </div>
    </div>
  )
}

function LayerRow({
  layer,
  index,
  selected,
  dragId,
}: {
  layer: Layer
  index: number
  selected: boolean
  dragId: React.MutableRefObject<string | null>
}) {
  const select = useEngraver((s) => s.select)
  const updateLayer = useEngraver((s) => s.updateLayer)
  const removeLayer = useEngraver((s) => s.removeLayer)
  const duplicateLayer = useEngraver((s) => s.duplicateLayer)
  const moveLayerTo = useEngraver((s) => s.moveLayerTo)
  const [renaming, setRenaming] = useState(false)

  return (
    <div
      className={`layer-row${selected ? ' selected' : ''}${layer.visible ? '' : ' hidden-layer'}`}
      onPointerDown={() => select(layer.id)}
      draggable={!renaming}
      onDragStart={(e) => {
        dragId.current = layer.id
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        e.preventDefault()
        if (dragId.current && dragId.current !== layer.id) {
          moveLayerTo(dragId.current, index)
        }
      }}
      onDragEnd={() => {
        dragId.current = null
      }}
    >
      <button
        type="button"
        className={`eye${layer.visible ? '' : ' off'}`}
        title={layer.visible ? 'Hide layer' : 'Show layer'}
        onClick={(e) => {
          e.stopPropagation()
          updateLayer(layer.id, { visible: !layer.visible })
        }}
      >
        {layer.visible ? '●' : '○'}
      </button>
      <span className="badge" title={LAYER_TYPE_LABELS[layer.type]}>
        {TYPE_BADGES[layer.type]}
      </span>
      {renaming ? (
        <input
          className="rename-input"
          autoFocus
          defaultValue={layer.name}
          onBlur={(e) => {
            const name = e.target.value.trim()
            if (name) updateLayer(layer.id, { name })
            setRenaming(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setRenaming(false)
          }}
        />
      ) : (
        <span className="layer-name" onDoubleClick={() => setRenaming(true)}>
          {layer.name}
        </span>
      )}
      <span className="layer-actions">
        <button
          type="button"
          title="Duplicate layer"
          onClick={(e) => {
            e.stopPropagation()
            duplicateLayer(layer.id)
          }}
        >
          ⧉
        </button>
        <button
          type="button"
          title="Delete layer"
          onClick={(e) => {
            e.stopPropagation()
            removeLayer(layer.id)
          }}
        >
          ✕
        </button>
      </span>
    </div>
  )
}
