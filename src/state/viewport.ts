import { create } from 'zustand'

/**
 * Screen-space viewport: pan/zoom of the mm-true stage plus the live cursor
 * readout. Deliberately a separate store from the document — high-frequency,
 * never undoable, never serialized.
 */

const MIN_SCALE = 2 // px per mm
const MAX_SCALE = 600

export interface CursorInfo {
  xMM: number
  yMM: number
  thetaDeg: number
  rMM: number
}

export interface ViewportState {
  /** px per mm. */
  scale: number
  /** Screen position (px) of the mm origin. */
  tx: number
  ty: number
  size: { w: number; h: number }
  fitted: boolean
  cursor: CursorInfo | null
  /** Space key held — pan mode; suppresses canvas selection. */
  spaceDown: boolean

  setSize: (w: number, h: number) => void
  setSpaceDown: (down: boolean) => void
  zoomFit: (diameterMM: number) => void
  zoomAt: (px: number, py: number, factor: number) => void
  zoomBy: (factor: number) => void
  panBy: (dx: number, dy: number) => void
  setCursor: (cursor: CursorInfo | null) => void
}

const clampScale = (s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s))

export const useViewport = create<ViewportState>()((set, get) => ({
  scale: 24,
  tx: 0,
  ty: 0,
  size: { w: 0, h: 0 },
  fitted: false,
  cursor: null,
  spaceDown: false,

  setSize: (w, h) => set({ size: { w, h } }),
  setSpaceDown: (spaceDown) => set({ spaceDown }),

  zoomFit: (diameterMM) => {
    const { w, h } = get().size
    if (w === 0 || h === 0) return
    const scale = clampScale((0.8 * Math.min(w, h)) / diameterMM)
    set({ scale, tx: w / 2, ty: h / 2, fitted: true })
  },

  zoomAt: (px, py, factor) => {
    const { scale, tx, ty } = get()
    const next = clampScale(scale * factor)
    const f = next / scale
    set({ scale: next, tx: px - (px - tx) * f, ty: py - (py - ty) * f })
  },

  zoomBy: (factor) => {
    const { size } = get()
    get().zoomAt(size.w / 2, size.h / 2, factor)
  },

  panBy: (dx, dy) => set((s) => ({ tx: s.tx + dx, ty: s.ty + dy })),

  setCursor: (cursor) => set({ cursor }),
}))

/** Screen px → document mm. */
export function screenToMM(px: number, py: number): { x: number; y: number } {
  const { scale, tx, ty } = useViewport.getState()
  return { x: (px - tx) / scale, y: (py - ty) / scale }
}
