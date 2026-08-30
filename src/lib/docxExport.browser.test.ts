import { describe, expect, it } from 'vitest'
import { docxParts } from './docxExport'
import type { PageText } from './ocrLayout'

/**
 * The escaping tests in the node suite check what the strings look like; these
 * check that a real XML parser accepts them. Hand-built markup is exactly the
 * kind of thing that reads fine and still fails to parse, and Word reports
 * that as "the file is corrupt" without saying which part or which byte.
 */

function page(...blocks: string[]): PageText {
  return { blocks: blocks.map((text) => ({ text, lines: [{ text, words: [] }] })) }
}

const OPTIONS = { title: 'Kwitansi', createdAt: '2026-03-04T09:15:00.000Z' }

function parsePart(pages: (PageText | null)[], name: string, options = OPTIONS): Document {
  const part = docxParts(pages, options).find((entry) => entry.name === name)!
  return new DOMParser().parseFromString(new TextDecoder().decode(part.data), 'application/xml')
}

/** DOMParser reports a failure as a document containing a parsererror node. */
function parseError(doc: Document): string | null {
  return doc.querySelector('parsererror')?.textContent ?? null
}

describe('docx parts, through a real XML parser', () => {
  it.each([
    '[Content_Types].xml',
    '_rels/.rels',
    'word/_rels/document.xml.rels',
    'docProps/core.xml',
    'word/document.xml',
    'word/styles.xml',
  ])('parses %s', (name) => {
    expect(parseError(parsePart([page('Halo')], name))).toBeNull()
  })

  it('reads the paragraphs back in the order they were written', () => {
    const doc = parsePart([page('Satu', 'Dua')], 'word/document.xml')
    const texts = [...doc.getElementsByTagName('w:t')].map((node) => node.textContent)

    expect(texts).toEqual(['Satu', 'Dua'])
  })

  it('survives text that is nothing but markup characters', () => {
    const doc = parsePart([page('<w:p>&</w:p>')], 'word/document.xml')

    expect(parseError(doc)).toBeNull()
    // Read back as text, not as elements: the point is that it stayed data.
    expect(doc.getElementsByTagName('w:t')[0].textContent).toBe('<w:p>&</w:p>')
    expect(doc.getElementsByTagName('w:p')).toHaveLength(1)
  })

  it('survives a title made of markup characters', () => {
    const doc = parsePart([page('Halo')], 'docProps/core.xml', {
      ...OPTIONS,
      title: 'Nota <A&B> "2026"',
    })

    expect(parseError(doc)).toBeNull()
    expect(doc.getElementsByTagName('dc:title')[0].textContent).toBe('Nota <A&B> "2026"')
  })

  it('carries non-Latin text through unchanged', () => {
    const doc = parsePart([page('Total 名前 rupiah')], 'word/document.xml')

    expect(parseError(doc)).toBeNull()
    expect(doc.getElementsByTagName('w:t')[0].textContent).toBe('Total 名前 rupiah')
  })
})
