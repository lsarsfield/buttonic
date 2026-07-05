import type { CompiledLayer, InstanceTransform, Paint, Shape } from '../../geometry/shapes'

function paintProps(paint: Paint, strokeScale = 1) {
  return {
    fill: paint.fill ? 'currentColor' : 'none',
    stroke: paint.stroke ? 'currentColor' : 'none',
    strokeWidth: paint.stroke ? paint.stroke.widthMM / strokeScale : undefined,
    strokeLinecap: paint.stroke?.cap,
    strokeLinejoin: paint.stroke?.join,
  } as const
}

function instanceTransform(tr: InstanceTransform): string | undefined {
  const parts: string[] = []
  if (tr.dx !== 0 || tr.dy !== 0) parts.push(`translate(${tr.dx} ${tr.dy})`)
  if (tr.rotateDeg !== 0) parts.push(`rotate(${tr.rotateDeg})`)
  if (tr.mirrorX) parts.push('scale(-1 1)')
  return parts.length > 0 ? parts.join(' ') : undefined
}

function ShapeEl({ shape, defId }: { shape: Shape; defId: string }) {
  switch (shape.kind) {
    case 'circle':
      return <circle r={shape.rMM} {...paintProps(shape.paint)} />
    case 'line':
      return <line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} {...paintProps(shape.paint)} />
    case 'path':
      return <path d={shape.d} fillRule={shape.fillRule} {...paintProps(shape.paint)} />
    case 'instanced': {
      const d = shape.def
      const defTransform = `translate(${d.dx} ${d.dy}) rotate(${d.rotateDeg}) scale(${d.scale} ${
        d.scale * d.flipY
      })`
      return (
        <>
          <defs>
            {/* Constant-width rule: the def is scaled, so the mm stroke width is
                pre-divided by the scale — engraved lines stay true cuts. */}
            <path
              id={defId}
              d={d.d}
              transform={defTransform}
              {...paintProps(shape.paint, Math.abs(d.scale))}
            />
          </defs>
          {shape.transforms.map((tr, i) => (
            <use key={i} href={`#${defId}`} transform={instanceTransform(tr)} />
          ))}
        </>
      )
    }
  }
}

export function ShapesRenderer({ layerId, compiled }: { layerId: string; compiled: CompiledLayer }) {
  return (
    <>
      {compiled.shapes.map((shape, i) => (
        <ShapeEl key={i} shape={shape} defId={`def-${layerId}-${i}`} />
      ))}
    </>
  )
}
