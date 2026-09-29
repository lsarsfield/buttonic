import type { ButtonDoc } from '../../model/types'
import { exportSvg } from '../../io/exportSvg'
import { buildHeightField, coverageFromRgba, reliefParamsOf, type HeightField, type ReliefParams } from './heightField'
import type { HeightDone, HeightJob } from './heightWorker'

/**
 * Die file → height field for the 3D view and the 3D PNG export.
 *
 * The coverage mask is the EXACT die file (exportSvg: halos, cut-outs,
 * invert-over-bare all applied) rasterized on the main thread; the expensive
 * EDT + normals run in a Web Worker (sync fallback if workers fail). Results
 * are cached by content key, so the export reuses what the canvas built.
 */

export const HEIGHT_N = 2048

export function reliefParams(doc: ButtonDoc): ReliefParams {
  return reliefParamsOf(doc)
}

/** Everything that changes the height field (finish, distressing, light and camera don't). */
export function heightKey(doc: ButtonDoc, fontsRevision: number, assetsRevision: number, n = HEIGHT_N): string {
  return JSON.stringify([
    n,
    fontsRevision,
    assetsRevision,
    doc.diameterMM,
    doc.holeDiameterMM,
    doc.product,
    doc.style,
    doc.material,
    doc.logoDisplay,
    doc.layers,
  ])
}

/** Rasterize the die art (black on transparent) over the face, n × n. */
export async function rasterizeDie(doc: ButtonDoc, n: number): Promise<Uint8ClampedArray> {
  const { svg } = exportSvg(doc, {
    expandInstances: false,
    mirrorForDie: false,
    includeBlankOutline: false,
    embedProject: false,
  })
  const sized = svg.replace(/width="[^"]*mm" height="[^"]*mm"/, `width="${n}" height="${n}"`)
  const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(n, n)
        : Object.assign(document.createElement('canvas'), { width: n, height: n })
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
    if (!ctx) throw new Error('No 2D canvas available.')
    ctx.drawImage(img, 0, 0, n, n)
    return ctx.getImageData(0, 0, n, n).data
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ---------------------------------------------------------------------------
// worker plumbing
// ---------------------------------------------------------------------------

// undefined = not yet created, null = unavailable/failed → sync fallback
let worker: Worker | null | undefined
let jobSeq = 0
const pending = new Map<number, { resolve: (f: HeightField) => void; reject: (e: Error) => void }>()

function getWorker(): Worker | null {
  if (worker !== undefined) return worker
  try {
    if (typeof Worker === 'undefined') return (worker = null)
    worker = new Worker(new URL('./heightWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<HeightDone>) => {
      const p = pending.get(e.data.jobId)
      if (!p) return
      pending.delete(e.data.jobId)
      if (e.data.error !== undefined) p.reject(new Error(e.data.error))
      else p.resolve(e.data.field)
    }
    worker.onerror = () => {
      // hard failure (e.g. bundle 404) → sync for the rest of the session
      worker?.terminate()
      worker = null
      for (const p of pending.values()) p.reject(new Error('relief worker failed'))
      pending.clear()
    }
  } catch {
    worker = null
  }
  return worker
}

function buildOffThread(rgba: Uint8ClampedArray, n: number, spanMM: number, params: ReliefParams): Promise<HeightField> {
  const w = getWorker()
  if (!w) return Promise.resolve(buildHeightField(coverageFromRgba(rgba, n), n, spanMM, params))
  const jobId = ++jobSeq
  const job: HeightJob = { jobId, rgba, n, spanMM, params }
  return new Promise<HeightField>((resolve, reject) => {
    pending.set(jobId, { resolve, reject })
    w.postMessage(job, [rgba.buffer])
  }).catch(() => {
    // worker died mid-job: the raster was transferred away, so re-rasterize is
    // the caller's job — signal with a plain rejection
    throw new Error('relief worker failed')
  })
}

// ---------------------------------------------------------------------------

let last: { key: string; field: HeightField } | null = null
const inflight = new Map<string, Promise<HeightField>>()

/** The height field for doc (cached by content key; concurrent callers share one build). */
export function computeHeightField(
  doc: ButtonDoc,
  fontsRevision: number,
  assetsRevision: number,
  n = HEIGHT_N,
): Promise<HeightField> {
  const key = heightKey(doc, fontsRevision, assetsRevision, n)
  if (last && last.key === key) return Promise.resolve(last.field)
  const running = inflight.get(key)
  if (running) return running
  const p = (async () => {
    const params = reliefParams(doc)
    let field: HeightField
    try {
      field = await buildOffThread(await rasterizeDie(doc, n), n, doc.diameterMM, params)
    } catch {
      field = buildHeightField(coverageFromRgba(await rasterizeDie(doc, n), n), n, doc.diameterMM, params)
    }
    if (n === HEIGHT_N) last = { key, field }
    return field
  })().finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}
