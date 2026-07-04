import type { ButtonDoc } from '../model/types'
import { parseDoc, stringifyDoc } from '../model/serialize'
import { downloadText, safeFilename } from './download'
import { extractEmbeddedProject } from './exportSvg'
import { createFromDoc } from './workspace'

export function saveProject(doc: ButtonDoc): void {
  downloadText(stringifyDoc(doc), `${safeFilename(doc.name)}.button.json`, 'application/json')
}

export type LoadResult = { ok: true; name: string } | { ok: false; error: string }

/**
 * Load a `.json` project file — or an exported SVG with embedded project
 * metadata. The document joins the workspace as a NEW entry (and becomes
 * current); it never overwrites the button being worked on.
 */
export async function loadProjectFile(file: File): Promise<LoadResult> {
  let text = await file.text()
  if (/\.svg$/i.test(file.name) || text.trimStart().startsWith('<')) {
    const embedded = extractEmbeddedProject(text)
    if (!embedded) {
      return {
        ok: false,
        error:
          'This SVG has no embedded Buttonic project. To use it as artwork, add a Bend or Repeat layer and upload it there.',
      }
    }
    text = embedded
  }
  const result = parseDoc(text)
  if (!result.ok) return { ok: false, error: result.error }
  await createFromDoc(result.doc)
  return { ok: true, name: result.doc.name }
}
