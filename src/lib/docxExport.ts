import type { PageText } from './ocrLayout'
import { buildZip, type ZipEntry } from './zipWriter'

/**
 * Exporting recognised text as an editable Word document.
 *
 * Text only, by decision (Boss Ali, 25 Agustus 2026): "ubah scan jadi Word"
 * means paragraphs someone can edit, and anyone who wants the scan itself
 * already has the PDF. Embedding the page images as well would make the file
 * as large as the PDF and leave the document carrying two copies of its own
 * contents that can drift apart.
 *
 * The container is written by hand — see `zipWriter` for why there is no zip
 * dependency. What is produced here is the smallest package Word will open:
 * the content types, the package relationships, the body, and the core
 * properties that carry the title and the scan date.
 */

export interface DocxOptions {
  title: string
  /** ISO string; becomes the document's creation date. */
  createdAt: string
}

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

/**
 * Escapes text for an XML node, and drops what XML 1.0 cannot carry at all.
 *
 * The control characters are not politeness: a single one of them makes the
 * whole part unparseable, and Word reports that as a corrupt file without ever
 * saying which byte it choked on. Tab, newline and carriage return are legal
 * and survive; every other C0 control goes.
 */
function escapeXml(text: string): string {
  let out = ''
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) continue

    if (character === '&') out += '&amp;'
    else if (character === '<') out += '&lt;'
    else if (character === '>') out += '&gt;'
    else if (character === '"') out += '&quot;'
    else out += character
  }
  return out
}

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

const contentTypes = `${XML_DECLARATION}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`

const packageRels = `${XML_DECLARATION}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`

function coreProperties(options: DocxOptions): string {
  const created = escapeXml(options.createdAt)
  return `${XML_DECLARATION}
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${escapeXml(options.title)}</dc:title>
<dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified>
</cp:coreProperties>`
}

/**
 * One paragraph per recognised block, its lines joined by a space.
 *
 * A block is the recogniser's idea of a paragraph and its lines are that
 * paragraph wrapped to the width of the page, so joining them is what lets the
 * text reflow when it is edited. The known trade-off: on a receipt or a form,
 * where each line is its own item, joining reads worse than keeping the lines
 * apart. Which way is better cannot be settled without looking at real
 * Indonesian documents, so it is on the device checklist rather than guessed
 * at here — and it is one line to change.
 */
function paragraphs(text: PageText): string {
  return text.blocks
    .map((block) => {
      const body = block.lines
        .map((line) => line.text.trim())
        .filter((line) => line !== '')
        .join(' ')
      return body === ''
        ? ''
        : `<w:p><w:r><w:t xml:space="preserve">${escapeXml(body)}</w:t></w:r></w:p>`
    })
    .filter((paragraph) => paragraph !== '')
    .join('')
}

const PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'

function documentBody(pages: readonly (PageText | null)[]): string {
  // A page with nothing on it still takes its place: dropping its break would
  // silently run it into the page before, and the page numbering the reader
  // sees would no longer match the document that was scanned.
  const body = pages
    .map((page) => (page ? paragraphs(page) : ''))
    .join(PAGE_BREAK)

  return `${XML_DECLARATION}
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body}</w:body>
</w:document>`
}

/**
 * The parts of the package, in the order they are stored.
 *
 * Separate from `buildDocx` so the contents can be read straight out in tests
 * without unpacking an archive — a test that had to use our own reader to
 * check our own writer would only prove the two agree.
 */
export function docxParts(
  pages: readonly (PageText | null)[],
  options: DocxOptions,
): ZipEntry[] {
  const hasText = pages.some((page) => page && page.blocks.length > 0)
  if (!hasText) {
    throw new Error('Belum ada teks yang dikenali di dokumen ini.')
  }

  return [
    { name: '[Content_Types].xml', data: utf8(contentTypes) },
    { name: '_rels/.rels', data: utf8(packageRels) },
    { name: 'docProps/core.xml', data: utf8(coreProperties(options)) },
    { name: 'word/document.xml', data: utf8(documentBody(pages)) },
  ]
}

/** Packs the parts into the .docx file itself. */
export function buildDocx(
  pages: readonly (PageText | null)[],
  options: DocxOptions,
): Uint8Array {
  // The scan's own date, not the clock: the same document exported twice
  // produces the same bytes, which is what makes the result testable at all.
  const stamped = new Date(options.createdAt)
  const modified = Number.isNaN(stamped.getTime()) ? new Date(0) : stamped

  return buildZip(docxParts(pages, options), modified)
}
