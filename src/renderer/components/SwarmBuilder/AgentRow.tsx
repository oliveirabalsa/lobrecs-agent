import type {
  AgentModelCatalog,
  SupportedAgentId,
  SwarmAgentConfig,
} from '../../../shared/types'
import { AGENT_LABELS } from '../../../shared/types'

interface Props {
  index: number
  config: SwarmAgentConfig
  onChange: (config: SwarmAgentConfig) => void
  onRemove: () => void
  installedAgents: SupportedAgentId[]
  modelCatalogs: AgentModelCatalog[]
  removable?: boolean
  sequential?: boolean
}

const FIELD_CLASSES =
  'min-w-0 rounded-card border border-hairline bg-card px-2 py-1.5 text-xs text-primary outline-none ' +
  'transition focus:border-accent-primary/40 focus:ring-2 focus:ring-accent-primary/20'

export function AgentRow({
  index,
  config,
  onChange,
  onRemove,
  installedAgents,
  modelCatalogs,
  removable = true,
  sequential = false,
}: Props) {
  const modelOptions =
    modelCatalogs.find((catalog) => catalog.agentId === config.agentId)?.models ?? []
  const showConnector = sequential && index > 0

  return (
    <div className="grid gap-2 py-3">
      <div className="grid grid-cols-[2rem_minmax(0,1fr)_9rem_10rem_2rem] items-center gap-2">
        <div className="flex flex-col items-center gap-1">
          {showConnector ? (
            <span aria-hidden="true" className="text-[10px] leading-none text-muted">
              ↓
            </span>
          ) : null}
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-medium ${
              showConnector
                ? 'border-accent-primary/30 bg-accent-primary/15 text-accent-primary'
                : 'border-hairline bg-canvas text-muted'
            }`}
          >
            {index + 1}
          </span>
        </div>
        <input
          value={config.role}
          onChange={(event) => onChange({ ...config, role: event.target.value })}
          className={FIELD_CLASSES}
          placeholder="Role"
          aria-label={`Agent ${index + 1} role`}
        />
        <select
          value={config.agentId}
          onChange={(event) =>
            onChange({
              ...config,
              agentId: event.target.value as SupportedAgentId,
              modelOverride: undefined,
            })
          }
          className={FIELD_CLASSES}
          aria-label={`Agent ${index + 1} runner`}
        >
          {installedAgents.map((agentId) => (
            <option key={agentId} value={agentId}>
              {AGENT_LABELS[agentId]}
            </option>
          ))}
        </select>
        <select
          value={config.modelOverride ?? ''}
          onChange={(event) =>
            onChange({
              ...config,
              modelOverride: event.target.value.trim() || undefined,
            })
          }
          className={FIELD_CLASSES}
          aria-label={`Agent ${index + 1} model override`}
        >
          <option value="">Auto model</option>
          {modelOptions.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-card text-muted transition-colors hover:bg-accent-del/10 hover:text-accent-del disabled:cursor-not-allowed disabled:opacity-40"
          onClick={onRemove}
          disabled={!removable}
          aria-label={`Remove agent ${index + 1}`}
          title="Remove agent"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
        </button>
      </div>

      <label className="ml-10 grid gap-1">
        <span className="text-[10px] text-muted">Role instructions</span>
        <textarea
          value={config.promptSuffix ?? ''}
          onChange={(event) =>
            onChange({
              ...config,
              promptSuffix: event.target.value.trim() ? event.target.value : undefined,
            })
          }
          className="h-14 resize-none rounded-card border border-hairline bg-card px-2 py-1.5 text-xs text-primary outline-none transition placeholder:text-muted focus:border-accent-primary/40 focus:ring-2 focus:ring-accent-primary/20"
          placeholder="Optional instructions specific to this agent's role…"
          aria-label={`Agent ${index + 1} role instructions`}
        />
      </label>
    </div>
  )
}
