import * as opentype from 'opentype.js'
import type { ButtonDoc, FontId } from '../model/types'
import { newId } from '../model/types'
import { useEngraver } from '../state/store'
import { base64ToBuffer, bufferToBase64 } from './base64'

/**
 * Font registry: three bundled OFL faces fetched lazily from public/fonts,
 * plus user uploads stored base64 in doc.assets. Parsed opentype.Font objects
 * live in a runtime cache outside the store (never serialized, never in undo
 * history); fontsRevision bumps when a parse lands so dependent layers
 * recompile.
 */

export interface BundledFont {
  id: FontId
  label: string
  url: string
}

// BASE_URL-aware so the app works when hosted under a subpath (GitHub Pages).
const base = import.meta.env.BASE_URL

export const BUNDLED_FONTS: readonly BundledFont[] = [
  { id: 'cinzel', label: 'Cinzel (engraved caps)', url: `${base}fonts/cinzel.ttf` },
  { id: 'garamond', label: 'EB Garamond', url: `${base}fonts/ebgaramond.ttf` },
  { id: 'unifraktur', label: 'UnifrakturCook (blackletter)', url: `${base}fonts/unifrakturcook-bold.ttf` },
]

const cache = new Map<FontId, opentype.Font>()
const pending = new Set<FontId>()
const failed = new Map<FontId, string>()

export function getLoadedFont(fontId: FontId): opentype.Font | null {
  return cache.get(fontId) ?? null
}

export function getFontError(fontId: FontId): string | null {
  return failed.get(fontId) ?? null
}

/** Parse and register a font buffer under an id. Throws on unparseable data. */
export function registerFontBuffer(fontId: FontId, buffer: ArrayBuffer): opentype.Font {
  const font = opentype.parse(buffer)
  cache.set(fontId, font)
  failed.delete(fontId)
  return font
}

/** Register an already-parsed font (local-font resolution parses to match faces). */
export function registerParsedFont(fontId: FontId, font: opentype.Font): void {
  cache.set(fontId, font)
  failed.delete(fontId)
}

/** Record a load failure so pickers and warnings can explain it. */
export function markFontFailed(fontId: FontId, error: string): void {
  failed.set(fontId, error)
}

export function clearFontFailure(fontId: FontId): void {
  failed.delete(fontId)
}

export function _resetFontCachesForTests(): void {
  cache.clear()
  pending.clear()
  failed.clear()
}

/**
 * Idempotent lazy load. Bundled ids fetch from public/fonts; asset-backed ids
 * decode from the doc. Bumps fontsRevision when the parse lands.
 */
export function ensureFontLoaded(fontId: FontId, doc: ButtonDoc): void {
  if (!fontId || cache.has(fontId) || pending.has(fontId) || failed.has(fontId)) return

  const bundled = BUNDLED_FONTS.find((f) => f.id === fontId)
  if (bundled) {
    pending.add(fontId)
    fetch(bundled.url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.arrayBuffer()
      })
      .then((buffer) => {
        registerFontBuffer(fontId, buffer)
      })
      .catch((e) => {
        failed.set(fontId, `Failed to load ${bundled.label}: ${e instanceof Error ? e.message : e}`)
      })
      .finally(() => {
        pending.delete(fontId)
        useEngraver.getState().bumpFontsRevision()
      })
    return
  }

  const asset = doc.assets[fontId]
  if (asset && asset.kind === 'font') {
    try {
      registerFontBuffer(fontId, base64ToBuffer(asset.dataBase64))
    } catch (e) {
      failed.set(
        fontId,
        `Could not parse "${asset.name}" — try converting it to TTF/OTF. (${e instanceof Error ? e.message : e})`,
      )
    }
    useEngraver.getState().bumpFontsRevision()
  }
}

/**
 * Upload flow: parse first (reject bad files with a readable error), then
 * store base64 in doc.assets so projects stay portable.
 */
export async function uploadFont(file: File): Promise<{ ok: true; fontId: FontId } | { ok: false; error: string }> {
  const buffer = await file.arrayBuffer()
  const fontId = `font-${newId()}`
  try {
    registerFontBuffer(fontId, buffer)
  } catch (e) {
    return {
      ok: false,
      error: `Could not parse "${file.name}" — WOFF2 is not supported; try a .ttf or .otf. (${
        e instanceof Error ? e.message : e
      })`,
    }
  }
  const state = useEngraver.getState()
  state.updateDocAssets({
    [fontId]: { kind: 'font', name: file.name, dataBase64: bufferToBase64(buffer) },
  })
  state.bumpFontsRevision()
  return { ok: true, fontId }
}

/** Options for font pickers: bundled faces + doc-embedded fonts + local references. */
export function fontOptions(doc: ButtonDoc): { value: string; label: string }[] {
  const uploaded = Object.entries(doc.assets)
    .filter(([, a]) => a.kind === 'font')
    .map(([id, a]) => ({ value: id, label: a.name.replace(/\.(ttf|otf)$/i, '') }))
  const local = Object.entries(doc.localFonts).map(([id, ref]) => ({
    value: id,
    label: `${ref.fullName || ref.family} (local${cache.has(id) ? '' : ' — missing'})`,
  }))
  return [...BUNDLED_FONTS.map((f) => ({ value: f.id, label: f.label })), ...uploaded, ...local]
}
