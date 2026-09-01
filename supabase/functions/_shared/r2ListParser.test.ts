import { describe, expect, it } from 'vitest'
import { parseListObjectsXml } from './r2ListParser.ts'

const ENVELOPE = (contents: string, truncated = false, token = '') => `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <Name>scanappstorage</Name>
  <Prefix>users/</Prefix>
  <IsTruncated>${truncated}</IsTruncated>
  ${token ? `<NextContinuationToken>${token}</NextContinuationToken>` : ''}
  ${contents}
</ListBucketResult>`

const ONE_OBJECT = `<Contents>
  <Key>users/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.pdf</Key>
  <LastModified>2026-08-30T10:00:00.000Z</LastModified>
  <Size>204800</Size>
</Contents>`

describe('parseListObjectsXml', () => {
  it('parses one object with key, size and lastModified', () => {
    const page = parseListObjectsXml(ENVELOPE(ONE_OBJECT))

    expect(page.objects).toEqual([
      {
        key: 'users/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.pdf',
        size: 204800,
        lastModified: new Date('2026-08-30T10:00:00.000Z'),
      },
    ])
  })

  it('parses every <Contents> entry, not just the first', () => {
    const second = `<Contents>
      <Key>users/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.pdf</Key>
      <LastModified>2026-08-31T00:00:00.000Z</LastModified>
      <Size>1000</Size>
    </Contents>`

    const page = parseListObjectsXml(ENVELOPE(ONE_OBJECT + second))

    expect(page.objects).toHaveLength(2)
    expect(page.objects[1].size).toBe(1000)
  })

  it('reports isTruncated=false and no token for a complete listing', () => {
    const page = parseListObjectsXml(ENVELOPE(ONE_OBJECT))

    expect(page.isTruncated).toBe(false)
    expect(page.nextContinuationToken).toBeNull()
  })

  it('carries the continuation token when the listing is truncated', () => {
    const page = parseListObjectsXml(ENVELOPE(ONE_OBJECT, true, 'abc123=='))

    expect(page.isTruncated).toBe(true)
    expect(page.nextContinuationToken).toBe('abc123==')
  })

  it('returns an empty list for a bucket prefix with nothing in it', () => {
    const page = parseListObjectsXml(ENVELOPE(''))

    expect(page.objects).toEqual([])
  })

  it('skips a Contents block missing a required field rather than crashing', () => {
    const broken = `<Contents>
      <Key>users/x/y.pdf</Key>
      <Size>10</Size>
    </Contents>` // no <LastModified>

    const page = parseListObjectsXml(ENVELOPE(broken + ONE_OBJECT))

    expect(page.objects).toHaveLength(1)
    expect(page.objects[0].size).toBe(204800)
  })
})
