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
 * Nonzero (font/SVG-default) fill, EXACTLY: a point is filled where the sum of
 * the orientations of the contours around it is non-zero.
 *
 * Containment parity (the old approach) is only right when contours never
 * overlap and alternate direction. Real fonts break both: Cinzel, Jost, Roboto
 * and Playfair build letters from OVERLAPPING contours (a crossbar drawn over
 * a stem), and some motifs nest same-direction contours — parity then turned
 * crossbars, serifs and arms into holes inside every knockout and halo.
 *
 * Contours are clustered by bounding-box overlap (letters are independent).
 * A cluster whose contours never cross gets an exact containment tree with
 * winding sums (no boolean library). A cluster with crossing contours is split
 * into faces of constant winding (intersection/difference per contour), and
 * the faces with non-zero winding are unioned.
 */
export function ringsToMultiPolygonNonzero(rings: Ring[]): MultiPolygon {
  // a contour that crosses ITSELF (variable-font outlines: Jost's B, Roboto's 6)
  // becomes the simple loops it's made of — winding numbers add, so this is exact
  const usable = rings.flatMap(splitSelfCrossing).filter((r) => r.length >= 3 && Math.abs(ringArea(r)) > 1e-12)
  if (usable.length === 0) return []
  const boxes = usable.map(ringBox)

  // cluster by bbox overlap (union-find)
  const parent = usable.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      if (boxesTouch(boxes[i]!, boxes[j]!)) parent[find(i)] = find(j)
    }
  }
  const clusters = new Map<number, number[]>()
  usable.forEach((_, i) => {
    const k = find(i)
    if (!clusters.has(k)) clusters.set(k, [])
    clusters.get(k)!.push(i)
  })

  const out: MultiPolygon = []
  for (const idx of clusters.values()) {
    const rs = idx.map((i) => usable[i]!)
    if (rs.length === 1) {
      out.push([rs[0]!])
      continue
    }
    const faces = anyRingsCross(rs, idx.map((i) => boxes[i]!)) ? windingFacesSplit(rs) : windingFacesTree(rs)
    for (const poly of faces) out.push(poly)
  }
  return out
}

/**
 * Split a self-crossing ring at its crossings into simple loops (each keeps
 * its own direction). Rings that don't cross themselves come back as-is.
 */
export function splitSelfCrossing(ring: Ring): Ring[] {
  const n = ring.length
  if (n < 4) return [ring]
  // edges sorted by minX; compare only while x-ranges overlap
  const order = Array.from({ length: n }, (_, i) => i)
  const lo = (i: number) => Math.min(ring[i]![0], ring[(i + 1) % n]![0])
  const hi = (i: number) => Math.max(ring[i]![0], ring[(i + 1) % n]![0])
  order.sort((a, b) => lo(a) - lo(b))
  const cuts: { t: number; id: number; pt: [number, number] }[][] = Array.from({ length: n }, () => [])
  let ids = 0
  for (let a = 0; a < n; a++) {
    const i = order[a]!
    const hiI = hi(i)
    for (let b = a + 1; b < n && lo(order[b]!) <= hiI; b++) {
      const j = order[b]!
      if (Math.abs(i - j) <= 1 || Math.abs(i - j) === n - 1) continue // neighbours share a vertex
      const [ax, ay] = ring[i]!
      const [bx, by] = ring[(i + 1) % n]!
      const [cx, cy] = ring[j]!
      const [dx, dy] = ring[(j + 1) % n]!
      if (!segsCross(ax, ay, bx, by, cx, cy, dx, dy)) continue
      const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy
      const den = rx * sy - ry * sx
      if (Math.abs(den) < 1e-18) continue
      const t = ((cx - ax) * sy - (cy - ay) * sx) / den
      const u = ((cx - ax) * ry - (cy - ay) * rx) / den
      const pt: [number, number] = [ax + rx * t, ay + ry * t]
      const id = ids++
      cuts[i]!.push({ t, id, pt })
      cuts[j]!.push({ t: u, id, pt })
    }
  }
  if (ids === 0) return [ring]
  const seq: { pt: [number, number]; id: number }[] = []
  for (let k = 0; k < n; k++) {
    seq.push({ pt: ring[k]!, id: -1 })
    for (const c of cuts[k]!.sort((a, b) => a.t - b.t)) seq.push({ pt: c.pt, id: c.id })
  }
  // Seifert smoothing: at each crossing, leave along the OTHER strand's outgoing
  // edge. Every edge keeps its direction (winding is unchanged everywhere) and
  // the resulting loops touch at the crossings but never cross — whatever order
  // the crossings interleave in.
  const m = seq.length
  const twin = new Map<number, number>()
  const firstAt = new Map<number, number>()
  seq.forEach((v, k) => {
    if (v.id < 0) return
    const f = firstAt.get(v.id)
    if (f === undefined) firstAt.set(v.id, k)
    else {
      twin.set(k, f)
      twin.set(f, k)
    }
  })
  const succ = (k: number) => ((twin.get(k) ?? k) + 1) % m
  const seen = new Uint8Array(m)
  const loops: Ring[] = []
  for (let s0 = 0; s0 < m; s0++) {
    if (seen[s0]) continue
    const loop: Ring = []
    for (let k = s0; !seen[k]; k = succ(k)) {
      seen[k] = 1
      loop.push(seq[k]!.pt)
    }
    loops.push(loop)
  }
  return loops.filter((l) => l.length >= 3)
}

/** A point on the ring that is never a shared crossing vertex: its first edge's midpoint. */
function sampleOf(r: Ring): [number, number] {
  const [x0, y0] = r[0]!
  const [x1, y1] = r[1]!
  return [(x0 + x1) / 2, (y0 + y1) / 2]
}

interface RBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}
function ringBox(r: Ring): RBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of r) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}
const boxesTouch = (a: RBox, b: RBox): boolean =>
  a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY

const orient = (r: Ring): 1 | -1 => (ringArea(r) > 0 ? 1 : -1)

function segsCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx)
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx)
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/**
 * Do two segments meet at all — crossing, touching, or overlapping along a
 * line? (Cinzel's serifs are separate contours sharing the stem's edges: they
 * never strictly cross, yet the containment tree is wrong for them.)
 */
function segsMeet(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const E = 1e-12
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => {
    const v = (qx - px) * (ry - py) - (qy - py) * (rx - px)
    return Math.abs(v) < E ? 0 : v > 0 ? 1 : -1
  }
  const on = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    Math.min(px, qx) - E <= rx && rx <= Math.max(px, qx) + E && Math.min(py, qy) - E <= ry && ry <= Math.max(py, qy) + E
  const o1 = o(ax, ay, bx, by, cx, cy)
  const o2 = o(ax, ay, bx, by, dx, dy)
  const o3 = o(cx, cy, dx, dy, ax, ay)
  const o4 = o(cx, cy, dx, dy, bx, by)
  if (o1 !== o2 && o3 !== o4) return true
  return (
    (o1 === 0 && on(ax, ay, bx, by, cx, cy)) ||
    (o2 === 0 && on(ax, ay, bx, by, dx, dy)) ||
    (o3 === 0 && on(cx, cy, dx, dy, ax, ay)) ||
    (o4 === 0 && on(cx, cy, dx, dy, bx, by))
  )
}

/** Do any two contours' edges meet (cross, touch or overlap)? Then the tree can't be trusted. */
function anyRingsCross(rs: Ring[], boxes: RBox[]): boolean {
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      if (!boxesTouch(boxes[i]!, boxes[j]!)) continue
      const a = rs[i]!
      const b = rs[j]!
      const bb = boxes[j]!
      for (let p = 0; p < a.length; p++) {
        const [ax, ay] = a[p]!
        const [bx, by] = a[(p + 1) % a.length]!
        if (Math.max(ax, bx) < bb.minX || Math.min(ax, bx) > bb.maxX || Math.max(ay, by) < bb.minY || Math.min(ay, by) > bb.maxY) continue
        for (let q = 0; q < b.length; q++) {
          const [cx, cy] = b[q]!
          const [dx, dy] = b[(q + 1) % b.length]!
          if (segsMeet(ax, ay, bx, by, cx, cy, dx, dy)) return true
        }
      }
    }
  }
  return false
}

/**
 * Non-crossing contours: the containment tree is the whole story. A contour's
 * face (inside it, outside its children) has winding = its orientation plus
 * its ancestors'; faces with non-zero winding are filled.
 */
function windingFacesTree(rs: Ring[]): Polygon[] {
  interface Node {
    ring: Ring
    area: number
    parent: Node | null
    w: number
  }
  const nodes: Node[] = rs.map((ring) => ({ ring, area: Math.abs(ringArea(ring)), parent: null, w: 0 }))
  nodes.sort((a, b) => b.area - a.area) // containers first
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!
    const [px, py] = sampleOf(n.ring)
    // smallest already-placed contour containing it = its parent
    for (let j = i - 1; j >= 0; j--) {
      if (pointInRing(px, py, nodes[j]!.ring)) {
        n.parent = nodes[j]!
        break
      }
    }
    n.w = orient(n.ring) + (n.parent ? n.parent.w : 0)
  }
  // only contours where filled ⇄ unfilled flips are real boundaries (a
  // same-direction contour nested in a filled one is interior, not a hole)
  const filled = (n: Node | null) => (n ? n.w !== 0 : false)
  const isEdge = (n: Node) => filled(n) !== filled(n.parent)
  const edgeAncestor = (n: Node): Node | null => {
    let p = n.parent
    while (p && !isEdge(p)) p = p.parent
    return p
  }
  const polys = new Map<Node, Polygon>()
  for (const n of nodes) if (isEdge(n) && filled(n)) polys.set(n, [n.ring])
  for (const n of nodes) {
    if (!isEdge(n) || filled(n)) continue
    const outer = edgeAncestor(n)
    if (outer) polys.get(outer)?.push(n.ring)
  }
  return [...polys.values()]
}

/** Crossing contours: split into faces of constant winding, keep the non-zero ones. */
function windingFacesSplit(rs: Ring[]): Polygon[] {
  let faces: { mp: MultiPolygon; w: number }[] = []
  for (const ring of rs) {
    const o = orient(ring)
    const R: MultiPolygon = [[ring]]
    const next: { mp: MultiPolygon; w: number }[] = []
    let rest: MultiPolygon | null = R
    for (const f of faces) {
      const inter = run(polygonClipping.intersection, [f.mp, R]) ?? []
      const diff = safeDifference(f.mp, R) ?? f.mp
      if (inter.length > 0) next.push({ mp: inter, w: f.w + o })
      if (diff.length > 0) next.push({ mp: diff, w: f.w })
      if (rest && rest.length > 0) rest = safeDifference(rest, f.mp)
    }
    if (rest && rest.length > 0) next.push({ mp: rest, w: o })
    faces = next
  }
  const filled = faces.filter((f) => f.w !== 0).map((f) => f.mp)
  if (filled.length === 0) return []
  return safeUnion(...filled) ?? filled.flat()
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
