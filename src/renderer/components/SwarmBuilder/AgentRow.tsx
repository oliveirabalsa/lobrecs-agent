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

  return (
    <div className="grid gap-3 border-b border-zinc-800 py-3 last:border-b-0">
      <div className="grid grid-cols-[2rem_minmax(0,1fr)_9rem_10rem_2rem] items-center gap-2">
        <div className="text-center text-xs text-zinc-500">
          {sequential && index > 0 ? '->' : index + 1}
        </div>
        <input
          value={config.role}
          onChange={(event) => onChange({ ...config, role: event.target.value })}
          className="min-w-0 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-zinc-500"
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
          className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-zinc-500"
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
          className="min-w-0 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-zinc-500"
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
          className="h-8 rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={onRemove}
          disabled={!removable}
          aria-label={`Remove agent ${index + 1}`}
          title="Remove agent"
        >
          x
        </button>
      </div>

      <textarea
        value={config.promptSuffix ?? ''}
        onChange={(event) =>
          onChange({
            ...config,
            promptSuffix: event.target.value.trim() ? event.target.value : undefined,
          })
        }
        className="ml-10 h-16 resize-none rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
        placeholder="Prompt suffix"
        aria-label={`Agent ${index + 1} prompt suffix`}
      />
    </div>
  )
}
