import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as opentype from 'opentype.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeBlankDoc, makeCenterLayer, LOCAL_FONT_PREFIX } from '../model/types'
import { useEngraver } from '../state/store'
import { _resetFontCachesForTests, getFontError, getLoadedFont } from './fonts'
import {
  embedLocalFont,
  linkLocalFont,
  queryLocalFontList,
  resolveLocalFonts,
} from './localFonts'
import { buildTtcForTest } from './ttc'

function loadTtf(rel: string): ArrayBuffer {
  const path = fileURLToPath(new URL(rel, import.meta.url))
  const buf = readFileSync(path)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

const cinzelBytes = loadTtf('../../public/fonts/cinzel.ttf')
const unifrakturBytes = loadTtf('../../public/fonts/unifrakturcook-bold.ttf')
const cinzelPs = Object.values(opentype.parse(cinzelBytes).names.postScriptName ?? {})[0]!
const unifrakturPs = Object.values(opentype.parse(unifrakturBytes).names.postScriptName ?? {})[0]!

/** Fake FontData entries; the TTC case hands back the whole collection like Chromium does. */
function fakeFontData(postscriptName: string, family: string, bytes: ArrayBuffer): FontData {
  return {
    postscriptName,
    family,
    fullName: `${family} Regular`,
    style: 'Regular',
    blob: async () => new Blob([bytes]),
  } as FontData
}

let installed: FontData[] = []

beforeEach(() => {
  _resetFontCachesForTests()
  useEngraver.getState().setDoc(makeBlankDoc())
  useEngraver.temporal.getState().clear()
  installed = []
  vi.stubGlobal('window', {
    queryLocalFonts: async (opts?: { postscriptNames?: string[] }) => {
      const names = opts?.postscriptNames
      return names ? installed.filter((f) => names.includes(f.postscriptName)) : [...installed]
    },
  })
  vi.stubGlobal('navigator', {
    permissions: { query: async () => ({ state: 'granted' }) },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('local font linking', () => {
  it('links a plain TTF: caches the parsed font and references it in the doc', async () => {
    installed = [fakeFontData(cinzelPs, 'Cinzel', cinzelBytes)]
    const result = await linkLocalFont({
      postscriptName: cinzelPs,
      family: 'Cinzel',
      fullName: 'Cinzel Regular',
      style: 'Regular',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.fontId).toBe(`${LOCAL_FONT_PREFIX}${cinzelPs}`)
    expect(getLoadedFont(result.fontId)).not.toBeNull()
    const ref = useEngraver.getState().doc.localFonts[result.fontId]
    expect(ref?.postscriptName).toBe(cinzelPs)
  })

  it('extracts the matching face when the API returns a whole .ttc', async () => {
    const ttc = buildTtcForTest([cinzelBytes, unifrakturBytes])
    installed = [fakeFontData(unifrakturPs, 'UnifrakturCook', ttc)]
    const result = await linkLocalFont({
      postscriptName: unifrakturPs,
      family: 'UnifrakturCook',
      fullName: 'UnifrakturCook Bold',
      style: 'Bold',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const font = getLoadedFont(result.fontId)!
    expect(Object.values(font.names.postScriptName ?? {})).toContain(unifrakturPs)
    expect(font.names.fontFamily?.en).toMatch(/UnifrakturCook/i)
  })

  it('queryLocalFontList reports unsupported browsers with upload guidance', async () => {
    vi.stubGlobal('window', {})
    const result = await queryLocalFontList()
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('unsupported')
    expect(result.error).toMatch(/upload/i)
  })
})

describe('resolution of doc references', () => {
  function docWithLocalFont(postscriptName: string, family: string) {
    const fontId = LOCAL_FONT_PREFIX + postscriptName
    const doc = {
      ...makeBlankDoc(),
      layers: [makeCenterLayer({ fontId })],
      localFonts: { [fontId]: { postscriptName, family, fullName: `${family} Regular` } },
    }
    useEngraver.getState().setDoc(doc)
    return { fontId, doc }
  }

  it('silently resolves installed fonts when permission is granted', async () => {
    installed = [fakeFontData(cinzelPs, 'Cinzel', cinzelBytes)]
    const { fontId, doc } = docWithLocalFont(cinzelPs, 'Cinzel')
    const outcome = await resolveLocalFonts(doc, { interactive: false })
    expect(outcome.resolved).toBe(1)
    expect(outcome.missing).toHaveLength(0)
    expect(getLoadedFont(fontId)).not.toBeNull()
  })

  it('marks fonts missing (with re-link guidance) when permission is not granted', async () => {
    vi.stubGlobal('navigator', {
      permissions: { query: async () => ({ state: 'prompt' }) },
    })
    const ps = 'Fictional-Font'
    const { fontId, doc } = docWithLocalFont(ps, 'Fictional')
    const outcome = await resolveLocalFonts(doc, { interactive: false })
    expect(outcome.resolved).toBe(0)
    expect(outcome.missing).toHaveLength(1)
    expect(getFontError(fontId)).toMatch(/re-link/i)
  })

  it('reports fonts not installed on this machine', async () => {
    installed = [] // nothing installed
    const { fontId, doc } = docWithLocalFont('Gone-Font', 'Gone')
    const outcome = await resolveLocalFonts(doc, { interactive: true })
    expect(outcome.missing).toHaveLength(1)
    expect(getFontError(fontId)).toMatch(/isn’t installed/)
  })
})

describe('embedding into the project', () => {
  it('moves a linked local font into assets and repoints layers', async () => {
    installed = [fakeFontData(cinzelPs, 'Cinzel', cinzelBytes)]
    const link = await linkLocalFont({
      postscriptName: cinzelPs,
      family: 'Cinzel',
      fullName: 'Cinzel Regular',
      style: 'Regular',
    })
    if (!link.ok) throw new Error('link failed')
    const fontId = link.fontId
    useEngraver.getState().setDoc({
      ...useEngraver.getState().doc,
      layers: [makeCenterLayer({ fontId })],
    })

    const result = embedLocalFont(fontId, useEngraver.getState().doc)
    expect(result.ok).toBe(true)
    const doc = useEngraver.getState().doc
    expect(doc.localFonts[fontId]).toBeUndefined()
    const layer = doc.layers[0]!
    if (layer.type !== 'center') throw new Error('expected center layer')
    expect(layer.fontId).not.toBe(fontId)
    const asset = doc.assets[layer.fontId]
    expect(asset?.kind).toBe('font')
    expect(getLoadedFont(layer.fontId)).not.toBeNull()
  })
})
