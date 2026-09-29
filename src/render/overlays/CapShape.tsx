import { useMemo } from 'react'
import { CENTRE_LABELS, centreKindOf, isOpening } from '../../model/product'
import { useEngraver } from '../../state/store'
import { useViewport } from '../../state/viewport'
import { baseProfile, faceInnerR, reliefParamsOf, type ReliefParams } from '../relief/heightField'

/**
 * The struck cap's shape on the flat canvas — the same profile the 3D view
 * builds (dome, concave dish, rolled edge, nipple, cup, plateau), shown as
 * shading on the blank, and a punched-out centre shown as an actual opening.
 * Preview only: none of this is in the export.
 */

function useCapParams(): ReliefParams {
  const d = useEngraver((s) => s.doc)
  const { diameterMM, holeDiameterMM, product, style, material, logoDisplay } = d
  return useMemo(
    () => reliefParamsOf({ diameterMM, holeDiameterMM, product, style, material, logoDisplay }),
    [diameterMM, holeDiameterMM, product, style, material, logoDisplay],
  )
}

/**
 * Radial shading of the blank from the cap profile, drawn under the art:
 * higher ground lighter (a dome's crown, a nipple's head, a plateau), steep
 * ground darker (the rolled edge, a nipple's wall, a cup's ring, a riser).
 */
export function CapShading({ faceD }: { faceD: string }) {
  const p = useCapParams()
  const stops = useMemo(() => {
    const R = p.faceR
    const r0 = faceInnerR(p)
    const N = 96
    const pts: { t: number; y: number; slope: number }[] = []
    for (let k = 0; k <= N; k++) {
      const r = (R * k) / N
      if (r < r0) continue
      const { y, dydr } = baseProfile(Math.min(r, R - 1e-4), p)
      pts.push({ t: r / R, y, slope: Math.abs(dydr) })
    }
    const ys = pts.map((q) => q.y)
    const lo = Math.min(...ys)
    const hi = Math.max(...ys)
    const range = hi - lo
    return pts.map((q) => ({
      t: q.t,
      lit: range > 0.05 ? (0.13 * (q.y - lo)) / range : 0,
      shade: Math.min(0.55, q.slope * 0.22),
    }))
  }, [p])
  return (
    <g pointerEvents="none">
      <defs>
        <radialGradient id="cap-lit" gradientUnits="userSpaceOnUse" cx={0} cy={0} r={p.faceR}>
          {stops.map((s, i) => (
            <stop key={i} offset={s.t} stopColor="#ffffff" stopOpacity={s.lit} />
          ))}
        </radialGradient>
        <radialGradient id="cap-shade" gradientUnits="userSpaceOnUse" cx={0} cy={0} r={p.faceR}>
          {stops.map((s, i) => (
            <stop key={i} offset={s.t} stopColor="#000000" stopOpacity={s.shade} />
          ))}
        </radialGradient>
      </defs>
      <path d={faceD} fillRule="evenodd" fill="url(#cap-lit)" />
      <path d={faceD} fillRule="evenodd" fill="url(#cap-shade)" />
    </g>
  )
}

/**
 * A punched-out centre (open-top hole, die-cast pin hole) as an opening:
 * hatched, outlined and labelled, and drawn OVER the art — anything there
 * isn't struck, so it's dimmed rather than hidden.
 */
export function OpeningMask() {
  const doc = useEngraver((s) => s.doc)
  const artboardLight = useEngraver((s) => s.view.artboardLight)
  const scale = useViewport((s) => s.scale)
  const kind = centreKindOf(doc)
  if (kind === 'none' || !isOpening(kind)) return null
  const r = doc.holeDiameterMM / 2
  const px = (n: number) => n / scale
  const bg = artboardLight ? '#f4f3ef' : '#0d0d0e'
  const ink = artboardLight ? '#8a877f' : '#6b6b73'
  const hatch = px(6)
  return (
    <g pointerEvents="none">
      <defs>
        <pattern id="opening-hatch" patternUnits="userSpaceOnUse" width={hatch} height={hatch} patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={hatch} stroke={ink} strokeWidth={px(1)} strokeOpacity={0.45} />
        </pattern>
      </defs>
      <circle r={r} fill={bg} fillOpacity={0.8} />
      <circle r={r} fill="url(#opening-hatch)" />
      <circle r={r} fill="none" stroke={ink} strokeWidth={px(1.25)} />
      {r * scale > 28 && (
        <text
          x={0}
          y={px(4)}
          textAnchor="middle"
          fontSize={px(10)}
          letterSpacing={px(1)}
          fill={ink}
          style={{ fontFamily: 'inherit', textTransform: 'uppercase' }}
        >
          {CENTRE_LABELS[kind].replace('Centre ', '')} ⌀{doc.holeDiameterMM}
        </text>
      )}
    </g>
  )
}
