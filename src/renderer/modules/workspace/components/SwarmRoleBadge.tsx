import { swarmRoleKind, type SwarmRoleKind } from '../lib/swarmMessage'

/**
 * Accent classes per role kind. Shared by the swarm plan card and the worker
 * role message so a "planner" looks the same wherever it appears.
 */
const ROLE_STYLES: Record<SwarmRoleKind, string> = {
  planner: 'border-accent-primary/30 bg-accent-primary/15 text-accent-primary',
  builder: 'border-accent-add/30 bg-accent-add/15 text-accent-add',
  reviewer: 'border-accent-warn/30 bg-accent-warn/15 text-accent-warn',
  security: 'border-accent-del/30 bg-accent-del/15 text-accent-del',
  generic: 'border-hairline bg-card-raised text-secondary',
}

const ROLE_GLYPHS: Record<SwarmRoleKind, string> = {
  planner: '◆',
  builder: '▲',
  reviewer: '✓',
  security: '⚠',
  generic: '●',
}

/** Small pill that labels a swarm role with a stable, kind-based accent. */
export function SwarmRoleBadge({ role }: { role: string }) {
  const kind = swarmRoleKind(role)

  return (
    <span
      className={`inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-pill border px-2.5 py-1 text-[11px] font-semibold ${ROLE_STYLES[kind]}`}
    >
      <span aria-hidden="true" className="text-[9px] leading-none opacity-80">
        {ROLE_GLYPHS[kind]}
      </span>
      <span className="min-w-0 truncate capitalize">{role}</span>
    </span>
  )
}
