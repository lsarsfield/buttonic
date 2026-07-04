import * as opentype from 'opentype.js'
import type { ButtonDoc, FontId, LocalFontRef } from '../model/types'
import { isLocalFontId, LOCAL_FONT_PREFIX, newId } from '../model/types'
import { useEngraver } from '../state/store'
import { bufferToBase64 } from './base64'
import { getLoadedFont, markFontFailed, registerParsedFont } from './fonts'
import { extractTtcFaces, isTtc } from './ttc'

/**
 * Machine-local fonts via the Local Font Access API (Chromium-only).
 *
 * Fonts are stored in the doc as REFERENCES (postscript name + family), never
 * as embedded bytes — using someone's installed Helvetica must not quietly
 * redistribute it inside a portable project file. On a machine without the
 * font, layers keep their settings and show a missing-font state; exports
 * always bake outlines, so exported SVG/PNG remain portable regardless.
 */

export interface LocalFontItem {
  postscriptName: string
  family: string
  fullName: string
  style: string
}

export type LocalFontQueryFailure = 'unsupported' | 'denied' | 'gesture' | 'error'

export type LocalFontQueryResult =
  | { ok: true; fonts: LocalFontItem[] }
  | { ok: false; reason: LocalFontQueryFailure; error: string }

// Session caches: FontData handles from the last query (for .blob()), the
// matched face bytes of linked fonts (for embed), and a one-shot silent
// resolution guard.
const fontDataCache = new Map<string, FontData>()
const linkedBytes = new Map<FontId, ArrayBuffer>()
let silentResolveAttempted = false

export function isLocalFontsSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.queryLocalFonts === 'function'
}

async function rawQuery(postscriptNames?: string[]): Promise<FontData[]> {
  const fonts = await window.queryLocalFonts!(
    postscriptNames ? { postscriptNames } : undefined,
  )
  for (const f of fonts) fontDataCache.set(f.postscriptName, f)
  return fonts
}

function classifyQueryError(e: unknown): LocalFontQueryResult {
  const name = (e as { name?: string } | null)?.name
  if (name === 'NotAllowedError') {
    return {
      ok: false,
      reason: 'denied',
      error:
        'Access to local fonts was denied. Re-enable it in the browser’s site settings (the tune icon in the address bar), then try again.',
    }
  }
  if (name === 'SecurityError') {
    return {
      ok: false,
      reason: 'gesture',
      error: 'The browser needs a direct click to ask for font access — try the button again.',
    }
  }
  return { ok: false, reason: 'error', error: e instanceof Error ? e.message : String(e) }
}

/** Full list for the picker dialog. Must be called from a user gesture. */
export async function queryLocalFontList(): Promise<LocalFontQueryResult> {
  if (!isLocalFontsSupported()) {
    return {
      ok: false,
      reason: 'unsupported',
      error:
        'This browser doesn’t support the Local Font Access API (Chrome and Edge do). You can still upload a font file instead.',
    }
  }
  try {
    const fonts = await rawQuery()
    return {
      ok: true,
      fonts: fonts.map((f) => ({
        postscriptName: f.postscriptName,
        family: f.family,
        fullName: f.fullName,
        style: f.style,
      })),
    }
  } catch (e) {
    return classifyQueryError(e)
  }
}

/**
 * Parse font bytes, unwrapping TrueType Collections: the API returns the
 * whole .ttc for any face in it, so faces are extracted and matched by
 * postscript name (first parseable face as a fallback).
 */
function parseMatchingFace(
  buffer: ArrayBuffer,
  postscriptName: string,
): { font: opentype.Font; bytes: ArrayBuffer } {
  if (!isTtc(buffer)) {
    return { font: opentype.parse(buffer), bytes: buffer }
  }
  let firstParsed: { font: opentype.Font; bytes: ArrayBuffer } | null = null
  let lastError: unknown = null
  for (const face of extractTtcFaces(buffer)) {
    try {
      const font = opentype.parse(face)
      const names = Object.values(font.names.postScriptName ?? {})
      if (names.includes(postscriptName)) return { font, bytes: face }
      firstParsed = firstParsed ?? { font, bytes: face }
    } catch (e) {
      lastError = e
    }
  }
  if (firstParsed) return firstParsed
  throw lastError ?? new Error('No parseable face in the collection')
}

async function loadAndRegister(fontData: FontData): Promise<void> {
  const fontId = LOCAL_FONT_PREFIX + fontData.postscriptName
  const buffer = await (await fontData.blob()).arrayBuffer()
  const { font, bytes } = parseMatchingFace(buffer, fontData.postscriptName)
  registerParsedFont(fontId, font)
  linkedBytes.set(fontId, bytes)
}

/** Link a font chosen in the picker dialog: parse, cache, reference in the doc. */
export async function linkLocalFont(
  item: LocalFontItem,
): Promise<{ ok: true; fontId: FontId } | { ok: false; error: string }> {
  const fontId = LOCAL_FONT_PREFIX + item.postscriptName
  const ref: LocalFontRef = {
    postscriptName: item.postscriptName,
    family: item.family,
    fullName: item.fullName,
  }
  const state = useEngraver.getState()
  if (getLoadedFont(fontId)) {
    state.addLocalFontRef(fontId, ref)
    return { ok: true, fontId }
  }
  try {
    let fontData = fontDataCache.get(item.postscriptName)
    if (!fontData) fontData = (await rawQuery([item.postscriptName]))[0]
    if (!fontData) return { ok: false, error: `“${item.fullName}” is no longer available.` }
    await loadAndRegister(fontData)
  } catch (e) {
    return {
      ok: false,
      error: `Couldn’t read “${item.fullName}” (${
        e instanceof Error ? e.message : e
      }). Try another style of the family.`,
    }
  }
  state.addLocalFontRef(fontId, ref)
  state.bumpFontsRevision()
  return { ok: true, fontId }
}

export interface ResolveOutcome {
  resolved: number
  missing: { fontId: FontId; ref: LocalFontRef }[]
}

/**
 * Resolve every unloaded local-font reference in the doc. Non-interactive
 * calls only proceed when permission is already granted (no prompt without a
 * gesture); interactive calls (the "Re-link" button) may prompt.
 */
export async function resolveLocalFonts(
  doc: ButtonDoc,
  opts: { interactive: boolean },
): Promise<ResolveOutcome> {
  const wanted = Object.entries(doc.localFonts).filter(
    ([fontId]) => !getLoadedFont(fontId),
  ) as [FontId, LocalFontRef][]
  if (wanted.length === 0) return { resolved: 0, missing: [] }

  const missAll = (message: string): ResolveOutcome => {
    for (const [fontId] of wanted) markFontFailed(fontId, message)
    useEngraver.getState().bumpFontsRevision()
    return { resolved: 0, missing: wanted.map(([fontId, ref]) => ({ fontId, ref })) }
  }

  if (!isLocalFontsSupported()) {
    return missAll('This browser can’t access local fonts (Chrome/Edge only) — upload the font file instead.')
  }

  if (!opts.interactive) {
    let granted = false
    try {
      const status = await navigator.permissions.query({
        name: 'local-fonts' as PermissionName,
      })
      granted = status.state === 'granted'
    } catch {
      granted = false
    }
    if (!granted) {
      return missAll('Local fonts need re-authorising — use “Re-link local fonts” in the font picker.')
    }
  }

  let fonts: FontData[]
  try {
    fonts = await rawQuery(wanted.map(([, ref]) => ref.postscriptName))
  } catch (e) {
    const failure = classifyQueryError(e)
    return missAll(failure.ok === false ? failure.error : String(e))
  }

  const byPsName = new Map(fonts.map((f) => [f.postscriptName, f]))
  let resolved = 0
  const missing: ResolveOutcome['missing'] = []
  for (const [fontId, ref] of wanted) {
    const fontData = byPsName.get(ref.postscriptName)
    if (!fontData) {
      markFontFailed(fontId, `“${ref.fullName || ref.family}” isn’t installed on this machine.`)
      missing.push({ fontId, ref })
      continue
    }
    try {
      await loadAndRegister(fontData)
      resolved += 1
    } catch (e) {
      markFontFailed(fontId, `Couldn’t read “${ref.fullName}”: ${e instanceof Error ? e.message : e}`)
      missing.push({ fontId, ref })
    }
  }
  useEngraver.getState().bumpFontsRevision()
  return { resolved, missing }
}

/**
 * Fire-and-forget silent resolution, kicked by the renderer when a doc uses
 * local fonts. One attempt per session; the interactive re-link path is the
 * retry.
 */
export function ensureLocalFontsResolved(doc: ButtonDoc): void {
  if (silentResolveAttempted) return
  const anyUnloaded = Object.keys(doc.localFonts).some(
    (fontId) => isLocalFontId(fontId) && !getLoadedFont(fontId),
  )
  if (!anyUnloaded) return
  silentResolveAttempted = true
  void resolveLocalFonts(doc, { interactive: false })
}

/** New doc opened — allow one fresh silent attempt for its fonts. */
export function resetSilentResolve(): void {
  silentResolveAttempted = false
}

/**
 * Explicitly embed a linked local font into the project (portable, at the
 * cost of shipping the font bytes — the user's deliberate call, licensing
 * included).
 */
export function embedLocalFont(
  fontId: FontId,
  doc: ButtonDoc,
): { ok: true } | { ok: false; error: string } {
  const ref = doc.localFonts[fontId]
  const font = getLoadedFont(fontId)
  const bytes = linkedBytes.get(fontId)
  if (!ref || !font || !bytes) {
    return { ok: false, error: 'Re-link this font first, then embed it.' }
  }
  const assetId = `font-${newId()}`
  const state = useEngraver.getState()
  registerParsedFont(assetId, font)
  state.embedLocalFontRef(fontId, assetId, {
    kind: 'font',
    name: `${ref.fullName || ref.family}.ttf`,
    dataBase64: bufferToBase64(bytes),
  })
  state.bumpFontsRevision()
  return { ok: true }
}
