import { DiffEditor } from '@monaco-editor/react'
import * as Dialog from '@radix-ui/react-dialog'
import type { DiffProposal } from '../../../../../shared/types'
import {
  DRACULA_THEME_NAME,
  languageFromPath,
  registerDraculaTheme,
} from '../../../../lib/monaco'
import { AnimatedDiffStat } from './AnimatedDiffStat'

export interface FileDiffModalProps {
  /**
   * The file to visualize. `null` keeps the modal closed — the modal is a
   * controlled Radix dialog driven entirely by this prop.
   */
  proposal: DiffProposal | null
  additions: number
  deletions: number
  onClose: () => void
  /** Optional escape hatch back to the user's external editor. */
  onOpenInEditor?: (filePath: string) => void
}

function fileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).at(-1) ?? filePath
}

/**
 * FileDiffModal — full-screen code visualizer for a single edited file.
 *
 * Renders the before/after diff with Monaco's `<DiffEditor>` under the Dracula
 * theme. Opened from a file row in `<EditedFilesCard>`; the docked
 * `<DiffViewer>` panel stays the multi-file review surface.
 */
export function FileDiffModal({
  proposal,
  additions,
  deletions,
  onClose,
  onOpenInEditor,
}: FileDiffModalProps) {
  return (
    <Dialog.Root
      open={proposal !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col overflow-hidden rounded-card border border-hairline shadow-2xl shadow-black/60 outline-none"
          style={{ background: '#282a36' }}
        >
          {proposal ? (
            <>
              <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-2.5">
                <span className="inline-flex shrink-0 text-[#bd93f9]" aria-hidden="true">
                  {iconCode}
                </span>
                <div className="min-w-0 flex-1">
                  <Dialog.Title className="truncate text-sm font-medium text-[#f8f8f2]">
                    {fileName(proposal.filePath)}
                  </Dialog.Title>
                  <div
                    className="truncate font-mono text-[11px] text-[#6272a4]"
                    dir="rtl"
                    title={proposal.filePath}
                  >
                    {proposal.filePath}
                  </div>
                </div>
                <AnimatedDiffStat
                  additions={additions}
                  deletions={deletions}
                  className="shrink-0 text-xs"
                />
                {onOpenInEditor ? (
                  <button
                    type="button"
                    onClick={() => onOpenInEditor(proposal.filePath)}
                    className="shrink-0 rounded p-1 text-[#6272a4] transition-colors hover:bg-white/10 hover:text-[#f8f8f2]"
                    title="Open in editor"
                  >
                    {iconExternalLink}
                  </button>
                ) : null}
                <Dialog.Close
                  className="shrink-0 rounded p-1 text-[#6272a4] transition-colors hover:bg-white/10 hover:text-[#f8f8f2]"
                  aria-label="Close"
                >
                  {iconClose}
                </Dialog.Close>
              </header>

              <div className="min-h-0 flex-1 overflow-hidden">
                <DiffEditor
                  key={proposal.filePath}
                  height="100%"
                  theme={DRACULA_THEME_NAME}
                  beforeMount={registerDraculaTheme}
                  original={proposal.originalContent || ''}
                  modified={proposal.proposedContent || ''}
                  language={languageFromPath(proposal.filePath)}
                  options={{
                    readOnly: true,
                    originalEditable: false,
                    renderSideBySide: true,
                    minimap: { enabled: true },
                    fontSize: 13,
                    lineHeight: 20,
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                  }}
                />
              </div>
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

const iconCode = (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="m5.5 5-3 3 3 3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="m10.5 5 3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const iconExternalLink = (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M6.5 3.5H3a1 1 0 0 0-1 1v8.5a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1V10" strokeLinecap="round" />
    <path d="M9.5 2.5h4v4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M13.5 2.5 8 8" strokeLinecap="round" />
  </svg>
)

const iconClose = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="m4 4 8 8M12 4l-8 8" strokeLinecap="round" />
  </svg>
)
