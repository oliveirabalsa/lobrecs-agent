import { DiffEditor, type DiffOnMount, type MonacoDiffEditor } from '@monaco-editor/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DiffProposal } from '../../../shared/types'

interface Props {
  proposals: DiffProposal[]
  onApprove: (filePath: string) => void
  onReject: (filePath: string) => void
  onEditAndApprove: (filePath: string, newContent: string) => void
}

function fileName(filePath: string) {
  const normalized = filePath.replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).at(-1) ?? filePath
}

function languageFromPath(filePath: string) {
  const extension = filePath.split('.').at(-1)?.toLowerCase()

  switch (extension) {
    case 'ts':
    case 'tsx':
      return 'typescript'
    case 'js':
    case 'jsx':
      return 'javascript'
    case 'json':
      return 'json'
    case 'css':
      return 'css'
    case 'html':
      return 'html'
    case 'md':
      return 'markdown'
    default:
      return 'plaintext'
  }
}

export function DiffViewer({ proposals, onApprove, onReject, onEditAndApprove }: Props) {
  const [selected, setSelected] = useState(0)
  const editorRef = useRef<MonacoDiffEditor | null>(null)
  const current = proposals[selected] ?? proposals[0]

  useEffect(() => {
    if (selected >= proposals.length) {
      setSelected(Math.max(0, proposals.length - 1))
    }
  }, [proposals.length, selected])

  const getModifiedContent = useCallback(() => {
    return editorRef.current?.getModifiedEditor().getValue() ?? current?.proposedContent ?? ''
  }, [current?.proposedContent])

  const approveEdited = useCallback(() => {
    if (!current) return
    onEditAndApprove(current.filePath, getModifiedContent())
  }, [current, getModifiedContent, onEditAndApprove])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        approveEdited()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    const unsubscribe = window.agentforge.onShortcut('shortcut:approve', approveEdited)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      unsubscribe()
    }
  }, [approveEdited])

  const handleMount: DiffOnMount = (editor) => {
    editorRef.current = editor
  }

  if (!current) {
    return null
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-zinc-800 bg-zinc-900">
      <div className="flex min-h-10 items-center border-b border-zinc-800">
        <div className="flex min-w-0 flex-1 overflow-x-auto">
          {proposals.map((proposal, index) => (
            <button
              key={proposal.filePath}
              type="button"
              onClick={() => setSelected(index)}
              className={`min-w-0 shrink-0 border-b-2 px-3 py-2 text-xs ${
                index === selected
                  ? 'border-blue-500 text-zinc-100'
                  : 'border-transparent text-zinc-500 hover:text-zinc-200'
              }`}
              title={proposal.filePath}
            >
              <span className="block max-w-44 truncate">{fileName(proposal.filePath)}</span>
            </button>
          ))}
        </div>
        <span className="px-3 text-xs text-zinc-500">
          {selected + 1} / {proposals.length} files
        </span>
      </div>

      {current.description ? (
        <div className="border-b border-zinc-800 px-3 py-2 text-xs text-zinc-400">
          {current.description}
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        <DiffEditor
          key={current.filePath}
          height="100%"
          theme="vs-dark"
          original={current.originalContent}
          modified={current.proposedContent}
          language={languageFromPath(current.filePath)}
          onMount={handleMount}
          options={{
            readOnly: false,
            renderSideBySide: true,
            minimap: { enabled: false },
            fontSize: 12,
            lineHeight: 18,
            scrollBeyondLastLine: false,
            automaticLayout: true,
          }}
        />
      </div>

      <div className="flex items-center gap-2 border-t border-zinc-800 px-3 py-2">
        <button
          type="button"
          onClick={() => onApprove(current.filePath)}
          className="rounded-md border border-emerald-700 bg-emerald-950/50 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-900/70"
        >
          Accept proposed
        </button>
        <button
          type="button"
          onClick={approveEdited}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
        >
          Apply edited
        </button>
        <button
          type="button"
          onClick={() => onReject(current.filePath)}
          className="rounded-md border border-red-800 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-950/70"
        >
          Reject
        </button>
        <span className="ml-auto text-xs text-zinc-500">Cmd+A applies edited content</span>
      </div>
    </div>
  )
}
