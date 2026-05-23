import type { SlashMentionOption } from './slashMentions'
import { slashMentionKindLabel } from './slashMentions'

export interface SlashMentionPaletteProps {
  options: SlashMentionOption[]
  loading?: boolean
  error?: string | null
  activeIndex: number
  onHover: (index: number) => void
  onSelect: (option: SlashMentionOption) => void
}

export function SlashMentionPalette({
  options,
  loading = false,
  error = null,
  activeIndex,
  onHover,
  onSelect,
}: SlashMentionPaletteProps) {
  return (
    <div className="border-t border-hairline px-2 py-2">
      <div className="overflow-hidden rounded-card border border-hairline bg-card-raised shadow-xl shadow-black/20">
        {loading ? (
          <div className="px-3 py-2 text-xs text-muted">Searching context...</div>
        ) : error ? (
          <div className="px-3 py-2 text-xs text-accent-del">{error}</div>
        ) : options.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted">No matching skills, plugins, or MCP servers.</div>
        ) : (
          <div className="max-h-56 overflow-auto py-1">
            {options.map((option, index) => (
              <button
                key={`${option.kind}:${option.id}`}
                type="button"
                className={`flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors ${
                  index === activeIndex ? 'bg-white/10' : 'hover:bg-white/5'
                }`}
                onMouseEnter={() => onHover(index)}
                onMouseDown={(event) => {
                  event.preventDefault()
                  onSelect(option)
                }}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[10px] font-semibold uppercase ${
                    option.kind === 'mcp-server'
                      ? 'border-accent-primary/30 bg-accent-primary/10 text-accent-primary'
                      : option.kind === 'plugin'
                        ? 'border-accent-warn/30 bg-accent-warn/10 text-accent-warn'
                        : 'border-accent-add/30 bg-accent-add/10 text-accent-add'
                  }`}
                >
                  {option.kind === 'mcp-server' ? 'M' : option.kind.charAt(0)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-xs font-medium text-primary">
                      {option.label}
                    </span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted">
                      {slashMentionKindLabel(option.kind)}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted">
                    {option.summary}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
