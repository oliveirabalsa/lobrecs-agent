import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { detectEditors, type EditorInfo } from './detectEditors'

const execFileAsync = promisify(execFile)

export interface LaunchEditorInput {
  editorId: string
  repoPath: string
}

export class EditorNotFoundError extends Error {
  constructor(editorId: string) {
    super(`Editor not found: ${editorId}`)
    this.name = 'EditorNotFoundError'
  }
}

export class UnsupportedPlatformError extends Error {
  constructor() {
    super('Editor launching is currently only supported on macOS')
    this.name = 'UnsupportedPlatformError'
  }
}

/**
 * Opens `repoPath` in the editor identified by `editorId`. macOS only.
 * GUI editors are launched via `open -a "<AppName>" <repoPath>`.
 * CLI editors are handled by the in-app terminal API so the renderer can own
 * the chat-area xterm surface and keyboard input.
 */
export async function launchEditor(input: LaunchEditorInput): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new UnsupportedPlatformError()
  }

  const editors = await detectEditors()
  const editor = editors.find((entry) => entry.id === input.editorId)
  if (!editor) throw new EditorNotFoundError(input.editorId)

  const absoluteRepoPath = path.resolve(input.repoPath)

  if (editor.kind === 'gui') {
    await launchGuiEditor(editor, absoluteRepoPath)
    return
  }

  await launchCliEditor(editor, absoluteRepoPath)
}

async function launchGuiEditor(editor: EditorInfo, repoPath: string): Promise<void> {
  await execFileAsync('/usr/bin/open', ['-a', editor.target, repoPath], {
    timeout: 5000,
  })
}

async function launchCliEditor(editor: EditorInfo, _repoPath: string): Promise<void> {
  throw new Error(
    `CLI editor ${editor.target} opens through the in-app terminal. ` +
      `Use system:start-cli-editor-terminal instead.`,
  )
}
