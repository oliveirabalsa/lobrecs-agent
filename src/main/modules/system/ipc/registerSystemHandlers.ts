import { app, clipboard, dialog, ipcMain, nativeImage, shell, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { listAgentModelCatalogs } from '../../agents/application/listAgentModelCatalogs'
import { getAgentProfileDoctorReport } from '../../agents/application/agentProfileService'
import { isSupportedAgentId } from '../../agents/domain/isSupportedAgentId'
import { projectsStore } from '../../../store'
import { readMarkdownDocument } from '../application/markdownDocument'
import { DoctorService } from '../application/doctor'
import {
  CLI_EDITOR_TERMINAL_DATA_CHANNEL,
  CLI_EDITOR_TERMINAL_EXIT_CHANNEL,
  type CliEditorTerminalEmitter,
} from '../application/cliEditorTerminal'
import { cliEditorTerminalService } from '../application/cliEditorTerminalService'
import { detectEditors } from '../application/detectEditors'
import {
  createImageSaveBuffer,
  imageSaveRequiresConversion,
  readImagePreviewSource,
  toImageSaveFileName,
} from '../application/imagePreviewFile'
import { launchEditor } from '../application/launchEditor'
import { listManagedCliRuntimes, runManagedCliAction } from '../application/managedCliRuntimes'
import {
  assertInsideProjectOrTrustedRoots,
  assertKnownProjectRoot,
} from '../application/trustedPaths'
import type { MainIpcContext } from '../../shared/ipcContext'
import type {
  AdapterCapability,
  AgentId,
  CliEditorTerminalResizeInput,
  CliEditorTerminalSession,
  CliEditorTerminalStartInput,
  CliEditorTerminalWriteInput,
  EditorInfo,
  ImageAttachment,
  ImagePreviewSourceInput,
  ManagedCliActionResult,
  ManagedCliStatus,
  MarkdownDocument,
  OpenInEditorInput,
  RunManagedCliActionInput,
  SaveAttachmentInput,
  SupportedAgentId,
} from '../../../../shared/types'
import {
  validateCliEditorTerminalResizeInput,
  validateCliEditorTerminalStartInput,
  validateCliEditorTerminalWriteInput,
  validateOpenEditorPath,
  validateOpenInEditorInput,
  validateReadMarkdownDocumentInput,
  validateSessionId,
} from '../../../../shared/types'

const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export function registerSystemHandlers(context: MainIpcContext): void {
  ipcMain.handle('system:open-editor', async (_event, rawFilePath: unknown) => {
    const filePath = assertInsideProjectOrTrustedRoots(
      validateOpenEditorPath(rawFilePath),
      projectsStore.list(),
      'Files can only be opened from saved project roots or trusted generated output.',
    )
    await shell.openPath(filePath)
  })
  ipcMain.handle(
    'system:read-markdown-document',
    async (_event, rawInput: unknown): Promise<MarkdownDocument> =>
      readMarkdownDocument(validateReadMarkdownDocumentInput(rawInput)),
  )
  ipcMain.handle('system:select-directory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('system:select-background-image', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'] },
      ],
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle(
    'system:load-background-image',
    async (_event, filePath: string): Promise<string | null> => {
      if (!filePath) return null
      try {
        const buffer = await readFile(filePath)
        const ext = path.extname(filePath).toLowerCase().slice(1)
        const mime =
          ext === 'svg' ? 'image/svg+xml'
            : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
            : ext === 'png' ? 'image/png'
            : ext === 'webp' ? 'image/webp'
            : ext === 'gif' ? 'image/gif'
            : ext === 'bmp' ? 'image/bmp'
            : 'application/octet-stream'
        return `data:${mime};base64,${buffer.toString('base64')}`
      } catch {
        return null
      }
    },
  )
  ipcMain.handle('system:check-agent', async (_event, agentId: AgentId) => {
    if (!isSupportedAgentId(agentId)) return false
    return context.adapters.get(agentId)?.isInstalled() ?? false
  })
  ipcMain.handle('system:list-agent-models', async () => listAgentModelCatalogs(context))
  ipcMain.handle('system:list-capabilities', async () => listCapabilities(context))
  ipcMain.handle('system:agent-profile-doctor', async (_event, projectId: string) => {
    const [capabilities, modelCatalogs] = await Promise.all([
      listCapabilities(context),
      listAgentModelCatalogs(context),
    ])
    return getAgentProfileDoctorReport({ projectId, capabilities, modelCatalogs })
  })
  ipcMain.handle('system:run-doctor', async (_event, projectId?: string) => {
    return new DoctorService(context).runDoctor(projectId)
  })
  ipcMain.handle('system:list-verification-recipes', async (_event, projectId?: string) =>
    context.settingsService.getEffective(projectId).settings.verification.recipes,
  )
  ipcMain.handle(
    'system:list-managed-cli-runtimes',
    async (): Promise<ManagedCliStatus[]> => listManagedCliRuntimes(context),
  )
  ipcMain.handle(
    'system:run-managed-cli-action',
    async (_event, input: RunManagedCliActionInput): Promise<ManagedCliActionResult> =>
      runManagedCliAction(context, input),
  )
  ipcMain.handle('system:save-attachment', async (_event, input: SaveAttachmentInput) =>
    saveAttachment(
      input,
      context.settingsService.getGlobal().agents.imageAttachments.maxSizeMb,
    ),
  )
  ipcMain.handle(
    'system:copy-image-to-clipboard',
    async (_event, input: ImagePreviewSourceInput) => {
      const source = await readImagePreviewSource(input.source)
      const image = source.filePath
        ? nativeImage.createFromPath(source.filePath)
        : nativeImage.createFromDataURL(source.source)

      if (image.isEmpty()) {
        throw new Error('Unable to copy this image preview.')
      }

      clipboard.writeImage(image)
    },
  )
  ipcMain.handle('system:save-image-file', async (_event, input: ImagePreviewSourceInput) => {
    const source = await readImagePreviewSource(input.source)
    const result = await dialog.showSaveDialog({
      defaultPath: toImageSaveFileName(input.suggestedName, source.mimeType),
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
      ],
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    const image = imageSaveRequiresConversion(result.filePath)
      ? source.filePath
        ? nativeImage.createFromPath(source.filePath)
        : nativeImage.createFromDataURL(source.source)
      : undefined

    if (image?.isEmpty()) {
      throw new Error('Unable to save this image preview.')
    }

    const buffer = createImageSaveBuffer(source, result.filePath, image)
    await writeFile(result.filePath, buffer)
    return result.filePath
  })
  ipcMain.handle('system:list-editors', async (): Promise<EditorInfo[]> => {
    const editors = await detectEditors()
    return editors.map(({ id, name, kind }) => ({ id, name, kind }))
  })
  ipcMain.handle('system:open-in-editor', async (_event, rawInput: unknown) => {
    const input: OpenInEditorInput = validateOpenInEditorInput(rawInput)
    assertKnownProjectRoot(input.repoPath, projectsStore.list())
    await launchEditor(input)
  })
  ipcMain.handle(
    'system:start-cli-editor-terminal',
    async (event, rawInput: unknown): Promise<CliEditorTerminalSession> => {
      const input: CliEditorTerminalStartInput = validateCliEditorTerminalStartInput(rawInput)
      assertKnownProjectRoot(input.repoPath, projectsStore.list())
      return cliEditorTerminalService.start(input, createCliEditorTerminalEmitter(event.sender))
    },
  )
  ipcMain.handle(
    'system:write-cli-editor-terminal',
    async (_event, rawInput: unknown): Promise<void> => {
      const input: CliEditorTerminalWriteInput = validateCliEditorTerminalWriteInput(rawInput)
      cliEditorTerminalService.write(input)
    },
  )
  ipcMain.handle(
    'system:resize-cli-editor-terminal',
    async (_event, rawInput: unknown): Promise<void> => {
      const input: CliEditorTerminalResizeInput = validateCliEditorTerminalResizeInput(rawInput)
      cliEditorTerminalService.resize(input)
    },
  )
  ipcMain.handle(
    'system:stop-cli-editor-terminal',
    async (_event, rawSessionId: unknown): Promise<void> => {
      cliEditorTerminalService.stop(validateSessionId(rawSessionId))
    },
  )
}

function createCliEditorTerminalEmitter(sender: WebContents): CliEditorTerminalEmitter {
  return (channel, payload) => {
    if (
      channel !== CLI_EDITOR_TERMINAL_DATA_CHANNEL &&
      channel !== CLI_EDITOR_TERMINAL_EXIT_CHANNEL
    ) {
      return
    }

    if (!sender.isDestroyed()) {
      sender.send(channel, payload)
    }
  }
}

/**
 * Copies an arbitrary attachment's bytes into the scratch dir and returns its
 * on-disk path. The agent later reads that path directly, so any file type is
 * supported — images are not special here. The original extension is preserved
 * (derived from the file name, falling back to the MIME type) so downstream
 * tools can sniff the format.
 */
async function saveAttachment(
  input: SaveAttachmentInput,
  maxSizeMb: number,
): Promise<ImageAttachment> {
  const parsed = parseDataUrl(input.dataUrl, input.mimeType)

  if (parsed.buffer.length === 0 || parsed.buffer.length > maxSizeMb * 1024 * 1024) {
    throw new Error(`Attachment is too large (limit ${maxSizeMb}MB)`)
  }

  const extension = attachmentExtension(input.name, parsed.mimeType)
  const dir = path.join(app.getPath('temp'), 'lobrecs-agent', 'attachments')
  const safeName = safeBaseName(input.name) ?? `attachment-${Date.now()}`
  const suffix = extension ? `.${extension}` : ''
  const filePath = path.join(dir, `${safeName}-${randomUUID()}${suffix}`)

  await mkdir(dir, { recursive: true })
  await writeFile(filePath, parsed.buffer)

  return {
    filePath,
    name: input.name ?? `${safeName}${suffix}`,
    mimeType: parsed.mimeType,
    size: parsed.buffer.length,
  }
}

function parseDataUrl(
  dataUrl: string,
  fallbackMimeType?: string,
): { mimeType: string; buffer: Buffer } {
  const match = /^data:([a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9!#$&^_.+-]+)?;base64,(.+)$/i.exec(dataUrl)

  if (match) {
    return {
      mimeType: (match[1] ?? fallbackMimeType ?? 'application/octet-stream').toLowerCase(),
      buffer: Buffer.from(match[2], 'base64'),
    }
  }

  if (!fallbackMimeType) {
    throw new Error('Invalid attachment data')
  }

  return {
    mimeType: fallbackMimeType.toLowerCase(),
    buffer: Buffer.from(dataUrl, 'base64'),
  }
}

/** Prefer the original file's extension; fall back to a known MIME mapping. */
function attachmentExtension(name: string | undefined, mimeType: string): string | undefined {
  const fromName = path.extname(name ?? '').toLowerCase().replace(/^\./, '')
  if (fromName) return fromName
  return IMAGE_MIME_EXTENSIONS[mimeType]
}

function safeBaseName(name?: string): string | undefined {
  const baseName = path.basename(name ?? '').replace(/\.[a-z0-9]+$/i, '')
  const normalized = baseName.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '')

  return normalized || undefined
}

export async function listCapabilities(context: MainIpcContext): Promise<AdapterCapability[]> {
  return Promise.all(
    [...context.adapters.entries()].map(async ([agentId, adapter]) => ({
      agentId,
      name: adapter.name,
      installed: await adapter.isInstalled().catch(() => false),
      ...capabilityFlags(agentId),
    })),
  )
}

export function capabilityFlags(
  agentId: SupportedAgentId,
): Omit<AdapterCapability, 'agentId' | 'name' | 'installed'> {
  if (agentId === 'codex') {
    return {
      supportsStreamingJson: true,
      supportsResume: false,
      supportsFileAttachments: false,
      supportsCustomAgents: false,
      supportsMcp: true,
      supportsApprovalMode: true,
      supportsModelListing: true,
    }
  }

  if (agentId === 'claude-code') {
    return {
      supportsStreamingJson: true,
      supportsResume: true,
      supportsFileAttachments: true,
      supportsCustomAgents: true,
      supportsMcp: true,
      supportsApprovalMode: true,
      supportsModelListing: true,
    }
  }

  if (agentId === 'antigravity') {
    return {
      supportsStreamingJson: false,
      supportsResume: false,
      supportsFileAttachments: false,
      supportsCustomAgents: true,
      supportsMcp: true,
      supportsApprovalMode: true,
      supportsModelListing: false,
    }
  }

  if (agentId === 'cursor') {
    return {
      supportsStreamingJson: true,
      supportsResume: false,
      supportsFileAttachments: false,
      supportsCustomAgents: false,
      supportsMcp: true,
      supportsApprovalMode: true,
      supportsModelListing: false,
    }
  }

  return {
    supportsStreamingJson: true,
    supportsResume: false,
    supportsFileAttachments: false,
    supportsCustomAgents: true,
    supportsMcp: true,
    supportsApprovalMode: false,
    supportsModelListing: true,
  }
}
