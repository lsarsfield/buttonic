import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { presetBlank } from '../model/presets'
import type { ButtonDoc } from '../model/types'
import { _resetFontCachesForTests, ensureFontLoaded, getLoadedFont } from './fonts'

const b64 = (file: string) => readFileSync(fileURLToPath(new URL(`../../public/fonts/${file}`, import.meta.url))).toString('base64')
const docWith = (fontB64: string): ButtonDoc => ({ ...presetBlank(), assets: { 'font-x': { kind: 'font', name: 'x.ttf', dataBase64: fontB64 } } })

describe('embedded font cache', () => {
  beforeEach(() => _resetFontCachesForTests())

  it('a second document with DIFFERENT bytes under the SAME font id renders its own font, not the cached one', () => {
    ensureFontLoaded('font-x', docWith(b64('cinzel.ttf')))
    const first = getLoadedFont('font-x')!
    expect(first.names.fontFamily?.en).toMatch(/Cinzel/)
    ensureFontLoaded('font-x', docWith(b64('jost.ttf')))
    const second = getLoadedFont('font-x')!
    expect(second).not.toBe(first)
    expect(second.names.fontFamily?.en).toMatch(/Jost/)
  })

  it('the same bytes again reuse the cached parse', () => {
    const doc = docWith(b64('cinzel.ttf'))
    ensureFontLoaded('font-x', doc)
    const first = getLoadedFont('font-x')
    ensureFontLoaded('font-x', { ...doc })
    expect(getLoadedFont('font-x')).toBe(first)
  })
})
