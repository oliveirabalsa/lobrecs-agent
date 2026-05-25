export interface AcceptanceCriterion {
  id: string
  description: string
  testable: boolean
}

export interface InterfaceContract {
  name: string
  signature: string
  file: string
}

export interface FileManifestEntry {
  path: string
  action: 'create' | 'modify' | 'delete'
  purpose: string
}

export interface TestScenario {
  id: string
  description: string
  covers: string[]
}

export interface SpecContract {
  acceptanceCriteria: AcceptanceCriterion[]
  interfaces: InterfaceContract[]
  fileManifest: FileManifestEntry[]
  testScenarios: TestScenario[]
}

export const PLANNER_SDD_INSTRUCTION = [
  '',
  '=== MANDATORY OUTPUT FORMAT — Spec-Driven Development ===',
  'Your response MUST contain the following three sections. Downstream agents',
  'cannot proceed without the Spec Contract JSON block. Do not skip it.',
  '',
  '## Approach',
  '[Description of the implementation approach and key decisions]',
  '',
  '## Spec Contract',
  '```json',
  '{',
  '  "acceptanceCriteria": [',
  '    { "id": "AC-1", "description": "Verifiable condition", "testable": true }',
  '  ],',
  '  "interfaces": [',
  '    { "name": "FunctionOrType", "signature": "concrete signature", "file": "relative/path.ts" }',
  '  ],',
  '  "fileManifest": [',
  '    { "path": "relative/path.ts", "action": "create | modify | delete", "purpose": "why" }',
  '  ],',
  '  "testScenarios": [',
  '    { "id": "TS-1", "description": "test description", "covers": ["AC-1"] }',
  '  ]',
  '}',
  '```',
  '',
  '## Rationale',
  '[Why this approach was chosen over alternatives]',
  '',
  'Spec rules:',
  '- Every acceptance criterion must be testable and independently verifiable.',
  '- Interfaces must include concrete signatures that implementers will create.',
  '- File manifest must list every file that will change.',
  '- Test scenarios must reference acceptance criteria by ID.',
  '- Keep the spec focused — do not pad with vague or untestable criteria.',
  '=== END MANDATORY OUTPUT FORMAT ===',
].join('\n')

export const IMPLEMENTER_SPEC_INSTRUCTION = [
  '',
  '=== BINDING SPEC CONTRACT — Read before starting ===',
  'A Spec Contract was produced by the planner phase (shown above). You MUST:',
  '1. Implement all interfaces listed in the spec with the specified signatures.',
  '2. Create, modify, or delete all files in the file manifest.',
  '3. Satisfy every acceptance criterion — each one is a hard requirement.',
  '4. Do not add features, refactors, or changes not described in the spec.',
  '5. Write or run tests covering all test scenarios.',
  '6. If you cannot satisfy a criterion, document why explicitly.',
  '=== END BINDING SPEC CONTRACT ===',
].join('\n')

export const VERIFIER_SPEC_INSTRUCTION = [
  '',
  '=== BINDING SPEC CONTRACT — Verification checklist ===',
  'A Spec Contract was produced by the planner phase (shown above). Verify the implementation against it:',
  '1. Check every acceptance criterion — mark each as PASS or FAIL with evidence.',
  '2. Verify all interfaces match the spec signatures (names, params, return types).',
  '3. Confirm all files in the manifest were changed as specified.',
  '4. Validate all test scenarios pass or are covered by existing tests.',
  '5. Report any deviations as spec violations with severity (blocking / warning).',
  '6. Summarize with a compliance score: number of criteria passed / total.',
  '=== END BINDING SPEC CONTRACT ===',
].join('\n')

export function extractSpecContract(output: string): SpecContract | null {
  const specBlock = extractSpecJson(output)
  if (!specBlock) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(specBlock)
  } catch {
    return null
  }

  return validateSpecContract(parsed)
}

function extractSpecJson(output: string): string | null {
  const specHeaderIndex = output.search(/##\s*Spec\s+Contract/i)
  const searchRegion = specHeaderIndex !== -1 ? output.slice(specHeaderIndex) : output

  const fenced = searchRegion.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced?.[1]?.trim()) return fenced[1].trim()

  const firstBrace = searchRegion.indexOf('{')
  const lastBrace = searchRegion.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return searchRegion.slice(firstBrace, lastBrace + 1)
  }

  return null
}

function validateSpecContract(value: unknown): SpecContract | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>

  const ac = validateAcceptanceCriteria(record.acceptanceCriteria)
  if (!ac) return null

  return {
    acceptanceCriteria: ac,
    interfaces: validateInterfaces(record.interfaces) ?? [],
    fileManifest: validateFileManifest(record.fileManifest) ?? [],
    testScenarios: validateTestScenarios(record.testScenarios) ?? [],
  }
}

function validateAcceptanceCriteria(value: unknown): AcceptanceCriterion[] | null {
  if (!Array.isArray(value) || value.length === 0) return null

  const criteria: AcceptanceCriterion[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const record = item as Record<string, unknown>
    if (typeof record.id !== 'string' || typeof record.description !== 'string') return null
    criteria.push({
      id: record.id,
      description: record.description,
      testable: record.testable !== false,
    })
  }
  return criteria
}

function validateInterfaces(value: unknown): InterfaceContract[] | null {
  if (!Array.isArray(value)) return null
  const contracts: InterfaceContract[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (
      typeof record.name !== 'string' ||
      typeof record.signature !== 'string' ||
      typeof record.file !== 'string'
    )
      continue
    contracts.push({ name: record.name, signature: record.signature, file: record.file })
  }
  return contracts
}

function validateFileManifest(value: unknown): FileManifestEntry[] | null {
  if (!Array.isArray(value)) return null
  const entries: FileManifestEntry[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (typeof record.path !== 'string' || typeof record.purpose !== 'string') continue
    const action = record.action
    if (action !== 'create' && action !== 'modify' && action !== 'delete') continue
    entries.push({ path: record.path, action, purpose: record.purpose })
  }
  return entries
}

function validateTestScenarios(value: unknown): TestScenario[] | null {
  if (!Array.isArray(value)) return null
  const scenarios: TestScenario[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (typeof record.id !== 'string' || typeof record.description !== 'string') continue
    const covers = Array.isArray(record.covers)
      ? record.covers.filter((c): c is string => typeof c === 'string')
      : []
    scenarios.push({ id: record.id, description: record.description, covers })
  }
  return scenarios
}

export function buildSpecContext(spec: SpecContract): string {
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
