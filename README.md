# Buttonic

**Live app: <https://lsarsfield.github.io/buttonic/>**

A browser tool for designing the engraved face of metal jean buttons. Its whole premise is
**true radial geometry from a single axis**: every element is computed from the centre
outward — counts, radii, and angles — the way a real die-stamp is engraved. No manual
duplicate-and-rotate, ever.

```
npm install
npm run dev        # http://localhost:5173
npm test           # geometry-kernel + import + golden-preset tests
npm run build      # typecheck + production build
```

## The model

A document is a **ring-layer stack** (centre → rim) over a mm-true canvas. Six layer types
cover the radial vocabulary:

| Layer | What it computes |
|---|---|
| **ring** | circle stroke or filled annulus (borders, rims, grooves) |
| **hatch** | N radial ticks between two radii, with twist — reeding / engine-turned texture |
| **repeat** | a motif (built-in library or your SVG) instanced N× around the axis; 1–2 rows with stagger + flip for herringbone |
| **ringText** | real glyph outlines on a circular baseline (kerning, inward/outward); classic arc placement or full polar warp |
| **center** | monogram glyph or SVG at the axis, with an optional clearance moat that clips line-work beneath |
| **bend** | any SVG warped into an annulus band — x→angle, y→radius — repeatable around the circle |

Two bundled templates recreate the reference buttons the project was built against:
**Engine turned** (guilloche hatch bands + emblem) and **Blackletter monogram**
(herringbone chevron band + blackletter D).

## Geometry guarantees

- **Exact where possible**: rings are circles, hatch ticks are lines, motifs and glyphs are
  true beziers placed by affine transforms. Polylines appear only for polar-warped content.
- **Flatten-then-warp**: the polar map isn't affine, so bezier control points are never
  warped directly; curves are flattened and adaptively subdivided *in warped space*
  (0.01 mm interactive, 0.0025 mm at export).
- **Constant cut width**: stroked art warps its centreline and keeps its mm stroke width —
  a graver cuts constant width. Filled art warps its outline.
- **Seam-exact**: instance angles are exact multiples of 360/N (never accumulated) and
  full-circle warps weld the 0°/360° seam.

## Export

- **SVG die file** — millimetre-true (`width="17mm"`, user units = mm), instances expanded
  to plain paths by default (CAM software dislikes `<use>`), optional mirror-for-die,
  warnings for sub-0.05 mm strokes and geometry off the face. The project JSON is embedded
  in `<metadata>`, so an exported SVG re-opens as a document.
- **PNG mockup** — flat or metal-preview rendering at 1024/2048/4096 px.
- **Project JSON** — portable save/load with fonts and SVG assets embedded base64.
  Autosaves to localStorage.

## Fonts

Bundled (OFL, licenses in `public/fonts/`): Cinzel, EB Garamond, UnifrakturCook.
Upload any `.ttf`/`.otf`. Kerning uses what opentype.js can read (GPOS support varies by
font — Cinzel kerns, EB Garamond's pairs aren't readable; letter-spacing is the manual
escape hatch). No WOFF2.

## Keyboard

`⌘Z / ⇧⌘Z` undo/redo · `⌘S` save project · `⌘D` duplicate layer · `⌫` delete layer ·
`[ ]` reorder · `0 / = / -` zoom fit/in/out · `M` metal preview · `Esc` deselect ·
space-drag / middle-drag pan · `⌘`+wheel zoom · arrow keys nudge fields (⇧ ×10, ⌥ ×0.1) ·
drag field labels to scrub · ⌥ bypasses snapping while dragging.

## Out of scope (v1)

Fill-vs-fill boolean knockouts (`polygon-clipping` is the v2 candidate), bezier re-fitting
of warped polylines, DXF export, three.js relief preview.
