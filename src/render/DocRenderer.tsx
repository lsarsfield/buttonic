import { memo, useEffect } from 'react'
import type { Layer } from '../model/types'
import { isLocalFontId } from '../model/types'
import { clipCompiled } from '../geometry/clip'
import { compileLayer, INTERACTIVE_TOLERANCE_MM, type CompileCtx } from '../geometry/compile'
import { annulusPathD } from '../geometry/format'
import { haloOf, isSubtractLayer, regionOutlineShapes, type Keepouts } from '../geometry/keepout'
import { getRegionAsync, keepoutsAboveAsync, pruneRegions } from './keepoutAsync'
import { rotateMultiPolygon, type MultiPolygon } from '../geometry/poly'
import { ensureFontLoaded, getLoadedFont } from '../io/fonts'
import { ensureLocalFontsResolved } from '../io/localFonts'
import { ensureSvgParsed, getSvgAsset } from '../io/svgAssets'
import { useEngraver } from '../state/store'
import { useViewport } from '../state/viewport'
import { PlaceholderRenderer } from './layers/PlaceholderRenderer'
import { ShapesRenderer } from './layers/ShapesRenderer'

export function DocRenderer() {
  const doc = useEngraver((s) => s.doc)
  const assetsRevision = useEngraver((s) => s.assetsRevision)
  const fontsRevision = useEngraver((s) => s.fontsRevision)
  useEngraver((s) => s.regionsRevision) // re-render when an off-thread region lands

  // Kick lazy font loads / SVG parses for any layer that needs one; the
  // revision bump on completion recompiles the affected layers. Local-font
  // references get one silent resolution attempt (works without a prompt
  // once permission was granted in a past session).
  useEffect(() => {
    const wantFont = (fontId: string) => {
      if (isLocalFontId(fontId)) ensureLocalFontsResolved(doc)
      else ensureFontLoaded(fontId, doc)
    }
    for (const layer of doc.layers) {
      if (layer.type === 'ringText') wantFont(layer.fontId)
      if (layer.type === 'center' && layer.sourceType === 'glyph') wantFont(layer.fontId)
      if (layer.type === 'center' && layer.sourceType === 'asset' && layer.assetId) {
        ensureSvgParsed(layer.assetId, doc)
      }
      if (layer.type === 'bend' && layer.assetId) ensureSvgParsed(layer.assetId, doc)
      if (layer.type === 'repeat' && layer.source.kind === 'asset') {
        ensureSvgParsed(layer.source.assetId, doc)
      }
    }
  }, [doc, fontsRevision, assetsRevision])

  const ctx: CompileCtx = {
    diameterMM: doc.diameterMM,
    toleranceMM: INTERACTIVE_TOLERANCE_MM,
    assetsRevision,
    fontsRevision,
    getFont: getLoadedFont,
    getSvgAsset,
  }
  pruneRegions(new Set(doc.layers.map((l) => l.id)))
  return (
    <>
      {doc.layers.map((layer, index) => (
        <LayerGroup
          key={layer.id}
          layer={layer}
          ctx={ctx}
          keepouts={keepoutsAboveAsync(doc.layers, index, ctx)}
          ownRegion={
            haloOf(layer) > 0 && (layer as { haloMode?: string }).haloMode === 'outline'
              ? getRegionAsync(layer, ctx).region
              : null
          }
        />
      ))}
    </>
  )
}

// Contributors compare by REGION identity (the actual clip input) + phase, not
// by layer ref: while a stale region is held during a scrub, consumers skip
// recompiling/re-clipping entirely — only the settle re-renders them.
const sameKeepouts = (a: Keepouts, b: Keepouts): boolean =>
  a.discs.length === b.discs.length &&
  a.discs.every((d, i) => d.rMM === b.discs[i]!.rMM) &&
  a.contributors.length === b.contributors.length &&
  a.contributors.every(
    (c, i) => c.region === b.contributors[i]!.region && c.phaseDeg === b.contributors[i]!.phaseDeg,
  )

/**
 * One <g> per layer: a generous transparent hit band for selection plus the
 * compiled geometry (pointer-events off — the band is the only click target).
 * phaseDeg is a render-time rotation; dragging phase never recompiles.
 *
 * Cut-out (subtract) layers draw nothing — their geometry is subtracted from
 * layers below via keepoutsAbove — but stay selectable and show a faint
 * preview while selected.
 */
const LayerGroup = memo(
  function LayerGroup({
    layer,
    ctx,
    keepouts,
    ownRegion,
  }: {
    layer: Layer
    ctx: CompileCtx
    keepouts: Keepouts
    ownRegion: MultiPolygon | null
  }) {
    const selected = useEngraver((s) => s.selection === layer.id)
    if (!layer.visible) return null
    const compiled = compileLayer(layer, ctx)

    if (isSubtractLayer(layer)) {
      return (
        <g data-layer-id={layer.id} transform={layer.phaseDeg !== 0 ? `rotate(${layer.phaseDeg})` : undefined}>
          <HitBand layer={layer} />
          {selected && compiled.shapes.length > 0 && (
            <g pointerEvents="none" opacity={0.3}>
              <ShapesRenderer layerId={layer.id} compiled={compiled} />
            </g>
          )}
        </g>
      )
    }

    // regions from contributors above, rotated into this layer's local frame
    const regions = keepouts.contributors.map((c) => rotateMultiPolygon(c.region, c.phaseDeg - layer.phaseDeg))
    const clipped =
      keepouts.discs.length > 0 || regions.length > 0
        ? clipCompiled(compiled, { discs: keepouts.discs, regions }, INTERACTIVE_TOLERANCE_MM)
        : compiled

    // halo 'outline': engrave this layer's own halo boundary (pre-phase region
    // drawn inside this phase-rotated group — correct by construction; the
    // region is a prop so its settle re-renders through the memo comparator)
    const shapes = [...clipped.shapes]
    if (ownRegion) {
      shapes.push(...regionOutlineShapes(ownRegion, (layer as { haloStrokeMM: number }).haloStrokeMM))
    }

    const hasShapes = shapes.length > 0
    const swallowed = !hasShapes && compiled.shapes.length > 0 // wholly clipped away — intentional
    return (
      <g data-layer-id={layer.id} transform={layer.phaseDeg !== 0 ? `rotate(${layer.phaseDeg})` : undefined}>
        <HitBand layer={layer} />
        <g pointerEvents="none">
          {hasShapes ? (
            <ShapesRenderer layerId={layer.id} compiled={{ shapes, warnings: clipped.warnings }} />
          ) : swallowed ? null : (
            <PlaceholderRenderer layer={layer} />
          )}
        </g>
      </g>
    )
  },
  (prev, next) =>
    prev.layer === next.layer &&
    prev.ctx.diameterMM === next.ctx.diameterMM &&
    prev.ctx.assetsRevision === next.ctx.assetsRevision &&
    prev.ctx.fontsRevision === next.ctx.fontsRevision &&
    prev.ownRegion === next.ownRegion &&
    sameKeepouts(prev.keepouts, next.keepouts),
)

/** [inner, outer] band a layer occupies, for hit-testing and handles. */
export function layerBand(layer: Layer): { rInner: number; rOuter: number } {
  switch (layer.type) {
    case 'ring':
      return layer.mode === 'annulus'
        ? { rInner: layer.rInnerMM, rOuter: layer.rOuterMM }
        : {
            rInner: layer.radiusMM - layer.strokeMM / 2,
            rOuter: layer.radiusMM + layer.strokeMM / 2,
          }
    case 'hatch':
    case 'bend':
      return { rInner: layer.rInnerMM, rOuter: layer.rOuterMM }
    case 'repeat': {
      const rowSpread = layer.rows === 2 ? layer.rowGapMM : 0
      return {
        rInner: layer.radiusMM - layer.sizeMM / 2 - rowSpread,
        rOuter: layer.radiusMM + layer.sizeMM / 2,
      }
    }
    case 'ringText':
      return { rInner: layer.radiusMM - layer.sizeMM * 0.4, rOuter: layer.radiusMM + layer.sizeMM }
    case 'center':
      return { rInner: 0, rOuter: Math.max(0.5, layer.sizeMM / 2) }
  }
}

const HIT_PAD_MM = 0.35

function HitBand({ layer }: { layer: Layer }) {
  const select = useEngraver((s) => s.select)
  const band = layerBand(layer)
  const rInner = Math.max(0, band.rInner - HIT_PAD_MM)
  const rOuter = Math.max(0.1, band.rOuter + HIT_PAD_MM)

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || useViewport.getState().spaceDown) return
    e.stopPropagation()
    select(layer.id)
  }

  if (rInner <= 0.01) {
    return <circle r={rOuter} fill="transparent" stroke="none" onPointerDown={onPointerDown} />
  }
  return (
    <path
      d={annulusPathD(rOuter, rInner)}
      fillRule="evenodd"
      fill="transparent"
      stroke="none"
      onPointerDown={onPointerDown}
    />
  )
}
