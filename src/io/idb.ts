import type { WorkspaceBackend, WorkspaceMeta } from './workspace'

/**
 * IndexedDB implementation of the workspace backend. DB `buttonic` v1 with
 * two object stores: `docs` (id → doc as a structured-clone object) and
 * `meta` (id → WorkspaceMeta), split so the switcher lists without loading
 * doc bodies. putEntry/deleteEntry span both stores in ONE transaction —
 * a ghost meta (listed row with no body) must be impossible.
 */

const DB_NAME = 'buttonic'
const DB_VERSION = 1
const DOCS = 'docs'
const META = 'meta'

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

export function openIdbBackend(timeoutMs = 2000): Promise<WorkspaceBackend> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable'))
      return
    }
    // legacy Safari can hang open() forever; the caller falls back to memory
    const timer = setTimeout(() => reject(new Error('IndexedDB open timed out')), timeoutMs)

    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (e) {
      clearTimeout(timer)
      reject(e)
      return
    }

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(DOCS)) db.createObjectStore(DOCS)
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META)
    }
    request.onsuccess = () => {
      clearTimeout(timer)
      const db = request.result
      // if a future version opens in another tab, release the connection
      db.onversionchange = () => db.close()
      resolve(makeBackend(db))
    }
    request.onerror = () => {
      clearTimeout(timer)
      reject(request.error ?? new Error('IndexedDB open failed'))
    }
  })
}

function makeBackend(db: IDBDatabase): WorkspaceBackend {
  return {
    async listMetas() {
      const tx = db.transaction(META, 'readonly')
      return requestToPromise(tx.objectStore(META).getAll() as IDBRequest<WorkspaceMeta[]>)
    },

    async getDoc(id) {
      const tx = db.transaction(DOCS, 'readonly')
      return requestToPromise(tx.objectStore(DOCS).get(id))
    },

    async putEntry(id, doc, meta) {
      const tx = db.transaction([DOCS, META], 'readwrite')
      tx.objectStore(DOCS).put(doc, id)
      tx.objectStore(META).put(meta, id)
      await transactionDone(tx)
    },

    async putMeta(meta) {
      const tx = db.transaction(META, 'readwrite')
      tx.objectStore(META).put(meta, meta.id)
      await transactionDone(tx)
    },

    async deleteEntry(id) {
      const tx = db.transaction([DOCS, META], 'readwrite')
      tx.objectStore(DOCS).delete(id)
      tx.objectStore(META).delete(id)
      await transactionDone(tx)
    },
  }
}
