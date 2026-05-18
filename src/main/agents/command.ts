import { constants } from 'node:fs'
import fs from 'node:fs'
import { access } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { ImageAttachment } from '../../shared/types'

const execFileAsync = promisify(execFile)

export function resolveCommand(envVarName: string, fallback: string): string {
  return process.env[envVarName]?.trim() || resolveLocalCommand(fallback) || fallback
}

export async function runCommandText(
  command: string,
  args: string[],
  options: { cwd?: string; timeout?: number; maxBuffer?: number } = {},
): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    cwd: options.cwd,
    timeout: options.timeout ?? 5000,
    maxBuffer: options.maxBuffer ?? 1024 * 1024,
  })

  return stdout
}

export async function commandExists(command: string): Promise<boolean> {
  if (!command) return false

  if (isPathLikeCommand(command)) {
    try {
      await access(command, constants.X_OK)
      return true
    } catch {
      return false
    }
  }

  try {
    const lookupCommand = process.platform === 'win32' ? 'where' : 'which'
    await execFileAsync(lookupCommand, [command], { timeout: 3000 })
    return true
  } catch {
    return false
  }
}

export function withContext(prompt: string, context?: string): string {
  const trimmedContext = context?.trim()
  if (!trimmedContext) return prompt

  return `Repository instructions:\n${trimmedContext}\n\nTask:\n${prompt}`
}

export function withContextAndImages(
  prompt: string,
  context?: string,
  imageAttachments: ReadonlyArray<ImageAttachment> = [],
): string {
  const basePrompt = withContext(prompt, context)
  if (imageAttachments.length === 0) return basePrompt

  const imageList = imageAttachments
    .map((image) => {
      const name = image.name ?? path.basename(image.filePath)
      const mimeType = image.mimeType ? ` (${image.mimeType})` : ''
      const sizeLabel = image.size ? ` [${Math.round(image.size / 1024)}KB]` : ''

      return `- ${name}${mimeType}${sizeLabel}: ${image.filePath}`
    })
    .join('\n')

  return `${basePrompt}\n\nAttached images:\n${imageList}\n\nUse these image attachments as context for the task.`
}

function isPathLikeCommand(command: string): boolean {
  return command.includes('/') || command.includes('\\')
}

function resolveLocalCommand(command: string): string | null {
  const home = homedir()
  const candidates = [
    path.join(home, '.local', 'bin', command),
    path.join(home, '.opencode', 'bin', command),
    ...nvmCommandCandidates(command),
  ]

  return candidates.find((candidate) => isExecutable(candidate)) ?? null
}

function nvmCommandCandidates(command: string): string[] {
  const nvmVersionsPath = path.join(homedir(), '.nvm', 'versions', 'node')

  try {
    return fs
      .readdirSync(nvmVersionsPath)
      .sort()
      .reverse()
      .map((version) => path.join(nvmVersionsPath, version, 'bin', command))
  } catch {
    return []
  }
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}
