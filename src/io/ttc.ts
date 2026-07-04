/**
 * TrueType Collection (.ttc) face extraction.
 *
 * macOS ships its marquee families — Helvetica, Avenir, Futura — as
 * collections, and the Local Font Access API hands back the WHOLE collection
 * file for any face in one. opentype.js cannot parse `ttcf`, so each face is
 * rebuilt as a standalone sfnt: new offset table + table directory with
 * retargeted offsets + the face's table data copied out (shared tables are
 * simply duplicated).
 *
 * No dependency; the format is mechanical: a `ttcf` header listing offsets to
 * per-face sfnt offset tables, whose table records point into the shared file.
 */

const TTCF = 0x74746366 // 'ttcf'

export function isTtc(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 12) return false
  return new DataView(buffer).getUint32(0) === TTCF
}

/** Extract every face as a standalone sfnt buffer. Throws on malformed input. */
export function extractTtcFaces(buffer: ArrayBuffer): ArrayBuffer[] {
  const view = new DataView(buffer)
  if (view.getUint32(0) !== TTCF) throw new Error('Not a TrueType Collection')
  const numFonts = view.getUint32(8)
  if (numFonts === 0 || numFonts > 512) throw new Error(`Implausible face count: ${numFonts}`)

  const faces: ArrayBuffer[] = []
  for (let i = 0; i < numFonts; i++) {
    const faceOffset = view.getUint32(12 + i * 4)
    faces.push(extractFace(buffer, view, faceOffset))
  }
  return faces
}

function extractFace(buffer: ArrayBuffer, view: DataView, faceOffset: number): ArrayBuffer {
  if (faceOffset + 12 > buffer.byteLength) throw new Error('Face offset out of range')
  const sfntVersion = view.getUint32(faceOffset)
  const numTables = view.getUint16(faceOffset + 4)
  if (numTables === 0 || numTables > 256) throw new Error(`Implausible table count: ${numTables}`)

  interface TableRec {
    tag: number
    checkSum: number
    offset: number
    length: number
  }
  const tables: TableRec[] = []
  for (let t = 0; t < numTables; t++) {
    const rec = faceOffset + 12 + t * 16
    tables.push({
      tag: view.getUint32(rec),
      checkSum: view.getUint32(rec + 4),
      offset: view.getUint32(rec + 8),
      length: view.getUint32(rec + 12),
    })
    const last = tables[tables.length - 1]!
    if (last.offset + last.length > buffer.byteLength) {
      throw new Error('Table data out of range')
    }
  }

  const align4 = (n: number) => (n + 3) & ~3
  const headerSize = 12 + numTables * 16
  let total = headerSize
  for (const t of tables) total += align4(t.length)

  const out = new ArrayBuffer(total)
  const outView = new DataView(out)
  const outBytes = new Uint8Array(out)
  const srcBytes = new Uint8Array(buffer)

  // offset table
  outView.setUint32(0, sfntVersion)
  outView.setUint16(4, numTables)
  const pow2 = 1 << Math.floor(Math.log2(numTables))
  outView.setUint16(6, pow2 * 16) // searchRange
  outView.setUint16(8, Math.log2(pow2)) // entrySelector
  outView.setUint16(10, numTables * 16 - pow2 * 16) // rangeShift

  // table records + data
  let dataCursor = headerSize
  tables.forEach((t, index) => {
    const rec = 12 + index * 16
    outView.setUint32(rec, t.tag)
    outView.setUint32(rec + 4, t.checkSum)
    outView.setUint32(rec + 8, dataCursor)
    outView.setUint32(rec + 12, t.length)
    outBytes.set(srcBytes.subarray(t.offset, t.offset + t.length), dataCursor)
    dataCursor += align4(t.length)
  })

  return out
}

/**
 * Test helper (exported for the spec): build a collection from standalone
 * sfnt buffers — the inverse of extraction, with shared table data appended
 * after all face headers.
 */
export function buildTtcForTest(fonts: ArrayBuffer[]): ArrayBuffer {
  interface FaceInfo {
    sfntVersion: number
    tables: { tag: number; checkSum: number; length: number; srcOffset: number; src: ArrayBuffer }[]
  }
  const faces: FaceInfo[] = fonts.map((font) => {
    const v = new DataView(font)
    const numTables = v.getUint16(4)
    const tables = []
    for (let t = 0; t < numTables; t++) {
      const rec = 12 + t * 16
      tables.push({
        tag: v.getUint32(rec),
        checkSum: v.getUint32(rec + 4),
        length: v.getUint32(rec + 12),
        srcOffset: v.getUint32(rec + 8),
        src: font,
      })
    }
    return { sfntVersion: v.getUint32(0), tables }
  })

  const align4 = (n: number) => (n + 3) & ~3
  const ttcHeader = 12 + fonts.length * 4
  const faceHeaderSizes = faces.map((f) => 12 + f.tables.length * 16)
  const headersTotal = ttcHeader + faceHeaderSizes.reduce((a, b) => a + b, 0)
  const dataTotal = faces.reduce(
    (sum, f) => sum + f.tables.reduce((s, t) => s + align4(t.length), 0),
    0,
  )

  const out = new ArrayBuffer(headersTotal + dataTotal)
  const view = new DataView(out)
  const bytes = new Uint8Array(out)

  view.setUint32(0, TTCF)
  view.setUint32(4, 0x00010000)
  view.setUint32(8, fonts.length)

  let faceHeaderCursor = ttcHeader
  let dataCursor = headersTotal
  faces.forEach((face, i) => {
    view.setUint32(12 + i * 4, faceHeaderCursor)
    const numTables = face.tables.length
    view.setUint32(faceHeaderCursor, face.sfntVersion)
    view.setUint16(faceHeaderCursor + 4, numTables)
    const pow2 = 1 << Math.floor(Math.log2(numTables))
    view.setUint16(faceHeaderCursor + 6, pow2 * 16)
    view.setUint16(faceHeaderCursor + 8, Math.log2(pow2))
    view.setUint16(faceHeaderCursor + 10, numTables * 16 - pow2 * 16)
    face.tables.forEach((t, ti) => {
      const rec = faceHeaderCursor + 12 + ti * 16
      view.setUint32(rec, t.tag)
      view.setUint32(rec + 4, t.checkSum)
      view.setUint32(rec + 8, dataCursor)
      view.setUint32(rec + 12, t.length)
      bytes.set(new Uint8Array(t.src, t.srcOffset, t.length), dataCursor)
      dataCursor += align4(t.length)
    })
    faceHeaderCursor += 12 + numTables * 16
  })

  return out
}
