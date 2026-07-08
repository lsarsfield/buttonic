import type { Layer } from '../model/types'
import { clearancesAbove, type ClearanceDisc } from './clip'
import { compileCtxKey, compileLayer, type CompileCtx } from './compile'
import { expandInstanced } from './expand'
import { flattenSegs } from './flatten'
import { parsePathData } from './pathData'
import {
  dilateMultiPolygon,
  dilatePolylines,
  multiPolygonToPathD,
  pathToMultiPolygon,
  ringsToMultiPolygonEvenodd,
  safeUnion,
  type MultiPolygon,
  type Ring,
} from './poly'
import type { CompiledLayer, Shape } from './shapes'
import { strokePaint } from './shapes'

/**
 * Cross-layer keepouts: the region that a cut-out or halo layer subtracts from
 * the FILLED geometry of layers below it (paint order). Regions are cached in
 * the contributor's PRE-PHASE frame; consumers rotate them into their own frame
 * at clip time (see DocRenderer / exportSvg). Discs (the circular moat) are the
 * shipped mechanism, collected unchanged via clearancesAbove.
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

function circleRing(rMM: number, n: number): Ring {
  const ring: Ring = []
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n
    ring.push([rMM * Math.cos(a), rMM * Math.sin(a)])
  }
  return ring
}

/** One compiled Shape → its filled polygon region. */
function shapeToRegion(shape: Shape, srcTol: number, arcTol: number): MultiPolygon {
  switch (shape.kind) {
    case 'path':
      if (shape.paint.fill) return pathToMultiPolygon(shape.d, shape.fillRule ?? 'nonzero', srcTol)
      return dilatePolylines(
        flattenSegs(parsePathData(shape.d), srcTol),
        Math.max((shape.paint.stroke?.widthMM ?? 0.1) / 2, 1e-4),
        arcTol,
      )
    case 'line':
      return dilatePolylines(
        [{ pts: [{ x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }], closed: false }],
        Math.max((shape.paint.stroke?.widthMM ?? 0.1) / 2, 1e-4),
        arcTol,
      )
    case 'instanced': {
      const acc: MultiPolygon[] = []
      for (const flat of expandInstanced(shape)) {
        const r = shapeToRegion(flat, srcTol, arcTol)
        if (r.length > 0) acc.push(r)
      }
      return safeUnion(...acc) ?? []
    }
    case 'circle': {
      // defensive — content layers don't emit circles
      const w = shape.paint.stroke?.widthMM ?? 0
      if (w > 0) {
        return ringsToMultiPolygonEvenodd([circleRing(shape.rMM + w / 2, 128), circleRing(shape.rMM - w / 2, 128)])
      }
      return [[circleRing(shape.rMM, 128)]]
    }
  }
}

interface RegionCache {
  key: string
  region: MultiPolygon | null
  warnings: string[]
}
const cache = new WeakMap<Layer, RegionCache>()

/** The pre-phase keepout region cast by a single layer (WeakMap-memoized). */
export function layerKeepoutRegion(
  layer: Layer,
  ctx: CompileCtx,
): { region: MultiPolygon | null; warnings: string[] } {
  const key = compileCtxKey(ctx)
  const hit = cache.get(layer)
  if (hit && hit.key === key) return { region: hit.region, warnings: hit.warnings }

  const halo = haloOf(layer)
  // Halo boundaries are VISIBLE: exact tick cuts trace them (clear mode) and
  // outline mode engraves them — so flatten the source fine (≤10µm sagitta).
  // Coarse 0.05 flattening read as sawtooth on every tick cut. The disc-sweep
  // dilation is spacing-dominated, so the finer source costs ~nothing
  // (benched 0.05→0.01: ±5% build time).
  const srcTol = halo > 0 ? Math.max(ctx.toleranceMM, 0.01) : ctx.toleranceMM
  const arcTol = srcTol

  const compiled: CompiledLayer = compileLayer(layer, ctx)
  const parts: MultiPolygon[] = []
  for (const shape of compiled.shapes) {
    const r = shapeToRegion(shape, srcTol, arcTol)
    if (r.length > 0) parts.push(r)
  }
  let region = parts.length === 0 ? [] : safeUnion(...parts)
  if (region !== null && region.length > 0 && halo > 0) {
    region = dilateMultiPolygon(region, halo, arcTol)
  }
  const warnings = region === null ? ['A keepout region could not be computed.'] : []
  cache.set(layer, { key, region, warnings })
  return { region, warnings }
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
