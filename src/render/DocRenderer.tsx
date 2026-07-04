import { memo, useEffect } from 'react'
import type { Layer } from '../model/types'
import { clearancesAbove, clipCompiled, type ClearanceDisc } from '../geometry/clip'
import { compileLayer, INTERACTIVE_TOLERANCE_MM, type CompileCtx } from '../geometry/compile'
import { annulusPathD } from '../geometry/format'
import { ensureFontLoaded, getLoadedFont } from '../io/fonts'
import { ensureSvgParsed, getSvgAsset } from '../io/svgAssets'
import { useEngraver } from '../state/store'
import { useViewport } from '../state/viewport'
import { PlaceholderRenderer } from './layers/PlaceholderRenderer'
import { ShapesRenderer } from './layers/ShapesRenderer'

export function DocRenderer() {
  const doc = useEngraver((s) => s.doc)
  const assetsRevision = useEngraver((s) => s.assetsRevision)
  const fontsRevision = useEngraver((s) => s.fontsRevision)

  // Kick lazy font loads / SVG parses for any layer that needs one; the
  // revision bump on completion recompiles the affected layers.
  useEffect(() => {
    for (const layer of doc.layers) {
      if (layer.type === 'ringText') ensureFontLoaded(layer.fontId, doc)
      if (layer.type === 'center' && layer.sourceType === 'glyph') ensureFontLoaded(layer.fontId, doc)
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
  return (
    <>
      {doc.layers.map((layer, index) => (
        <LayerGroup
          key={layer.id}
          layer={layer}
          ctx={ctx}
          discs={clearancesAbove(doc.layers, index)}
        />
      ))}
    </>
  )
}

/**
 * One <g> per layer: a generous transparent hit band for selection plus the
 * compiled geometry (pointer-events off — the band is the only click target).
 * phaseDeg is a render-time rotation; dragging phase never recompiles.
 */
const LayerGroup = memo(
  function LayerGroup({
    layer,
    ctx,
    discs,
  }: {
    layer: Layer
    ctx: CompileCtx
    discs: ClearanceDisc[]
  }) {
    if (!layer.visible) return null
    const compiled = discs.length > 0 ? clipCompiled(compileLayer(layer, ctx), discs) : compileLayer(layer, ctx)
    const hasShapes = compiled.shapes.length > 0
    return (
      <g
        data-layer-id={layer.id}
        transform={layer.phaseDeg !== 0 ? `rotate(${layer.phaseDeg})` : undefined}
      >
        <HitBand layer={layer} />
        <g pointerEvents="none">
          {hasShapes ? (
            <ShapesRenderer layerId={layer.id} compiled={compiled} />
          ) : (
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
    prev.discs.length === next.discs.length &&
    prev.discs.every((d, i) => d.rMM === next.discs[i]!.rMM),
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
