import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { RepositoryFileSnapshot } from '../domain/chunking'

const MAX_FILE_BYTES = 220 * 1024
const MAX_FILES = 2_500

const IGNORED_DIRECTORIES = new Set([
  '.cache',
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'release',
  'tmp',
])

const INDEXED_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.prisma',
  '.sql',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
])

const INDEXED_FILENAMES = new Set([
  '.env.example',
  '.gitignore',
  'AGENTS.md',
  'Dockerfile',
  'Makefile',
  'README',
  'README.md',
])

export interface RepositoryScanResult {
  files: RepositoryFileSnapshot[]
  skippedFiles: number
}

export async function scanRepository(repoPath: string): Promise<RepositoryScanResult> {
  const root = path.resolve(repoPath)
  const files: RepositoryFileSnapshot[] = []
  let skippedFiles = 0

  async function visit(directory: string): Promise<void> {
    if (files.length >= MAX_FILES) return

    const entries = await fs.readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      if (files.length >= MAX_FILES) break

      const absolutePath = path.join(directory, entry.name)
      const relativePath = path.relative(root, absolutePath)

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue
        await visit(absolutePath)
        continue
      }

      if (!entry.isFile() || !shouldIndexFile(entry.name)) {
        skippedFiles += 1
        continue
      }

      try {
        const stat = await fs.stat(absolutePath)
        if (stat.size <= 0 || stat.size > MAX_FILE_BYTES) {
          skippedFiles += 1
          continue
        }

        const content = await fs.readFile(absolutePath, 'utf8')
        if (looksBinary(content)) {
          skippedFiles += 1
          continue
        }

        files.push({ path: relativePath, content })
      } catch {
        skippedFiles += 1
      }
    }
  }

  await visit(root)
  return { files, skippedFiles }
}

function shouldIndexFile(fileName: string): boolean {
  return INDEXED_FILENAMES.has(fileName) || INDEXED_EXTENSIONS.has(path.extname(fileName))
}

function looksBinary(content: string): boolean {
  return content.includes('\u0000')
}
