import { app, dialog, ipcMain, shell, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { listAgentModelCatalogs } from '../../agents/application/listAgentModelCatalogs'
import { isSupportedAgentId } from '../../agents/domain/isSupportedAgentId'
import { readMarkdownDocument } from '../application/markdownDocument'
import {
  CLI_EDITOR_TERMINAL_DATA_CHANNEL,
  CLI_EDITOR_TERMINAL_EXIT_CHANNEL,
  type CliEditorTerminalEmitter,
} from '../application/cliEditorTerminal'
import { cliEditorTerminalService } from '../application/cliEditorTerminalService'
import { detectEditors } from '../application/detectEditors'
import { launchEditor } from '../application/launchEditor'
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
  MarkdownDocument,
  OpenInEditorInput,
  ReadMarkdownDocumentInput,
  SaveImageAttachmentInput,
  SupportedAgentId,
} from '../../../../shared/types'

const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export function registerSystemHandlers(context: MainIpcContext): void {
  ipcMain.handle('system:open-editor', async (_event, filePath: string) => {
    await shell.openPath(filePath)
  })
  ipcMain.handle(
    'system:read-markdown-document',
    async (_event, input: ReadMarkdownDocumentInput): Promise<MarkdownDocument> =>
      readMarkdownDocument(input),
  )
  ipcMain.handle('system:select-directory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('system:check-agent', async (_event, agentId: AgentId) => {
    if (!isSupportedAgentId(agentId)) return false
    return context.adapters.get(agentId)?.isInstalled() ?? false
  })
  ipcMain.handle('system:list-agent-models', async () => listAgentModelCatalogs(context))
  ipcMain.handle('system:list-capabilities', async () => listCapabilities(context))
  ipcMain.handle('system:list-verification-recipes', async (_event, projectId?: string) =>
    context.settingsService.getEffective(projectId).settings.verification.recipes,
  )
  ipcMain.handle('system:save-image-attachment', async (_event, input: SaveImageAttachmentInput) =>
    saveImageAttachment(
      input,
      context.settingsService.getGlobal().agents.imageAttachments.maxSizeMb,
    ),
  )
  ipcMain.handle('system:list-editors', async (): Promise<EditorInfo[]> => {
    const editors = await detectEditors()
    return editors.map(({ id, name, kind }) => ({ id, name, kind }))
  })
  ipcMain.handle('system:open-in-editor', async (_event, input: OpenInEditorInput) => {
    await launchEditor(input)
  })
  ipcMain.handle(
    'system:start-cli-editor-terminal',
    async (event, input: CliEditorTerminalStartInput): Promise<CliEditorTerminalSession> => {
      return cliEditorTerminalService.start(input, createCliEditorTerminalEmitter(event.sender))
    },
  )
  ipcMain.handle(
    'system:write-cli-editor-terminal',
    async (_event, input: CliEditorTerminalWriteInput): Promise<void> => {
      cliEditorTerminalService.write(input)
    },
  )
  ipcMain.handle(
    'system:resize-cli-editor-terminal',
    async (_event, input: CliEditorTerminalResizeInput): Promise<void> => {
      cliEditorTerminalService.resize(input)
    },
  )
  ipcMain.handle(
    'system:stop-cli-editor-terminal',
    async (_event, sessionId: string): Promise<void> => {
      cliEditorTerminalService.stop(sessionId)
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

async function saveImageAttachment(
  input: SaveImageAttachmentInput,
  maxSizeMb: number,
): Promise<ImageAttachment> {
  const parsed = parseImageDataUrl(input.dataUrl, input.mimeType)
  const extension = IMAGE_MIME_EXTENSIONS[parsed.mimeType]

  if (!extension) {
    throw new Error('Unsupported image type')
  }

  if (parsed.buffer.length === 0 || parsed.buffer.length > maxSizeMb * 1024 * 1024) {
    throw new Error('Image attachment is too large')
  }

  const dir = path.join(app.getPath('temp'), 'lobrecs-agent', 'attachments')
  const safeName = safeBaseName(input.name) ?? `clipboard-${Date.now()}`
  const filePath = path.join(dir, `${safeName}-${randomUUID()}.${extension}`)

  await mkdir(dir, { recursive: true })
  await writeFile(filePath, parsed.buffer)

  return {
    filePath,
    name: input.name ?? `${safeName}.${extension}`,
    mimeType: parsed.mimeType,
    size: parsed.buffer.length,
  }
}

function parseImageDataUrl(
  dataUrl: string,
  fallbackMimeType?: string,
): { mimeType: string; buffer: Buffer } {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl)

  if (match) {
    return {
      mimeType: match[1].toLowerCase(),
      buffer: Buffer.from(match[2], 'base64'),
    }
  }

  if (!fallbackMimeType?.startsWith('image/')) {
    throw new Error('Invalid image attachment')
  }

  return {
    mimeType: fallbackMimeType.toLowerCase(),
    buffer: Buffer.from(dataUrl, 'base64'),
  }
}

function safeBaseName(name?: string): string | undefined {
  const baseName = path.basename(name ?? '').replace(/\.[a-z0-9]+$/i, '')
  const normalized = baseName.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '')

  return normalized || undefined
}

async function listCapabilities(context: MainIpcContext): Promise<AdapterCapability[]> {
  return Promise.all(
    [...context.adapters.entries()].map(async ([agentId, adapter]) => ({
      agentId,
      name: adapter.name,
      installed: await adapter.isInstalled().catch(() => false),
      ...capabilityFlags(agentId),
    })),
  )
}

function capabilityFlags(
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
