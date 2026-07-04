import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeBlankDoc, type ButtonDoc } from '../model/types'
import { presetReferenceB } from '../model/presets'
import { stringifyDoc } from '../model/serialize'
import { useEngraver } from '../state/store'
import {
  _resetWorkspaceForTests,
  boot,
  createFromDoc,
  currentId,
  flushPendingSave,
  getStatus,
  list,
  memoryBackend,
  open,
  remove,
  startWorkspaceAutosave,
  type WorkspaceBackend,
  type WorkspaceMeta,
} from './workspace'

/** memoryBackend + call counters + optional fault injection. */
function spyBackend(inner: WorkspaceBackend = memoryBackend()) {
  const counts = { putEntry: 0, putMeta: 0, deleteEntry: 0 }
  let failNextPutWith: unknown = null
  let failAllPutsWith: unknown = null
  const backend: WorkspaceBackend = {
    listMetas: () => inner.listMetas(),
    getDoc: (id) => inner.getDoc(id),
    putEntry: async (id, doc, meta) => {
      counts.putEntry += 1
      if (failAllPutsWith) throw failAllPutsWith
      if (failNextPutWith) {
        const err = failNextPutWith
        failNextPutWith = null
        throw err
      }
      return inner.putEntry(id, doc, meta)
    },
    putMeta: async (meta) => {
      counts.putMeta += 1
      return inner.putMeta(meta)
    },
    deleteEntry: async (id) => {
      counts.deleteEntry += 1
      return inner.deleteEntry(id)
    },
  }
  return {
    backend,
    counts,
    failNextPut: (err: unknown) => {
      failNextPutWith = err
    },
    failAllPuts: (err: unknown) => {
      failAllPutsWith = err
    },
    inner,
  }
}

const fakeStorage = () => {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    _map: map,
  }
}

let storageStub: ReturnType<typeof fakeStorage>
let stopAutosave: (() => void) | null = null

const doc = (name: string): ButtonDoc => ({ ...makeBlankDoc(), name })

const metaByName = (metas: WorkspaceMeta[], name: string) =>
  metas.find((m) => m.name === name) ?? null

beforeEach(() => {
  vi.useFakeTimers()
  storageStub = fakeStorage()
  vi.stubGlobal('localStorage', storageStub)
  _resetWorkspaceForTests()
  useEngraver.getState().setDoc(makeBlankDoc())
  useEngraver.temporal.getState().clear()
})

afterEach(() => {
  stopAutosave?.()
  stopAutosave = null
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('boot + migration', () => {
  it('migrates the legacy autosave once, under a stable id, and clears both keys', async () => {
    const legacy = doc('Migrated one')
    storageStub.setItem('buttonic:autosave', stringifyDoc(legacy))
    storageStub.setItem('button-engraver:autosave', stringifyDoc(doc('older ghost')))
    const { backend } = spyBackend()

    await boot(backend)
    expect(storageStub.getItem('buttonic:autosave')).toBeNull()
    expect(storageStub.getItem('button-engraver:autosave')).toBeNull()
    expect(useEngraver.getState().doc.name).toBe('Migrated one')

    // simulate a second boot against the SAME backend (e.g. crashed tab): no duplicate
    _resetWorkspaceForTests()
    storageStub.setItem('buttonic:autosave', stringifyDoc(legacy))
    await boot(backend)
    const metas = await list()
    expect(metas).toHaveLength(1)
    expect(metas[0]!.id).toBe('legacy-autosave')
  })

  it('keeps the legacy keys when storage is full (all writes fail)', async () => {
    storageStub.setItem('buttonic:autosave', stringifyDoc(doc('Precious')))
    const spy = spyBackend()
    spy.failAllPuts({ name: 'QuotaExceededError' }) // real quota is storage-wide

    await boot(spy.backend)
    expect(storageStub.getItem('buttonic:autosave')).not.toBeNull()
    expect(getStatus().kind).toBe('quota')
  })

  it('opens the pointer entry; falls back to most recent on a dangling pointer', async () => {
    const spy = spyBackend()
    await spy.backend.putEntry('a', doc('Older'), { id: 'a', name: 'Older', updatedAt: 100, thumbSvg: null })
    await spy.backend.putEntry('b', doc('Newer'), { id: 'b', name: 'Newer', updatedAt: 200, thumbSvg: null })

    storageStub.setItem('buttonic:current', 'a')
    await boot(spy.backend)
    expect(useEngraver.getState().doc.name).toBe('Older')

    _resetWorkspaceForTests()
    storageStub.setItem('buttonic:current', 'nope')
    await boot(spy.backend)
    expect(useEngraver.getState().doc.name).toBe('Newer')
  })

  it('seeds Reference A when the workspace is empty', async () => {
    await boot(spyBackend().backend)
    expect(useEngraver.getState().doc.name).toBe('Engine turned')
    expect(await list()).toHaveLength(1)
  })

  it('falls back past a corrupt entry without deleting it', async () => {
    const spy = spyBackend()
    await spy.backend.putEntry('bad', { junk: true }, { id: 'bad', name: 'Bad', updatedAt: 300, thumbSvg: null })
    await spy.backend.putEntry('good', doc('Good'), { id: 'good', name: 'Good', updatedAt: 200, thumbSvg: null })

    await boot(spy.backend)
    expect(useEngraver.getState().doc.name).toBe('Good')
    expect(await spy.backend.getDoc('bad')).toBeDefined() // never deleted
  })
})

describe('debounced pair-capturing saver', () => {
  async function bootWithA(spy = spyBackend()) {
    await spy.backend.putEntry('A', doc('Alpha'), { id: 'A', name: 'Alpha', updatedAt: 100, thumbSvg: null })
    storageStub.setItem('buttonic:current', 'A')
    await boot(spy.backend)
    stopAutosave = startWorkspaceAutosave()
    return spy
  }

  it('coalesces edits into one save under the current id', async () => {
    const spy = await bootWithA()
    const before = spy.counts.putEntry
    useEngraver.getState().updateDocMeta({ name: 'one' })
    await vi.advanceTimersByTimeAsync(500)
    useEngraver.getState().updateDocMeta({ name: 'two' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(spy.counts.putEntry).toBe(before + 1)
    const stored = (await spy.backend.getDoc('A')) as ButtonDoc
    expect(stored.name).toBe('two')
  })

  it('switching flushes the previous entry first — B never lands under A', async () => {
    const spy = await bootWithA()
    await spy.backend.putEntry('B', doc('Bravo'), { id: 'B', name: 'Bravo', updatedAt: 50, thumbSvg: null })

    useEngraver.getState().updateDocMeta({ name: 'Alpha edited' })
    await open('B') // no timer advance: the pending save must flush inside the switch
    const storedA = (await spy.backend.getDoc('A')) as ButtonDoc
    const storedB = (await spy.backend.getDoc('B')) as ButtonDoc
    expect(storedA.name).toBe('Alpha edited')
    expect(storedB.name).toBe('Bravo')
    expect(currentId()).toBe('B')
  })

  it('opening an entry does not bump its updatedAt or write anything', async () => {
    const spy = await bootWithA()
    await spy.backend.putEntry('B', doc('Bravo'), { id: 'B', name: 'Bravo', updatedAt: 50, thumbSvg: null })
    const before = spy.counts.putEntry
    await open('B')
    await vi.advanceTimersByTimeAsync(5000)
    expect(spy.counts.putEntry).toBe(before) // suppression swallowed the setDoc
    const metas = await list()
    expect(metaByName(metas, 'Bravo')!.updatedAt).toBe(50)
  })

  it('the first real edit after a switch is saved (suppression is one-shot)', async () => {
    const spy = await bootWithA()
    await spy.backend.putEntry('B', doc('Bravo'), { id: 'B', name: 'Bravo', updatedAt: 50, thumbSvg: null })
    await open('B')
    useEngraver.getState().updateDocMeta({ name: 'Bravo edited' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(((await spy.backend.getDoc('B')) as ButtonDoc).name).toBe('Bravo edited')
  })

  it('remove(current) cancels the pending save — deleted entries never resurrect', async () => {
    const spy = await bootWithA()
    await spy.backend.putEntry('B', doc('Bravo'), { id: 'B', name: 'Bravo', updatedAt: 50, thumbSvg: null })

    useEngraver.getState().updateDocMeta({ name: 'Alpha dying words' })
    await remove('A')
    await vi.advanceTimersByTimeAsync(5000)
    expect(await spy.backend.getDoc('A')).toBeUndefined() // no zombie
    expect(currentId()).toBe('B')
  })

  it('removing the last entry seeds a blank doc', async () => {
    await bootWithA()
    await remove('A')
    const metas = await list()
    expect(metas).toHaveLength(1)
    expect(useEngraver.getState().doc.name).toBe('Untitled button')
  })

  it('createFromDoc leaves the previous entry intact', async () => {
    await bootWithA()
    await createFromDoc(presetReferenceB())
    const metas = await list()
    expect(metas).toHaveLength(2)
    expect(useEngraver.getState().doc.name).toBe('Blackletter monogram')
  })

  it('a revision bump refreshes meta only, preserving list order', async () => {
    const spy = await bootWithA()
    const entriesBefore = spy.counts.putEntry
    useEngraver.getState().bumpFontsRevision()
    await vi.advanceTimersByTimeAsync(2500)
    expect(spy.counts.putMeta).toBeGreaterThan(0)
    expect(spy.counts.putEntry).toBe(entriesBefore)
    const metas = await list()
    expect(metaByName(metas, 'Alpha')!.updatedAt).toBe(100) // not an edit
  })

  it('quota errors set status, keep the pair, and retry on the next flush', async () => {
    const spy = await bootWithA()
    spy.failNextPut({ name: 'QuotaExceededError' })

    useEngraver.getState().updateDocMeta({ name: 'survives quota' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(getStatus().kind).toBe('quota')
    expect(((await spy.backend.getDoc('A')) as ButtonDoc).name).toBe('Alpha') // write failed

    await flushPendingSave() // retry with the retained pair
    expect(((await spy.backend.getDoc('A')) as ButtonDoc).name).toBe('survives quota')
    expect(getStatus().kind).toBe('ok')
  })
})
