import { useEngraver } from '../state/store'
import { useViewport } from '../state/viewport'

export function StatusBar() {
  const layerCount = useEngraver((s) => s.doc.layers.length)
  const cursor = useViewport((s) => s.cursor)
  const scale = useViewport((s) => s.scale)

  return (
    <div className="statusbar">
      <span>
        {layerCount} layer{layerCount === 1 ? '' : 's'}
      </span>
      <span className="statusbar-spacer" />
      <span className="statusbar-readout">
        {cursor ? `r ${cursor.rMM.toFixed(2)} mm · θ ${cursor.thetaDeg.toFixed(1)}°` : '—'}
      </span>
      <span className="statusbar-zoom">{scale.toFixed(1)} px/mm</span>
    </div>
  )
}
