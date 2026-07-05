import polygonClipping, { type MultiPolygon, type Polygon, type Ring } from 'polygon-clipping'
import { distToSegment, type Pt, type SubPath } from './flatten'
import { fmt } from './format'
import { parsePathData } from './pathData'
import { flattenSegs } from './flatten'
import { rotation, apply } from './mat2d'

/**
 * Bridge between Buttonic's Shape IR and `polygon-clipping` MultiPolygons — the
 * only place the boolean library is touched. Pure geometry: no model, no DOM.
 *
 * Two non-obvious rules the whole boolean feature depends on:
 *  - polygon-clipping IGNORES winding: within a Polygon = Ring[], ring 0 is the
 *    exterior and later rings are holes BY POSITION. Feeding glyph contours as
 *    separate polygons through union() ERASES counters. `ringsToMultiPolygon*`
 *    reconstruct hole nesting structurally.
 *  - capsule dilation caps must be CIRCUMSCRIBED (r' = r/cos(π/n)) so the
 *    delivered halo margin is never LESS than nominal — an inscribed cap would
 *    undershoot by the sagitta and fail the halo invariant.
 */

export type { MultiPolygon, Polygon, Ring } from 'polygon-clipping'

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const WELD = 1e-9

// ---------------------------------------------------------------------------
// safe wrappers — polygon-clipping throws on pathological input; never let that
// reach React or a broken export. catch → one retry with snapped coords → null.
// ---------------------------------------------------------------------------

const isEmpty = (g: Polygon | MultiPolygon | null | undefined): boolean =>
  !g || g.length === 0

function snapGeom<T extends Polygon | MultiPolygon>(g: T): T {
  const snap = (v: number) => Math.round(v * 1e6) / 1e6
  const snapRing = (r: Ring): Ring => r.map(([x, y]) => [snap(x), snap(y)])
  // Polygon = Ring[]; MultiPolygon = Ring[][]
  return (g as unknown[]).map((poly) =>
    Array.isArray((poly as Ring)[0]?.[0] ?? undefined)
      ? (poly as Polygon).map(snapRing)
      : snapRing(poly as Ring),
  ) as T
}

function run(
  op: (a: Polygon | MultiPolygon, ...rest: (Polygon | MultiPolygon)[]) => MultiPolygon,
  geoms: (Polygon | MultiPolygon)[],
): MultiPolygon | null {
  const clean = geoms.filter((g) => !isEmpty(g))
  if (clean.length === 0) return []
  try {
    return op(clean[0]!, ...clean.slice(1))
  } catch {
    try {
      const snapped = clean.map(snapGeom)
      return op(snapped[0]!, ...snapped.slice(1))
    } catch {
      return null
    }
  }
}

export function safeUnion(...geoms: (Polygon | MultiPolygon)[]): MultiPolygon | null {
  return run(polygonClipping.union, geoms)
}

export function safeXor(...geoms: (Polygon | MultiPolygon)[]): MultiPolygon | null {
  return run(polygonClipping.xor, geoms)
}

export function safeDifference(
  subject: MultiPolygon,
  ...clips: MultiPolygon[]
): MultiPolygon | null {
  if (isEmpty(subject)) return []
  const clean = clips.filter((c) => !isEmpty(c))
  if (clean.length === 0) return subject
  try {
    return polygonClipping.difference(subject, ...clean)
  } catch {
    try {
      return polygonClipping.difference(snapGeom(subject), ...clean.map(snapGeom))
    } catch {
      return null
    }
  }
}

// ---------------------------------------------------------------------------
// Ring primitives
// ---------------------------------------------------------------------------

/** Signed shoelace area (relative sign only; y-down). */
export function ringArea(ring: Ring): number {
  let sum = 0
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const [xi, yi] = ring[i]!
    const [xj, yj] = ring[(i + 1) % n]!
    sum += xi * yj - xj * yi
  }
  return sum / 2
}

/** Even-odd point-in-polygon (PNPOLY; robust for generic points). */
export function pointInRing(px: number, py: number, ring: Ring): boolean {
  let inside = false
  const n = ring.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i]!
    const [xj, yj] = ring[j]!
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/** Even-odd parity over every ring — correct for well-nested MultiPolygons
 *  (islands-in-counters resolve because parity counts each containing ring). */
export function pointInMultiPolygon(px: number, py: number, mp: MultiPolygon): boolean {
  let parity = false
  for (const poly of mp) {
    for (const ring of poly) {
      if (pointInRing(px, py, ring)) parity = !parity
    }
  }
  return parity
}

/** Closed subpaths → rings. Welds consecutive duplicates (incl. first/last),
 *  drops rings with < 3 distinct points. Open subs included only when closeOpen. */
export function subPathsToRings(subs: SubPath[], closeOpen: boolean): Ring[] {
  const rings: Ring[] = []
  for (const sub of subs) {
    if (!sub.closed && !closeOpen) continue
    const ring: Ring = []
    for (const p of sub.pts) {
      const prev = ring[ring.length - 1]
      if (!prev || Math.hypot(p.x - prev[0], p.y - prev[1]) > WELD) ring.push([p.x, p.y])
    }
    // drop trailing duplicate of the first vertex
    while (ring.length > 1) {
      const first = ring[0]!
      const last = ring[ring.length - 1]!
      if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= WELD) ring.pop()
      else break
    }
    if (ring.length >= 3) rings.push(ring)
  }
  return rings
}

// ---------------------------------------------------------------------------
// Ring sets → MultiPolygon (winding reconstruction — the counter-preserving core)
// ---------------------------------------------------------------------------

/** XOR of each ring — exactly the even-odd fill region for all inputs. */
export function ringsToMultiPolygonEvenodd(rings: Ring[]): MultiPolygon {
  if (rings.length === 0) return []
  return safeXor(...rings.map((r) => [r] as Polygon)) ?? []
}

/**
 * Nonzero (font/SVG-default) sources: reconstruct hole nesting by containment
 * parity (even depth = exterior, odd = hole), group holes under their immediate
 * exterior, then one union() to normalize overlapping sibling contours.
 */
export function ringsToMultiPolygonNonzero(rings: Ring[]): MultiPolygon {
  const usable = rings.filter((r) => r.length >= 3 && Math.abs(ringArea(r)) > 1e-12)
  if (usable.length === 0) return []

  interface Node {
    ring: Ring
    absArea: number
    depth: number
    parent: Node | null
  }
  const nodes: Node[] = usable
    .map((ring) => ({ ring, absArea: Math.abs(ringArea(ring)), depth: 0, parent: null as Node | null }))
    .sort((a, b) => b.absArea - a.absArea) // largest first — any container is processed earlier

  const placed: Node[] = []
  for (const node of nodes) {
    const [rx, ry] = node.ring[0]! // representative point (font contours never touch)
    const containers = placed.filter((s) => pointInRing(rx, ry, s.ring))
    node.depth = containers.length
    if (node.depth % 2 === 1) {
      // immediate parent = deepest container (== depth-1), tiebreak smallest
      let best: Node | null = null
      for (const c of containers) {
        if (!best || c.depth > best.depth || (c.depth === best.depth && c.absArea < best.absArea)) {
          best = c
        }
      }
      node.parent = best
    }
    placed.push(node)
  }

  const mp: MultiPolygon = []
  for (const node of nodes) {
    if (node.depth % 2 === 0) {
      const poly: Polygon = [node.ring]
      for (const other of nodes) {
        if (other.depth % 2 === 1 && other.parent === node) poly.push(other.ring)
      }
      mp.push(poly)
    }
  }
  return safeUnion(mp) ?? mp
}

// ---------------------------------------------------------------------------
// Path ⇄ MultiPolygon
// ---------------------------------------------------------------------------

export function pathToMultiPolygon(
  d: string,
  fillRule: 'nonzero' | 'evenodd',
  tolMM: number,
): MultiPolygon {
  const rings = subPathsToRings(flattenSegs(parsePathData(d), tolMM), true)
  return fillRule === 'evenodd'
    ? ringsToMultiPolygonEvenodd(rings)
    : ringsToMultiPolygonNonzero(rings)
}

/** MultiPolygon → one M…L…Z per ring, L-only, deterministic fmt numbers.
 *  Output polygons are disjoint, so the caller renders with fillRule 'evenodd'. */
export function multiPolygonToPathD(mp: MultiPolygon): string {
  const parts: string[] = []
  for (const poly of mp) {
    for (const ring of poly) {
      if (ring.length < 3) continue
      const [x0, y0] = ring[0]!
      parts.push(`M ${fmt(x0)} ${fmt(y0)}`)
      for (let i = 1; i < ring.length; i++) {
        const [x, y] = ring[i]!
        parts.push(`L ${fmt(x)} ${fmt(y)}`)
      }
      parts.push('Z')
    }
  }
  return parts.join(' ')
}

export function multiPolygonArea(mp: MultiPolygon): number {
  let area = 0
  for (const poly of mp) {
    if (poly.length === 0) continue
    area += Math.abs(ringArea(poly[0]!))
    for (let i = 1; i < poly.length; i++) area -= Math.abs(ringArea(poly[i]!))
  }
  return area
}

export function mpBounds(mp: MultiPolygon): Bounds | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const poly of mp) {
    for (const ring of poly) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null
}

/** Radial band from the origin. rMax at vertices (exact for polygons); rMin
 *  from edge distances (an edge can dip closer than any vertex) so the band is
 *  conservative — a prefilter must never miss a real overlap. */
export function mpRadialBand(mp: MultiPolygon): { rMin: number; rMax: number } | null {
  let rMin = Infinity
  let rMax = 0
  const origin: Pt = { x: 0, y: 0 }
  for (const poly of mp) {
    for (const ring of poly) {
      const n = ring.length
      for (let i = 0; i < n; i++) {
        const [x, y] = ring[i]!
        rMax = Math.max(rMax, Math.hypot(x, y))
        const [nx, ny] = ring[(i + 1) % n]!
        rMin = Math.min(rMin, distToSegment(origin, { x, y }, { x: nx, y: ny }))
      }
    }
  }
  return Number.isFinite(rMin) && rMax > 0 ? { rMin, rMax } : null
}

export function rotateMultiPolygon(mp: MultiPolygon, deg: number): MultiPolygon {
  if (deg === 0) return mp
  const m = rotation(deg)
  return mp.map((poly) =>
    poly.map((ring) =>
      ring.map(([x, y]) => {
        const p = apply(m, x, y)
        return [p.x, p.y] as [number, number]
      }),
    ),
  )
}

// ---------------------------------------------------------------------------
// Dilation (Minkowski with a disc) via capsule union — no offset library
// ---------------------------------------------------------------------------

/** Circumscribed n-gon segment count for arc tolerance arcTol at radius r. */
function capSegments(r: number, arcTol: number): number {
  if (r <= 0) return 0
  const ratio = r / (r + Math.max(arcTol, 1e-6))
  const n = Math.ceil(Math.PI / Math.acos(Math.min(0.999999, ratio)))
  return Math.max(6, n)
}

/** Circumscribed disc polygon (r' = r/cos(π/n)) centred at (cx,cy). */
function vertexDisc(cx: number, cy: number, r: number, arcTol: number): Polygon {
  const n = capSegments(r, arcTol)
  const rp = r / Math.cos(Math.PI / n)
  const ring: Ring = []
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n
    ring.push([cx + rp * Math.cos(a), cy + rp * Math.sin(a)])
  }
  return [ring]
}

/**
 * Disc-sweep capsules: circumscribed discs placed along every edge of a ring
 * at a spacing tight enough that the scallop between neighbours still clears
 * the nominal margin r (so the halo never undershoots). Discs are convex and
 * overlap cleanly, unlike thin rectangles whose slivers make the boolean
 * sweep both slow and prone to failure. NOT filled interiors — so unioning
 * onto a holed region expands outers and erodes holes correctly.
 */
function ringCaps(ring: Ring, r: number, arcTol: number, closed: boolean): Polygon[] {
  const n = ring.length
  if (n === 0) return []
  const segs = capSegments(r, arcTol)
  const rp = r / Math.cos(Math.PI / segs)
  // spacing s so that √(rp² − (s/2)²) ≥ r  →  midpoint between discs still clears r
  const spacing = Math.max(1e-3, 0.95 * 2 * Math.sqrt(Math.max(0, rp * rp - r * r)))
  const disc = (cx: number, cy: number): Polygon => {
    const g: Ring = []
    for (let k = 0; k < segs; k++) {
      const a = (2 * Math.PI * k) / segs
      g.push([cx + rp * Math.cos(a), cy + rp * Math.sin(a)])
    }
    return [g]
  }
  const caps: Polygon[] = []
  for (let i = 0; i < n; i++) caps.push(disc(ring[i]![0], ring[i]![1]))
  const last = closed ? n : n - 1
  for (let i = 0; i < last; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % n]!
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const steps = Math.floor(len / spacing)
    for (let k = 1; k < steps; k++) {
      const t = k / steps
      caps.push(disc(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    }
  }
  return caps
}

/** P ⊕ Disc(r): union the region with capsule strips along every ring edge.
 *  Batched per ring — a single variadic union of hundreds of heavily-overlapping
 *  capsules is martinez's worst case, so each ring's strips are unioned in
 *  isolation first, then the small per-ring results are combined onto mp. */
export function dilateMultiPolygon(mp: MultiPolygon, rMM: number, arcTolMM: number): MultiPolygon {
  if (rMM <= 0 || mp.length === 0) return mp
  // Per-ring batching beats one giant union — martinez slows superlinearly on
  // many mutually-overlapping caps, so keep each sub-union small then merge.
  const perRing: MultiPolygon[] = []
  for (const poly of mp) {
    for (const ring of poly) {
      const u = safeUnion(...ringCaps(ring, rMM, arcTolMM, true))
      if (u) perRing.push(u)
    }
  }
  return safeUnion(mp, ...perRing) ?? mp
}

/** Capsules around open/closed polylines (stroked sources have no interior). */
export function dilatePolylines(subs: SubPath[], rMM: number, arcTolMM: number): MultiPolygon {
  if (rMM <= 0) return []
  const perSub: MultiPolygon[] = []
  for (const sub of subs) {
    const ring: Ring = sub.pts.map((p) => [p.x, p.y])
    if (ring.length === 0) continue
    if (ring.length === 1) {
      const u = safeUnion(vertexDisc(ring[0]![0], ring[0]![1], rMM, arcTolMM))
      if (u) perSub.push(u)
      continue
    }
    const caps = ringCaps(ring, rMM, arcTolMM, sub.closed)
    const u = safeUnion(...caps)
    if (u) perSub.push(u)
  }
  if (perSub.length === 0) return []
  return safeUnion(...perSub) ?? perSub.flat()
}
