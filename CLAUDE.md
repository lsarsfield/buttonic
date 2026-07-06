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
  svg-pathdata, polygon-clipping). Justify any addition.

## Commands

`npm run dev` (preview via .claude/launch.json "dev", port 5173) · `npm test` ·
`npm run typecheck` · `npm run build`. Dev builds expose `window.__engraver`
(stores, presets, exportSvg/exportPng, workspace, loadProjectFile) for scripted
browser verification.

Deploy = push to main → CI (typecheck + tests gate the deploy, base `./`).
**Pages flake:** "Deployment failed, try again later" with a green build is GitHub being
GitHub — `gh run rerun <id> --failed`; if it persists, dispatch fresh:
`gh workflow run deploy.yml`. (`error_count: 10` in deploy-pages logs is an input
param, not an error.)

## Architecture map

- `src/model/` — doc schema (`types.ts`, DOC_VERSION **8**), sequential `migrate.ts`
  (v2 localFonts, v3 ring-text symmetry, v4 boolean roles/halos, v5 partial-arc hatch
  `sweepDeg`/`repeats`, v6 stroke `cap`/`join`, v7 pointed-hatch `capPointMM`/`pointEnds`,
  v8 centre `motifId` (built-in motif as a third centre source, inert unless
  `sourceType: 'builtin'`) — copy this pattern; defaults spread FIRST so stored values win),
  hand-rolled
  `validate.ts` (REQUIRED field tables), `presets.ts` (Reference A/B + Flower-Power +
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
    Stroked ticks clip by centreline; POINTED hatch ticks are filled thin spindles →
    also clip by centreline (`filledThinTickClip`: keep only the OUTWARD span, drop inner
    stubs + sub-~3×-stroke nubs), NEVER martinez-differenced against a halo (that hangs
    for tens of seconds and mangles edges). Real motifs (curved/multi-loop) still use
    `safeDifference`.
  - `motifs/builtins.ts` — ~140 built-in motifs grouped Basic/Celestial/Floral/Bandana/
    Groovy/Workwear/Tarot/Old Book (`{id,label,d,paintType,group?}`, unit-box y-down).
    Referenced by string `motifId` (repeat bands + ring-text dividers + centre, never
    stored inline), so adding one is a single-file edit — no schema change. Holes via
    reversed-winding under nonzero (instanced defs have no evenodd). Many were authored by
    `scratchpad`-style generators (parametric polygons/stars/suns/rings via a `pt`/`circle`/
    `polarClosed`/`starPoly` toolkit; figurative ones hand-beziered). Rendered as swatches
    by `ui/controls/MotifPicker`, which is a SEARCH + collapsible-accordion + capped-scroll
    picker (the flat grid would swamp the ~272px inspector at this count; the group holding
    the current value auto-expands).
  - `poly.ts` polygon-clipping bridge: counter-preserving winding nesting (nonzero),
    xor (evenodd), disc-sweep Minkowski dilation (circumscribed caps — margins never
    undershoot), `safe*` wrappers (martinez can throw; never let it reach React).
  - `keepout.ts` per-layer knockout/halo regions, WeakMap-memoized, cached PRE-PHASE;
    consumers rotate by `contributor.phaseDeg − consumer.phaseDeg` at clip time.
- `src/io/` — fonts (bundled dozen in public/fonts + uploads + Local Font Access API
  with TTC extraction in `ttc.ts`), svgImport (capability whitelist, warn-and-skip),
  workspace (IndexedDB multi-button store; saver captures (id, doc) pairs at schedule
  time — anti-corruption invariants are commented in-file and load-bearing),
  exportSvg (mm-true die files, instance expansion default ON, project JSON embedded
  in <metadata> so exports re-open as documents), exportPng, thumbnail.
- `src/render/` — SvgStage (mm-true, `#doc` = export subtree, overlays separate),
  DocRenderer (per-layer memo; comparator: layer refs + disc values + contributor
  layer REFS — no deep geometry compares), MetalPreview (SVG filters, preview-only).
- `src/ui/` — panels per layer type, workspace switcher, dialogs.

## Invariants (violating these breaks real dies)

1. **Conventions:** mm units; degrees, 0° at 12 o'clock, CLOCKWISE, y-down
   (`polar.ts`, test-locked). Instance angles are exact `k*360/N`, never accumulated.
2. **Stroke semantics:** stroked geometry = constant-width cut (centreline + strokeMM);
   filled = outline fill. Never `vector-effect`. Line clipping is centreline-based.
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

185 vitest tests: kernel invariants (warp/dilation/winding/clip math with analytic
area checks), golden preset snapshots, migration round-trips, workspace anti-corruption
regressions, bundled-font + builtin-motif smoke tests (parse + outlines + in-box +
license), e2e boolean acceptance (reversed-monogram counter preservation, phase tracking,
pointed-hatch halo clipping).
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
  pointed-hatch ticks (thin filled spindles) are halo-clipped by centreline, not martinez.
- Pointed hatch ticks are filled, so the def-level clearance-disc trim (a stroked-line
  fast path) doesn't apply — a pointed band is bounded by its own rInner/rOuter, not by a
  centre clearance moat.
- Multi-tab workspace = last-write-wins (BroadcastChannel is future work).
- Deferred: bezier re-fitting of warped polylines, DXF export, three.js relief.

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
