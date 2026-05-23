import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function readTextFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return ''
    throw error
  }
}

export async function writeTextFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
}

export async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
  const content = await readTextFile(filePath)
  if (!content.trim()) return {}

  try {
    const parsed = JSON.parse(stripJsonComments(content)) as unknown
    return isRecord(parsed) ? parsed : {}
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid JSON'
    throw new Error(`Cannot parse ${filePath}: ${message}`)
  }
}

export async function writeJsonObject(
  filePath: string,
  value: Record<string, unknown>,
): Promise<void> {
  await writeTextFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stripJsonComments(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
