import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  MarkdownDocument,
  ReadMarkdownDocumentInput,
} from '../../../../shared/contracts/system'
import {
  isPathInside,
  isTrustedGeneratedMarkdownPath,
} from './trustedPaths'

export { isTrustedGeneratedMarkdownPath } from './trustedPaths'

const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024
const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx', '.markdown'])

type MarkdownLocation =
  | { kind: 'file'; filePath: string }
  | { kind: 'remote'; url: URL }

export async function readMarkdownDocument(
  input: ReadMarkdownDocumentInput,
): Promise<MarkdownDocument> {
  const location = parseMarkdownLocation(input)

  if (location.kind === 'remote') {
    return readRemoteMarkdown(location.url)
  }

  return readLocalMarkdown(location.filePath)
}

export function isMarkdownDocumentHref(href: string): boolean {
  const trimmed = href.trim()
  if (!trimmed) return false

  try {
    const url = new URL(trimmed)
    if (url.protocol === 'file:' || url.protocol === 'http:' || url.protocol === 'https:') {
      return hasMarkdownExtension(url.pathname)
    }
    return false
  } catch {
    return hasMarkdownExtension(stripQueryAndHash(trimmed))
  }
}

function parseMarkdownLocation(input: ReadMarkdownDocumentInput): MarkdownLocation {
  const href = input.href.trim()
  if (!isMarkdownDocumentHref(href)) {
    throw new Error('Only Markdown documents can be previewed.')
  }

  const url = parseUrl(href)
  if (url) {
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      ensureSafeRemoteMarkdownUrl(url)
      return { kind: 'remote', url }
    }
    if (url.protocol === 'file:') {
      return {
        kind: 'file',
        filePath: ensureAllowedLocalMarkdownPath(fileURLToPath(url), input.repoPath),
      }
    }
  }

  const pathLike = decodePath(stripQueryAndHash(href))
  const filePath = path.isAbsolute(pathLike)
    ? pathLike
    : resolveRelativeMarkdownPath(pathLike, input.repoPath)

  return {
    kind: 'file',
    filePath: ensureAllowedLocalMarkdownPath(filePath, input.repoPath),
  }
}

async function readLocalMarkdown(filePath: string): Promise<MarkdownDocument> {
  const info = await stat(filePath)
  if (!info.isFile()) throw new Error('Markdown preview target is not a file.')
  if (info.size > MAX_MARKDOWN_BYTES) {
    throw new Error('Markdown document is too large to preview.')
  }

  const content = await readFile(filePath, 'utf8')
  return {
    title: path.basename(filePath),
    content,
    suggestedFileName: markdownFileName(path.basename(filePath)),
    size: Buffer.byteLength(content),
    sourcePath: filePath,
  }
}

async function readRemoteMarkdown(url: URL): Promise<MarkdownDocument> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
    })
    if (!response.ok) {
      throw new Error(`Could not load Markdown document (${response.status}).`)
    }

    const length = Number(response.headers.get('content-length') ?? 0)
    if (length > MAX_MARKDOWN_BYTES) {
      throw new Error('Markdown document is too large to preview.')
    }

    const content = await response.text()
    const size = Buffer.byteLength(content)
    if (size > MAX_MARKDOWN_BYTES) {
      throw new Error('Markdown document is too large to preview.')
    }

    const title = decodePath(path.basename(url.pathname)) || 'Markdown preview'
    return {
      title,
      content,
      suggestedFileName: markdownFileName(title),
      size,
      sourceUrl: url.toString(),
    }
  } finally {
    clearTimeout(timeout)
  }
}

function resolveRelativeMarkdownPath(pathLike: string, repoPath?: string): string {
  if (!repoPath) throw new Error('Relative Markdown links require a selected project.')
  return path.resolve(repoPath, pathLike)
}

function ensureAllowedLocalMarkdownPath(filePath: string, repoPath?: string): string {
  if (!repoPath) {
    if (isTrustedGeneratedMarkdownPath(filePath)) {
      return path.resolve(filePath)
    }

    throw new Error('Markdown preview requires a selected project.')
  }

  if (isInsideRepo(filePath, repoPath) || isTrustedGeneratedMarkdownPath(filePath)) {
    return path.resolve(filePath)
  }

  throw new Error('Markdown preview can only open files inside the selected project.')
}

function isInsideRepo(filePath: string, repoPath: string): boolean {
  return isPathInside(path.resolve(repoPath), path.resolve(filePath))
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function ensureSafeRemoteMarkdownUrl(url: URL): void {
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const isIpv6 = hostname.includes(':')
  if (
    url.username ||
    url.password ||
    hostname === 'localhost' ||
    hostname === '0.0.0.0' ||
    hostname === '::1' ||
    (isIpv6 && /^f[cd][0-9a-f:]*$/i.test(hostname)) ||
    (isIpv6 && /^fe80[:]/i.test(hostname)) ||
    hostname.startsWith('127.') ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    hostname.startsWith('169.254.')
  ) {
    throw new Error('Remote Markdown preview cannot load local network URLs.')
  }
}

function hasMarkdownExtension(pathname: string): boolean {
  return MARKDOWN_EXTENSIONS.has(path.extname(pathname).toLowerCase())
}

function stripQueryAndHash(value: string): string {
  return value.split(/[?#]/, 1)[0] ?? value
}

function decodePath(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function markdownFileName(name: string): string {
  const fallback = 'markdown-preview.md'
  const safe = path
    .basename(name || fallback)
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')

  if (!safe) return fallback
  return hasMarkdownExtension(safe) ? safe : `${safe}.md`
}
