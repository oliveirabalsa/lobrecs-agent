import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { isPathInside } from './trustedPaths'

const MAX_BACKGROUND_IMAGE_BYTES = 20 * 1024 * 1024

const BACKGROUND_IMAGE_MIME_BY_EXTENSION = new Map([
  ['.svg', 'image/svg+xml'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.bmp', 'image/bmp'],
])

export class BackgroundImageAccess {
  private readonly root: string

  constructor(userDataPath: string) {
    this.root = path.join(userDataPath, 'background-images')
  }

  async allowSelected(filePath: string): Promise<string> {
    const sourcePath = path.resolve(filePath)
    const mime = backgroundImageMimeType(sourcePath)
    if (!mime) {
      throw new Error('Only image files can be selected as background images.')
    }

    const info = await stat(sourcePath)
    if (!info.isFile()) {
      throw new Error('Background image source must be a file.')
    }
    if (info.size > MAX_BACKGROUND_IMAGE_BYTES) {
      throw new Error('Background image is too large.')
    }

    await mkdir(this.root, { recursive: true })
    const targetPath = path.join(
      this.root,
      `${safeBaseName(path.basename(sourcePath))}-${randomUUID()}${path.extname(sourcePath).toLowerCase()}`,
    )
    await copyFile(sourcePath, targetPath)
    return targetPath
  }

  assertAllowed(filePath: string): string {
    const resolved = path.resolve(filePath)
    if (!isPathInside(this.root, resolved)) {
      throw new Error('Background images can only be loaded from app-managed storage.')
    }
    if (!backgroundImageMimeType(resolved)) {
      throw new Error('Only image files can be loaded as background images.')
    }
    return resolved
  }

  dataUrl(filePath: string, buffer: Buffer): string {
    const mime = backgroundImageMimeType(filePath)
    if (!mime) {
      throw new Error('Only image files can be loaded as background images.')
    }
    return `data:${mime};base64,${buffer.toString('base64')}`
  }
}

function backgroundImageMimeType(filePath: string): string | undefined {
  return BACKGROUND_IMAGE_MIME_BY_EXTENSION.get(path.extname(filePath).toLowerCase())
}

function safeBaseName(name: string): string {
  const baseName = path.basename(name).replace(/\.[a-z0-9]+$/i, '')
  const normalized = baseName.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '')
  return normalized || 'background'
}
