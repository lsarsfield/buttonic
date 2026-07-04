import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as opentype from 'opentype.js'
import { describe, expect, it } from 'vitest'
import { buildTtcForTest, extractTtcFaces, isTtc } from './ttc'

function loadTtf(rel: string): ArrayBuffer {
  const path = fileURLToPath(new URL(rel, import.meta.url))
  const buf = readFileSync(path)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

describe('TTC face extraction', () => {
  const cinzel = loadTtf('../../public/fonts/cinzel.ttf')
  const unifraktur = loadTtf('../../public/fonts/unifrakturcook-bold.ttf')

  it('detects collections vs plain sfnts', () => {
    const ttc = buildTtcForTest([cinzel])
    expect(isTtc(ttc)).toBe(true)
    expect(isTtc(cinzel)).toBe(false)
    expect(isTtc(new ArrayBuffer(4))).toBe(false)
  })

  it('extracted faces parse in opentype.js with the original identities', () => {
    const ttc = buildTtcForTest([cinzel, unifraktur])
    // sanity: opentype cannot read the collection itself
    expect(() => opentype.parse(ttc)).toThrow()

    const faces = extractTtcFaces(ttc)
    expect(faces).toHaveLength(2)
    const parsed = faces.map((f) => opentype.parse(f))
    const families = parsed.map((p) => p.names.fontFamily?.en)
    expect(families[0]).toMatch(/Cinzel/i)
    expect(families[1]).toMatch(/UnifrakturCook/i)
  })

  it('extracted faces produce identical glyph outlines to the originals', () => {
    const ttc = buildTtcForTest([cinzel])
    const original = opentype.parse(cinzel)
    const extracted = opentype.parse(extractTtcFaces(ttc)[0]!)
    const a = original.getPath('AV', 0, 0, 24).toPathData(3)
    const b = extracted.getPath('AV', 0, 0, 24).toPathData(3)
    expect(a).toBe(b)
    expect(extracted.unitsPerEm).toBe(original.unitsPerEm)
  })

  it('rejects malformed collections', () => {
    expect(() => extractTtcFaces(cinzel)).toThrow(/Not a TrueType Collection/)
    const junk = new ArrayBuffer(64)
    new DataView(junk).setUint32(0, 0x74746366)
    new DataView(junk).setUint32(8, 100000) // implausible face count
    expect(() => extractTtcFaces(junk)).toThrow(/Implausible/)
  })
})
