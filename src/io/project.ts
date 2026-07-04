import type { ButtonDoc } from '../model/types'
import { parseDoc, stringifyDoc } from '../model/serialize'
import { useEngraver } from '../state/store'
import { downloadText, safeFilename } from './download'
import { extractEmbeddedProject } from './exportSvg'

const AUTOSAVE_KEY = 'buttonic:autosave'
/** Pre-rename key — read once as a fallback so existing sessions survive. */
const LEGACY_AUTOSAVE_KEY = 'button-engraver:autosave'

export function saveProject(doc: ButtonDoc): void {
  downloadText(stringifyDoc(doc), `${safeFilename(doc.name)}.button.json`, 'application/json')
}

export type LoadResult = { ok: true } | { ok: false; error: string }

/** Load .json project files — or exported SVGs with embedded project metadata. */
export async function loadProjectFile(file: File): Promise<LoadResult> {
  let text = await file.text()
  if (/\.svg$/i.test(file.name) || text.trimStart().startsWith('<')) {
    const embedded = extractEmbeddedProject(text)
    if (!embedded) {
      return { ok: false, error: 'This SVG has no embedded Buttonic project.' }
    }
    text = embedded
  }
  const result = parseDoc(text)
  if (!result.ok) return { ok: false, error: result.error }
  const state = useEngraver.getState()
  state.setDoc(result.doc)
  useEngraver.temporal.getState().clear()
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Autosave: debounced localStorage mirror of the doc + restore on boot.
// ---------------------------------------------------------------------------

export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const unsubscribe = useEngraver.subscribe((state, prev) => {
    if (state.doc === prev.doc) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, stringifyDoc(state.doc))
      } catch {
        // storage full/blocked — autosave is best-effort
      }
    }, 1000)
  })
  return () => {
    if (timer) clearTimeout(timer)
    unsubscribe()
  }
}

export function readAutosave(): ButtonDoc | null {
  try {
    const json = localStorage.getItem(AUTOSAVE_KEY) ?? localStorage.getItem(LEGACY_AUTOSAVE_KEY)
    if (!json) return null
    const result = parseDoc(json)
    return result.ok ? result.doc : null
  } catch {
    return null
  }
}

export function clearAutosave(): void {
  try {
    localStorage.removeItem(AUTOSAVE_KEY)
  } catch {
    // ignore
  }
}
