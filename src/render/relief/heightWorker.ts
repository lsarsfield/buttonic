import { buildHeightField, coverageFromRgba, type HeightField, type ReliefParams } from './heightField'

/**
 * Off-thread height-field building: the exact EDT at 2048² costs ~1 s, far too
 * long for the UI thread. Imports only the pure kernel (no three.js, no
 * compilers). The RGBA raster arrives transferred and results go back
 * transferred — no copies of the 16 MB buffers.
 */

export interface HeightJob {
  jobId: number
  rgba: Uint8ClampedArray
  n: number
  spanMM: number
  params: ReliefParams
}

export type HeightDone = { jobId: number; field: HeightField; error?: undefined } | { jobId: number; error: string }

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<HeightJob>) => void) | null
  postMessage: (msg: HeightDone, transfer?: Transferable[]) => void
}

scope.onmessage = (e) => {
  const { jobId, rgba, n, spanMM, params } = e.data
  try {
    const field = buildHeightField(coverageFromRgba(rgba, n), n, spanMM, params)
    scope.postMessage({ jobId, field }, [
      field.disp.buffer,
      field.normal.buffer,
      field.surface.buffer,
      field.albedo.buffer,
    ])
  } catch (err) {
    scope.postMessage({ jobId, error: String(err) })
  }
}
