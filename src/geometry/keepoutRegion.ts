import type { Layer } from '../model/types'
import { expandInstanced } from './expand'
import { flattenSegs } from './flatten'
import { parsePathData } from './pathData'
import {
  dilateMultiPolygon,
  dilatePolylines,
  pathToMultiPolygon,
  ringsToMultiPolygonEvenodd,
  safeUnion,
  type MultiPolygon,
  type Ring,
} from './poly'
import type { Shape } from './shapes'

/**
 * Pure region building from ALREADY-COMPILED shapes — split out of keepout.ts
 * so the Web Worker that runs the expensive dilation off the UI thread imports
 * only the polygon kernel (no compile.ts → no opentype.js in the worker
 * bundle). keepout.ts composes compileLayer + this for the sync path.
 */

function circleRing(rMM: number, n: number): Ring {
  const ring: Ring = []
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n
    ring.push([rMM * Math.cos(a), rMM * Math.sin(a)])
  }
  return ring
}

/** One compiled Shape → its filled polygon region. */
export function shapeToRegion(shape: Shape, srcTol: number, arcTol: number): MultiPolygon {
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

/**
 * Source-flatten / dilation-arc tolerances for a keepout region. Halo
 * boundaries are VISIBLE (exact tick cuts trace them; outline mode engraves
 * them) — 0.005 is the cost/quality knee: ~9µm peak ripple, ~2× dilation cost
 * (Liam-approved trade). Fixed — not ctx-clamped — so render and export halos
 * are the same geometry (WYSIWYG). Subtract-role regions keep the ctx tol.
 */
export function keepoutTolerances(haloMM: number, ctxTolMM: number): { srcTol: number; arcTol: number } {
  const srcTol = haloMM > 0 ? 0.005 : ctxTolMM
  return { srcTol, arcTol: srcTol }
}

/** Union the shapes' regions, dilate by the halo. Pure — safe in a worker. */
export function buildKeepoutRegion(
  shapes: Shape[],
  haloMM: number,
  srcTol: number,
  arcTol: number,
): { region: MultiPolygon | null; warnings: string[] } {
  const parts: MultiPolygon[] = []
  for (const shape of shapes) {
    const r = shapeToRegion(shape, srcTol, arcTol)
    if (r.length > 0) parts.push(r)
  }
  let region: MultiPolygon | null = parts.length === 0 ? [] : safeUnion(...parts)
  if (region !== null && region.length > 0 && haloMM > 0) {
    region = dilateMultiPolygon(region, haloMM, arcTol)
  }
  const warnings = region === null ? ['A keepout region could not be computed.'] : []
  return { region, warnings }
}

/**
 * Content key for a layer's keepout region. Regions are cached PRE-PHASE
 * (consumers rotate by phase at clip time) and names are cosmetic, so neither
 * invalidates — phase scrubs and renames cost nothing. `ctxKey` is
 * compileCtxKey(ctx), passed in so this module stays compile-free.
 */
export function regionKey(layer: Layer, ctxKey: string): string {
  return ctxKey + '|' + JSON.stringify({ ...layer, phaseDeg: 0, name: '' })
}
