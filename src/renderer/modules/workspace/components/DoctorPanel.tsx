import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AdapterCapability,
  AgentProfileDoctorReport,
  ManagedCliStatus,
  Project,
  VerificationRecipe,
} from '../../../../shared/types'
import { Button, Spinner } from '../../../components/ui'

interface DoctorPanelProps {
  project: Project
}

type DoctorState =
  | { kind: 'loading' }
  | {
      kind: 'ready'
      runtimes: ManagedCliStatus[]
      capabilities: AdapterCapability[]
      profileDoctor: AgentProfileDoctorReport
      recipes: VerificationRecipe[]
    }
  | { kind: 'error'; message: string }

export function DoctorPanel({ project }: DoctorPanelProps) {
  const [state, setState] = useState<DoctorState>({ kind: 'loading' })

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const [runtimes, capabilities, profileDoctor, recipes] = await Promise.all([
        window.agentforge.system.listManagedCliRuntimes(),
        window.agentforge.system.listCapabilities(),
        window.agentforge.system.getAgentProfileDoctor(project.id),
        window.agentforge.system.listVerificationRecipes(project.id),
      ])
      setState({ kind: 'ready', runtimes, capabilities, profileDoctor, recipes })
    } catch (error: unknown) {
      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Unable to load doctor status.',
      })
    }
  }, [project.id])

  useEffect(() => {
    void load()
  }, [load])

  const summary = useMemo(() => {
    if (state.kind !== 'ready') return null
    const installed = state.runtimes.filter((runtime) => runtime.installed).length
    const updates = state.runtimes.filter((runtime) => runtime.updateAvailable).length
    const streaming = state.capabilities.filter(
      (capability) => capability.installed && capability.supportsStreamingJson,
    ).length
    return { installed, updates, streaming, recipes: state.recipes.length }
  }, [state])

  return (
    <section className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="shrink-0 border-b border-hairline px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold text-primary">Doctor</h2>
            <p className="mt-1 truncate text-[11px] leading-5 text-muted">{project.name}</p>
          </div>
          <Button type="button" size="sm" variant="chip" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {state.kind === 'loading' ? (
          <div className="flex items-center gap-2 rounded-card border border-hairline bg-card p-3 text-[12px] text-muted">
            <Spinner size={12} />
            Checking local capabilities...
          </div>
        ) : state.kind === 'error' ? (
          <div className="rounded-card border border-accent-del/40 bg-accent-del/10 p-3">
            <div className="text-[12px] font-medium text-accent-del">Doctor unavailable</div>
            <p className="mt-1 text-[12px] leading-5 text-accent-del/90">{state.message}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {summary ? (
              <div className="grid grid-cols-2 gap-2">
                <Metric label="Installed CLIs" value={`${summary.installed}/${state.runtimes.length}`} />
                <Metric label="Updates" value={summary.updates} />
                <Metric label="Streaming" value={summary.streaming} />
                <Metric label="Recipes" value={summary.recipes} />
              </div>
            ) : null}

            <section className="rounded-card border border-hairline bg-card p-3">
              <div className="text-[12px] font-medium text-primary">Agent runtimes</div>
              <div className="mt-3 space-y-2">
                {state.runtimes.map((runtime) => (
                  <RuntimeRow key={runtime.agentId} runtime={runtime} />
                ))}
              </div>
            </section>

            <section className="rounded-card border border-hairline bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[12px] font-medium text-primary">Agent profiles</div>
                <span className="rounded border border-hairline px-1.5 py-0.5 text-[10px] text-muted">
                  {state.profileDoctor.profileCount}
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {state.profileDoctor.issues.length > 0 ? (
                  state.profileDoctor.issues.map((issue, index) => (
                    <div
                      key={`${issue.profileId}:${issue.kind}:${issue.ref ?? index}`}
                      className="rounded border border-accent-warn/30 bg-accent-warn/10 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[12px] font-medium text-accent-warn">
                          {issue.profileName}
                        </span>
                        <span className="rounded border border-accent-warn/30 px-1.5 py-0.5 text-[10px] text-accent-warn">
                          {issue.kind}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] leading-5 text-accent-warn/90">
                        {issue.message}
                      </p>
                    </div>
                  ))
                ) : state.profileDoctor.profileCount > 0 ? (
                  <div className="rounded border border-accent-add/30 bg-accent-add/10 px-3 py-2 text-[12px] text-accent-add">
                    Profiles are ready.
                  </div>
                ) : (
                  <div className="rounded border border-dashed border-hairline px-3 py-5 text-center text-[12px] text-muted">
                    No project profiles found.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-card border border-hairline bg-card p-3">
              <div className="text-[12px] font-medium text-primary">Verification recipes</div>
              <div className="mt-3 space-y-2">
                {state.recipes.length > 0 ? (
                  state.recipes.map((recipe) => (
                    <div key={recipe.id} className="rounded border border-hairline/70 bg-card-raised px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12px] font-medium text-secondary">{recipe.label}</span>
                        <span className="rounded border border-hairline px-1.5 py-0.5 text-[10px] text-muted">
                          {recipe.scope}
                        </span>
                      </div>
                      <code className="mt-1 block truncate font-mono text-[11px] text-muted">
                        {recipe.command}
                      </code>
                    </div>
                  ))
                ) : (
                  <div className="rounded border border-dashed border-hairline px-3 py-5 text-center text-[12px] text-muted">
                    No verification recipes configured.
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </section>
  )
}

function RuntimeRow({ runtime }: { runtime: ManagedCliStatus }) {
  return (
    <div className="rounded border border-hairline/70 bg-card-raised px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-medium text-secondary">{runtime.name}</div>
          <code className="mt-0.5 block truncate font-mono text-[11px] text-muted">
            {runtime.commandPath ?? runtime.command}
          </code>
        </div>
        <span
          className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${
            runtime.installed
              ? 'border-accent-add/40 bg-accent-add/10 text-accent-add'
              : 'border-accent-warn/40 bg-accent-warn/10 text-accent-warn'
          }`}
        >
          {runtime.installed ? 'installed' : 'missing'}
        </span>
      </div>
      {runtime.updateAvailable ? (
        <div className="mt-2 text-[11px] text-accent-primary">Update available</div>
      ) : null}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-card border border-hairline bg-card px-3 py-2">
      <div className="text-[16px] font-semibold text-primary">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted">{label}</div>
    </div>
  )
}
