# Buttonic — project context for Claude

Parametric radial engraving designer for die-stamped jean buttons. Everything is computed
from the centre axis outward — counts, radii, angles — never manual duplicate-and-rotate.

- **Live:** https://buttonic.liet.co (GitHub Pages; `buttonic` CNAME → lsarsfield.github.io;
  DNS lives at Cargo, ns*.cargo.site). Old github.io/buttonic URL 301s here.
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

- `src/model/` — doc schema (`types.ts`, DOC_VERSION **4**), sequential `migrate.ts`
  (v2 localFonts, v3 ring-text symmetry, v4 boolean roles/halos — copy this pattern),
  hand-rolled `validate.ts` (REQUIRED field tables), `presets.ts` (two reference-button
  templates; **preset literals must carry every schema field** — the round-trip test
  compares them through parseDoc).
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
3. **`phaseDeg` never enters compiled geometry or cached regions** — render-time
   rotation only.
4. **Golden snapshots** (`src/model/__snapshots__/`) are the acceptance contract for
   the two reference presets. NEVER `vitest -u`. A golden diff = your change altered
   existing documents' output = wrong.
5. Exports contain plain black fills/strokes — no masks, no filters, no CSS,
   no currentColor. Compound knockouts are evenodd paths of disjoint polygons.
6. Every emitted number goes through `fmt` (deterministic goldens, small files).

## Testing & verification culture

159 vitest tests: kernel invariants (warp/dilation/winding/clip math with analytic
area checks), golden preset snapshots, migration round-trips, workspace anti-corruption
regressions, bundled-font smoke tests (parse + outlines + license per manifest entry),
e2e boolean acceptance (reversed-monogram counter preservation, phase tracking).
After code changes: typecheck + full suite, then ONE browser acceptance pass via the
preview tools + `window.__engraver`, then push (CI re-gates).

## Known limits / backlog

- opentype.js: no WOFF2, no CFF2, GPOS kerning partial (Cinzel kerns; EB Garamond's
  pairs unreadable — letter-spacing is the escape hatch). macOS .ttc handled via
  `ttc.ts` extraction.
- Local fonts are Chromium-only by design; projects store references (postscript name),
  not bytes; exports always bake outlines. Explicit per-font Embed action exists.
- Halo dilation is martinez's worst case: disc-sweep capsules (~200ms, memoized).
  Thin-rect capsules are slower AND crash — don't "optimize" back to them.
- Multi-tab workspace = last-write-wins (BroadcastChannel is future work).
- Deferred: bezier re-fitting of warped polylines, DXF export, three.js relief.

## Working with Liam

Design-literate founder (liet.co / fluorescent.co). Communicates via reference imagery —
recreating the reference IS the acceptance test. Prefers a clear recommendation over
option menus. Session pattern: plan in plan-mode first (sometimes Fable plans /
Opus executes — plans must then be fully self-contained), lean execution, one browser
acceptance pass, ship to live. Public repo visibility, commits, and domain changes were
each explicitly user-approved — keep confirming outward-facing actions of new kinds.
