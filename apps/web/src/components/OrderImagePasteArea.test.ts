import { describe, expect, it } from 'vitest'
import { collectClipboardImageFiles, limitOrderImageBatch, validOrderImage } from './OrderImagePasteArea'

function clipboard(files: File[], text = '') {
  return {
    items: [
      ...files.map(file => ({ kind: 'file' as const, type: file.type, getAsFile: () => file })),
      ...(text ? [{ kind: 'string' as const, type: 'text/plain', getAsFile: () => null }] : []),
    ],
    files,
  }
}

describe('collectClipboardImageFiles', () => {
  it('accepts multiple supported images and ignores text', () => {
    const images = [
      new File(['png'], 'one.png', { type: 'image/png' }),
      new File(['jpeg'], 'two.jpg', { type: 'image/jpeg' }),
      new File(['webp'], 'three.webp', { type: 'image/webp' }),
    ]
    const result = collectClipboardImageFiles(clipboard(images, 'copied text'), new Date(2026, 9, 13, 1, 19, 0))
    expect(result.files.map(file => file.name)).toEqual(['one.png', 'two.jpg', 'three.webp'])
    expect(result.unsupported).toBe(false)
  })

  it('removes duplicate clipboard items and files using name, size, and modified time', () => {
    const image = new File(['same'], 'same.png', { type: 'image/png', lastModified: 123 })
    const result = collectClipboardImageFiles(clipboard([image]), new Date())
    expect(result.files).toHaveLength(1)
  })

  it('names unnamed clipboard images with a timestamp and safe extension', () => {
    const image = new File(['png'], '', { type: 'image/png', lastModified: 123 })
    const result = collectClipboardImageFiles(clipboard([image]), new Date(2026, 9, 13, 1, 19, 0))
    expect(result.files[0].name).toBe('clipboard-20261013-011900-1.png')
  })

  it('reports unsupported image types while skipping non-image clipboard content', () => {
    const unsupportedImage = new File(['gif'], 'motion.gif', { type: 'image/gif' })
    const pdf = new File(['pdf'], 'document.pdf', { type: 'application/pdf' })
    const result = collectClipboardImageFiles(clipboard([unsupportedImage, pdf], 'text'), new Date())
    expect(result.files).toEqual([])
    expect(result.unsupported).toBe(true)
  })

  it('validates clipboard and file uploads against supported types and size limits', () => {
    expect(validOrderImage(new File(['png'], 'paste.png', { type: 'image/png' }))).toBe(true)
    expect(validOrderImage(new File(['webp'], 'paste.webp', { type: 'image/webp' }))).toBe(true)
    expect(validOrderImage(new File(['pdf'], 'not-image.pdf', { type: 'application/pdf' }))).toBe(false)
    expect(validOrderImage(new File([], 'empty.jpg', { type: 'image/jpeg' }))).toBe(false)
    expect(validOrderImage(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.jpg', { type: 'image/jpeg' }))).toBe(false)
  })

  it('caps combined file and clipboard batches at twenty pending images', () => {
    const files = Array.from({ length: 5 }, (_, index) => new File(['png'], `${index}.png`, { type: 'image/png' }))
    const result = limitOrderImageBatch(files, 18)
    expect(result.accepted).toHaveLength(2)
    expect(result.overLimit).toBe(true)
    expect(result.invalid).toBe(false)
  })
})
