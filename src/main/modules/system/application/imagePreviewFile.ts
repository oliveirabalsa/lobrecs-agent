import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export interface ImagePreviewSource {
  source: string
  buffer: Buffer
  mimeType?: string
  filePath?: string
}

export async function readImagePreviewSource(source: string): Promise<ImagePreviewSource> {
  if (!source.trim()) {
    throw new Error('Image preview source is required.')
  }

  const dataUrl = parseImageDataUrl(source)
  if (dataUrl) {
    return {
      source,
      ...dataUrl,
    }
  }

  const filePath = imageFilePathFromSource(source)
  const buffer = await readFile(filePath)

  return {
    source,
    filePath,
    buffer,
    mimeType: mimeTypeFromPath(filePath),
  }
}

export function createImageSaveBuffer(
  source: ImagePreviewSource,
  targetPath: string,
  converted?: { toPNG(): Buffer; toJPEG(quality: number): Buffer },
): Buffer {
  const targetExtension = path.extname(targetPath).toLowerCase()

  if (targetExtension === '.jpg' || targetExtension === '.jpeg') {
    if (!converted) throw new Error('Unable to convert this image preview.')
    return converted.toJPEG(90)
  }

  if (targetExtension === '.png' || targetExtension === '') {
    if (!converted) throw new Error('Unable to convert this image preview.')
    return converted.toPNG()
  }

  const sourceExtension = source.mimeType ? IMAGE_MIME_EXTENSIONS[source.mimeType] : undefined
  if (sourceExtension && targetExtension === `.${sourceExtension}`) {
    return source.buffer
  }

  throw new Error('This image can only be saved as PNG or JPEG.')
}

export function imageSaveRequiresConversion(targetPath: string): boolean {
  const targetExtension = path.extname(targetPath).toLowerCase()
  return (
    targetExtension === '.jpg' ||
    targetExtension === '.jpeg' ||
    targetExtension === '.png' ||
    targetExtension === ''
  )
}

export function toImageSaveFileName(name: string | undefined, mimeType?: string): string {
  const baseName = safeBaseName(name) ?? 'image'
  const extension = mimeType ? IMAGE_MIME_EXTENSIONS[mimeType] : undefined

  return `${baseName}.${extension ?? 'png'}`
}

function parseImageDataUrl(source: string): { mimeType: string; buffer: Buffer } | null {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(source)
  if (!match) return null

  return {
    mimeType: match[1].toLowerCase(),
    buffer: Buffer.from(match[2], 'base64'),
  }
}

function imageFilePathFromSource(source: string): string {
  try {
    const url = new URL(source)
    if (url.protocol !== 'file:') {
      throw new Error('Image preview can only save local image sources.')
    }
    return fileURLToPath(url)
  } catch (error) {
    if (error instanceof Error && error.message.includes('local image sources')) {
      throw error
    }
    throw new Error('Image preview source must be a data URL or local file URL.')
  }
}

function mimeTypeFromPath(filePath: string): string | undefined {
  const extension = path.extname(filePath).toLowerCase()

  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.gif') return 'image/gif'
  return undefined
}

function safeBaseName(name?: string): string | undefined {
  const baseName = path.basename(name ?? '').replace(/\.[a-z0-9]+$/i, '')
  const normalized = baseName.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '')

  return normalized || undefined
}
