import type { ButtonDoc } from '../model/types'
import { makeBlankDoc, newId } from '../model/types'
import { presetReferenceA } from '../model/presets'
import { coerceDoc, parseDoc, stringifyDoc } from '../model/serialize'
import { useEngraver } from '../state/store'
import { downloadText, safeFilename } from './download'
import { openIdbBackend } from './idb'
import { renderThumbSvg } from './thumbnail'

/**
 * The local multi-button workspace: every document lives in IndexedDB (doc
 * body + list metadata in separate stores), with a localStorage pointer to
 * the current entry.
 *
 * ANTI-CORRUPTION INVARIANTS — load-bearing, do not "simplify":
 *  1. The debounced saver captures {id, doc} AS A PAIR at schedule time and
 *     does IO only at fire time. A missed flush can therefore write at worst
 *     a slightly stale doc under its own id — never doc B under id A.
 *  2. Every entry switch goes through switchTo(): cancel timer → optional
 *     flush → move currentId BEFORE setDoc → suppress the resulting doc
 *     change (opening must not bump updatedAt) → setDoc + temporal.clear().
 *     The undo clear is mandatory: zundo's past states belong to the
 *     PREVIOUS entry; undo after a switch would write them under the new id.
 *  3. remove(current) cancels the pending save WITHOUT flushing — flushing
 *     would resurrect the entry being deleted.
 */

export interface WorkspaceMeta {
  id: string
  name: string
  updatedAt: number
  thumbSvg: string | null
}

export interface WorkspaceBackend {
  listMetas(): Promise<WorkspaceMeta[]>
  getDoc(id: string): Promise<unknown | undefined>
  /** Atomic across both stores — no ghost metas, no orphan bodies. */
  putEntry(id: string, doc: unknown, meta: WorkspaceMeta): Promise<void>
  putMeta(meta: WorkspaceMeta): Promise<void>
  deleteEntry(id: string): Promise<void>
}

export type WorkspaceStatus = { kind: 'ok' } | { kind: 'memory' } | { kind: 'quota' }

const POINTER_KEY = 'buttonic:current'
const LEGACY_KEYS = ['buttonic:autosave', 'button-engraver:autosave'] as const
const LEGACY_ID = 'legacy-autosave'
const SAVE_DEBOUNCE_MS = 1000
const THUMB_REFRESH_DEBOUNCE_MS = 2000
const THUMB_MIN_INTERVAL_MS = 15_000

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let backend: WorkspaceBackend | null = null
let backendIsMemory = false
let bootPromise: Promise<void> | null = null
let current: string | null = null
let status: WorkspaceStatus = { kind: 'ok' }
const statusListeners = new Set<(s: WorkspaceStatus) => void>()

let pending: { id: string; doc: ButtonDoc } | null = null
let pendingTimer: ReturnType<typeof setTimeout> | null = null
let pendingThumb: { id: string; doc: ButtonDoc } | null = null
let thumbTimer: ReturnType<typeof setTimeout> | null = null
let suppressNextDocChange = false

const metaCache = new Map<string, WorkspaceMeta>()
const lastThumbAt = new Map<string, number>()

// ---------------------------------------------------------------------------
// Small guarded helpers
// ---------------------------------------------------------------------------

const storage = {
  get(key: string): string | null {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string): void {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(key, value)
    } catch {
      // pointer loss is recoverable (falls back to most-recent)
    }
  },
  remove(key: string): void {
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(key)
    } catch {
      // ignore
    }
  },
}

function setStatus(s: WorkspaceStatus): void {
  if (s.kind === status.kind) return
  status = s
  for (const cb of statusListeners) cb(s)
}

export function getStatus(): WorkspaceStatus {
  return status
}

export function onStatusChange(cb: (s: WorkspaceStatus) => void): () => void {
  statusListeners.add(cb)
  return () => statusListeners.delete(cb)
}

export function currentId(): string | null {
  return current
}

const isQuotaError = (e: unknown): boolean => {
  const name = (e as { name?: string } | null)?.name
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED'
}

function makeThumb(id: string, doc: ButtonDoc, force: boolean): string | null {
  const now = Date.now()
  if (!force && now - (lastThumbAt.get(id) ?? 0) < THUMB_MIN_INTERVAL_MS) {
    return metaCache.get(id)?.thumbSvg ?? null
  }
  lastThumbAt.set(id, now)
  return renderThumbSvg(doc)
}

async function persistPair(id: string, doc: ButtonDoc, forceThumb: boolean): Promise<void> {
  if (!backend) return
  const meta: WorkspaceMeta = {
    id,
    name: doc.name,
    updatedAt: Date.now(),
    thumbSvg: makeThumb(id, doc, forceThumb),
  }
  try {
    await backend.putEntry(id, doc, meta)
    metaCache.set(id, meta)
    if (status.kind === 'quota') setStatus(backendIsMemory ? { kind: 'memory' } : { kind: 'ok' })
  } catch (e) {
    // keep the pair so a later flush or the next edit retries; never drop silently
    pending = { id, doc }
    if (isQuotaError(e)) setStatus({ kind: 'quota' })
  }
}

// ---------------------------------------------------------------------------
// Debounced saver (invariant 1)
// ---------------------------------------------------------------------------

function schedulePairSave(): void {
  if (!current) return
  pending = { id: current, doc: useEngraver.getState().doc }
  if (pendingTimer) clearTimeout(pendingTimer)
  pendingTimer = setTimeout(() => {
    pendingTimer = null
    void flushPendingSave()
  }, SAVE_DEBOUNCE_MS)
}

export async function flushPendingSave(): Promise<void> {
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingTimer = null
  }
  const p = pending
  pending = null
  if (p) await persistPair(p.id, p.doc, false)
}

function cancelPendingSave(): void {
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingTimer = null
  }
  pending = null
}

/** Meta-only refresh when async fonts/SVGs finish parsing (thumb was stale). */
function scheduleThumbRefresh(): void {
  if (!current) return
  pendingThumb = { id: current, doc: useEngraver.getState().doc }
  if (thumbTimer) clearTimeout(thumbTimer)
  thumbTimer = setTimeout(() => {
    thumbTimer = null
    const p = pendingThumb
    pendingThumb = null
    if (!p || !backend) return
    const prev = metaCache.get(p.id)
    const meta: WorkspaceMeta = {
      id: p.id,
      name: p.doc.name,
      // a font finishing its fetch is not an edit — keep the list order
      updatedAt: prev?.updatedAt ?? Date.now(),
      thumbSvg: makeThumb(p.id, p.doc, true),
    }
    backend
      .putMeta(meta)
      .then(() => metaCache.set(p.id, meta))
      .catch(() => {
        // cosmetic only; next real save retries
      })
  }, THUMB_REFRESH_DEBOUNCE_MS)
}

// ---------------------------------------------------------------------------
// Switching (invariant 2)
// ---------------------------------------------------------------------------

async function switchTo(id: string, doc: ButtonDoc, flushPrevious: boolean): Promise<void> {
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingTimer = null
  }
  if (flushPrevious) {
    const p = pending
    pending = null
    if (p) await persistPair(p.id, p.doc, true)
  } else {
    pending = null
  }
  current = id
  storage.set(POINTER_KEY, id)
  suppressNextDocChange = true
  useEngraver.getState().setDoc(doc)
  useEngraver.temporal.getState().clear() // mandatory — see invariant 2
}

// ---------------------------------------------------------------------------
// Public CRUD
// ---------------------------------------------------------------------------

export async function list(): Promise<WorkspaceMeta[]> {
  if (!backend) return []
  const metas = await backend.listMetas()
  metaCache.clear()
  for (const m of metas) metaCache.set(m.id, m)
  return [...metas].sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function open(id: string): Promise<boolean> {
  if (!backend) return false
  const raw = await backend.getDoc(id)
  if (raw === undefined) return false
  const result = coerceDoc(raw)
  if (!result.ok) return false
  await switchTo(id, result.doc, true)
  return true
}

export async function createFromDoc(
  doc: ButtonDoc,
  opts: { open?: boolean } = {},
): Promise<string> {
  const id = newId()
  await persistPair(id, doc, true)
  if (opts.open !== false) await switchTo(id, doc, true)
  return id
}

export async function duplicate(id: string): Promise<string | null> {
  if (!backend) return null
  if (id === current) await flushPendingSave()
  const raw = await backend.getDoc(id)
  if (raw === undefined) return null
  const result = coerceDoc(raw)
  if (!result.ok) return null
  return createFromDoc({ ...result.doc, name: result.doc.name + ' copy' })
}

export async function remove(id: string): Promise<void> {
  if (!backend) return
  const wasCurrent = id === current
  if (wasCurrent) cancelPendingSave() // invariant 3: no flush — no zombie
  await backend.deleteEntry(id)
  metaCache.delete(id)
  lastThumbAt.delete(id)
  if (!wasCurrent) return
  current = null
  const metas = await list()
  for (const m of metas) {
    if (await open(m.id)) return
  }
  await createFromDoc(makeBlankDoc())
}

export async function downloadEntry(id: string): Promise<void> {
  if (!backend) return
  if (id === current) await flushPendingSave()
  const raw = await backend.getDoc(id)
  if (raw === undefined) return
  const result = coerceDoc(raw)
  if (!result.ok) return
  downloadText(
    stringifyDoc(result.doc),
    `${safeFilename(result.doc.name)}.button.json`,
    'application/json',
  )
}

// ---------------------------------------------------------------------------
// Boot + migration
// ---------------------------------------------------------------------------

/** Fallback backend for private-mode/hung IndexedDB: session-only Maps. */
export function memoryBackend(): WorkspaceBackend {
  const docs = new Map<string, unknown>()
  const metas = new Map<string, WorkspaceMeta>()
  return {
    listMetas: async () => [...metas.values()].map((m) => structuredClone(m)),
    getDoc: async (id) => (docs.has(id) ? structuredClone(docs.get(id)) : undefined),
    putEntry: async (id, doc, meta) => {
      docs.set(id, structuredClone(doc))
      metas.set(id, structuredClone(meta))
    },
    putMeta: async (meta) => {
      metas.set(meta.id, structuredClone(meta))
    },
    deleteEntry: async (id) => {
      docs.delete(id)
      metas.delete(id)
    },
  }
}

function readLegacyAutosave(): ButtonDoc | null {
  for (const key of LEGACY_KEYS) {
    const json = storage.get(key)
    if (!json) continue
    const result = parseDoc(json)
    if (result.ok) return result.doc
  }
  return null
}

async function migrateLegacy(): Promise<void> {
  const doc = readLegacyAutosave()
  if (!doc || !backend) return
  const meta: WorkspaceMeta = {
    id: LEGACY_ID, // fixed id → re-running the migration overwrites, never duplicates
    name: doc.name,
    updatedAt: Date.now(),
    thumbSvg: renderThumbSvg(doc),
  }
  try {
    await backend.putEntry(LEGACY_ID, doc, meta)
  } catch (e) {
    // keys stay put — the migration retries next boot
    if (isQuotaError(e)) setStatus({ kind: 'quota' })
    return
  }
  // only after the write is durable
  for (const key of LEGACY_KEYS) storage.remove(key)
  storage.set(POINTER_KEY, LEGACY_ID)
}

/** Memoized: restore happens exactly once, however many effects await it. */
export function boot(backendOverride?: WorkspaceBackend): Promise<void> {
  if (bootPromise) return bootPromise
  bootPromise = (async () => {
    if (backendOverride) {
      backend = backendOverride
      backendIsMemory = false
    } else {
      try {
        backend = await openIdbBackend()
        backendIsMemory = false
      } catch {
        backend = memoryBackend()
        backendIsMemory = true
        setStatus({ kind: 'memory' })
      }
    }

    await migrateLegacy()

    const pointer = storage.get(POINTER_KEY)
    const metas = await list()
    const ordered = pointer
      ? [...metas.filter((m) => m.id === pointer), ...metas.filter((m) => m.id !== pointer)]
      : metas
    for (const m of ordered) {
      if (await open(m.id)) return // corrupt entries fall through, never deleted
    }
    await createFromDoc(presetReferenceA())
  })()
  return bootPromise
}

// ---------------------------------------------------------------------------
// Autosave lifecycle
// ---------------------------------------------------------------------------

export function startWorkspaceAutosave(): () => void {
  // boot's setDoc ran before any subscriber existed — never swallow a real edit
  suppressNextDocChange = false

  const unsubscribe = useEngraver.subscribe((state, prev) => {
    if (state.doc !== prev.doc) {
      if (suppressNextDocChange) {
        suppressNextDocChange = false
        return
      }
      schedulePairSave()
    } else if (
      current &&
      (state.fontsRevision !== prev.fontsRevision || state.assetsRevision !== prev.assetsRevision)
    ) {
      scheduleThumbRefresh()
    }
  })

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') void flushPendingSave()
  }
  const onPageHide = () => {
    void flushPendingSave()
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onPageHide)

  return () => {
    unsubscribe()
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility)
    }
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', onPageHide)
    if (pendingTimer) {
      clearTimeout(pendingTimer)
      pendingTimer = null
    }
    if (thumbTimer) {
      clearTimeout(thumbTimer)
      thumbTimer = null
    }
  }
}

// ---------------------------------------------------------------------------
// Test support
// ---------------------------------------------------------------------------

export function _resetWorkspaceForTests(): void {
  backend = null
  backendIsMemory = false
  bootPromise = null
  current = null
  status = { kind: 'ok' }
  statusListeners.clear()
  cancelPendingSave()
  if (thumbTimer) {
    clearTimeout(thumbTimer)
    thumbTimer = null
  }
  pendingThumb = null
  suppressNextDocChange = false
  metaCache.clear()
  lastThumbAt.clear()
}
