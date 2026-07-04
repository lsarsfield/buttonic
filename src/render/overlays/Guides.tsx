import { useMemo } from 'react'
import { polarToXY } from '../../geometry/polar'
import { useEngraver } from '../../state/store'
import { useViewport } from '../../state/viewport'

/**
 * Polar guides: centre crosshair, 1 mm concentric circles, 15° ticks outside
 * the rim, plus a highlight ring on the selected layer's characteristic
 * radius. All strokes are divided by zoom so they stay 1px on screen.
 */
export function Guides() {
  const showGuides = useEngraver((s) => s.view.showGuides)
  const diameterMM = useEngraver((s) => s.doc.diameterMM)
  const scale = useViewport((s) => s.scale)
  const selected = useEngraver((s) => s.doc.layers.find((l) => l.id === s.selection) ?? null)

  const R = diameterMM / 2
  const px = (n: number) => n / scale

  const ticks = useMemo(() => {
    const lines: { x1: number; y1: number; x2: number; y2: number; major: boolean }[] = []
    for (let deg = 0; deg < 360; deg += 15) {
      const major = deg % 90 === 0
      const a = polarToXY(deg, R + 0.25)
      const b = polarToXY(deg, R + (major ? 1.1 : 0.7))
      lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, major })
    }
    return lines
  }, [R])

  let selectionRadius: number | null = null
  if (selected) {
    switch (selected.type) {
      case 'ring':
        selectionRadius = selected.mode === 'annulus' ? selected.rOuterMM : selected.radiusMM
        break
      case 'hatch':
      case 'bend':
        selectionRadius = selected.rOuterMM
        break
      case 'repeat':
      case 'ringText':
        selectionRadius = selected.radiusMM
        break
      case 'center':
        selectionRadius = Math.max(0.5, selected.sizeMM / 2)
        break
    }
  }

  return (
    <g pointerEvents="none">
      {showGuides && (
        <g stroke="var(--guide)" fill="none">
          {/* concentric mm circles */}
          {Array.from({ length: Math.floor(R) }, (_, i) => i + 1).map((r) => (
            <circle key={r} r={r} strokeWidth={px(1)} strokeOpacity={r % 5 === 0 ? 0.35 : 0.16} />
          ))}
          {/* button edge */}
          <circle r={R} strokeWidth={px(1)} strokeOpacity={0.55} />
          {/* degree ticks */}
          {ticks.map((t, i) => (
            <line
              key={i}
              x1={t.x1}
              y1={t.y1}
              x2={t.x2}
              y2={t.y2}
              strokeWidth={px(t.major ? 1.5 : 1)}
              strokeOpacity={t.major ? 0.5 : 0.28}
            />
          ))}
          {/* centre crosshair */}
          <line x1={-1.2} y1={0} x2={1.2} y2={0} strokeWidth={px(1)} strokeOpacity={0.5} />
          <line x1={0} y1={-1.2} x2={0} y2={1.2} strokeWidth={px(1)} strokeOpacity={0.5} />
        </g>
      )}
      {selectionRadius !== null && (
        <circle
          r={selectionRadius}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={px(1.5)}
          strokeOpacity={0.85}
          strokeDasharray={`${px(4)} ${px(4)}`}
        />
      )}
    </g>
  )
}
