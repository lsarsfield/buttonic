import { useMemo } from 'react'
import { MATERIALS, PRODUCTS, STYLES } from '../model/product'
import { baseProfile, faceInnerR, reliefParamsOf } from '../render/relief/heightField'
import { useEngraver } from '../state/store'

const W = 232
const PAD = 6

/**
 * A true-scale cross-section through the cap, cut across the axis — the
 * technical-drawing view of what the 3D shape is: dome or dish, rolled edge,
 * wall height, and the centre feature (a hole is a real gap in the section).
 * Flat view, with guides on; redraws as the shape, size or material change.
 */
export function ProfileSection() {
  const d = useEngraver((s) => s.doc)
  const { diameterMM, holeDiameterMM, product, style, material, logoDisplay } = d
  const geo = useMemo(() => {
    const p = reliefParamsOf({ diameterMM, holeDiameterMM, product, style, material, logoDisplay })
    const R = p.faceR
    const r0 = faceInnerR(p)
    const N = 160
    const top: [number, number][] = []
    for (let k = 0; k <= N; k++) {
      const r = r0 + ((R - r0) * k) / N
      top.push([r, baseProfile(Math.min(r, R - 1e-4), p).y])
    }
    const yMax = Math.max(...top.map((q) => q[1]))
    const yMin = -p.capH
    const s = (W - 2 * PAD) / (2 * R) // px per mm, same on both axes: true scale
    const H = Math.ceil((yMax - yMin) * s) + 2 * PAD
    const X = (r: number) => W / 2 + r * s
    const Y = (y: number) => PAD + (yMax - y) * s
    // right half: underside at the inner radius, up the hole wall, along the top, down the side
    const half = (sign: 1 | -1) => {
      const pts: [number, number][] = [[sign * r0, yMin], ...top.map(([r, y]) => [sign * r, y] as [number, number]), [sign * R, yMin]]
      return pts.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' ')
    }
    return { H, right: half(1), left: half(-1), gap: r0 > 0, axisX: X(0), yTop: Y(yMax), yBot: Y(yMin) }
  }, [diameterMM, holeDiameterMM, product, style, material, logoDisplay])

  const label = `${STYLES[style].label} · ${diameterMM} mm · ${MATERIALS[material].label.toLowerCase()}`
  return (
    <div className="profile-section" aria-label={`Section through the ${PRODUCTS[product].label.toLowerCase()}`}>
      <svg width={W} height={geo.H} viewBox={`0 0 ${W} ${geo.H}`}>
        <line x1={geo.axisX} y1={1} x2={geo.axisX} y2={geo.H - 1} className="profile-axis" />
        <polygon points={geo.right} className="profile-body" />
        <polygon points={geo.left} className="profile-body" />
      </svg>
      <div className="profile-label">Section · {label}</div>
    </div>
  )
}
