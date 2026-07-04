import type { Layer } from '../../model/types'
import { useViewport } from '../../state/viewport'
import { layerBand } from '../DocRenderer'

/**
 * Stand-in for layer types whose compiler hasn't landed yet: a dashed circle
 * in the middle of the layer's band so the layer is visible and selectable.
 */
export function PlaceholderRenderer({ layer }: { layer: Layer }) {
  const scale = useViewport((s) => s.scale)
  const band = layerBand(layer)
  const radius = Math.max(0.4, (band.rInner + band.rOuter) / 2)

  return (
    <circle
      r={radius}
      fill="none"
      stroke="currentColor"
      strokeOpacity={0.35}
      strokeWidth={2 / scale}
      strokeDasharray={`${6 / scale} ${5 / scale}`}
    />
  )
}
