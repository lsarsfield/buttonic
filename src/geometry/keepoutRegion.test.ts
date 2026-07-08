import { describe, expect, it } from 'vitest'
import { makeCenterLayer } from '../model/types'
import { compileCtxKey, EXPORT_TOLERANCE_MM, type CompileCtx } from './compile'
import { layerKeepoutRegion } from './keepout'
import { regionKey } from './keepoutRegion'

const ctx = (over: Partial<CompileCtx> = {}): CompileCtx => ({
  diameterMM: 17,
  toleranceMM: EXPORT_TOLERANCE_MM,
  assetsRevision: 0,
  fontsRevision: 0,
  getFont: () => null,
  getSvgAsset: () => null,
  ...over,
})

// A builtin-motif centre layer casts a halo region without needing any font.
const halostar = (patch: Partial<ReturnType<typeof makeCenterLayer>> = {}) =>
  makeCenterLayer({ id: 'c', sourceType: 'builtin', motifId: 'star', sizeMM: 4, haloMM: 0.3, ...patch })

describe('regionKey', () => {
  it('ignores phaseDeg and name (regions are cached pre-phase; names are cosmetic)', () => {
    const k = regionKey(halostar(), compileCtxKey(ctx()))
    expect(regionKey(halostar({ phaseDeg: 137 }), compileCtxKey(ctx()))).toBe(k)
    expect(regionKey(halostar({ name: 'renamed' }), compileCtxKey(ctx()))).toBe(k)
  })

  it('changes with region-relevant fields and with the compile context', () => {
    const k = regionKey(halostar(), compileCtxKey(ctx()))
    expect(regionKey(halostar({ sizeMM: 5 }), compileCtxKey(ctx()))).not.toBe(k)
    expect(regionKey(halostar({ motifId: 'sun' }), compileCtxKey(ctx()))).not.toBe(k)
    expect(regionKey(halostar({ haloMM: 0.5 }), compileCtxKey(ctx()))).not.toBe(k)
    expect(regionKey(halostar(), compileCtxKey(ctx({ toleranceMM: 0.01 })))).not.toBe(k)
  })
})

describe('layerKeepoutRegion content-keyed cache', () => {
  it('reuses the SAME region object across layer identities when only phase/name changed', () => {
    const l1 = halostar({ id: 'reuse-1' })
    const r1 = layerKeepoutRegion(l1, ctx()).region
    expect(r1).not.toBeNull()
    // immer-style churn: new object, same content apart from phase + name
    const l2 = { ...l1, phaseDeg: 90, name: 'spun' }
    expect(layerKeepoutRegion(l2, ctx()).region).toBe(r1)
    // a real geometry change recomputes
    const l3 = { ...l1, sizeMM: 5 }
    expect(layerKeepoutRegion(l3, ctx()).region).not.toBe(r1)
  })
})
