import type {
  SwarmAgentConfig,
  SwarmConfig,
} from '../../../shared/types'
import {
  IMPLEMENTER_SPEC_INSTRUCTION,
  PLANNER_SDD_INSTRUCTION,
  VERIFIER_SPEC_INSTRUCTION,
  type SpecContract,
} from '../../modules/swarms/domain/specContract'

export function buildAgentPrompt(
  basePrompt: string,
  agentConfig: SwarmAgentConfig,
  previousOutput?: string,
  options?: { contextLabel?: string; extraInstruction?: string; specContract?: SpecContract },
): string {
  const role = agentConfig.role
  const lines: string[] = [`[Role: ${role}]`]

  if (isPlanningRole(role)) {
    lines.push(PLANNER_SDD_INSTRUCTION)
  } else if (options?.specContract) {
    lines.push('', buildSpecContext(options.specContract))
    if (isImplementationRole(role)) {
      lines.push(IMPLEMENTER_SPEC_INSTRUCTION)
    } else if (isVerificationRole(role)) {
      lines.push(VERIFIER_SPEC_INSTRUCTION)
    }
  }

  lines.push('', basePrompt.trim())

  if (previousOutput?.trim()) {
    const label = options?.contextLabel ?? 'Context from previous step'
    lines.push('', `${label}:`, previousOutput.trim())
  }

  if (agentConfig.promptSuffix?.trim()) {
    lines.push('', agentConfig.promptSuffix.trim())
  }

  if (options?.extraInstruction?.trim()) {
    lines.push('', options.extraInstruction.trim())
  }

  return lines.join('\n')
}

export function buildManagedPhaseOutput(sessions: readonly { role: string; output?: string }[]): string {
  return sessions
    .map((session) => {
      const output = session.output?.trim()
      if (!output) return ''
      return `[${session.role}]\n${output}`
    })
    .filter(Boolean)
    .join('\n\n')
}

export function buildSwarmThreadTitle(config: SwarmConfig): string {
  const prefix =
    config.strategy === 'managed'
      ? 'Managed swarm'
      : config.strategy === 'sequential'
        ? 'Sequential swarm'
        : config.strategy === 'multitask'
          ? 'Multitask'
          : 'Swarm'
  const prompt = config.prompt.trim()
  const title = prompt ? `${prefix}: ${prompt}` : prefix
  return title.slice(0, 200)
}

function isPlanningRole(role: string): boolean {
  return /\b(plan|planner|planning|architect|design|scope|research|analy)/i.test(role)
}

function isImplementationRole(role: string): boolean {
  return /\b(implement\w*|builder|build|coder|developer|engineer)\b/i.test(role)
}

function isVerificationRole(role: string): boolean {
  const normalized = role.toLowerCase()
  if (isImplementationRole(normalized)) return false

  return /\b(review|reviewer|critic|test|tester|qa|quality assurance|verif|validat)/i.test(
    normalized,
  )
}

function buildSpecContext(spec: SpecContract): string {
  const lines: string[] = ['--- Spec Contract (binding) ---']

  lines.push('', 'Acceptance Criteria:')
  for (const ac of spec.acceptanceCriteria) {
    lines.push(`  ${ac.id}: ${ac.description}${ac.testable ? '' : ' [non-testable]'}`)
  }

  if (spec.interfaces.length > 0) {
    lines.push('', 'Interface Contracts:')
    for (const iface of spec.interfaces) {
      lines.push(`  ${iface.name} (${iface.file}): ${iface.signature}`)
    }
  }

  if (spec.fileManifest.length > 0) {
    lines.push('', 'File Manifest:')
    for (const entry of spec.fileManifest) {
      lines.push(`  [${entry.action}] ${entry.path} — ${entry.purpose}`)
    }
  }

  if (spec.testScenarios.length > 0) {
    lines.push('', 'Test Scenarios:')
    for (const ts of spec.testScenarios) {
      const coversStr = ts.covers.length > 0 ? ` (covers: ${ts.covers.join(', ')})` : ''
      lines.push(`  ${ts.id}: ${ts.description}${coversStr}`)
    }
  }

  lines.push('', '--- End Spec Contract ---')
  return lines.join('\n')
}
