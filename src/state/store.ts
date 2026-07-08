import { create } from 'zustand'
import { useStore } from 'zustand'
import { temporal } from 'zundo'
import { immer } from 'zustand/middleware/immer'
import type { Asset, AssetId, ButtonDoc, FontId, Layer, LayerId, LayerType, LocalFontRef } from '../model/types'
import { LAYER_FACTORIES, makeBlankDoc, newId } from '../model/types'

export type ViewMode = 'flat' | 'metal'

export interface ViewState {
  mode: ViewMode
  /** Azimuth of the metal-preview light. */
  lightDeg: number
  showGuides: boolean
  /** Light artboard behind the button in flat mode (proofing on white). */
  artboardLight: boolean
  snapping: boolean
}

export interface EngraverState {
  doc: ButtonDoc
  selection: LayerId | null
  view: ViewState
  /** Bumped when an uploaded SVG/font finishes parsing; layers depending on assets recompile. */
  assetsRevision: number
  fontsRevision: number
  /** Bumped when an off-thread keepout region lands; consumers re-clip. */
  regionsRevision: number
  /** True while any halo region is being recomputed (StatusBar indicator). */
  haloPending: boolean

  setDoc: (doc: ButtonDoc) => void
  updateDocMeta: (patch: Partial<Pick<ButtonDoc, 'name' | 'diameterMM' | 'finish'>>) => void
  addLayer: (type: LayerType) => void
  removeLayer: (id: LayerId) => void
  duplicateLayer: (id: LayerId) => void
  moveLayer: (id: LayerId, delta: number) => void
  moveLayerTo: (id: LayerId, index: number) => void
  updateLayer: (id: LayerId, patch: Partial<Layer>) => void
  updateDocAssets: (patch: Record<AssetId, Asset>) => void
  addLocalFontRef: (fontId: FontId, ref: LocalFontRef) => void
  /** Embed a local font: store bytes as an asset, repoint layers, drop the reference. */
  embedLocalFontRef: (fontId: FontId, assetId: AssetId, asset: Asset) => void
  select: (id: LayerId | null) => void
  setView: (patch: Partial<ViewState>) => void
  bumpAssetsRevision: () => void
  bumpFontsRevision: () => void
  bumpRegionsRevision: () => void
  setHaloPending: (pending: boolean) => void
}

export const useEngraver = create<EngraverState>()(
  temporal(
    immer((set) => ({
      doc: makeBlankDoc(),
      selection: null,
      view: {
        mode: 'flat' as ViewMode,
        lightDeg: 315,
        showGuides: true,
        artboardLight: false,
        snapping: true,
      },
      assetsRevision: 0,
      fontsRevision: 0,
      regionsRevision: 0,
      haloPending: false,

      setDoc: (doc) =>
        set((s) => {
          s.doc = doc
          s.selection = null
        }),

      updateDocMeta: (patch) =>
        set((s) => {
          Object.assign(s.doc, patch)
        }),

      addLayer: (type) =>
        set((s) => {
          const layer = LAYER_FACTORIES[type]()
          const selectedAt = s.doc.layers.findIndex((l) => l.id === s.selection)
          const at = selectedAt === -1 ? s.doc.layers.length : selectedAt + 1
          s.doc.layers.splice(at, 0, layer)
          s.selection = layer.id
        }),

      removeLayer: (id) =>
        set((s) => {
          const at = s.doc.layers.findIndex((l) => l.id === id)
          if (at === -1) return
          s.doc.layers.splice(at, 1)
          if (s.selection === id) {
            const next = s.doc.layers[Math.min(at, s.doc.layers.length - 1)]
            s.selection = next ? next.id : null
          }
        }),

      duplicateLayer: (id) =>
        set((s) => {
          const at = s.doc.layers.findIndex((l) => l.id === id)
          const source = s.doc.layers[at]
          if (!source) return
          const copy: Layer = { ...source, id: newId(), name: source.name + ' copy' }
          s.doc.layers.splice(at + 1, 0, copy)
          s.selection = copy.id
        }),

      moveLayer: (id, delta) =>
        set((s) => {
          const at = s.doc.layers.findIndex((l) => l.id === id)
          if (at === -1) return
          const to = Math.max(0, Math.min(s.doc.layers.length - 1, at + delta))
          if (to === at) return
          const [layer] = s.doc.layers.splice(at, 1)
          s.doc.layers.splice(to, 0, layer as Layer)
        }),

      moveLayerTo: (id, index) =>
        set((s) => {
          const at = s.doc.layers.findIndex((l) => l.id === id)
          if (at === -1) return
          const to = Math.max(0, Math.min(s.doc.layers.length - 1, index))
          if (to === at) return
          const [layer] = s.doc.layers.splice(at, 1)
          s.doc.layers.splice(to, 0, layer as Layer)
        }),

      updateLayer: (id, patch) =>
        set((s) => {
          const layer = s.doc.layers.find((l) => l.id === id)
          if (!layer) return
          Object.assign(layer, patch)
        }),

      updateDocAssets: (patch) =>
        set((s) => {
          Object.assign(s.doc.assets, patch)
        }),

      addLocalFontRef: (fontId, ref) =>
        set((s) => {
          s.doc.localFonts[fontId] = ref
        }),

      embedLocalFontRef: (fontId, assetId, asset) =>
        set((s) => {
          s.doc.assets[assetId] = asset
          for (const layer of s.doc.layers) {
            if ((layer.type === 'ringText' || layer.type === 'center') && layer.fontId === fontId) {
              layer.fontId = assetId
            }
          }
          delete s.doc.localFonts[fontId]
        }),

      select: (id) =>
        set((s) => {
          s.selection = id
        }),

      setView: (patch) =>
        set((s) => {
          Object.assign(s.view, patch)
        }),

      bumpAssetsRevision: () =>
        set((s) => {
          s.assetsRevision += 1
        }),

      bumpFontsRevision: () =>
        set((s) => {
          s.fontsRevision += 1
        }),

      bumpRegionsRevision: () =>
        set((s) => {
          s.regionsRevision += 1
        }),

      setHaloPending: (pending) =>
        set((s) => {
          s.haloPending = pending
        }),
    })),
    {
      // Only the document participates in undo history; selection and view
      // changes never create steps (equality below skips them).
      partialize: (state) => ({ doc: state.doc }),
      equality: (past, current) => past.doc === current.doc,
      limit: 100,
    },
  ),
)

// ---------------------------------------------------------------------------
// Gesture-scoped undo: a whole drag or scrub is exactly one history step.
//
// zundo records the *previous* state on each tracked set, so pausing alone
// would lose the pre-gesture snapshot. Pattern: snapshot at gesture start,
// mutate freely while paused, then at gesture end silently restore the
// snapshot, resume tracking, and re-apply the final doc — that single tracked
// set pushes the pre-gesture snapshot into history.
// ---------------------------------------------------------------------------

let gestureDepth = 0
let gestureSnapshot: ButtonDoc | null = null

export function beginGesture(): void {
  if (gestureDepth === 0) {
    gestureSnapshot = useEngraver.getState().doc
    useEngraver.temporal.getState().pause()
  }
  gestureDepth += 1
}

export function endGesture(): void {
  gestureDepth = Math.max(0, gestureDepth - 1)
  if (gestureDepth > 0) return
  const snapshot = gestureSnapshot
  gestureSnapshot = null
  const temporalApi = useEngraver.temporal.getState()
  const finalDoc = useEngraver.getState().doc
  if (snapshot && snapshot !== finalDoc) {
    useEngraver.setState({ doc: snapshot })
    temporalApi.resume()
    useEngraver.setState({ doc: finalDoc })
  } else {
    temporalApi.resume()
  }
}

export function undo(): void {
  useEngraver.temporal.getState().undo()
}

export function redo(): void {
  useEngraver.temporal.getState().redo()
}

export function useCanUndo(): boolean {
  return useStore(useEngraver.temporal, (s) => s.pastStates.length > 0)
}

export function useCanRedo(): boolean {
  return useStore(useEngraver.temporal, (s) => s.futureStates.length > 0)
}
