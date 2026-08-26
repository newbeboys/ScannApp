import { describe, expect, it } from 'vitest'
import { buildDocx, docxParts } from './docxExport'
import type { PageText } from './ocrLayout'

/** A page holding one block per string, each block a single line. */
function page(...blocks: string[]): PageText {
  return {
    blocks: blocks.map((text) => ({ text, lines: [{ text, words: [] }] })),
  }
}

/** A page holding one block whose lines are the strings given. */
function wrapped(...lines: string[]): PageText {
  return {
    blocks: [{ text: lines.join(' '), lines: lines.map((text) => ({ text, words: [] })) }],
  }
}

const OPTIONS = { title: 'Kwitansi', createdAt: '2026-03-04T09:15:00.000Z' }

function partNamed(pages: (PageText | null)[], name: string): string {
  const part = docxParts(pages, OPTIONS).find((entry) => entry.name === name)
  return new TextDecoder().decode(part!.data)
}

const documentXml = (pages: (PageText | null)[]) => partNamed(pages, 'word/document.xml')

describe('docxParts', () => {
  it('packs the four parts an OPC reader needs to open the file', () => {
    const names = docxParts([page('Halo')], OPTIONS).map((entry) => entry.name)

    expect(names).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'docProps/core.xml',
      'word/document.xml',
    ])
  })

  it('writes one paragraph per recognised block', () => {
    const xml = documentXml([page('Baris pertama', 'Baris kedua')])

    expect(xml.match(/<w:p>/g)).toHaveLength(2)
    expect(xml).toContain('<w:t xml:space="preserve">Baris pertama</w:t>')
    expect(xml).toContain('<w:t xml:space="preserve">Baris kedua</w:t>')
  })

  /**
   * A block is ML Kit's idea of a paragraph and its lines are that paragraph
   * wrapped by the width of the page, so joining them gives text that reflows
   * when it is edited — which is the whole point of exporting to Word.
   */
  it('joins the lines inside a block into one paragraph', () => {
    const xml = documentXml([wrapped('Dengan ini kami', 'menyatakan bahwa')])

    expect(xml).toContain('<w:t xml:space="preserve">Dengan ini kami menyatakan bahwa</w:t>')
  })

  it('separates pages with a page break, never one too many', () => {
    const xml = documentXml([page('Satu'), page('Dua'), page('Tiga')])

    expect(xml.match(/<w:br w:type="page"\/>/g)).toHaveLength(2)
  })

  /**
   * A page the recogniser found nothing on still occupies its place in the
   * document. Dropping its break would silently merge it into the page before.
   */
  it('keeps the break for a page that produced no text', () => {
    const xml = documentXml([page('Satu'), null, page('Tiga')])

    expect(xml.match(/<w:br w:type="page"\/>/g)).toHaveLength(2)
    expect(xml.match(/<w:t /g)).toHaveLength(2)
  })

  it('escapes the characters that would otherwise close a tag', () => {
    const xml = documentXml([page('PT Maju & Jaya <utama> "resmi"')])

    expect(xml).toContain('PT Maju &amp; Jaya &lt;utama&gt; &quot;resmi&quot;')
  })

  /**
   * XML 1.0 forbids most C0 controls outright — one stray byte from the
   * recogniser makes Word refuse the file with no useful message.
   */
  it('strips control characters the format cannot carry', () => {
    const xml = documentXml([page('Total\u0000 Rp\u0007 500')])

    expect(xml).toContain('<w:t xml:space="preserve">Total Rp 500</w:t>')
  })

  /**
   * Unlike the invisible PDF layer, which is limited to WinAnsi by the font it
   * draws with, the DOCX body is UTF-8 and keeps whatever the recogniser read.
   */
  it('keeps characters the PDF text layer has to drop', () => {
    const xml = documentXml([page('Total 名前 rupiah')])

    expect(xml).toContain('Total 名前 rupiah')
  })

  it('carries the document title and scan date into the properties', () => {
    const xml = partNamed([page('Halo')], 'docProps/core.xml')

    expect(xml).toContain('<dc:title>Kwitansi</dc:title>')
    expect(xml).toContain('2026-03-04T09:15:00.000Z')
  })

  it('escapes a title that would break the properties part', () => {
    const parts = docxParts([page('Halo')], { ...OPTIONS, title: 'Nota <A&B>' })
    const xml = new TextDecoder().decode(
      parts.find((entry) => entry.name === 'docProps/core.xml')!.data,
    )

    expect(xml).toContain('<dc:title>Nota &lt;A&amp;B&gt;</dc:title>')
  })

  it('refuses a document with nothing recognised on any page', () => {
    expect(() => docxParts([null, null], OPTIONS)).toThrow(/teks/i)
  })
})

describe('buildDocx', () => {
  it('produces a ZIP archive', () => {
    const docx = buildDocx([page('Halo')], OPTIONS)

    expect(Array.from(docx.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])
  })

  /**
   * The timestamp comes from the document, not the clock, so the same document
   * exported twice is the same file — which is the only way anything about it
   * can be compared exactly.
   */
  it('produces identical bytes for the same document', () => {
    expect(buildDocx([page('Halo')], OPTIONS)).toEqual(buildDocx([page('Halo')], OPTIONS))
  })
})
