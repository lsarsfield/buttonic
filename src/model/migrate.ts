import { DOC_VERSION } from './types'

/**
 * Sequential document migrations: migrations[n] upgrades a version n-1 doc to
 * version n. Empty at v1; the machinery exists from day one so saved files
 * never strand their owners.
 */
export const migrations: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {}

export function migrateDoc(raw: Record<string, unknown>): Record<string, unknown> {
  let version = typeof raw.version === 'number' ? raw.version : NaN
  if (!Number.isInteger(version)) throw new Error('document has no version number')
  if (version > DOC_VERSION) {
    throw new Error(
      `document version ${version} is newer than this app understands (${DOC_VERSION})`,
    )
  }
  let doc = raw
  while (version < DOC_VERSION) {
    const step = migrations[version + 1]
    if (!step) throw new Error(`no migration path from document version ${version}`)
    doc = step(doc)
    version += 1
    doc = { ...doc, version }
  }
  return doc
}
