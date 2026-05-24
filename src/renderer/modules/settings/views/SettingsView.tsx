import { useEffect, useMemo, useState } from 'react'
import { AGENT_LABELS, SUPPORTED_AGENT_IDS } from '../../../../shared/types'
import type {
  AgentPermissionMode,
  AppSettings,
  ModelTier,
  Project,
  SupportedAgentId,
  SwarmTemplate,
  VerificationRecipe,
} from '../../../../shared/types'
import {
  FieldRow,
  NumberInput,
  SelectInput,
  SettingsSection,
  TextInput,
  Toggle,
} from '../components/SettingsControls'
import { useSettingsDraft } from '../hooks/useSettingsDraft'
import { THEME_IDS, THEME_META, useTheme } from '../../../hooks/useTheme'

interface SettingsViewProps {
  isMac?: boolean
  selectedProject: Project | null
  onOpenSidebar?: () => void
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
  onClose?: () => void
  onReplayWalkthrough?: () => void
}

const sectionNav = [
  ['general', 'General'],
  ['agents', 'Agents & Models'],
  ['routing', 'Routing'],
  ['execution', 'Execution'],
  ['swarms', 'Swarms'],
  ['specs', 'Specs'],
  ['verification', 'Verification'],
  ['costs', 'Costs'],
  ['appearance', 'Appearance'],
  ['ui', 'UI'],
  ['editor', 'Editor'],
  ['advanced', 'Advanced JSON'],
] as const

const agentIds: SupportedAgentId[] = [...SUPPORTED_AGENT_IDS]
const modelTiers: ModelTier[] = ['lightweight', 'balanced', 'advanced', 'frontier']
const permissionModes: AgentPermissionMode[] = [
  'dangerous',
  'bypass-permissions',
  'ask-for-approval',
  'read-only',
]

export function SettingsView({
  isMac = false,
  selectedProject,
  onOpenSidebar,
  sidebarCollapsed = false,
  onToggleSidebar,
  onClose,
  onReplayWalkthrough,
}: SettingsViewProps) {
  const settingsDraft = useSettingsDraft({ project: selectedProject })
  const [notificationEventsExpanded, setNotificationEventsExpanded] = useState(false)
  const draft = settingsDraft.draft

  const leftInsetClass = isMac
    ? (sidebarCollapsed ? 'pl-[70px]' : 'pl-[70px] md:pl-4')
    : 'pl-2 md:pl-4'
  const canUseProjectScope = Boolean(selectedProject)

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    settingsDraft.updateDraft((current) => ({ ...current, [key]: value }))
  }

  const rtkWarnings = useMemo(() => {
    if (!draft?.verification.requireCommandPrefix) return []
    const prefix = draft.execution.commandPrefix.trim()
    if (!prefix) return []

    return draft.verification.recipes
      .filter((recipe) => !recipe.command.trim().startsWith(prefix))
      .map((recipe) => recipe.label)
  }, [draft])

  if (settingsDraft.loading || !draft) {
    return (
      <main className="motion-fade-up-in flex min-w-0 flex-1 flex-col bg-canvas text-primary">
        <SettingsTopBar
          leftInsetClass={leftInsetClass}
          onOpenSidebar={onOpenSidebar}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={onToggleSidebar}
          onClose={onClose}
        />
        <div className="flex flex-1 items-center justify-center text-[13px] text-muted">
          Loading settings...
        </div>
      </main>
    )
  }

  return (
    <main className="motion-fade-up-in flex min-w-0 flex-1 flex-col overflow-hidden bg-canvas text-primary">
      <SettingsTopBar
        leftInsetClass={leftInsetClass}
        onOpenSidebar={onOpenSidebar}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        onClose={onClose}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="hidden w-56 shrink-0 border-r border-hairline bg-sidebar bg-sidebar-surface px-2 py-3 md:block">
          <div className="mb-3 px-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Settings
            </div>
            <div className="mt-1 truncate text-[12px] text-secondary">
              {settingsDraft.scope === 'project' && selectedProject
                ? selectedProject.name
                : 'Global defaults'}
            </div>
          </div>
          <nav className="grid gap-0.5">
            {sectionNav.map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                className="rounded-card px-2 py-1.5 text-[12px] text-secondary hover:bg-white/5 hover:text-primary"
              >
                {label}
              </a>
            ))}
          </nav>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="shrink-0 border-b border-hairline px-6 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-[18px] font-semibold">Settings</h1>
                <p className="mt-1 text-[12px] text-muted">
                  Configure routing, runtime behavior, swarms, verification, costs, and the workspace shell.
                </p>
              </div>
              <div className="flex rounded-card border border-hairline bg-card p-0.5">
                <button
                  type="button"
                  onClick={() => settingsDraft.setScope('global')}
                  className={`rounded px-3 py-1.5 text-[12px] ${
                    settingsDraft.scope === 'global'
                      ? 'bg-white/10 text-primary'
                      : 'text-secondary hover:text-primary'
                  }`}
                >
                  Global
                </button>
                <button
                  type="button"
                  onClick={() => settingsDraft.setScope('project')}
                  disabled={!canUseProjectScope}
                  className={`rounded px-3 py-1.5 text-[12px] ${
                    settingsDraft.scope === 'project'
                      ? 'bg-white/10 text-primary'
                      : 'text-secondary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40'
                  }`}
                >
                  Project
                </button>
              </div>
            </div>
          </header>

          {settingsDraft.error ? (
            <div className="shrink-0 border-b border-accent-del/40 bg-accent-del/10 px-6 py-2 text-[12px] text-accent-del">
              {settingsDraft.error}
            </div>
          ) : null}
          {settingsDraft.notice ? (
            <div className="shrink-0 border-b border-accent-add/40 bg-accent-add/10 px-6 py-2 text-[12px] text-accent-add">
              {settingsDraft.notice}
            </div>
          ) : null}
          {rtkWarnings.length > 0 ? (
            <div className="shrink-0 border-b border-accent-warn/40 bg-accent-warn/10 px-6 py-2 text-[12px] text-accent-warn">
              Verification commands missing the configured prefix: {rtkWarnings.join(', ')}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto">
            <SettingsSection id="general" title="General">
              <FieldRow label="App name">
                <TextInput
                  value={draft.general.appName}
                  onChange={(appName) => update('general', { ...draft.general, appName })}
                />
              </FieldRow>
              <FieldRow label="Open last project on launch">
                <Toggle
                  checked={draft.general.openLastProjectOnLaunch}
                  onChange={(openLastProjectOnLaunch) =>
                    update('general', { ...draft.general, openLastProjectOnLaunch })
                  }
                />
              </FieldRow>
              <FieldRow label="Desktop notifications">
                <Toggle
                  checked={draft.general.enableDesktopNotifications}
                  onChange={(enableDesktopNotifications) =>
                    update('general', { ...draft.general, enableDesktopNotifications })
                  }
                />
              </FieldRow>
              {onReplayWalkthrough ? (
                <FieldRow
                  label="Walkthrough"
                  detail="Replay first-run setup for agents, credentials, project creation, and the Swarm Builder demo."
                >
                  <button
                    type="button"
                    onClick={onReplayWalkthrough}
                    className="h-8 rounded-card border border-hairline bg-card px-2.5 text-[13px] text-secondary outline-none hover:bg-card-raised hover:text-primary focus:border-hairline-strong"
                  >
                    Replay walkthrough
                  </button>
                </FieldRow>
              ) : null}
              {draft.general.enableDesktopNotifications && (
                <>
                  <FieldRow label="Only when window is not focused">
                    <Toggle
                      checked={draft.general.onlyWhenUnfocused}
                      onChange={(onlyWhenUnfocused) =>
                        update('general', { ...draft.general, onlyWhenUnfocused })
                      }
                    />
                  </FieldRow>
                  <div className="pl-6">
                    <button
                      type="button"
                      onClick={() => setNotificationEventsExpanded((v) => !v)}
                      className="mb-2 flex items-center gap-1 text-[13px] text-secondary hover:text-primary"
                    >
                      <span className="text-[10px]">
                        {notificationEventsExpanded ? '▼' : '▶'}
                      </span>
                      Event preferences
                    </button>
                    {notificationEventsExpanded && (
                      <div className="space-y-2">
                        <FieldRow label="Swarm completed">
                          <Toggle
                            checked={draft.general.notificationEvents.swarmCompleted}
                            onChange={(swarmCompleted) =>
                              update('general', {
                                ...draft.general,
                                notificationEvents: { ...draft.general.notificationEvents, swarmCompleted },
                              })
                            }
                          />
                        </FieldRow>
                        <FieldRow label="Diff ready for review">
                          <Toggle
                            checked={draft.general.notificationEvents.diffReady}
                            onChange={(diffReady) =>
                              update('general', {
                                ...draft.general,
                                notificationEvents: { ...draft.general.notificationEvents, diffReady },
                              })
                            }
                          />
                        </FieldRow>
                        <FieldRow label="Automation succeeded">
                          <Toggle
                            checked={draft.general.notificationEvents.automationSuccess}
                            onChange={(automationSuccess) =>
                              update('general', {
                                ...draft.general,
                                notificationEvents: { ...draft.general.notificationEvents, automationSuccess },
                              })
                            }
                          />
                        </FieldRow>
                        <FieldRow label="Automation failed">
                          <Toggle
                            checked={draft.general.notificationEvents.automationFailure}
                            onChange={(automationFailure) =>
                              update('general', {
                                ...draft.general,
                                notificationEvents: { ...draft.general.notificationEvents, automationFailure },
                              })
                            }
                          />
                        </FieldRow>
                        <FieldRow label="Agent session error">
                          <Toggle
                            checked={draft.general.notificationEvents.sessionError}
                            onChange={(sessionError) =>
                              update('general', {
                                ...draft.general,
                                notificationEvents: { ...draft.general.notificationEvents, sessionError },
                              })
                            }
                          />
                        </FieldRow>
                      </div>
                    )}
                  </div>
                </>
              )}
            </SettingsSection>

            <SettingsSection id="agents" title="Agents & Models">
              <FieldRow label="Default agent">
                <SelectInput
                  value={draft.agents.defaultAgentId}
                  options={agentOptions()}
                  onChange={(defaultAgentId) =>
                    update('agents', { ...draft.agents, defaultAgentId })
                  }
                />
              </FieldRow>
              <FieldRow label="Fallback agent">
                <SelectInput
                  value={draft.agents.fallbackAgentId}
                  options={agentOptions()}
                  onChange={(fallbackAgentId) =>
                    update('agents', { ...draft.agents, fallbackAgentId })
                  }
                />
              </FieldRow>
              <div className="grid gap-4">
                {agentIds.map((agentId) => {
                  const runtime = draft.agents.runtimes[agentId]
                  return (
                    <div key={agentId} className="rounded-card border border-hairline bg-card px-4 py-3">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="text-[13px] font-semibold text-secondary">
                          {agentLabel(agentId)}
                        </div>
                        <Toggle
                          checked={draft.agents.enabledAgentIds.includes(agentId)}
                          onChange={(enabled) => {
                            const enabledAgentIds = enabled
                              ? [...new Set([...draft.agents.enabledAgentIds, agentId])]
                              : draft.agents.enabledAgentIds.filter((id) => id !== agentId)
                            update('agents', {
                              ...draft.agents,
                              enabledAgentIds,
                              runtimes: {
                                ...draft.agents.runtimes,
                                [agentId]: { ...runtime, enabled },
                              },
                            })
                          }}
                        />
                      </div>
                      <div className="grid gap-3">
                        <FieldRow label="Command override">
                          <TextInput
                            value={runtime.command}
                            placeholder="Use PATH/env default"
                            onChange={(command) =>
                              update('agents', {
                                ...draft.agents,
                                runtimes: {
                                  ...draft.agents.runtimes,
                                  [agentId]: { ...runtime, command },
                                },
                              })
                            }
                          />
                        </FieldRow>
                        <FieldRow label="Permission mode">
                          <SelectInput
                            value={runtime.permissionMode}
                            options={permissionModes.map((value) => ({ value, label: value }))}
                            onChange={(permissionMode) =>
                              update('agents', {
                                ...draft.agents,
                                runtimes: {
                                  ...draft.agents.runtimes,
                                  [agentId]: { ...runtime, permissionMode },
                                },
                              })
                            }
                          />
                        </FieldRow>
                        {modelTiers.map((tier) => (
                          <FieldRow key={tier} label={`${tier} model`}>
                            <TextInput
                              value={draft.agents.modelMap[agentId][tier]}
                              onChange={(model) =>
                                update('agents', {
                                  ...draft.agents,
                                  modelMap: {
                                    ...draft.agents.modelMap,
                                    [agentId]: {
                                      ...draft.agents.modelMap[agentId],
                                      [tier]: model,
                                    },
                                  },
                                })
                              }
                            />
                          </FieldRow>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
              <FieldRow label="Max image attachments">
                <NumberInput
                  value={draft.agents.imageAttachments.maxCount}
                  min={0}
                  max={20}
                  onChange={(maxCount) =>
                    update('agents', {
                      ...draft.agents,
                      imageAttachments: { ...draft.agents.imageAttachments, maxCount },
                    })
                  }
                />
              </FieldRow>
              <FieldRow label="Max image size MB">
                <NumberInput
                  value={draft.agents.imageAttachments.maxSizeMb}
                  min={1}
                  max={100}
                  onChange={(maxSizeMb) =>
                    update('agents', {
                      ...draft.agents,
                      imageAttachments: { ...draft.agents.imageAttachments, maxSizeMb },
                    })
                  }
                />
              </FieldRow>
            </SettingsSection>

            <SettingsSection id="routing" title="Routing">
              <FieldRow label="Lightweight max score">
                <NumberInput
                  value={draft.routing.tierThresholds.lightweightMax}
                  min={1}
                  max={99}
                  onChange={(lightweightMax) =>
                    update('routing', {
                      ...draft.routing,
                      tierThresholds: { ...draft.routing.tierThresholds, lightweightMax },
                    })
                  }
                />
              </FieldRow>
              <FieldRow label="Balanced max score">
                <NumberInput
                  value={draft.routing.tierThresholds.balancedMax}
                  min={1}
                  max={99}
                  onChange={(balancedMax) =>
                    update('routing', {
                      ...draft.routing,
                      tierThresholds: { ...draft.routing.tierThresholds, balancedMax },
                    })
                  }
                />
              </FieldRow>
              <FieldRow label="Advanced max score">
                <NumberInput
                  value={draft.routing.tierThresholds.advancedMax}
                  min={1}
                  max={99}
                  onChange={(advancedMax) =>
                    update('routing', {
                      ...draft.routing,
                      tierThresholds: { ...draft.routing.tierThresholds, advancedMax },
                    })
                  }
                />
              </FieldRow>
              <FieldRow label="Security minimum tier">
                <SelectInput
                  value={draft.routing.securityMinimumTier}
                  options={modelTiers.map((value) => ({ value, label: value }))}
                  onChange={(securityMinimumTier) =>
                    update('routing', { ...draft.routing, securityMinimumTier })
                  }
                />
              </FieldRow>
              <FieldRow label="Use recent failure escalation">
                <Toggle
                  checked={draft.routing.useRecentFailureEscalation}
                  onChange={(useRecentFailureEscalation) =>
                    update('routing', { ...draft.routing, useRecentFailureEscalation })
                  }
                />
              </FieldRow>
              <FieldRow label="Allow OpenCode for frontier">
                <Toggle
                  checked={draft.routing.allowOpenCodeForFrontier}
                  onChange={(allowOpenCodeForFrontier) =>
                    update('routing', { ...draft.routing, allowOpenCodeForFrontier })
                  }
                />
              </FieldRow>
            </SettingsSection>

            <SettingsSection id="execution" title="Execution & Approvals">
              <FieldRow label="Worktree isolation for new sessions">
                <Toggle
                  checked={draft.execution.worktreeIsolation}
                  onChange={(worktreeIsolation) =>
                    update('execution', { ...draft.execution, worktreeIsolation })
                  }
                />
              </FieldRow>
              <FieldRow label="Auto-apply completed diffs">
                <Toggle
                  checked={draft.execution.autoApplyCompletedDiffs}
                  onChange={(autoApplyCompletedDiffs) =>
                    update('execution', { ...draft.execution, autoApplyCompletedDiffs })
                  }
                />
              </FieldRow>
              <FieldRow label="Default approval mode">
                <SelectInput
                  value={draft.execution.defaultApprovalMode}
                  options={permissionModes.map((value) => ({ value, label: value }))}
                  onChange={(defaultApprovalMode) =>
                    update('execution', { ...draft.execution, defaultApprovalMode })
                  }
                />
              </FieldRow>
              <FieldRow label="Max queued messages per thread">
                <NumberInput
                  value={draft.execution.maxQueuedMessagesPerThread}
                  min={1}
                  max={100}
                  onChange={(maxQueuedMessagesPerThread) =>
                    update('execution', { ...draft.execution, maxQueuedMessagesPerThread })
                  }
                />
              </FieldRow>
              <FieldRow label="Local command prefix">
                <TextInput
                  value={draft.execution.commandPrefix}
                  onChange={(commandPrefix) =>
                    update('execution', { ...draft.execution, commandPrefix })
                  }
                />
              </FieldRow>
              <FieldRow label="Warn when commands miss prefix">
                <Toggle
                  checked={draft.execution.warnWhenCommandMissingPrefix}
                  onChange={(warnWhenCommandMissingPrefix) =>
                    update('execution', {
                      ...draft.execution,
                      warnWhenCommandMissingPrefix,
                    })
                  }
                />
              </FieldRow>
            </SettingsSection>

            <SettingsSection id="swarms" title="Swarms">
              <FieldRow label="Default strategy">
                <SelectInput
                  value={draft.swarms.defaultStrategy}
                  options={[
                    { value: 'managed', label: 'managed' },
                    { value: 'parallel', label: 'parallel' },
                    { value: 'sequential', label: 'sequential' },
                    { value: 'fan-out', label: 'fan-out' },
                  ]}
                  onChange={(defaultStrategy) =>
                    update('swarms', { ...draft.swarms, defaultStrategy })
                  }
                />
              </FieldRow>
              <FieldRow label="Max agents">
                <NumberInput
                  value={draft.swarms.maxAgents}
                  min={1}
                  max={16}
                  onChange={(maxAgents) => update('swarms', { ...draft.swarms, maxAgents })}
                />
              </FieldRow>
              <FieldRow label="Reviewer iterations">
                <NumberInput
                  value={draft.swarms.maxReviewerIterations}
                  min={1}
                  max={10}
                  onChange={(maxReviewerIterations) =>
                    update('swarms', { ...draft.swarms, maxReviewerIterations })
                  }
                />
              </FieldRow>
              <JsonEditor<SwarmTemplate[]>
                label="Swarm templates"
                value={draft.swarms.templates}
                onChange={(templates) => update('swarms', { ...draft.swarms, templates })}
              />
              <JsonEditor<Record<string, string>>
                label="Role prompts"
                value={draft.swarms.rolePrompts}
                onChange={(rolePrompts) => update('swarms', { ...draft.swarms, rolePrompts })}
              />
            </SettingsSection>

            <SettingsSection id="specs" title="Specs">
              <JsonEditor<SupportedAgentId[]>
                label="Default spec agents"
                value={draft.specs.defaultAgentIds}
                onChange={(defaultAgentIds) =>
                  update('specs', { ...draft.specs, defaultAgentIds })
                }
              />
              <JsonEditor<string[]>
                label="Default verification recipe ids"
                value={draft.specs.defaultVerificationRecipeIds}
                onChange={(defaultVerificationRecipeIds) =>
                  update('specs', { ...draft.specs, defaultVerificationRecipeIds })
                }
              />
              <FieldRow label="Target file limit">
                <NumberInput
                  value={draft.specs.targetFileLimit}
                  min={1}
                  max={100}
                  onChange={(targetFileLimit) =>
                    update('specs', { ...draft.specs, targetFileLimit })
                  }
                />
              </FieldRow>
              <FieldRow label="Require approval before run">
                <Toggle
                  checked={draft.specs.requireApprovalBeforeRun}
                  onChange={(requireApprovalBeforeRun) =>
                    update('specs', { ...draft.specs, requireApprovalBeforeRun })
                  }
                />
              </FieldRow>
            </SettingsSection>

            <SettingsSection id="verification" title="Verification">
              <JsonEditor<VerificationRecipe[]>
                label="Recipes"
                value={draft.verification.recipes}
                onChange={(recipes) => update('verification', { ...draft.verification, recipes })}
              />
              <FieldRow label="Require command prefix">
                <Toggle
                  checked={draft.verification.requireCommandPrefix}
                  onChange={(requireCommandPrefix) =>
                    update('verification', { ...draft.verification, requireCommandPrefix })
                  }
                />
              </FieldRow>
              <FieldRow label="Default timeout seconds">
                <NumberInput
                  value={draft.verification.defaultTimeoutSeconds}
                  min={5}
                  max={1800}
                  onChange={(defaultTimeoutSeconds) =>
                    update('verification', {
                      ...draft.verification,
                      defaultTimeoutSeconds,
                    })
                  }
                />
              </FieldRow>
              <FieldRow label="Max output bytes">
                <NumberInput
                  value={draft.verification.maxOutputBytes}
                  min={16384}
                  max={5000000}
                  onChange={(maxOutputBytes) =>
                    update('verification', { ...draft.verification, maxOutputBytes })
                  }
                />
              </FieldRow>
            </SettingsSection>

            <SettingsSection id="costs" title="Cost & Pricing">
              <FieldRow label="Monthly budget USD">
                <NumberInput
                  value={draft.costs.monthlyBudgetUsd}
                  min={0}
                  max={100000}
                  step={1}
                  onChange={(monthlyBudgetUsd) =>
                    update('costs', { ...draft.costs, monthlyBudgetUsd })
                  }
                />
              </FieldRow>
              <FieldRow label="Warn at percent">
                <NumberInput
                  value={draft.costs.warnAtPercent}
                  min={1}
                  max={100}
                  onChange={(warnAtPercent) => update('costs', { ...draft.costs, warnAtPercent })}
                />
              </FieldRow>
              <JsonEditor<AppSettings['costs']['pricing']>
                label="Model pricing"
                value={draft.costs.pricing}
                onChange={(pricing) => update('costs', { ...draft.costs, pricing })}
              />
            </SettingsSection>

            <SettingsSection id="appearance" title="Appearance">
              <div className="grid gap-2">
                <div className="text-[13px] font-medium text-secondary">Theme</div>
                <div className="text-[12px] leading-5 text-muted">
                  Applies instantly and is remembered on this device.
                </div>
                <ThemePicker />
              </div>
            </SettingsSection>

            <SettingsSection id="ui" title="UI">
              <FieldRow label="Compact mode">
                <Toggle
                  checked={draft.ui.compactMode}
                  onChange={(compactMode) => update('ui', { ...draft.ui, compactMode })}
                />
              </FieldRow>
              <FieldRow label="Sidebar default width">
                <NumberInput
                  value={draft.ui.sidebarDefaultWidth}
                  min={220}
                  max={420}
                  onChange={(sidebarDefaultWidth) =>
                    update('ui', { ...draft.ui, sidebarDefaultWidth })
                  }
                />
              </FieldRow>
              <FieldRow label="Right panel default open">
                <Toggle
                  checked={draft.ui.rightPanelDefaultOpen}
                  onChange={(rightPanelDefaultOpen) =>
                    update('ui', { ...draft.ui, rightPanelDefaultOpen })
                  }
                />
              </FieldRow>
              <FieldRow label="Right panel default mode">
                <SelectInput
                  value={draft.ui.rightPanelDefaultMode}
                  options={[
                    { value: 'diff', label: 'diff' },
                    { value: 'terminal', label: 'terminal' },
                  ]}
                  onChange={(rightPanelDefaultMode) =>
                    update('ui', { ...draft.ui, rightPanelDefaultMode })
                  }
                />
              </FieldRow>
              <FieldRow label="Terminal default height">
                <NumberInput
                  value={draft.ui.terminalDefaultHeight}
                  min={160}
                  max={640}
                  onChange={(terminalDefaultHeight) =>
                    update('ui', { ...draft.ui, terminalDefaultHeight })
                  }
                />
              </FieldRow>
            </SettingsSection>

            <SettingsSection id="editor" title="Editor">
              <FieldRow label="Default editor id">
                <TextInput
                  value={draft.editor.defaultEditorId}
                  onChange={(defaultEditorId) =>
                    update('editor', { ...draft.editor, defaultEditorId })
                  }
                />
              </FieldRow>
              <FieldRow label="CLI editor id">
                <TextInput
                  value={draft.editor.cliEditorId}
                  onChange={(cliEditorId) => update('editor', { ...draft.editor, cliEditorId })}
                />
              </FieldRow>
              <FieldRow label="Font size">
                <NumberInput
                  value={draft.editor.fontSize}
                  min={10}
                  max={24}
                  onChange={(fontSize) => update('editor', { ...draft.editor, fontSize })}
                />
              </FieldRow>
              <FieldRow label="Tab size">
                <NumberInput
                  value={draft.editor.tabSize}
                  min={1}
                  max={8}
                  onChange={(tabSize) => update('editor', { ...draft.editor, tabSize })}
                />
              </FieldRow>
              <FieldRow label="Word wrap">
                <Toggle
                  checked={draft.editor.wordWrap}
                  onChange={(wordWrap) => update('editor', { ...draft.editor, wordWrap })}
                />
              </FieldRow>
            </SettingsSection>

            <SettingsSection id="advanced" title="Advanced JSON">
              <textarea
                value={settingsDraft.jsonText}
                onChange={(event) => settingsDraft.setJsonText(event.target.value)}
                spellCheck={false}
                className="min-h-[360px] w-full resize-y rounded-card border border-hairline bg-card p-3 font-mono text-[12px] leading-5 text-primary outline-none focus:border-hairline-strong"
              />
              <div>
                <button
                  type="button"
                  onClick={settingsDraft.applyJson}
                  className="rounded-card border border-hairline bg-card px-3 py-1.5 text-[12px] text-secondary hover:bg-card-raised hover:text-primary"
                >
                  Apply JSON
                </button>
              </div>
            </SettingsSection>
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-hairline bg-sidebar px-6 py-3">
            <div className="min-w-0 text-[12px] text-muted">
              {settingsDraft.dirty ? 'Unsaved changes' : 'Settings are current'}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void settingsDraft.reset()}
                disabled={settingsDraft.saving}
                className="rounded-card border border-hairline bg-card px-3 py-1.5 text-[12px] text-secondary hover:bg-card-raised hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {settingsDraft.scope === 'project' ? 'Reset Overrides' : 'Reload'}
              </button>
              <button
                type="button"
                onClick={() => void settingsDraft.save()}
                disabled={!settingsDraft.dirty || settingsDraft.saving}
                className="rounded-card bg-accent-primary px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent-primary/85 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {settingsDraft.saving ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </footer>
        </section>
      </div>
    </main>
  )
}

function ThemePicker() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {THEME_IDS.map((id) => {
        const meta = THEME_META[id]
        const selected = theme === id
        return (
          <button
            key={id}
            type="button"
            onClick={() => setTheme(id)}
            aria-pressed={selected}
            className={`flex flex-col gap-3 rounded-card border p-3 text-left transition-colors ${
              selected
                ? 'border-accent-primary bg-card-raised'
                : 'border-hairline bg-card hover:border-hairline-strong hover:bg-card-raised'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold text-primary">{meta.label}</span>
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-pill border ${
                  selected ? 'border-accent-primary' : 'border-hairline-strong'
                }`}
              >
                {selected ? (
                  <span className="h-2 w-2 rounded-pill bg-accent-primary" />
                ) : null}
              </span>
            </div>
            <div className="flex gap-1.5">
              {meta.swatches.map((color, index) => (
                <span
                  key={index}
                  className="h-6 flex-1 rounded border border-hairline"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <span className="text-[12px] leading-5 text-muted">{meta.description}</span>
          </button>
        )
      })}
    </div>
  )
}

function SettingsTopBar({
  leftInsetClass,
  onOpenSidebar,
  sidebarCollapsed,
  onToggleSidebar,
  onClose,
}: {
  leftInsetClass: string
  onOpenSidebar?: () => void
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
  onClose?: () => void
}) {
  return (
    <div className={`drag flex h-11 shrink-0 items-center border-b border-hairline bg-canvas ${leftInsetClass} pr-2 gap-1`}>
      {onOpenSidebar ? (
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Open sidebar"
          className="no-drag flex h-7 w-7 items-center justify-center rounded text-secondary transition-colors hover:bg-white/5 hover:text-primary md:hidden"
        >
          <MenuIcon />
        </button>
      ) : null}
      {onToggleSidebar ? (
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          title={sidebarCollapsed ? 'Show sidebar (⌘B)' : 'Hide sidebar (⌘B)'}
          className="no-drag hidden md:flex h-7 w-7 items-center justify-center rounded text-secondary transition-colors hover:bg-white/5 hover:text-primary"
        >
          <SidebarToggleIcon collapsed={!!sidebarCollapsed} />
        </button>
      ) : null}
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          title="Close settings (Esc)"
          className="no-drag flex h-7 w-7 items-center justify-center rounded text-secondary transition-colors hover:bg-white/5 hover:text-primary"
        >
          <CloseIcon />
        </button>
      ) : null}
    </div>
  )
}

function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
      {collapsed ? (
        <path d="M12 10l2 2-2 2" />
      ) : (
        <path d="M14 14l-2-2 2-2" />
      )}
    </svg>
  )
}

function JsonEditor<T>({
  label,
  value,
  onChange,
}: {
  label: string
  value: T
  onChange: (value: T) => void
}) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setText(JSON.stringify(value, null, 2))
    setError(null)
  }, [value])

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[13px] font-medium text-secondary">{label}</div>
        <button
          type="button"
          onClick={() => {
            try {
              const parsed = JSON.parse(text) as T
              onChange(parsed)
              setText(JSON.stringify(parsed, null, 2))
              setError(null)
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : 'Invalid JSON')
            }
          }}
          className="rounded-card border border-hairline bg-card px-2 py-1 text-[11px] text-secondary hover:bg-card-raised hover:text-primary"
        >
          Apply
        </button>
      </div>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        spellCheck={false}
        className="min-h-[120px] w-full resize-y rounded-card border border-hairline bg-card p-3 font-mono text-[12px] leading-5 text-primary outline-none focus:border-hairline-strong"
      />
      {error ? <div className="text-[12px] text-accent-del">{error}</div> : null}
    </div>
  )
}

function agentOptions() {
  return agentIds.map((value) => ({ value, label: agentLabel(value) }))
}

function agentLabel(agentId: SupportedAgentId): string {
  return AGENT_LABELS[agentId]
}

function MenuIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}
