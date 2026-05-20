import type { SwarmPlanAgentView, SwarmPlanView } from '../lib/swarmMessage'
import { SwarmRoleBadge } from './SwarmRoleBadge'

/**
 * Formatted view of the managed-swarm execution plan that the manager agent
 * emits as raw JSON. Rendered in place of the JSON blob inside the chat
 * stream (see `AssistantMessage`).
 */
export function SwarmPlanCard({ plan }: { plan: SwarmPlanView }) {
  const sequential = plan.strategy === 'sequential'
  const agentCount = plan.agents.length

  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-card">
      <header className="flex items-center gap-3 border-b border-hairline px-4 py-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-card border border-accent-primary/30 bg-accent-primary/15 text-accent-primary">
          {iconSwarm}
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-primary">Swarm plan</div>
          <div className="text-[11px] text-muted">
            {sequential ? 'Sequential' : 'Parallel'} ·{' '}
            {agentCount} {agentCount === 1 ? 'agent' : 'agents'}
            {sequential ? ' run in order' : ' run together'}
          </div>
        </div>
      </header>

      <ol className="flex flex-col">
        {plan.agents.map((agent, index) => (
          <PlanStep
            key={`${agent.role}-${index}`}
            agent={agent}
            index={index}
            sequential={sequential}
            isLast={index === agentCount - 1}
          />
        ))}
      </ol>
    </div>
  )
}

function PlanStep({
  agent,
  index,
  sequential,
  isLast,
}: {
  agent: SwarmPlanAgentView
  index: number
  sequential: boolean
  isLast: boolean
}) {
  return (
    <li className="flex gap-3 border-t border-hairline px-4 py-3 first:border-t-0">
      <div className="flex flex-col items-center">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-hairline bg-canvas text-[11px] font-semibold text-secondary">
          {index + 1}
        </span>
        {/* Connector line only makes sense when steps are ordered. */}
        {sequential && !isLast ? (
          <span className="mt-1 w-px flex-1 bg-hairline" aria-hidden="true" />
        ) : null}
      </div>

      <div className="min-w-0 flex-1 pb-0.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <SwarmRoleBadge role={agent.role} />
          <span className="truncate text-[11px] text-muted">{agent.agentLabel}</span>
          {agent.modelOverride ? (
            <span className="truncate rounded border border-hairline bg-card-raised px-1.5 py-0.5 font-mono text-[10px] text-muted">
              {agent.modelOverride}
            </span>
          ) : null}
        </div>
        {agent.promptSuffix ? (
          <p className="mt-1.5 break-words text-[12px] leading-5 text-secondary">
            {agent.promptSuffix}
          </p>
        ) : null}
      </div>
    </li>
  )
}

const iconSwarm = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4">
    <circle cx="8" cy="3.2" r="1.9" />
    <circle cx="3.4" cy="11" r="1.9" />
    <circle cx="12.6" cy="11" r="1.9" />
    <path d="M8 5.1v3.2M6.6 9.4 4.6 10.4M9.4 9.4l2 1" strokeLinecap="round" />
  </svg>
)
