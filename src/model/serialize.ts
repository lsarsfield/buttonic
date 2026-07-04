import type { ButtonDoc } from './types'
import { migrateDoc } from './migrate'
import { validateDoc } from './validate'

export function stringifyDoc(doc: ButtonDoc): string {
  return JSON.stringify(doc, null, 2)
}

export type ParseDocResult =
  | { ok: true; doc: ButtonDoc }
  | { ok: false; error: string }

/**
 * Plain value → migrated, validated ButtonDoc. Never throws. Used directly by
 * the workspace store, which persists structured-clone objects, not JSON text.
 */
export function coerceDoc(raw: unknown): ParseDocResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'value is not a project document' }
  }
  let migrated: Record<string, unknown>
  try {
    migrated = migrateDoc(raw as Record<string, unknown>)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  return validateDoc(migrated)
}

/** JSON text → migrated, validated ButtonDoc. Never throws. */
export function parseDoc(json: string): ParseDocResult {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return { ok: false, error: 'file is not valid JSON' }
  }
  return coerceDoc(raw)
}
