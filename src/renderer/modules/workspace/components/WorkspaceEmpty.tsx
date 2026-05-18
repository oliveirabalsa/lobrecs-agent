interface WorkspaceEmptyProps {
  projectName?: string
}

/**
 * Centered empty state shown when no thread is active. The composer below
 * stays mounted so the user can start a new thread by typing.
 */
export function WorkspaceEmpty({ projectName }: WorkspaceEmptyProps) {
  return (
    <div className="flex min-h-full w-full flex-1 flex-col items-center justify-center px-6 py-12 text-center">
      <div className="max-w-full break-words text-[15px] font-semibold text-primary">
        {projectName ? `Ready for ${projectName}` : 'No thread selected'}
      </div>
      <p className="mt-2 max-w-sm text-[13px] leading-6 text-muted">
        Start a new chat or pick a thread from the sidebar.
      </p>
    </div>
  )
}
