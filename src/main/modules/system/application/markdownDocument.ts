import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  MarkdownDocument,
  ReadMarkdownDocumentInput,
} from '../../../../shared/contracts/system'

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

  try {
    const url = new URL(href)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return { kind: 'remote', url }
    }
    if (url.protocol === 'file:') {
      return {
        kind: 'file',
        filePath: ensureInsideRepo(fileURLToPath(url), input.repoPath),
      }
    }
  } catch {
    // Continue below for absolute and repo-relative filesystem paths.
  }

  const pathLike = decodePath(stripQueryAndHash(href))
  const filePath = path.isAbsolute(pathLike)
    ? pathLike
    : resolveRelativeMarkdownPath(pathLike, input.repoPath)

  return {
    kind: 'file',
    filePath: ensureInsideRepo(filePath, input.repoPath),
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

function ensureInsideRepo(filePath: string, repoPath?: string): string {
  if (!repoPath) return path.resolve(filePath)

  const root = path.resolve(repoPath)
  const resolved = path.resolve(filePath)
  const relative = path.relative(root, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Markdown preview can only open files inside the selected project.')
  }
  return resolved
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
