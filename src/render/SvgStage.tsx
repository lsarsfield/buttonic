import { useEffect, useRef, useState } from 'react'
import { useEngraver } from '../state/store'
import { screenToMM, useViewport } from '../state/viewport'
import { xyToPolar } from '../geometry/polar'
import { DocRenderer } from './DocRenderer'
import { FINISHES, MetalDefs } from './MetalPreview'
import { Guides } from './overlays/Guides'
import { Handles } from './overlays/Handles'

/**
 * The mm-true stage: one <svg> filling the pane, a zoom/pan group in screen
 * px, and inside it the document in millimetre coordinates centred on the
 * button axis. `<g id="doc">` stays pristine — the export subtree — while
 * guides and handles live in a sibling overlay group.
 */
export function SvgStage() {
  const svgRef = useRef<SVGSVGElement>(null)
  const [spaceDown, setSpaceDown] = useState(false)
  const pan = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null)

  const { scale, tx, ty } = useViewport()
  const diameterMM = useEngraver((s) => s.doc.diameterMM)
  const finish = useEngraver((s) => s.doc.finish)
  const artboardLight = useEngraver((s) => s.view.artboardLight)
  const metal = useEngraver((s) => s.view.mode === 'metal')
  const lightDeg = useEngraver((s) => s.view.lightDeg)
  const select = useEngraver((s) => s.select)

  // Track pane size; fit the button on first layout.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const vp = useViewport.getState()
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      vp.setSize(width, height)
      if (!useViewport.getState().fitted) vp.zoomFit(useEngraver.getState().doc.diameterMM)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Wheel: plain = pan, ctrl/cmd (and trackpad pinch) = zoom to cursor.
  // Attached natively because wheel listeners must be non-passive to preventDefault.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const vp = useViewport.getState()
      if (e.ctrlKey || e.metaKey) {
        vp.zoomAt(px, py, Math.exp(-e.deltaY * 0.0022))
      } else {
        vp.panBy(-e.deltaX, -e.deltaY)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Space-drag panning.
  useEffect(() => {
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e.target)) {
        e.preventDefault()
        setSpaceDown(true)
        useViewport.getState().setSpaceDown(true)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpaceDown(false)
        useViewport.getState().setSpaceDown(false)
      }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const panButton = e.button === 1 || (e.button === 0 && spaceDown)
    if (panButton) {
      e.preventDefault()
      svgRef.current?.setPointerCapture(e.pointerId)
      pan.current = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY }
    } else if (e.button === 0 && e.target === e.currentTarget) {
      select(null)
    }
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (pan.current && e.pointerId === pan.current.pointerId) {
      useViewport.getState().panBy(e.clientX - pan.current.lastX, e.clientY - pan.current.lastY)
      pan.current.lastX = e.clientX
      pan.current.lastY = e.clientY
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const { x, y } = screenToMM(e.clientX - rect.left, e.clientY - rect.top)
    const { thetaDeg, rMM } = xyToPolar(x, y)
    useViewport.getState().setCursor({ xMM: x, yMM: y, thetaDeg, rMM })
  }

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (pan.current && e.pointerId === pan.current.pointerId) {
      svgRef.current?.releasePointerCapture(e.pointerId)
      pan.current = null
    }
  }

  const faceR = diameterMM / 2

  return (
    <svg
      ref={svgRef}
      className="stage"
      style={{ cursor: spaceDown || pan.current ? 'grab' : 'default' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => useViewport.getState().setCursor(null)}
    >
      {metal && <MetalDefs finish={finish} lightDeg={lightDeg} faceR={faceR} />}
      <g transform={`translate(${tx} ${ty}) scale(${scale})`}>
        {/* Backdrop: the physical button blank. Not part of the export subtree. */}
        <g id="backdrop">
          {metal ? (
            <g
              onPointerDown={(e) => {
                if (e.button === 0 && !spaceDown) select(null)
              }}
            >
              <circle r={faceR} fill="url(#metal-plate)" />
              <circle r={faceR} filter="url(#metal-grain)" opacity={FINISHES[finish].grainOpacity} />
              <circle r={faceR} fill="url(#metal-sheen)" />
            </g>
          ) : (
            <circle
              r={faceR}
              fill={artboardLight ? '#e9e7e2' : 'var(--face)'}
              stroke={artboardLight ? '#c9c6bf' : 'var(--face-edge)'}
              strokeWidth={1.5 / scale}
              onPointerDown={(e) => {
                if (e.button === 0 && !spaceDown) select(null)
              }}
            />
          )}
        </g>
        <g
          id="doc"
          style={{ color: metal ? FINISHES[finish].engrave : artboardLight ? '#2a2b30' : 'var(--engrave)' }}
          filter={metal ? 'url(#engrave-cut)' : undefined}
        >
          <DocRenderer />
        </g>
        <g id="overlays">
          <Guides />
          <Handles />
        </g>
      </g>
    </svg>
  )
}
