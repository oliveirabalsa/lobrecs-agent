import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createImageSaveBuffer,
  readImagePreviewSource,
  toImageSaveFileName,
  type ImagePreviewSource,
} from './imagePreviewFile'

let tempDir: string | undefined

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = undefined
  }
})

describe('image preview file helpers', () => {
  it('reads a base64 image data URL', async () => {
    const source = await readImagePreviewSource('data:image/png;base64,aGVsbG8=')

    expect(source.mimeType).toBe('image/png')
    expect(source.buffer.toString('utf8')).toBe('hello')
    expect(source.filePath).toBeUndefined()
  })

  it('reads a local file URL', async () => {
    await mkdir(path.join(os.tmpdir(), 'lobrecs-agent'), { recursive: true })
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'lobrecs-agent', 'image-preview-'))
    const filePath = path.join(tempDir, 'screen shot.png')
    await writeFile(filePath, Buffer.from('image-bytes'))

    const source = await readImagePreviewSource(pathToFileURL(filePath).toString())

    expect(source.filePath).toBe(filePath)
    expect(source.mimeType).toBe('image/png')
    expect(source.buffer.toString('utf8')).toBe('image-bytes')
  })

  it('rejects remote image URLs', async () => {
    await expect(readImagePreviewSource('https://example.com/image.png')).rejects.toThrow(
      'local image sources',
    )
  })

  it('rejects local file URLs outside app-managed or trusted generated roots', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'lobrecs-image-preview-'))
    const filePath = path.join(tempDir, 'screen shot.png')
    await writeFile(filePath, Buffer.from('image-bytes'))

    await expect(readImagePreviewSource(pathToFileURL(filePath).toString())).rejects.toThrow(
      'app-managed or trusted generated',
    )
  })

  it('uses converted bytes for PNG and JPEG save targets', () => {
    const source = previewSource('image/png', 'original')
    const converted = {
      toPNG: vi.fn(() => Buffer.from('png')),
      toJPEG: vi.fn(() => Buffer.from('jpeg')),
    }

    expect(createImageSaveBuffer(source, '/tmp/output.png', converted).toString()).toBe('png')
    expect(createImageSaveBuffer(source, '/tmp/output.jpg', converted).toString()).toBe('jpeg')
  })

  it('preserves original bytes for matching non-convertible targets', () => {
    const source = previewSource('image/webp', 'webp-original')
    const converted = {
      toPNG: vi.fn(() => Buffer.from('png')),
      toJPEG: vi.fn(() => Buffer.from('jpeg')),
    }

    expect(createImageSaveBuffer(source, '/tmp/output.webp', converted).toString()).toBe(
      'webp-original',
    )
    expect(() => createImageSaveBuffer(source, '/tmp/output.gif', converted)).toThrow(
      'PNG or JPEG',
    )
  })

  it('creates safe default save names', () => {
    expect(toImageSaveFileName('Screenshot 1.png', 'image/png')).toBe('Screenshot-1.png')
    expect(toImageSaveFileName('../../bad/name', undefined)).toBe('name.png')
  })
})

function previewSource(mimeType: string, content: string): ImagePreviewSource {
  return {
    source: 'preview',
    mimeType,
    buffer: Buffer.from(content),
  }
}
