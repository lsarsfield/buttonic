import { buildKeepoutRegion } from '../geometry/keepoutRegion'
import type { MultiPolygon } from '../geometry/poly'
import type { Shape } from '../geometry/shapes'

/**
 * Off-thread keepout region building. The Shape IR is plain JSON, and
 * keepoutRegion.ts imports only the polygon kernel, so this bundle stays free
 * of opentype.js and the compilers — glyphs are compiled on the main thread
 * (fast) and only the expensive union+dilation runs here.
 */

export interface KeepoutJob {
  jobId: number
  layerId: string
  shapes: Shape[]
  haloMM: number
  srcTol: number
  arcTol: number
  outlineMM: number
}

export interface KeepoutDone {
  jobId: number
  layerId: string
  region: MultiPolygon | null
  outline: MultiPolygon | null
  warnings: string[]
  error?: string
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<KeepoutJob>) => void) | null
  postMessage: (msg: KeepoutDone) => void
}

scope.onmessage = (e) => {
  const { jobId, layerId, shapes, haloMM, srcTol, arcTol, outlineMM } = e.data
  try {
    const { region, outline, warnings } = buildKeepoutRegion(shapes, haloMM, srcTol, arcTol, outlineMM)
    scope.postMessage({ jobId, layerId, region, outline, warnings })
  } catch (err) {
    scope.postMessage({ jobId, layerId, region: null, outline: null, warnings: [], error: String(err) })
  }
}
