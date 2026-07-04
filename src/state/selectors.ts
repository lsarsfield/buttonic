import type { Layer } from '../model/types'
import { useEngraver } from './store'

export function useSelectedLayer(): Layer | null {
  return useEngraver((s) => s.doc.layers.find((l) => l.id === s.selection) ?? null)
}

export function useDiameterMM(): number {
  return useEngraver((s) => s.doc.diameterMM)
}
