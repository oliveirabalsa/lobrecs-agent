import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { buildProcessEnvironment, resolveExecutable } from '../process/environment'
import { isImageAttachment, type ImageAttachment } from '../../shared/types'

const execFileAsync = promisify(execFile)

export function resolveCommand(
  envVarName: string,
  fallback: string,
  override?: string,
): string {
  return override?.trim() || process.env[envVarName]?.trim() || resolveExecutable(fallback) || fallback
}

export async function runCommandText(
  command: string,
  args: string[],
  options: { cwd?: string; timeout?: number; maxBuffer?: number } = {},
): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    cwd: options.cwd,
    env: buildProcessEnvironment(),
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
    await execFileAsync(lookupCommand, [command], {
      env: buildProcessEnvironment(),
      timeout: 3000,
    })
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

function formatAttachmentLine(attachment: ImageAttachment): string {
  const name = attachment.name ?? path.basename(attachment.filePath)
  const mimeType = attachment.mimeType ? ` (${attachment.mimeType})` : ''
  const sizeLabel = attachment.size ? ` [${Math.round(attachment.size / 1024)}KB]` : ''

  return `- ${name}${mimeType}${sizeLabel}: ${attachment.filePath}`
}

export function withContextAndImages(
  prompt: string,
  context?: string,
  attachments: ReadonlyArray<ImageAttachment> = [],
): string {
  const basePrompt = withContext(prompt, context)
  if (attachments.length === 0) return basePrompt

  const images = attachments.filter(isImageAttachment)
  const files = attachments.filter((attachment) => !isImageAttachment(attachment))

  const sections: string[] = [basePrompt]

  if (images.length > 0) {
    sections.push(
      `Attached images:\n${images.map(formatAttachmentLine).join('\n')}\n\n` +
        'Use these image attachments as context for the task.',
    )
  }

  if (files.length > 0) {
    sections.push(
      `Attached files:\n${files.map(formatAttachmentLine).join('\n')}\n\n` +
        'Read these files from their paths and use their contents as context for the task.',
    )
  }

  return sections.join('\n\n')
}

function isPathLikeCommand(command: string): boolean {
  return command.includes('/') || command.includes('\\')
}
