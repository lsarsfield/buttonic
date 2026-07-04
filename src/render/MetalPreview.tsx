import type { Finish } from '../model/types'
import { polarToXY } from '../geometry/polar'

/**
 * Metal preview: a plate gradient lit from the light azimuth, subtle grain,
 * and an "engraved-in" filter for the artwork — inner shadow on the lit edge
 * of each cut plus a glint just past the far edge. Preview-only; none of
 * this ever enters the export subtree.
 */

export interface FinishPalette {
  base: string
  light: string
  dark: string
  engrave: string
  glint: string
  grainOpacity: number
  brushed: boolean
}

export const FINISHES: Record<Finish, FinishPalette> = {
  gunmetal: {
    base: '#43464d',
    light: '#787d88',
    dark: '#1b1c20',
    engrave: 'rgba(12, 13, 16, 0.88)',
    glint: 'rgba(255, 255, 255, 0.5)',
    grainOpacity: 0.05,
    brushed: false,
  },
  steel: {
    base: '#9aa0a8',
    light: '#dde1e6',
    dark: '#565c64',
    engrave: 'rgba(30, 33, 38, 0.82)',
    glint: 'rgba(255, 255, 255, 0.65)',
    grainOpacity: 0.07,
    brushed: true,
  },
  brass: {
    base: '#a8863f',
    light: '#e3c87e',
    dark: '#5f4a1e',
    engrave: 'rgba(43, 32, 8, 0.85)',
    glint: 'rgba(255, 244, 214, 0.6)',
    grainOpacity: 0.05,
    brushed: false,
  },
}

export function MetalDefs({
  finish,
  lightDeg,
  faceR,
}: {
  finish: Finish
  lightDeg: number
  faceR: number
}) {
  const pal = FINISHES[finish]
  const lightPos = polarToXY(lightDeg, faceR)
  const off = polarToXY(lightDeg, 0.07)
  const pad = faceR + 1

  return (
    <defs>
      <linearGradient
        id="metal-plate"
        gradientUnits="userSpaceOnUse"
        x1={lightPos.x}
        y1={lightPos.y}
        x2={-lightPos.x}
        y2={-lightPos.y}
      >
        <stop offset="0%" stopColor={pal.light} />
        <stop offset="55%" stopColor={pal.base} />
        <stop offset="100%" stopColor={pal.dark} />
      </linearGradient>
      <radialGradient id="metal-sheen" gradientUnits="userSpaceOnUse" cx={0} cy={0} r={faceR}>
        <stop offset="72%" stopColor="rgba(255,255,255,0)" />
        <stop offset="92%" stopColor="rgba(255,255,255,0.10)" />
        <stop offset="100%" stopColor="rgba(0,0,0,0.28)" />
      </radialGradient>
      <filter
        id="metal-grain"
        filterUnits="userSpaceOnUse"
        x={-pad}
        y={-pad}
        width={2 * pad}
        height={2 * pad}
      >
        <feTurbulence
          type="fractalNoise"
          baseFrequency={pal.brushed ? '0.012 1.1' : '0.9 0.9'}
          numOctaves={2}
          seed={7}
          result="noise"
        />
        <feColorMatrix
          in="noise"
          type="matrix"
          values={`0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.6 0.6 0.6 0 0`}
          result="mono"
        />
        <feComposite in="mono" in2="SourceAlpha" operator="in" />
      </filter>
      <filter
        id="engrave-cut"
        filterUnits="userSpaceOnUse"
        x={-pad}
        y={-pad}
        width={2 * pad}
        height={2 * pad}
      >
        {/* inner shadow hugging the lit edge of the cut */}
        <feGaussianBlur in="SourceAlpha" stdDeviation={0.035} result="soft" />
        <feOffset in="soft" dx={off.x} dy={off.y} result="softLit" />
        <feComposite in="softLit" in2="SourceAlpha" operator="in" result="innerShade" />
        <feFlood floodColor="rgba(0,0,0,0.75)" result="shadeColor" />
        <feComposite in="shadeColor" in2="innerShade" operator="in" result="innerShadow" />
        {/* glint just outside the far edge of the cut */}
        <feOffset in="soft" dx={-off.x * 1.2} dy={-off.y * 1.2} result="softFar" />
        <feComposite in="softFar" in2="SourceAlpha" operator="out" result="rim" />
        <feFlood floodColor={pal.glint} result="glintColor" />
        <feComposite in="glintColor" in2="rim" operator="in" result="glintRim" />
        <feMerge>
          <feMergeNode in="SourceGraphic" />
          <feMergeNode in="innerShadow" />
          <feMergeNode in="glintRim" />
        </feMerge>
      </filter>
    </defs>
  )
}
