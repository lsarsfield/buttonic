import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as opentype from 'opentype.js'
import { describe, expect, it } from 'vitest'
import { BUNDLED_FONTS } from './fonts'

/**
 * Every bundled font must exist, parse in opentype.js, and produce real
 * outlines — this is what makes swapping a face in the manifest a safe
 * two-minute change.
 */

const fontsDir = fileURLToPath(new URL('../../public/fonts/', import.meta.url))

const fileFor = (url: string) => {
  const name = url.split('/').pop()!
  return `${fontsDir}${name}`
}

describe('bundled font manifest', () => {
  it('offers the full dozen', () => {
    expect(BUNDLED_FONTS.length).toBe(12)
    expect(new Set(BUNDLED_FONTS.map((f) => f.id)).size).toBe(12)
  })

  for (const entry of BUNDLED_FONTS) {
    it(`${entry.id}: file exists, parses, and yields outlines`, () => {
      const path = fileFor(entry.url)
      expect(existsSync(path), `missing ${path}`).toBe(true)
      const buf = readFileSync(path)
      const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
      expect(font.unitsPerEm).toBeGreaterThan(0)
      const commands = font.getPath('AB', 0, 0, 72).commands
      expect(commands.length).toBeGreaterThan(4)
    })

    it(`${entry.id}: ships a license file`, () => {
      const hasLicense =
        existsSync(`${fontsDir}OFL-${entry.id}.txt`) ||
        existsSync(`${fontsDir}LICENSE-${entry.id}.txt`)
      expect(hasLicense, `no OFL-${entry.id}.txt or LICENSE-${entry.id}.txt`).toBe(true)
    })
  }
})
