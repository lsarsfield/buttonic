import { FINISH_LABELS, LOGO_DISPLAYS, MARKING_NOTES, markingLabel, markingSummary, reliefGroups, STYLES } from '../model/product'
import type { ButtonDoc } from '../model/types'

/**
 * Print-at-actual-size test sheet: copies of the button's top-down 3D render
 * laid out on a page, true to the millimetre, as a PDF (a PDF prints at 100%
 * reliably and can go to a sticker printer as-is). A calibration ruler on the
 * sheet proves the printer didn't scale it.
 *
 * Pure: layout in mm (y-down from the page's top-left, the app's convention)
 * and a hand-rolled PDF writer — no PDF dependency. The image is one RGB +
 * alpha raster, Flate-compressed by the caller (zlib streams), placed once
 * per copy.
 */

export type Paper = 'a4' | 'letter'

export const PAPERS: Record<Paper, { label: string; wMM: number; hMM: number }> = {
  a4: { label: 'A4', wMM: 210, hMM: 297 },
  letter: { label: 'Letter', wMM: 215.9, hMM: 279.4 },
}

/** Printers can't reach the paper's edge; 12 mm clears every common one. */
export const MARGIN_MM = 12
/** Height of the header band: title, instructions, the ruler and one line of marking notes. */
export const HEADER_MM = 34
/** Marking notes: first baseline below the page margin, and line pitch. */
const NOTES_TOP_MM = 31
const NOTE_PITCH_MM = 3.4
const NOTE_PT = 7

/** The header's height with `noteLines` lines of marking notes (at least one). */
export function headerMM(noteLines: number): number {
  return HEADER_MM + NOTE_PITCH_MM * Math.max(0, noteLines - 1)
}
/** The calibration ruler's length. */
export const RULER_MM = 50

/**
 * The image spans this × the diameter: a transparent margin round the rim, so
 * no viewer's edge-pixel smear can touch the button (a disc filling its square
 * grew spurs at 12, 3, 6 and 9 o'clock). The render's frustum uses the same
 * factor, so the scale stays exact.
 */
export const IMAGE_SPAN = 1.04

/** Letter where the locale prints on it (US, Canada, Mexico, Philippines…), A4 elsewhere. */
export function defaultPaper(locale: string | undefined): Paper {
  return /-(US|CA|MX|PH|CL|CO|VE|GT|PR)\b/i.test(locale ?? '') ? 'letter' : 'a4'
}

/** Gap between neighbouring buttons: room to cut each one out cleanly. */
export function gapMM(diameterMM: number): number {
  return Math.max(4, 0.3 * diameterMM)
}

export interface SheetLayout {
  paper: Paper
  diameterMM: number
  /** Button centres, mm from the page's top-left (y down). */
  centres: { x: number; y: number }[]
  cols: number
  rows: number
}

/** As many copies as fit below the header, centred in the printable area. */
export function layoutSheet(paper: Paper, diameterMM: number, header = HEADER_MM): SheetLayout {
  const { wMM, hMM } = PAPERS[paper]
  const g = gapMM(diameterMM)
  const pitch = diameterMM + g
  const areaW = wMM - 2 * MARGIN_MM
  const areaH = hMM - 2 * MARGIN_MM - header
  const cols = Math.max(1, Math.floor((areaW + g) / pitch))
  const rows = Math.max(1, Math.floor((areaH + g) / pitch))
  const usedW = cols * pitch - g
  const usedH = rows * pitch - g
  const x0 = MARGIN_MM + (areaW - usedW) / 2 + diameterMM / 2
  const y0 = MARGIN_MM + header + (areaH - usedH) / 2 + diameterMM / 2
  const centres: { x: number; y: number }[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) centres.push({ x: x0 + c * pitch, y: y0 + r * pitch })
  return { paper, diameterMM, centres, cols, rows }
}

export interface SheetImage {
  width: number
  height: number
  /** zlib (Flate) streams: interleaved 8-bit RGB, and 8-bit alpha. */
  rgbFlate: Uint8Array
  alphaFlate: Uint8Array
}

const PT = 72 / 25.4
/** PDF numbers: deterministic, short. */
const n = (v: number) => {
  const s = (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '')
  return s === '-0' ? '0' : s
}

/** A WinAnsi string literal for the standard Helvetica (unmappable characters become '?'). */
function pdfString(text: string): string {
  let out = ''
  for (const ch of text) {
    const c = ch.codePointAt(0)!
    const b = c === 0x2014 ? 0x97 : c === 0x2013 ? 0x96 : c === 0x2019 ? 0x92 : c === 0x00b7 ? 0xb7 : c < 0x20 || c > 0xff ? 0x3f : c
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += '\\' + String.fromCharCode(b)
    else if (b > 0x7e) out += '\\' + b.toString(8).padStart(3, '0')
    else out += String.fromCharCode(b)
  }
  return `(${out})`
}

/** One line of marking notes: a bold lead-in, then plain text (empty on wrapped continuation lines). */
export interface SheetNote {
  bold: string
  text: string
}

/**
 * Greedy word wrap at an estimated Helvetica width (0.56 em a character —
 * wider than the average, so lines fall short of the margin, never past it).
 */
function wrap(text: string, firstMM: number, restMM: number): string[] {
  const mmPerChar = NOTE_PT * (25.4 / 72) * 0.56
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const max = (lines.length ? restMM : firstMM) / mmPerChar
    const next = line ? `${line} ${word}` : word
    if (line && next.length > max) {
      lines.push(line)
      line = word
    } else line = next
  }
  lines.push(line)
  return lines
}

/**
 * The design's marking, for the sheet's header: one line for a single
 * marking; for a mixed die, each marking (embossed, debossed, lasered) with
 * its layers, wrapped to the printable width.
 */
export function reliefNotes(doc: ButtonDoc, paper: Paper): SheetNote[] {
  const groups = reliefGroups(doc)
  if (groups.size <= 1) {
    const r = [...groups.keys()][0] ?? doc.logoDisplay
    return [{ bold: `Marking: ${markingLabel(r)}`, text: ` — the whole design is ${MARKING_NOTES[r]}.` }]
  }
  const widthMM = PAPERS[paper].wMM - 2 * MARGIN_MM
  const notes: SheetNote[] = []
  for (const { value: r, label: bold } of LOGO_DISPLAYS) {
    const layers = groups.get(r)
    if (!layers) continue
    // the bold lead-in is a little wider per character than the plain text
    const leadMM = (bold.length + 1) * NOTE_PT * (25.4 / 72) * 0.62
    const [first, ...rest] = wrap(`(${MARKING_NOTES[r]}): ${layers.map((l) => l.name).join(', ')}`, widthMM - leadMM, widthMM - 4)
    notes.push({ bold, text: ` ${first}` })
    for (const t of rest) notes.push({ bold: '', text: t })
  }
  return notes
}

/** Page content: header text, the ruler, marking notes, then every copy of the button. */
export function sheetContent(layout: SheetLayout, title: string, subtitle: string, notes: SheetNote[] = []): string {
  const { hMM } = PAPERS[layout.paper]
  // mm, y-down → pt, y-up
  const X = (x: number) => n(x * PT)
  const Y = (y: number) => n((hMM - y) * PT)
  const ops: string[] = []
  const text = (x: number, y: number, size: number, s: string, bold = false) =>
    ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${X(x)} ${Y(y)} Td ${pdfString(s)} Tj ET`)
  const line = (x1: number, y1: number, x2: number, y2: number) => ops.push(`${X(x1)} ${Y(y1)} m ${X(x2)} ${Y(y2)} l S`)

  const top = MARGIN_MM
  text(MARGIN_MM, top + 4, 11, title, true)
  text(MARGIN_MM, top + 9, 8, subtitle)
  text(MARGIN_MM, top + 14, 8, 'Print at 100% / Actual size (not Fit to page). The ruler must measure exactly 50 mm.')

  // calibration ruler: 50 mm in 1 mm ticks (5 mm and 10 mm longer)
  const rx = MARGIN_MM
  const ry = top + 24
  ops.push('0 G 0.4 w 0 J')
  line(rx, ry, rx + RULER_MM, ry)
  ops.push('0.25 w')
  for (let i = 0; i <= RULER_MM; i++) {
    const len = i % 10 === 0 ? 3 : i % 5 === 0 ? 2 : 1.2
    line(rx + i, ry, rx + i, ry - len)
  }
  for (let i = 0; i <= RULER_MM; i += 10) text(rx + i - (i < 10 ? 0.6 : 1.2), ry + 3, 6, String(i))
  text(rx + RULER_MM + 2.5, ry - 0.4, 7, 'mm')
  // and an inch, for the US printer
  const ix = rx + RULER_MM + 12
  ops.push('0.4 w')
  line(ix, ry, ix + 25.4, ry)
  ops.push('0.25 w')
  for (let i = 0; i <= 8; i++) line(ix + (i * 25.4) / 8, ry, ix + (i * 25.4) / 8, ry - (i % 4 === 0 ? 3 : i % 2 === 0 ? 2 : 1.2))
  text(ix + 25.4 + 2.5, ry - 0.4, 7, '1 in')

  // the marking: bold lead-in, plain text after (Tj advances, so no measuring)
  notes.forEach((note, i) => {
    const y = Y(top + NOTES_TOP_MM + i * NOTE_PITCH_MM)
    const x = X(MARGIN_MM + (note.bold ? 0 : 4))
    const bold = note.bold ? `/F2 ${NOTE_PT} Tf ${pdfString(note.bold)} Tj ` : ''
    ops.push(`BT ${x} ${y} Td ${bold}/F1 ${NOTE_PT} Tf ${pdfString(note.text)} Tj ET`)
  })

  // the buttons: the image's square is the diameter × IMAGE_SPAN, centred on each copy
  const s = layout.diameterMM * IMAGE_SPAN
  for (const c of layout.centres) {
    ops.push(`q ${n(s * PT)} 0 0 ${n(s * PT)} ${X(c.x - s / 2)} ${Y(c.y + s / 2)} cm /Im1 Do Q`)
  }
  return ops.join('\n') + '\n'
}

/** Assemble the PDF: one page, one image (with soft-mask alpha), Helvetica + Helvetica-Bold. */
export function buildSheetPdf(
  layout: SheetLayout,
  image: SheetImage,
  title: string,
  subtitle: string,
  notes: SheetNote[] = [],
): Uint8Array {
  const { wMM, hMM } = PAPERS[layout.paper]
  const enc = new TextEncoder()
  const content = enc.encode(sheetContent(layout, title, subtitle, notes))
  // each object: header text, optional binary stream
  const objs: { head: string; stream?: Uint8Array }[] = [
    { head: '<< /Type /Catalog /Pages 2 0 R >>' },
    { head: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    {
      head:
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(wMM * PT)} ${n(hMM * PT)}] ` +
        '/Resources << /XObject << /Im1 5 0 R >> /Font << /F1 7 0 R /F2 8 0 R >> >> /Contents 4 0 R >>',
    },
    { head: `<< /Length ${content.length} >>`, stream: content },
    {
      head:
        `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB ` +
        `/BitsPerComponent 8 /Filter /FlateDecode /SMask 6 0 R /Interpolate true /Length ${image.rgbFlate.length} >>`,
      stream: image.rgbFlate,
    },
    {
      head:
        `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceGray ` +
        `/BitsPerComponent 8 /Filter /FlateDecode /Interpolate true /Length ${image.alphaFlate.length} >>`,
      stream: image.alphaFlate,
    },
    { head: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>' },
    { head: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>' },
  ]

  const parts: Uint8Array[] = []
  let length = 0
  const push = (b: Uint8Array) => {
    parts.push(b)
    length += b.length
  }
  // binary marker comment so tools treat the file as binary
  push(enc.encode('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'))
  const offsets: number[] = []
  objs.forEach((o, i) => {
    offsets.push(length)
    push(enc.encode(`${i + 1} 0 obj\n${o.head}\n`))
    if (o.stream) {
      push(enc.encode('stream\n'))
      push(o.stream)
      push(enc.encode('\nendstream\n'))
    }
    push(enc.encode('endobj\n'))
  })
  const xref = length
  let tail = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) tail += `${String(off).padStart(10, '0')} 00000 n \n`
  tail += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  push(enc.encode(tail))

  const out = new Uint8Array(length)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** zlib-compress bytes (PDF FlateDecode) with the platform's CompressionStream. */
export async function flate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Split canvas RGBA (unpremultiplied) into compressed RGB + alpha planes. */
export async function sheetImageOf(rgba: Uint8ClampedArray, width: number, height: number): Promise<SheetImage> {
  const px = width * height
  const rgb = new Uint8Array(px * 3)
  const alpha = new Uint8Array(px)
  for (let i = 0; i < px; i++) {
    rgb[i * 3] = rgba[i * 4]!
    rgb[i * 3 + 1] = rgba[i * 4 + 1]!
    rgb[i * 3 + 2] = rgba[i * 4 + 2]!
    alpha[i] = rgba[i * 4 + 3]!
  }
  const [rgbFlate, alphaFlate] = await Promise.all([flate(rgb), flate(alpha)])
  return { width, height, rgbFlate, alphaFlate }
}

/** Render resolution for the sheet: ~1200 dpi at the button's size (sharp on any printer). */
export function printPx(diameterMM: number): number {
  return Math.round(Math.min(2048, Math.max(600, ((diameterMM * IMAGE_SPAN) / 25.4) * 1200)))
}

/** The sheet's copies for doc: the header grows with its marking notes. */
export function sheetLayoutFor(doc: ButtonDoc, paper: Paper): { layout: SheetLayout; notes: SheetNote[] } {
  const notes = reliefNotes(doc, paper)
  return { layout: layoutSheet(paper, doc.diameterMM, headerMM(notes.length)), notes }
}

/** "17 mm · Flat cap · Satin nickel · Embossed" (mixed: "Embossed + lasered") */
export function sheetSubtitle(doc: ButtonDoc): string {
  const relief = markingSummary(doc)
  return [`${Number(doc.diameterMM.toFixed(2))} mm`, STYLES[doc.style].label, FINISH_LABELS[doc.finish], relief]
    .filter(Boolean)
    .join(' \u00b7 ')
}

/**
 * The print sheet PDF for doc: the 3D view's materials and light, straight
 * down, as many copies as fit (three.js loads lazily, as for the 3D PNG).
 */
export async function exportPrintSheet(
  doc: ButtonDoc,
  opts: { paper: Paper; lightDeg: number; fontsRevision: number; assetsRevision: number },
): Promise<Blob> {
  const { renderButtonTopRgba } = await import('../render/relief/renderPng')
  const px = printPx(doc.diameterMM)
  const rgba = await renderButtonTopRgba(doc, { px, spanMM: doc.diameterMM * IMAGE_SPAN, lightDeg: opts.lightDeg, fontsRevision: opts.fontsRevision, assetsRevision: opts.assetsRevision })
  const image = await sheetImageOf(rgba, px, px)
  const { layout, notes } = sheetLayoutFor(doc, opts.paper)
  const pdf = buildSheetPdf(layout, image, doc.name || 'Untitled button', sheetSubtitle(doc), notes)
  return new Blob([pdf as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })
}
