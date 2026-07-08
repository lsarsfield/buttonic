import type { Layer } from '../model/types'
import { clearancesAbove } from '../geometry/clip'
import { compileCtxKey, compileLayer, type CompileCtx } from '../geometry/compile'
import {
  adoptKeepoutRegion,
  castsRegion,
  haloOf,
  layerKeepoutRegion,
  peekKeepoutRegion,
  pruneKeepoutCache,
  type Keepouts,
  type RegionContributor,
} from '../geometry/keepout'
import { keepoutTolerances, regionKey } from '../geometry/keepoutRegion'
import type { MultiPolygon } from '../geometry/poly'
import { useEngraver } from '../state/store'
import type { KeepoutDone, KeepoutJob } from './keepoutWorker'

/**
 * Stale-while-recomputing keepout regions for the interactive canvas.
 *
 * Halo dilation costs ~80–190 ms; running it synchronously in render made
 * editing a haloed layer stutter. Here DocRenderer always renders immediately
 * with the LAST GOOD region for each contributor (or none, before the first
 * ever build), while the exact region is rebuilt in a Web Worker after a short
 * trailing debounce; when it lands, regionsRevision bumps and the cut settles.
 * The StatusBar shows a subtle "halo…" spinner while anything is pending.
 *
 * exportSvg is untouched — it computes regions synchronously and exactly.
 */

const DEBOUNCE_MS = 120

interface Entry {
  key: string
  region: MultiPolygon | null
}
interface Want {
  key: string
  layer: Layer
  ctx: CompileCtx
}

const lastGood = new Map<string, Entry>()
const wanted = new Map<string, Want>()
const inflight = new Map<string, { key: string; jobId: number; layer: Layer }>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let jobSeq = 0
// undefined = not yet created, null = unavailable/failed → sync fallback
let worker: Worker | null | undefined

/** Store updates are deferred off the render stack. */
const defer = (fn: () => void): void => queueMicrotask(fn)

function syncPendingFlag(): void {
  const pending = wanted.size > 0 || inflight.size > 0
  defer(() => {
    const s = useEngraver.getState()
    if (s.haloPending !== pending) s.setHaloPending(pending)
  })
}

function bumpRevision(): void {
  defer(() => useEngraver.getState().bumpRegionsRevision())
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker
  try {
    if (typeof Worker === 'undefined') {
      worker = null
      return null
    }
    worker = new Worker(new URL('./keepoutWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<KeepoutDone>) => onDone(e.data)
    worker.onerror = () => {
      // hard worker failure (e.g. bundle 404) → sync fallback for the session
      worker?.terminate()
      worker = null
      for (const id of [...wanted.keys()]) resolveSync(id)
      inflight.clear()
      syncPendingFlag()
      bumpRevision()
    }
  } catch {
    worker = null
  }
  return worker
}

/** Compute on the main thread once (no-Worker environments, worker errors). */
function resolveSync(id: string): void {
  const want = wanted.get(id)
  if (!want) return
  const { region } = layerKeepoutRegion(want.layer, want.ctx) // fills the sync caches
  lastGood.set(id, { key: want.key, region })
  wanted.delete(id)
  const t = timers.get(id)
  if (t) {
    clearTimeout(t)
    timers.delete(id)
  }
}

function dispatch(id: string): void {
  const want = wanted.get(id)
  if (!want) return
  const w = getWorker()
  if (!w) {
    resolveSync(id)
    syncPendingFlag()
    bumpRevision()
    return
  }
  // glyph/motif compilation is fast and memoized — only the union+dilation is slow
  const compiled = compileLayer(want.layer, want.ctx)
  const halo = haloOf(want.layer)
  const { srcTol, arcTol } = keepoutTolerances(halo, want.ctx.toleranceMM)
  const jobId = ++jobSeq
  inflight.set(id, { key: want.key, jobId, layer: want.layer })
  const job: KeepoutJob = { jobId, layerId: id, shapes: compiled.shapes, haloMM: halo, srcTol, arcTol }
  w.postMessage(job)
}

function onDone(msg: KeepoutDone): void {
  const cur = inflight.get(msg.layerId)
  if (!cur || cur.jobId !== msg.jobId) return // superseded or pruned — drop
  inflight.delete(msg.layerId)
  const want = wanted.get(msg.layerId)
  if (msg.error) {
    if (want) resolveSync(msg.layerId) // one sync retry on a job error
  } else {
    lastGood.set(msg.layerId, { key: cur.key, region: msg.region })
    adoptKeepoutRegion(cur.layer, cur.key, msg.region, msg.warnings)
    if (want && want.key === cur.key) wanted.delete(msg.layerId)
    else if (want) dispatch(msg.layerId) // edited again while computing — chase the newest
  }
  syncPendingFlag()
  bumpRevision()
}

/**
 * The layer's keepout region, stale-while-recomputing. Returns the last good
 * region immediately (null before the first ever build) and schedules an
 * off-thread rebuild when the content key changed.
 */
export function getRegionAsync(layer: Layer, ctx: CompileCtx): { region: MultiPolygon | null; pending: boolean } {
  const id = layer.id
  const key = regionKey(layer, compileCtxKey(ctx))
  const good = lastGood.get(id)
  if (good && good.key === key) return { region: good.region, pending: false }
  const peeked = peekKeepoutRegion(layer, ctx) // sync caches may already have it
  if (peeked) {
    lastGood.set(id, { key, region: peeked.region })
    return { region: peeked.region, pending: false }
  }
  const already = wanted.get(id)
  if (!already || already.key !== key) {
    wanted.set(id, { key, layer, ctx })
    const t = timers.get(id)
    if (t) clearTimeout(t)
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id)
        if (!inflight.has(id)) dispatch(id) // else onDone chases the newest key
      }, DEBOUNCE_MS),
    )
    syncPendingFlag()
  }
  return { region: good ? good.region : null, pending: true }
}

/** keepoutsAbove, but contributors resolve via the stale-while-recomputing cache. */
export function keepoutsAboveAsync(layers: Layer[], index: number, ctx: CompileCtx): Keepouts {
  const discs = clearancesAbove(layers, index)
  const contributors: RegionContributor[] = []
  for (let i = index + 1; i < layers.length; i++) {
    const l = layers[i]!
    if (!l.visible || !castsRegion(l)) continue
    const { region } = getRegionAsync(l, ctx)
    if (region && region.length > 0) contributors.push({ layer: l, phaseDeg: l.phaseDeg, region })
  }
  return { discs, contributors }
}

/** Drop state for layers that no longer exist (called once per render pass). */
export function pruneRegions(validIds: ReadonlySet<string>): void {
  for (const id of [...lastGood.keys()]) if (!validIds.has(id)) lastGood.delete(id)
  for (const id of [...wanted.keys()]) if (!validIds.has(id)) wanted.delete(id)
  for (const id of [...inflight.keys()]) if (!validIds.has(id)) inflight.delete(id)
  for (const id of [...timers.keys()]) {
    if (!validIds.has(id)) {
      clearTimeout(timers.get(id)!)
      timers.delete(id)
    }
  }
  pruneKeepoutCache(validIds)
}
