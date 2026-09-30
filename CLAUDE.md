# Buttonic — project context for Claude

Parametric radial engraving designer for die-stamped jean buttons. Everything is computed
from the centre axis outward — counts, radii, angles — never manual duplicate-and-rotate.

- **Live:** https://buttonic.app (GitHub Pages; apex A records → 185.199.108–111.153;
  DNS at DreamHost). Old github.io/buttonic URL 301s here. The earlier
  buttonic.liet.co (Cargo DNS) is retired and no longer served.
- **Repo:** https://github.com/lsarsfield/buttonic (public; `gh` is authed as `lsarsfield` —
  Liam also owns a separate `LiamSarsfield` account, unused here).
- **Stack:** React 19 + TS strict + Vite 6 + vitest 3 (Node 18.20.8 locally — do NOT bump
  vite to 7). Runtime deps are deliberately minimal (zustand+zundo+immer, opentype.js,
  svg-pathdata, polygon-clipping, three — LAZY: only the 3D view / 3D PNG import it, so
  it stays out of the main chunk; keep it that way). Justify any addition.

## Commands

`npm run dev` (preview via .claude/launch.json "dev", port 5173) · `npm test` ·
`npm run typecheck` · `npm run build`. Dev builds expose `window.__engraver`
(stores, presets, exportSvg/exportPng, workspace, loadProjectFile) and, while the 3D
view is mounted, `window.__relief` ({scene, controls, render}) for scripted browser
verification.

Deploy = push to main → CI (typecheck + tests gate the deploy, base `./`).
**Pages flake:** "Deployment failed, try again later" with a green build is GitHub being
GitHub — `gh run rerun <id> --failed`; if it persists, dispatch fresh:
`gh workflow run deploy.yml`. (`error_count: 10` in deploy-pages logs is an input
param, not an error.)

## Architecture map

- `src/model/` — doc schema (`types.ts`, DOC_VERSION **15**), sequential `migrate.ts`
  (v2 localFonts, v3 ring-text symmetry, v4 boolean roles/halos, v5 partial-arc hatch
  `sweepDeg`/`repeats`, v6 stroke `cap`/`join`, v7 pointed-hatch `capPointMM`/`pointEnds`,
  v8 centre `motifId` (built-in motif as a third centre source, inert unless
  `sourceType: 'builtin'`), v9 text/centre `invertOverBare` (migrates FALSE = old
  vanish behaviour; new layers default true), v10 doc-level physical product
  `holeDiameterMM` (donut/tack cap; 0 = solid) + `relief` ('raised' = die-struck: the
  die's cut stands proud) + finish `'nickel'` (new-doc default); `'antique-brass'` added
  later with no migration (finish is a validated enum string), v11 the TRADE'S PRODUCT
  OPTIONS (from Liam's supplier guides, jeans buttons + rivets; metals only — he said
  ignore colour/Pantone/enamel/rubber/epoxy): `product` button|rivet, `style` (flat /
  domed / open top / open top concave / moveable shank · capped / nipple / inverted
  nipple / die-cast), `material` brass|die-cast, `logoDisplay` embossed|debossed|lasered
  (REPLACED `relief`: raised→embossed), `distressed`; `holeDiameterMM` = the style's
  centre-feature size (hole/nipple/cup/pin). Product options degrade softly in
  validate (`coerceProductOptions`), never reject. All product numbers live once in
  `src/model/product.ts` (STYLES/PRODUCTS/capProportions/FINISH_GROUPS), read by the
  panel, the 3D view and `io/specSheet.ts` (supplier-neutral order spec, also the SVG
  `<desc>`) — copy this pattern; defaults spread FIRST
  so stored values win). Factory defaults may differ from migration defaults: new
  text/centre layers get `haloMM = NEW_TEXT_GAP_MM` (0.15, the Engrave "Gap") while
  stored docs keep theirs. Hand-rolled `validate.ts` (REQUIRED field tables), `presets.ts` (Reference A/B + Flower-Power +
  Old-Book templates; **preset literals must carry every schema field** — the round-trip
  test compares them through parseDoc. New presets add NEW snapshots; existing goldens
  must stay byte-identical, so new schema fields default to the old behaviour).
- `src/geometry/` — the pure kernel (NO DOM/React/IO imports; node-tested):
  - `shapes.ts` Shape IR: `circle | line | path | instanced(def + N transforms)`.
    Exact-first: circles stay circles, motifs/glyphs stay beziers under affine;
    polylines ONLY for warped/boolean output (L-only, via `format.fmt`).
  - `compile.ts` per-layer compilers, WeakMap-memoized on layer identity +
    `compileCtxKey` (immer preserves identity of untouched layers).
  - `warp.ts` flatten-then-warp with adaptive subdivision IN WARPED SPACE (never warp
    bezier control points — the polar map isn't affine). `flatten.ts`, `pathData.ts`
    (single svg-pathdata wrapper), `mat2d.ts` (no DOMMatrix).
  - `clip.ts` cross-layer subtraction: clearance discs (v1, def-level fast path for
    hatch — keep) + polygon regions (v2). Regions-empty path returns the SAME objects.
    POINTED hatch ticks (filled convex spindles) subtract halos EXACTLY — the cut is
    precisely the halo, nothing more (Liam's spec): `convexDifference` walks the tick
    boundary against the region rings (ring chains inside the tick + boundary arcs
    outside the regions, stitched at shared crossings). Oblique letter edges cut
    obliquely, corner grazes shave only the corner, partial-width overlaps leave the
    rest standing, counters survive. Degenerate configurations (tangency,
    vertex-on-edge, overlapping contributor regions) fail validation and fall back to
    the conservative SWATH cut (`swathClearSpans`: union of per-edge Cyrus–Beck axial
    shadows on the tick axis; gap midpoints classify interior-only coverage).
    STROKED geometry is cut EXACTLY too (Liam's call, superseding tool-pass): a stroke
    becomes its true painted outline as convex pieces (`strokePieces.ts`: segment
    quads + SVG caps + joins; stroked rings tile into ¼-tol annular trapezoids whose
    untouched runs stay exact arcs), each cut by the same boundary walk; a touched
    stroke is emitted as a filled path, an untouched one as itself. Overlapping regions
    are unioned first (`mergeOverlapping`) so the walk sees disjoint rings. Minimum
    surviving piece `MIN_PIECE_MM` = 0.05 (Liam's rule): a piece is dropped only if
    no 0.05 disc fits anywhere in it (`holdsDisc`, polylabel-style) — judged per
    CONNECTED group, so a sliver joined to live stroke stays. Mean width 2A/P was wrong
    (killed star tips). Early-out bbox/band tests pad by the stroke's reach — a round
    cap can poke past its centreline's box. NEVER martinez-difference ticks against a
    halo (hangs tens of seconds, mangles edges). Real motifs (curved/multi-loop/
    non-convex filled) still use `safeDifference`.
    Halo 'outline' = an exact FILLED ring `dilate(region, haloStrokeMM) \ region`,
    built with the region (worker too), added to the layer's art BEFORE clipping so
    cut-outs/halos above trim it; the stated gap is clear metal. Halos dilate by
    `haloMM + 0.75·srcTol` (chord sag) — they may exceed the stated gap by ≲9 µm,
    never fall short. Clearance DISCS still clip strokes by centreline (changing it
    would move the Reference A golden — known limit).
  - `motifs/builtins.ts` — ~128 built-in motifs grouped Basic/Celestial/Floral/Bandana/
    Kilim/Groovy/Workwear/Tarot/Old Book (`{id,label,d,paintType,group?}`, unit-box y-down).
    Selection is grounded in the traditional canon per category (kilim = authentic Anatolian:
    elibelinde/scorpion/comb/muska/ram's-horn; tarot = the four suits + Major-Arcana emblems;
    Old Book = real typographic ornaments: hedera/pilcrow/dagger/asterism/dinkus). LESSON from
    a prune-then-rebuild: intricate hand-drawn FIGURATIVE silhouettes read as mush at ~36px, so
    the figurative motifs are now ADOPTED from open-licensed icon libraries — normalized into
    the unit box by `scratchpad/find-refs.mjs`+`normalize-files.mjs` (game-icons.net CC BY,
    Wikimedia CC0), attributed in `CREDITS.md`; geometric/parametric motifs stay original.
    game-icons author for nonzero winding, so holes adopt as-is (no evenodd fixups needed). Referenced by string `motifId` (repeat bands + ring-text dividers + centre, never
    stored inline), so adding one is a single-file edit — no schema change. Holes via
    reversed-winding under nonzero (instanced defs have no evenodd). Many were authored by
    `scratchpad`-style generators (parametric polygons/stars/suns/rings via a `pt`/`circle`/
    `polarClosed`/`starPoly` toolkit; figurative ones hand-beziered). Rendered as swatches
    by `ui/controls/MotifPicker`, which is a SEARCH + collapsible-accordion + capped-scroll
    picker (the flat grid would swamp the ~272px inspector at this count; the group holding
    the current value auto-expands).
  - `poly.ts` polygon-clipping bridge: TRUE nonzero reconstruction (bbox clusters;
    self-crossing contours split by Seifert smoothing — Jost B, Roboto 6; contours that
    touch/overlap/cross → face split with winding sums — Cinzel's serifs share the stem's
    edges; otherwise an exact containment tree; `nonzero.test.ts` checks every glyph of
    every bundled font + every fill motif against a scanline nonzero fill),
    xor (evenodd), disc-sweep Minkowski dilation (circumscribed caps — margins never
    undershoot), `safe*` wrappers (martinez can throw; never let it reach React).
  - `keepout.ts` per-layer knockout/halo regions, WeakMap-memoized, cached PRE-PHASE;
    consumers rotate by `contributor.phaseDeg − consumer.phaseDeg` at clip time.
    **Masks** (`booleanRole: 'mask'`, any content layer — Mode "Engrave | Cut out | Mask"):
    a window — the layer draws nothing and everything BELOW it survives only inside its
    shape (grown by the halo, "Grow"). Implemented as a subtract of the COMPLEMENT
    (`buildKeepoutRegion(…, maskDiscRMM)`: disc of radius diameter + 1 mm minus the
    shape; rotation-invariant, so pre-phase caching holds) — every exact-cut guarantee
    comes free. Stacked masks intersect (each restricts all beneath; union = one layer
    with several shapes, e.g. a repeat of dots = quatrefoil). An empty shape keeps
    nothing (export warns). Masks never take part in cross-relief clipping, have no
    outline mode, and count as bare metal outside the window for invert coverage; a mask
    above a cut-out trims its inverted overhang like any engraving. `mpRadialBand`
    reaches r = 0 for regions containing the axis (the band prefilter used to wave
    through geometry nearer the axis than a solid region's edge).
  - `star.ts` parametric star/polygon for the centre `'star'` source: N points on the
    sizeMM circle (first at 12 o'clock), valleys at `starInner`·R (cos(180°/N) = regular
    polygon), sides straight or exact circular arcs (`starBulge` = sagitta ÷ half-chord;
    + swells, − caves in). Sized point-to-point, never bbox-recentred.
  - `invert.ts` — text over other layers, Cut out half. UI model (ringText + centre,
    `OverlayControls`): **Engrave** = engraved on top, kept clear of what's beneath by
    the Gap (= halo); **Cut out** = knocked out of what's beneath (Grow = halo) and, with
    `invertOverBare` ("Over bare: Engrave"), ENGRAVED where it crosses bare metal
    (stamp reversal): `T ∖ coverage`, emitted as the cut-out layer's own filled geometry
    and clipped by keepouts above like any engraving. Coverage is built bottom-up in the
    absolute frame: each layer's real engraved outline (disc moats applied), minus any
    halo/knockout between it and the cut-out, plus lower cut-outs' own inverts —
    EXCEPT hatch, which counts as its whole band (`hatchBand`: annulus, or first→last
    tick ±½ stroke per arc block, twisted, moat-raised). Literal XOR over hatch would
    engrave the gaps between ticks (inverse duty cycle, illegible) — don't "fix" it.
    Without a halo, T IS the knockout region (shared flattening → no seam slivers);
    pieces no 0.05 mm disc fits into are dropped (`holdsDisc`, the min-piece rule). Memo key = content of layers
    0..i + discs above + identity of the consumed regions (the canvas passes
    stale-while-recomputing regions, export passes exact ones). ~10–30 ms per export.
- `src/io/` — fonts (bundled dozen in public/fonts + uploads + Local Font Access API
  with TTC extraction in `ttc.ts`), svgImport (capability whitelist, warn-and-skip),
  (doc-embedded fonts are cached by id AND bytes: a different font re-embedded under the
  same asset id is re-parsed, never served stale), workspace (IndexedDB multi-button store; saver captures (id, doc) pairs at schedule
  time — anti-corruption invariants are commented in-file and load-bearing),
  exportSvg (mm-true die files, instance expansion default ON, project JSON embedded
  in <metadata> so exports re-open as documents), exportPng, thumbnail.
- `src/render/` — SvgStage (mm-true, `#doc` = export subtree, overlays separate),
  DocRenderer (per-layer memo; comparator: layer refs + disc values + contributor
  REGION identity — no deep geometry compares). Mask layers render nothing, take no
  canvas clicks (a face-sized window on top would swallow them — select in the layer
  list), and ghost their window outline (dashed) while selected. Keepout regions for the CANVAS are stale-while-recomputing
  (`keepoutAsync.ts` + `keepoutWorker.ts`): edits render immediately with the
  last-good region while the ~80–190ms union+dilation reruns in a Web Worker
  (120ms trailing debounce, latest-wins, sync fallback on worker failure);
  `regionsRevision` bumps on landing and the StatusBar shows a "halo…" pill
  while pending. Regions are content-keyed (`regionKey`: phaseDeg/name excluded)
  so phase scrubs and renames never rebuild. The worker bundle imports only
  `keepoutRegion.ts` (no compile.ts → no opentype). exportSvg stays synchronous
  and exact. Vite emits the worker URL root-absolute under base './' — fine at
  the domain root; a 404 would trip the sync fallback.
- `src/render/relief/` — the **3D view** (toolbar `Flat | 3D`, `M`; replaced the old
  SVG-filter Metal mode) and the 3D PNG mockup. Acceptance reference: Liam's photo of
  Stevenson Overall Co. tack buttons on raw selvedge (satin nickel, raised lettering,
  rolled edge, copper post in a donut hole, ~34° product-shot angle).
  - `heightField.ts` (pure, node-tested, worker-safe): die raster coverage → exact
    Felzenszwalb EDT signed distance (sub-pixel on boundary px, ~1.6 px blur against
    diagonal terracing — the blur is in PIXELS, tuned for the live 2048² over the face)
    → wall-profiled design height (raised/recessed) → cavity (blurred high-ground vs
    local height) + lowness → OBJECT-SPACE normals of cap profile + relief, a raw
    `occl` map (R cavity, G lowness) and a 1024² displacement. PATINA IS PER FINISH:
    `finishMaps(field, finish.patina)` composes AO/roughness + oxide-albedo on the main
    thread (~50 ms) — nickel greys only tight recesses, antique brass fills the whole
    low ground with brown-black oxide (burnished highs). Finish switches never re-run
    the EDT. `baseProfile` = flat face (optional
    dome), quarter-round rolled shoulder, rolled hole lip.
  - Per-style cap profiles (`baseProfile`, from `reliefParamsOf(doc)`): dome, concave
    dish, rolled shoulder, and the centre feature — hole/pin lip, nipple knob, sunk
    cup; die-cast = thicker cap + crisper edge + deeper relief. Lasered = no relief,
    art located by `occl.B` and marked dark/matte in `finishMaps`; distressed =
    deterministic mottled oxide (`distressMask`) worn bright on the high points.
    Patina maps carry METALNESS (surface.B): oxide is a dark dielectric film — dimmed
    metal still mirrors a bright studio. Normals are HALF-FLOAT (8-bit terraced into
    blocky bands on polished domes). SHAPE CALIBRATION (Liam: "things seem very
    flat"): die-struck relief is DEEP — brass 0.3 mm, die-cast 0.45 (0.12 read as
    print), drafted walls 0.1 mm, caps ~D/10 tall with a 0.04 D rolled edge, domed cap
    0.2 D; proportions tuned against the supplier guides' page-2 shape photos. Side
    walls are duller than the face and carry the finish's field oxide. Displacement
    uses linear float filtering where supported (nearest = jagged walls at depth).
    TWO ADVERSARIAL REVIEWS against the supplier photos drove the current forms —
    keep these invariants: rolled edges are TANGENT fillets (`capGeometry`/`Fillet`:
    leave the face on its own slope, end vertical at the edge — no dome crease); the
    cap is always deeper than its lowest fillet (`reliefParamsOf` guard); the face mesh
    ends halfway round the roll and the body lathes the rest (one dull side band);
    LatheGeometry profiles for FrontSide parts run bottom→top (else inside-out); the
    open-top post seats below the lip's lowest point; the relief-wall limiter searches
    far enough to reach a feature's medial axis and smooths the width map (a short
    reach halved and combed every wall — `relief walls` test guards it); the shadow
    pass uses a low-res proxy face mesh. `postFinish` (v13, was v12 `postMetal`):
    the open-top post takes ANY cap finish (silver→dull nickel, copper→the new
    'copper' Polished copper), rendered darkened for sitting down a pit.
    MIXED RELIEF (v14): every layer has `relief` 'inherit' | embossed | debossed |
    lasered (`layerRelief`, `reliefGroups` in product.ts). The 3D pipeline
    rasterizes one mask per class via `exportSvg({onlyLayers})` (each layer still
    clipped by ALL keepouts), and `buildHeightField(masks)` puts raised +d, sunk −d,
    field midway for "high ground" (cavity) purposes; raised art inside a sunk area
    lands at face level. A mixed die file wraps layers in `relief-raised` /
    `relief-sunk` / `relief-lasered` groups (single-relief output unchanged); the
    spec sheet lists layers per depth. `regionKey` ignores `relief`.
    v15: centre `sourceType: 'star'` (`starPoints`/`starInner`/`starBulge`, inert
    otherwise; `geometry/star.ts`) + `booleanRole: 'mask'` (new enum value, no migration;
    validate coerces an unknown role to 'draw'). Masks join no relief group.
    Layers at DIFFERENT depths never share metal: the upper one clips the lower at its
    exact outline with no Gap (`clipsAcrossRelief` in keepout.ts, via
    `keepoutsAbove(…, doc.logoDisplay)`); same-depth layers still merge unless a Gap is set.
    `studio` backdrop = white sweep + a bright PMREM
    environment, the button standing on its tack/swivel shank, shot low (62°).
  - `heightAsync.ts` rasterizes the EXACT `exportSvg` die (halos/cut-outs/inverts
    included) on the main thread (~25 ms), EDT in `heightWorker.ts` (~1 s at 2048²),
    content-key cached (layers/diameter/hole/relief + font/asset revisions; finish,
    light, camera excluded) so the PNG export reuses the canvas's field.
  - `scene.ts` `ButtonScene` (shared by stage + PNG): polar-grid face mesh (dense
    rings on the rolled curves) with displacementMap + `ObjectSpaceNormalMap` +
    roughness/ao/map from the field; `customDepthMaterial` carries the displacement
    into shadows. Lathed body (side wall + curled base, dark low-env hole wall), lathed
    copper post + bore. Lighting = a PROCEDURAL product studio through PMREM (dark
    room + key softbox + overhead diffuser + strip fill; `environmentRotation` follows
    the key light's azimuth) + a shadow-casting key DirectionalLight. The stock
    RoomEnvironment made nickel read as porcelain — metals need contrast to reflect.
    `NeutralToneMapping` (AgX greyed the indigo). Procedural denim (`denim.ts`, 3/1
    twill, slub, ring-dyed flecks, raw/ecru) with low envMapIntensity.
  - `ReliefStage.tsx` (React.lazy): render-on-demand, OrbitControls (≤65° polar),
    Photo/Top poses, 250 ms debounced latest-wins relief rebuild (StatusBar "3D…"),
    `lastPose` shared with `renderPng.ts`. `useDocResources` (exported from
    DocRenderer) kicks font/asset loads since DocRenderer isn't mounted in 3D.
  - Browser gotcha: the preview pane throttles rAF to ~1 fps when backgrounded —
    measure main-thread stalls with a setInterval probe, not rAF.
- Flat-canvas shape preview (preview only, never exported): `overlays/CapShape.tsx`
  shades the blank from the same `baseProfile` the 3D view uses (`CapShading`, under
  the art) and draws a punched-out centre as a hatched, labelled opening OVER the art
  (`OpeningMask`, art there is dimmed — it isn't struck); `ui/ProfileSection.tsx` is a
  true-scale cross-section inset (flat view + guides on); DocRenderer tints sunk and
  lasered layers (raised = engrave colour) so mixed-relief dies read in 2D.
- `src/ui/` — panels per layer type, workspace switcher, dialogs.
- `designs/` and `liet/` — LOCAL, untracked (they hold Liam's reference photos and brand
  assets; never commit): reference recreations and custom fonts built by scripts
  (`npx vite-node designs/<script>.ts`, `node liet/<script>.mjs`).

## Invariants (violating these breaks real dies)

1. **Conventions:** mm units; degrees, 0° at 12 o'clock, CLOCKWISE, y-down
   (`polar.ts`, test-locked). Instance angles are exact `k*360/N`, never accumulated.
2. **Stroke semantics:** stroked geometry = constant-width cut (centreline + strokeMM);
   filled = outline fill. Never `vector-effect`. Region clipping cuts a stroke's TRUE
   outline (caps + joins); only clearance-disc clipping is centreline-based.
   Per-layer stroke `cap` (butt/round/square, hatch/repeat) + `join` (miter/round/bevel,
   repeat) via `SvgStrokeCap`/`StrokeJoin`; `join` is OMITTED from paint when miter so
   goldens stay byte-identical. Hatch `cap: 'point'` synthesizes a filled tapered spindle
   (SVG has no pointed cap) — kept out of the SVG-valid `SvgStrokeCap`.
3. **`phaseDeg` never enters compiled geometry or cached regions** — render-time
   rotation only.
4. **Golden snapshots** (`src/model/__snapshots__/`) are the acceptance contract for
   the two reference presets. NEVER `vitest -u`. A golden diff = your change altered
   existing documents' output = wrong.
5. Exports contain plain black fills/strokes — no masks, no filters, no CSS,
   no currentColor. Compound knockouts are evenodd paths of disjoint polygons.
6. Every emitted number goes through `fmt` (deterministic goldens, small files).

## Testing & verification culture

296 vitest tests: kernel invariants (warp/dilation/winding/clip math with analytic
area checks), golden preset snapshots, migration round-trips, workspace anti-corruption
regressions, bundled-font + builtin-motif smoke tests (parse + outlines + in-box +
license), e2e boolean acceptance (reversed-monogram counter preservation, phase tracking,
pointed-hatch halo clipping), invert-over-bare analytic areas (`invert.test.ts`),
masks (`mask.test.ts`: analytic tick/disc and star areas, Grow, mask + cut-out, stacked
masks, phase tracking, invert interplay, schema, die output),
3D height-field kernel (`relief/heightField.test.ts`: EDT vs analytic disc, polarity,
normals, cavity, per-finish patina, cap profile), schema v10 + centre-hole export warnings.
After code changes: typecheck + full suite, then ONE browser acceptance pass via the
preview tools + `window.__engraver`, then push (CI re-gates).

## Known limits / backlog

- opentype.js: no WOFF2, no CFF2, GPOS kerning partial (Cinzel kerns; EB Garamond's
  pairs unreadable — letter-spacing is the escape hatch). macOS .ttc handled via
  `ttc.ts` extraction.
- Local fonts are Chromium-only by design; projects store references (postscript name),
  not bytes; exports always bake outlines. Explicit per-font Embed action exists.
- Halo dilation is martinez's worst case: disc-sweep capsules (~200ms, memoized).
  Thin-rect capsules are slower AND crash — don't "optimize" back to them. Same reason
  thin ticks/stroke pieces are cut by the convex boundary walk, not martinez.
- Pointed hatch ticks are filled, so the def-level clearance-disc trim (a stroked-line
  fast path) doesn't apply — a pointed band is bounded by its own rInner/rOuter, not by a
  centre clearance moat.
- Multi-tab workspace = last-write-wins (BroadcastChannel is future work).
- 3D: the face relief is a height field at 2048² over the diameter (~8 µm/px); deep
  zoom past that softens. Dome is supported by `baseProfile` but not exposed. Denim is
  procedural (a CC0 scan would look more real — needs Liam's OK to download).
- Deferred: bezier re-fitting of warped polylines, DXF export.

## Working with Liam

Design-literate founder (liet.co / fluorescent.co). Communicates via reference imagery —
recreating the reference IS the acceptance test. Prefers a clear recommendation over
option menus. Session pattern: plan in plan-mode first (sometimes Fable plans /
Opus executes — plans must then be fully self-contained), lean execution, one browser
acceptance pass, ship to live. Public repo visibility, commits, and domain changes were
each explicitly user-approved — keep confirming outward-facing actions of new kinds.

When a visual bug won't reproduce from a screenshot, ask for the exported `.button` JSON
and load it — the exact layer settings (e.g. a hatch `cap: 'point'`, local font ids) are
usually the missing clue; guessing a repro wastes rounds. `~/Downloads` is macOS-TCC-
protected (Read/cp fail even with sandbox off), so have him drop the file into the repo
folder. Verify panel-UI changes at the REAL inspector width (~272px, fixed), not a wide
preview window; stack 4-option segmented controls (label above) so they don't overflow.
