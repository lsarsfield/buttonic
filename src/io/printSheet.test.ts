import { describe, expect, it } from 'vitest'
import { inflateSync } from 'node:zlib'
import { presetReferenceA } from '../model/presets'
import {
  buildSheetPdf,
  defaultPaper,
  flate,
  HEADER_MM,
  IMAGE_SPAN,
  layoutSheet,
  MARGIN_MM,
  PAPERS,
  reliefNotes,
  sheetContent,
  sheetLayoutFor,
  sheetSubtitle,
  sheetImageOf,
  type Paper,
} from './printSheet'

const PT = 72 / 25.4

describe('print sheet layout', () => {
  for (const paper of ['a4', 'letter'] as Paper[]) {
    for (const d of [8, 14, 17, 20, 27]) {
      it(`${paper} ${d} mm: every copy inside the printable area, none overlapping`, () => {
        const { wMM, hMM } = PAPERS[paper]
        const l = layoutSheet(paper, d)
        expect(l.centres.length).toBe(l.cols * l.rows)
        for (const c of l.centres) {
          expect(c.x - d / 2).toBeGreaterThanOrEqual(MARGIN_MM - 1e-9)
          expect(c.x + d / 2).toBeLessThanOrEqual(wMM - MARGIN_MM + 1e-9)
          expect(c.y - d / 2).toBeGreaterThanOrEqual(MARGIN_MM + HEADER_MM - 1e-9)
          expect(c.y + d / 2).toBeLessThanOrEqual(hMM - MARGIN_MM + 1e-9)
        }
        const a = l.centres[0]!
        if (l.cols > 1) expect(l.centres[1]!.x - a.x).toBeGreaterThan(d)
      })
    }
  }

  it('fits a useful number of 17 mm buttons on A4', () => {
    const l = layoutSheet('a4', 17)
    expect(l.cols).toBe(8)
    expect(l.rows).toBe(11)
  })

  it('picks Letter for US/Canadian locales, A4 elsewhere', () => {
    expect(defaultPaper('en-US')).toBe('letter')
    expect(defaultPaper('fr-CA')).toBe('letter')
    expect(defaultPaper('en-AU')).toBe('a4')
    expect(defaultPaper('en-GB')).toBe('a4')
    expect(defaultPaper(undefined)).toBe('a4')
  })
})

describe('print sheet PDF', () => {
  it('places the image at exactly the render span, centred on each copy, in points', () => {
    const l = layoutSheet('a4', 17)
    const ops = sheetContent(l, 'T', 'S')
    const m = ops.match(/q (\S+) 0 0 (\S+) (\S+) (\S+) cm \/Im1 Do Q/)!
    const s = 17 * IMAGE_SPAN
    expect(Number(m[1])).toBeCloseTo(s * PT, 2)
    expect(Number(m[2])).toBeCloseTo(s * PT, 2)
    // lower-left corner, y-up from the page bottom
    const c = l.centres[0]!
    expect(Number(m[3])).toBeCloseTo((c.x - s / 2) * PT, 2)
    expect(Number(m[4])).toBeCloseTo((297 - (c.y + s / 2)) * PT, 2)
    expect(ops.match(/\/Im1 Do/g)!.length).toBe(l.centres.length)
  })

  it('draws a 50 mm ruler', () => {
    const ops = sheetContent(layoutSheet('a4', 17), 'T', 'S')
    const first = ops.match(/(\S+) (\S+) m (\S+) (\S+) l S/)!
    expect((Number(first[3]) - Number(first[1])) / PT).toBeCloseTo(50, 3)
  })

  it('escapes and encodes text for Helvetica', () => {
    const ops = sheetContent(layoutSheet('a4', 17), 'Café (draft) \\ 1', 'a · b — ☃')
    expect(ops).toContain('(Caf\\351 \\(draft\\) \\\\ 1)')
    expect(ops).toContain('(a \\267 b \\227 ?)')
  })

  it('writes a well-formed file: xref offsets land on their objects, image streams round-trip', async () => {
    const w = 3
    const rgba = new Uint8ClampedArray(w * w * 4).map((_, i) => (i * 37) % 256)
    const image = await sheetImageOf(rgba, w, w)
    expect([...inflateSync(image.alphaFlate)]).toEqual([...rgba].filter((_, i) => i % 4 === 3))
    const pdf = buildSheetPdf(layoutSheet('letter', 17), image, 'Name', 'Spec')
    const text = new TextDecoder('latin1').decode(pdf)
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    const startxref = Number(text.match(/startxref\n(\d+)/)![1])
    expect(text.slice(startxref, startxref + 4)).toBe('xref')
    const entries = [...text.slice(startxref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]))
    expect(entries.length).toBe(8)
    entries.forEach((off, i) => expect(text.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`))
    // stream /Length matches its bytes
    for (const m of text.matchAll(/\/Length (\d+) >>\nstream\n/g)) {
      const start = m.index! + m[0].length
      expect(text.slice(start + Number(m[1]), start + Number(m[1]) + 10)).toBe('\nendstream')
    }
    expect(text).toContain('/MediaBox [0 0 612 792]')
  })

  it('flate is zlib', async () => {
    const bytes = new TextEncoder().encode('button '.repeat(50))
    expect(new TextDecoder().decode(inflateSync(await flate(bytes)))).toBe('button '.repeat(50))
  })
})

describe('print sheet relief notes', () => {
  it('a single-relief design gets one line naming how it is struck', () => {
    const doc = { ...presetReferenceA(), logoDisplay: 'debossed' as const }
    const notes = reliefNotes(doc, 'a4')
    expect(notes).toEqual([{ bold: 'Marking: Debossed', text: ' \u2014 the whole design is sunk into the face.' }])
    expect(sheetSubtitle(doc)).toContain('Debossed')
    expect(sheetLayoutFor(doc, 'a4').layout).toEqual(layoutSheet('a4', doc.diameterMM))
  })

  it('a mixed die lists every depth with its layers, embossed → debossed → lasered', () => {
    const base = presetReferenceA()
    const reliefs = ['lasered', 'inherit', 'debossed'] as const
    const doc = { ...base, layers: base.layers.map((l, i) => ({ ...l, visible: true, relief: reliefs[i % 3]! })) }
    const notes = reliefNotes(doc, 'a4')
    expect(notes.filter((n) => n.bold).map((n) => n.bold)).toEqual(['Embossed', 'Debossed', 'Lasered'])
    expect(notes.find((n) => n.bold === 'Lasered')!.text).toContain('laser-engraved')
    for (const l of doc.layers) expect(notes.map((n) => n.text).join(' ')).toContain(l.name)
    expect(sheetSubtitle(doc)).toContain('Embossed + debossed + lasered')
    const ops = sheetContent(sheetLayoutFor(doc, 'a4').layout, 'T', 'S', notes)
    expect(ops).toContain('/F2 7 Tf (Embossed) Tj /F1 7 Tf')
  })

  it('long layer lists wrap, and the header grows so no copy runs under them', () => {
    const base = presetReferenceA()
    const many = Array.from({ length: 40 }, (_, i) => ({
      ...base.layers[0]!,
      id: `l${i}`,
      name: `A rather long layer name ${i}`,
      visible: true,
      relief: i % 2 ? ('debossed' as const) : ('embossed' as const),
    }))
    const doc = { ...base, layers: many }
    const { layout, notes } = sheetLayoutFor(doc, 'a4')
    expect(notes.length).toBeGreaterThan(2)
    for (const n of notes) expect((n.bold + n.text).length).toBeLessThan(140)
    const lastNoteY = MARGIN_MM + 31 + 3.4 * (notes.length - 1)
    for (const c of layout.centres) expect(c.y - doc.diameterMM / 2).toBeGreaterThan(lastNoteY + 1)
  })
})
