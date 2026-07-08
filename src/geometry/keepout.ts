import type { Layer } from '../model/types'
import { clearancesAbove, type ClearanceDisc } from './clip'
import { compileCtxKey, compileLayer, type CompileCtx } from './compile'
import { buildKeepoutRegion, keepoutTolerances, regionKey } from './keepoutRegion'
import { multiPolygonToPathD, type MultiPolygon } from './poly'
import type { CompiledLayer, Shape } from './shapes'
import { strokePaint } from './shapes'

/**
 * Cross-layer keepouts: the region that a cut-out or halo layer subtracts from
 * the FILLED geometry of layers below it (paint order). Regions are cached in
 * the contributor's PRE-PHASE frame; consumers rotate them into their own frame
 * at clip time (see DocRenderer / exportSvg). Discs (the circular moat) are the
 * shipped mechanism, collected unchanged via clearancesAbove.
 *
 * Region building itself lives in keepoutRegion.ts (pure, worker-safe); this
 * module composes compileLayer + buildKeepoutRegion and owns the sync caches.
 */

export interface RegionContributor {
  layer: Layer
  phaseDeg: number
  region: MultiPolygon
}

export interface Keepouts {
  discs: ClearanceDisc[]
  contributors: RegionContributor[]
}

const CONTENT = new Set(['ringText', 'center', 'repeat', 'bend'])

export function isSubtractLayer(l: Layer): boolean {
  return CONTENT.has(l.type) && (l as { booleanRole?: string }).booleanRole === 'subtract'
}

export function haloOf(l: Layer): number {
  return (l.type === 'ringText' || l.type === 'center') && l.haloMM > 0 ? l.haloMM : 0
}

export function castsRegion(l: Layer): boolean {
  return isSubtractLayer(l) || haloOf(l) > 0
}

// ---------------------------------------------------------------------------

interface RegionCache {
  key: string
  region: MultiPolygon | null
  warnings: string[]
}
const cache = new WeakMap<Layer, RegionCache>()
// Content-keyed fallback: immer creates a new layer object on ANY field edit,
// but phase scrubs / renames don't change the region — reuse the last entry
// for the same layer id when its content key still matches.
const cacheById = new Map<string, RegionCache>()

/** The pre-phase keepout region cast by a single layer (memoized by content). */
export function layerKeepoutRegion(
  layer: Layer,
  ctx: CompileCtx,
): { region: MultiPolygon | null; warnings: string[] } {
  const key = regionKey(layer, compileCtxKey(ctx))
  const hit = cache.get(layer)
  if (hit && hit.key === key) return { region: hit.region, warnings: hit.warnings }
  const idHit = cacheById.get(layer.id)
  if (idHit && idHit.key === key) {
    cache.set(layer, idHit)
    return { region: idHit.region, warnings: idHit.warnings }
  }

  const halo = haloOf(layer)
  const { srcTol, arcTol } = keepoutTolerances(halo, ctx.toleranceMM)
  const compiled: CompiledLayer = compileLayer(layer, ctx)
  const { region, warnings } = buildKeepoutRegion(compiled.shapes, halo, srcTol, arcTol)
  const entry: RegionCache = { key, region, warnings }
  cache.set(layer, entry)
  cacheById.set(layer.id, entry)
  return { region, warnings }
}

/** Adopt an off-thread result into the sync caches (worker path). */
export function adoptKeepoutRegion(layer: Layer, key: string, region: MultiPolygon | null, warnings: string[]): void {
  const entry: RegionCache = { key, region, warnings }
  cache.set(layer, entry)
  cacheById.set(layer.id, entry)
}

/** Cache-only lookup — null when the region isn't already computed. */
export function peekKeepoutRegion(
  layer: Layer,
  ctx: CompileCtx,
): { region: MultiPolygon | null; warnings: string[] } | null {
  const key = regionKey(layer, compileCtxKey(ctx))
  const hit = cache.get(layer)
  if (hit && hit.key === key) return hit
  const idHit = cacheById.get(layer.id)
  if (idHit && idHit.key === key) return idHit
  return null
}

/** Drop content-cache entries for layers that no longer exist. */
export function pruneKeepoutCache(validIds: ReadonlySet<string>): void {
  for (const id of cacheById.keys()) {
    if (!validIds.has(id)) cacheById.delete(id)
  }
}

/** Discs + region contributors cast by visible layers ABOVE index (paint order). */
export function keepoutsAbove(layers: Layer[], index: number, ctx: CompileCtx): Keepouts {
  const discs = clearancesAbove(layers, index)
  const contributors: RegionContributor[] = []
  for (let i = index + 1; i < layers.length; i++) {
    const l = layers[i]!
    if (!l.visible || !castsRegion(l)) continue
    const { region } = layerKeepoutRegion(l, ctx)
    if (region && region.length > 0) contributors.push({ layer: l, phaseDeg: l.phaseDeg, region })
  }
  return { discs, contributors }
}

/** haloMode 'outline': each region ring as an engraved stroked loop. */
export function regionOutlineShapes(region: MultiPolygon, strokeMM: number): Shape[] {
  const d = multiPolygonToPathD(region)
  if (!d) return []
  return [{ kind: 'path', d, paint: strokePaint(strokeMM, 'round') }]
}
