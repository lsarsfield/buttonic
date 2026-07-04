import { useRef } from 'react'
import type { Layer } from '../../model/types'
import { normDeg, polarToXY, xyToPolar } from '../../geometry/polar'
import { beginGesture, endGesture, useEngraver } from '../../state/store'
import { screenToMM, useViewport } from '../../state/viewport'
import { snapAngle, snapRadius } from '../../ui/snap'
import { layerBand } from '../DocRenderer'

interface RadiusGrip {
  key: string
  rMM: number
  min: number
  max: number
}

function radiusGrips(layer: Layer, maxR: number): RadiusGrip[] {
  switch (layer.type) {
    case 'ring':
      return layer.mode === 'annulus'
        ? [
            { key: 'rInnerMM', rMM: layer.rInnerMM, min: 0, max: layer.rOuterMM - 0.05 },
            { key: 'rOuterMM', rMM: layer.rOuterMM, min: layer.rInnerMM + 0.05, max: maxR },
          ]
        : [{ key: 'radiusMM', rMM: layer.radiusMM, min: 0.1, max: maxR }]
    case 'hatch':
    case 'bend':
      return [
        { key: 'rInnerMM', rMM: layer.rInnerMM, min: 0, max: layer.rOuterMM - 0.05 },
        { key: 'rOuterMM', rMM: layer.rOuterMM, min: layer.rInnerMM + 0.05, max: maxR },
      ]
    case 'repeat':
    case 'ringText':
      return [{ key: 'radiusMM', rMM: layer.radiusMM, min: 0.1, max: maxR }]
    case 'center':
      return []
  }
}

/** Signed representation in (-180, 180] for the phase field. */
const toSignedDeg = (deg: number) => {
  const d = normDeg(deg)
  return d > 180 ? d - 360 : d
}

/**
 * Canvas manipulation for the selected layer: square grips on the right
 * (θ = 90°) drag band radii; the round grip just outside the band drags
 * phase. Every drag is one undo step and honours snapping.
 */
export function Handles() {
  const layer = useEngraver((s) => s.doc.layers.find((l) => l.id === s.selection) ?? null)
  const diameterMM = useEngraver((s) => s.doc.diameterMM)
  const scale = useViewport((s) => s.scale)

  if (!layer || !layer.visible) return null
  const maxR = diameterMM / 2 + 2
  const grips = radiusGrips(layer, maxR)
  const band = layerBand(layer)
  const phaseR = Math.min(band.rOuter + 1.1, maxR + 1)
  const px = (n: number) => n / scale

  return (
    <g>
      {grips.map((grip) => (
        <RadiusGripEl key={grip.key} layerId={layer.id} grip={grip} px={px} />
      ))}
      <PhaseGripEl layerId={layer.id} phaseDeg={layer.phaseDeg} rMM={phaseR} px={px} />
    </g>
  )
}

/** Pointer-capture drag reporting positions in document mm. */
function useMMDrag(onDragMM: (x: number, y: number, e: PointerEvent | React.PointerEvent) => void) {
  const active = useRef(false)
  return {
    onPointerDown: (e: React.PointerEvent<SVGElement>) => {
      if (e.button !== 0) return
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      active.current = true
      beginGesture()
    },
    onPointerMove: (e: React.PointerEvent<SVGElement>) => {
      if (!active.current) return
      const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement
      if (!svg) return
      const rect = svg.getBoundingClientRect()
      const mm = screenToMM(e.clientX - rect.left, e.clientY - rect.top)
      onDragMM(mm.x, mm.y, e)
    },
    onPointerUp: (e: React.PointerEvent<SVGElement>) => {
      if (!active.current) return
      active.current = false
      e.currentTarget.releasePointerCapture(e.pointerId)
      endGesture()
    },
  }
}

function RadiusGripEl({
  layerId,
  grip,
  px,
}: {
  layerId: string
  grip: RadiusGrip
  px: (n: number) => number
}) {
  const updateLayer = useEngraver((s) => s.updateLayer)
  const snapping = useEngraver((s) => s.view.snapping)
  const drag = useMMDrag((x, y, e) => {
    const r = Math.hypot(x, y)
    const snapped = snapRadius(r, e, snapping)
    const clamped = Math.max(grip.min, Math.min(grip.max, snapped))
    updateLayer(layerId, { [grip.key]: Number(clamped.toFixed(3)) } as Partial<Layer>)
  })
  const size = px(9)
  return (
    <rect
      x={grip.rMM - size / 2}
      y={-size / 2}
      width={size}
      height={size}
      fill="var(--accent)"
      stroke="var(--bg0)"
      strokeWidth={px(1.5)}
      style={{ cursor: 'ew-resize' }}
      {...drag}
    />
  )
}

function PhaseGripEl({
  layerId,
  phaseDeg,
  rMM,
  px,
}: {
  layerId: string
  phaseDeg: number
  rMM: number
  px: (n: number) => number
}) {
  const updateLayer = useEngraver((s) => s.updateLayer)
  const snapping = useEngraver((s) => s.view.snapping)
  const drag = useMMDrag((x, y, e) => {
    const { thetaDeg } = xyToPolar(x, y)
    const snapped = snapAngle(thetaDeg, e, snapping)
    updateLayer(layerId, { phaseDeg: toSignedDeg(snapped) })
  })
  const pos = polarToXY(phaseDeg, rMM)
  const inner = polarToXY(phaseDeg, rMM - 0.9)
  return (
    <g>
      <line
        x1={inner.x}
        y1={inner.y}
        x2={pos.x}
        y2={pos.y}
        stroke="var(--accent)"
        strokeWidth={px(1)}
        strokeOpacity={0.7}
        pointerEvents="none"
      />
      <circle
        cx={pos.x}
        cy={pos.y}
        r={px(5.5)}
        fill="var(--accent)"
        stroke="var(--bg0)"
        strokeWidth={px(1.5)}
        style={{ cursor: 'grab' }}
        {...drag}
      />
    </g>
  )
}
