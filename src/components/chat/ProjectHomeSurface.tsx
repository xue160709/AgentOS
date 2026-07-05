/**
 * Agent Mode card home surface rendered from per-card Home Plugins.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'
import { MultimodalGroup, useInteractionObject } from '@xue160709/omni-ui-react'
import { A2uiSurface, basicCatalog, MarkdownContext, type ReactComponentImplementation } from '@a2ui/react/v0_9'
import { MessageProcessor, type A2uiClientAction, type A2uiMessage, type SurfaceModel } from '@a2ui/web_core/v0_9'
import type { AgentContextSlashItem, ChatModelPick, ClaudeAgentSettingsSnapshot, ClaudeAgentStatusSnapshot } from '../../claude-chat-types'
import type {
  AgentMcpServerConfig,
  AgentMcpServerOverrides,
  AgentMcpServerProbeCache,
  AgentMcpServerProbeSnapshot,
  AgentMcpToolPolicies,
  AgentMcpToolPolicy,
  AgentProjectDocumentName,
  HomePluginCardSize,
  HomePluginRunItem,
  HomePluginTaskMode,
  HomePluginTaskSchedule,
  HomePluginTaskSkillStep,
  ProjectContextAddMode,
  ProjectContextEntry,
} from '../../desktop-types'
import { IconInline } from '../../icon-inline'
import { SemanticButton, semanticAliases, useSemanticNodeRef } from '../../multimodal/semantic-controls'
import { CLAUDE_AGENT_SETTINGS_CHANGED_EVENT } from '../../app-events'
import { useI18n } from '../../i18n/i18n'
import {
  buildModelPickRows,
  modelPickFromRow,
  modelRowForPick,
  sameModelPick,
  validateModelPick,
  type ModelPickMenuRow,
} from '../../model-pick'
import type { AgentSettingsPanelId, FileTreeNode, ProjectSkillRunRequest, ThreadRunState, WorkspaceProject, WorkspaceThread } from '../types'
import type { WorkspaceAgentModeState } from '../useWorkspaceAgentMode'
import { sortProjectsForSidebar } from '../project-order'
import { formatBytes } from './format'
import { renderMarkdown } from './markdown'

type ProjectHomeSurfaceProps = {
  project: WorkspaceProject
  projects: WorkspaceProject[]
  projectOrderIds: readonly string[]
  agent: WorkspaceAgentModeState
  todoEnabled: boolean
  loading: boolean
  agentStatusSnapshot: ClaudeAgentStatusSnapshot | null
  agentSettingsOpen: boolean
  agentSettingsPanel: AgentSettingsPanelId
  onOpenAgentSettings: (panel: AgentSettingsPanelId) => void
  onAgentSettingsPanelChange: (panel: AgentSettingsPanelId) => void
  onCloseAgentSettings: () => void
  threads: WorkspaceThread[]
  threadRunStates: Record<string, ThreadRunState>
  hiddenSkillPaths: string[]
  onStartDataCardDraft: () => void
  onCreateProject: (mode: 'scratch' | 'existing') => void | Promise<void>
  onSelectProject: (projectId: string) => void
  onEditHomePluginCard: (item: HomePluginRunItem) => void
  onOpenProjectFile: (node: FileTreeNode) => void
  onRunProjectSkill: (projectId: string, skill: ProjectSkillRunRequest) => void
  onStopProjectSkillRun: (projectId: string, skillPath: string) => void
  onRefreshAgentStatus: (refresh?: boolean) => void
}

const pluginCache = new Map<string, { hashes: Record<string, string>; plugins: HomePluginRunItem[] }>()
const HOME_GRID_COLUMNS = 3
const HOME_CARD_LAYOUT_STORAGE_KEY = 'agentos:project-home-card-layout:v1'
const AGENT_PROJECT_DOCUMENT_NAMES: AgentProjectDocumentName[] = ['AGENTS.md', 'SOUL.md', 'GOAL.md']
const TODO_HOME_PLUGIN_ID = 'agentos.todo-card'

type HomeCardItem =
  | { kind: 'plugin'; cardId: string; item: HomePluginRunItem; size: HomePluginCardSize }
  | { kind: 'skill'; cardId: string; skill: AgentContextSlashItem; size: HomePluginCardSize }

type HomeGridItem =
  | { kind: 'card'; card: HomeCardItem }
  | { kind: 'filler'; id: string; span: 1 | 2; tone: 'grid' | 'signal' | 'trace' }
type ProjectMcpOperation = 'idle' | 'saving' | 'testing'
type HomeGridFillerItem = Extract<HomeGridItem, { kind: 'filler' }>

type HomeCardLayout = {
  order: string[]
  sizes: Record<string, HomePluginCardSize>
}

type TodoHomeCardData = {
  phase: string
  progress: string
  currentTask: string
  nextStep: string
  blocker: string
  updatedAt: string
  completed: number
  total: number
  percent: number
  tasks: TodoHomeCardTask[]
}

type TodoHomeCardTask = {
  id: string
  title: string
  checked: boolean
  status: string
  priority: string
}

type ProjectHomeProjectSelectorProps = {
  project: WorkspaceProject
  projects: WorkspaceProject[]
  projectOrderIds: readonly string[]
  onCreateProject: (mode: 'scratch' | 'existing') => void | Promise<void>
  onSelectProject: (projectId: string) => void
}

/** Codex-style project switcher used on the project home surface. */
export function ProjectHomeProjectSelector({
  project,
  projects,
  projectOrderIds,
  onCreateProject,
  onSelectProject,
}: ProjectHomeProjectSelectorProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const selectorRef = useRef<HTMLDivElement>(null)
  const orderedProjects = useMemo(
    () => sortProjectsForSidebar(projects, projectOrderIds),
    [projectOrderIds, projects],
  )

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (target && selectorRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="project-home-project-selector" ref={selectorRef}>
      <SemanticButton
        type="button"
        className="chat-start-view__project project-home-project-trigger"
        title={project.path}
        aria-label={t('chat.switchProject')}
        aria-haspopup="menu"
        aria-expanded={open}
        semantic={{
          id: 'agentos.control.projectHome.projectSelector',
          role: 'button',
          label: t('omni.controls.projectHomeSelector'),
          actions: ['press'],
          state: { open, projectId: project.id, projectName: project.name },
          hint: { aliases: semanticAliases(t, 'omni.aliases.projectSelector') },
        }}
        onClick={() => setOpen((value) => !value)}
      >
        <IconInline name="folder" />
        <span className="project-home-project-trigger__copy">
          <span>{project.name}</span>
          {project.pathMissing ? (
            <span className="project-home-project-trigger__badge">{t('sidebar.projectPathMissingBadge')}</span>
          ) : null}
        </span>
        <IconInline name="chevron" className="project-home-project-trigger__chevron" />
      </SemanticButton>
      {open ? (
        <div className="project-home-project-menu" role="menu" aria-label={t('chat.projectMenuAria')}>
          <div className="project-home-project-menu__list">
            {orderedProjects.map((item) => {
              const active = item.id === project.id
              return (
                <SemanticButton
                  key={item.id}
                  type="button"
                  role="menuitem"
                  className={`project-home-project-menu__item${active ? ' is-active' : ''}`}
                  aria-current={active ? 'true' : undefined}
                  title={item.path}
                  semantic={{
                    id: `agentos.control.projectHome.project.${item.id}`,
                    role: 'menuitem',
                    label: t('omni.controls.projectSelect', { name: item.name }),
                    actions: ['press'],
                    state: { active, projectId: item.id, pathMissing: Boolean(item.pathMissing) },
                    hint: { aliases: [item.name, item.path].filter(Boolean) },
                  }}
                  onClick={() => {
                    setOpen(false)
                    if (!active) onSelectProject(item.id)
                  }}
                >
                  <IconInline name="folder" />
                  <span className="project-home-project-menu__copy">
                    <span className="project-home-project-menu__name">{item.name}</span>
                    <span className="project-home-project-menu__path">
                      {item.pathMissing ? t('sidebar.projectPathMissingBadge') : item.path}
                    </span>
                  </span>
                  {active ? <IconInline name="check" className="project-home-project-menu__check" /> : null}
                </SemanticButton>
              )
            })}
          </div>
          <div className="project-home-project-menu__footer">
            <SemanticButton
              type="button"
              role="menuitem"
              className="project-home-project-menu__item project-home-project-menu__item--add"
              semantic={{
                id: 'agentos.control.projectHome.addProject',
                role: 'menuitem',
                label: t('chat.addProjectTitle'),
                actions: ['press'],
                hint: { aliases: semanticAliases(t, 'omni.aliases.addProject') },
              }}
              onClick={() => {
                setOpen(false)
                void onCreateProject('existing')
              }}
            >
              <IconInline name="plus" />
              <span>{t('chat.addProjectTitle')}</span>
            </SemanticButton>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** Runs all card Home Plugins and renders the Agent Mode card grid. */
export function ProjectHomeSurface({
  project,
  projects,
  projectOrderIds,
  agent,
  todoEnabled,
  loading,
  agentStatusSnapshot,
  agentSettingsOpen,
  agentSettingsPanel,
  onOpenAgentSettings,
  onAgentSettingsPanelChange,
  onCloseAgentSettings,
  threads,
  threadRunStates,
  hiddenSkillPaths,
  onStartDataCardDraft,
  onCreateProject,
  onSelectProject,
  onEditHomePluginCard,
  onOpenProjectFile,
  onRunProjectSkill,
  onStopProjectSkillRun,
  onRefreshAgentStatus,
}: ProjectHomeSurfaceProps) {
  const { t } = useI18n()
  const cacheKey = project.path
  const outputHashesRef = useRef<Record<string, string>>(pluginCache.get(cacheKey)?.hashes ?? {})
  const [plugins, setPlugins] = useState<HomePluginRunItem[]>(() => pluginCache.get(cacheKey)?.plugins ?? [])
  const [skills, setSkills] = useState<AgentContextSlashItem[]>([])
  const [cardLayout, setCardLayout] = useState<HomeCardLayout>(() => readHomeCardLayout(cacheKey))
  const [error, setError] = useState('')
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [taskDialogOpen, setTaskDialogOpen] = useState(false)
  const [editingTaskSlug, setEditingTaskSlug] = useState<string | undefined>()
  const [draftOrder, setDraftOrder] = useState<string[]>([])
  const [draftSizes, setDraftSizes] = useState<Record<string, HomePluginCardSize>>({})
  const [projectModelPick, setProjectModelPick] = useState<ChatModelPick | undefined>(undefined)
  const [draftProjectModelPick, setDraftProjectModelPick] = useState<ChatModelPick | undefined>(undefined)
  const [projectDocumentDrafts, setProjectDocumentDrafts] = useState<Record<AgentProjectDocumentName, string>>(() => emptyAgentProjectDocuments())
  const [savedProjectDocumentDrafts, setSavedProjectDocumentDrafts] = useState<Record<AgentProjectDocumentName, string>>(() => emptyAgentProjectDocuments())
  const [projectSettingsStatus, setProjectSettingsStatus] = useState('')
  const [projectSettingsSaving, setProjectSettingsSaving] = useState(false)
  const [projectContextEntries, setProjectContextEntries] = useState<ProjectContextEntry[]>([])
  const [projectContextInstructions, setProjectContextInstructions] = useState('')
  const [savedProjectContextInstructions, setSavedProjectContextInstructions] = useState('')
  const [projectContextReadOnly, setProjectContextReadOnly] = useState(false)
  const [projectContextTargetPath, setProjectContextTargetPath] = useState('')
  const [projectContextStatus, setProjectContextStatus] = useState('')
  const [projectContextBusy, setProjectContextBusy] = useState(false)
  const [skillModelOverrides, setSkillModelOverrides] = useState<Record<string, ChatModelPick>>({})
  const [draftSkillModelOverrides, setDraftSkillModelOverrides] = useState<Record<string, ChatModelPick>>({})
  const [skillSettingsStatus, setSkillSettingsStatus] = useState('')
  const [skillSettingsSaving, setSkillSettingsSaving] = useState(false)
  const [mcpServers, setMcpServers] = useState<AgentMcpServerConfig[]>([])
  const [draftMcpServers, setDraftMcpServers] = useState<AgentMcpServerConfig[]>([])
  const [mcpServerOverrides, setMcpServerOverrides] = useState<AgentMcpServerOverrides>({})
  const [draftMcpServerOverrides, setDraftMcpServerOverrides] = useState<AgentMcpServerOverrides>({})
  const [mcpToolPolicies, setMcpToolPolicies] = useState<AgentMcpToolPolicies>({})
  const [draftMcpToolPolicies, setDraftMcpToolPolicies] = useState<AgentMcpToolPolicies>({})
  const [mcpServerProbeCache, setMcpServerProbeCache] = useState<AgentMcpServerProbeCache>({})
  const [mcpSettingsStatus, setMcpSettingsStatus] = useState('')
  const [mcpSettingsOperation, setMcpSettingsOperation] = useState<ProjectMcpOperation>('idle')
  const autoTestedProjectMcpSignatureRef = useRef('')
  const agentSettingsLoadSeqRef = useRef(0)
  const projectMcpProbeSeqRef = useRef(0)
  const projectPathRef = useRef(project.path)
  const agentSettingsOpenRef = useRef(agentSettingsOpen)
  const agentSettingsPanelRef = useRef(agentSettingsPanel)
  const [cardOrderSaving, setCardOrderSaving] = useState(false)
  const [cardOrderStatus, setCardOrderStatus] = useState('')
  const [modelRows, setModelRows] = useState<ModelPickMenuRow[]>([])
  const [modelSettingsSnapshot, setModelSettingsSnapshot] = useState<ClaudeAgentSettingsSnapshot | null>(null)
  const [deletingSlug, setDeletingSlug] = useState('')
  const addMenuRef = useRef<HTMLDivElement>(null)
  projectPathRef.current = project.path
  agentSettingsOpenRef.current = agentSettingsOpen
  agentSettingsPanelRef.current = agentSettingsPanel
  const mcpStatusServers = useMemo(() => {
    if (!agentStatusSnapshot) return undefined
    if (agentStatusSnapshot.cwd && !sameProjectPath(agentStatusSnapshot.cwd, project.path)) return undefined
    return agentStatusSnapshot.mcpServers
  }, [agentStatusSnapshot, project.path])

  useEffect(() => {
    autoTestedProjectMcpSignatureRef.current = ''
    agentSettingsLoadSeqRef.current += 1
    projectMcpProbeSeqRef.current += 1
    setMcpSettingsOperation('idle')
    setMcpSettingsStatus('')
  }, [project.path])

  useEffect(() => {
    if (agentSettingsOpen && agentSettingsPanel === 'mcp') return
    projectMcpProbeSeqRef.current += 1
    setMcpSettingsOperation((operation) => (operation === 'testing' ? 'idle' : operation))
  }, [agentSettingsOpen, agentSettingsPanel])

  const loadHomePlugins = useCallback(async () => {
    const runHomePlugin = window.desktop?.runHomePlugin
    if (!runHomePlugin) return
    try {
      const result = await runHomePlugin(project.path, { knownOutputHashes: outputHashesRef.current })
      if (!result.ok) {
        setError(result.message)
        return
      }
      setError('')
      const cached = pluginCache.get(cacheKey)?.plugins ?? []
      const cachedBySlug = new Map(cached.map((item) => [item.slug, item]))
      const nextPlugins = (result.plugins ?? []).map((item) => {
        if (item.status !== 'unchanged') return item
        const cachedItem = cachedBySlug.get(item.slug)
        return {
          ...item,
          messages: cachedItem?.messages,
          variants: cachedItem?.variants,
        } as HomePluginRunItem
      })
      const hashes: Record<string, string> = {}
      for (const item of nextPlugins) {
        if (item.outputHash) hashes[item.slug] = item.outputHash
      }
      outputHashesRef.current = hashes
      pluginCache.set(cacheKey, { hashes, plugins: nextPlugins })
      setPlugins(nextPlugins)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
  }, [cacheKey, project.path])

  const loadProjectSkills = useCallback(async () => {
    const listAgentContext = window.desktop?.listAgentContext
    if (!listAgentContext) {
      setSkills([])
      return
    }
    try {
      const result = await listAgentContext(project.path)
      setSkills(result.ok ? result.skills.filter((skill) => skill.kind === 'skill' && skill.scope === 'project') : [])
    } catch {
      setSkills([])
    }
  }, [project.path])

  useEffect(() => {
    outputHashesRef.current = pluginCache.get(cacheKey)?.hashes ?? {}
    setPlugins(pluginCache.get(cacheKey)?.plugins ?? [])
    setSkills([])
    setCardLayout(readHomeCardLayout(cacheKey))
    setError('')
    void loadHomePlugins()
    void loadProjectSkills()
  }, [cacheKey, loadHomePlugins, loadProjectSkills])

  const applyModelSettings = useCallback(
    (snapshot: ClaudeAgentSettingsSnapshot) => {
      const slots = {
        primary: t('chat.modelSlotPrimary'),
        haiku: t('chat.modelSlotHaiku'),
        sonnet: t('chat.modelSlotSonnet'),
        opus: t('chat.modelSlotOpus'),
      }
      setModelSettingsSnapshot(snapshot)
      setModelRows(buildModelPickRows(snapshot.settings.providers, slots, t('chat.modelFallback')))
    },
    [t],
  )

  useEffect(() => {
    window.claudeChat?.getSettings().then(applyModelSettings).catch(() => {
      setModelSettingsSnapshot(null)
      setModelRows([])
    })
    const onSettingsChanged = (event: Event) => {
      applyModelSettings((event as CustomEvent<ClaudeAgentSettingsSnapshot>).detail)
    }
    window.addEventListener(CLAUDE_AGENT_SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => window.removeEventListener(CLAUDE_AGENT_SETTINGS_CHANGED_EVENT, onSettingsChanged)
  }, [applyModelSettings])

  const loadAgentSkillModelSettings = useCallback(async () => {
    const requestProjectPath = project.path
    const requestSeq = agentSettingsLoadSeqRef.current + 1
    agentSettingsLoadSeqRef.current = requestSeq
    const isCurrentRequest = () => agentSettingsLoadSeqRef.current === requestSeq && projectPathRef.current === requestProjectPath
    const getAgentModeSettings = window.desktop?.getAgentModeSettings
    if (!getAgentModeSettings) {
      if (!isCurrentRequest()) return
      setProjectModelPick(undefined)
      setDraftProjectModelPick(undefined)
      setSkillModelOverrides({})
      setDraftSkillModelOverrides({})
      setMcpServers([])
      setDraftMcpServers([])
      setMcpServerOverrides({})
      setDraftMcpServerOverrides({})
      setMcpToolPolicies({})
      setDraftMcpToolPolicies({})
      setMcpServerProbeCache({})
      setMcpSettingsStatus(t('settings.agentMode.bridgeUnavailable'))
      setSkillSettingsStatus(t('settings.agentMode.bridgeUnavailable'))
      setProjectSettingsStatus(t('settings.agentMode.bridgeUnavailable'))
      return
    }
    try {
      const result = await getAgentModeSettings(requestProjectPath)
      if (!isCurrentRequest()) return
      if (!result.ok) {
        setSkillSettingsStatus(result.message)
        setProjectSettingsStatus(result.message)
        setMcpSettingsStatus(result.message)
        return
      }
      const projectPick = result.settings.projectModelPick
      setProjectModelPick(projectPick)
      setDraftProjectModelPick(projectPick)
      const overrides = result.settings.skillModelOverrides ?? {}
      setSkillModelOverrides(overrides)
      setDraftSkillModelOverrides(overrides)
      const servers = result.settings.mcpServers ?? []
      setMcpServers(servers)
      setDraftMcpServers(servers)
      const serverOverrides = result.settings.mcpServerOverrides ?? {}
      setMcpServerOverrides(serverOverrides)
      setDraftMcpServerOverrides(serverOverrides)
      const policies = result.settings.mcpToolPolicies ?? {}
      setMcpToolPolicies(policies)
      setDraftMcpToolPolicies(policies)
      setMcpServerProbeCache(result.settings.mcpServerProbeCache ?? {})
      setMcpSettingsStatus(t('settings.agentMode.loaded'))
      setSkillSettingsStatus(t('settings.agentMode.loaded'))
      setProjectSettingsStatus(t('settings.agentMode.loaded'))
    } catch (error) {
      if (!isCurrentRequest()) return
      setSkillSettingsStatus(error instanceof Error ? error.message : String(error))
      setProjectSettingsStatus(error instanceof Error ? error.message : String(error))
      setMcpSettingsStatus(error instanceof Error ? error.message : String(error))
    }
  }, [project.path, t])

  useEffect(() => {
    if (!agentSettingsOpen) return
    void loadAgentSkillModelSettings()
  }, [agentSettingsOpen, loadAgentSkillModelSettings])

  useEffect(() => {
    void loadAgentSkillModelSettings()
  }, [loadAgentSkillModelSettings])

  const loadAgentProjectDocuments = useCallback(async () => {
    const readAgentProjectDocuments = window.desktop?.readAgentProjectDocuments
      if (!readAgentProjectDocuments) {
        setProjectDocumentDrafts(emptyAgentProjectDocuments())
        setSavedProjectDocumentDrafts(emptyAgentProjectDocuments())
        setProjectSettingsStatus(t('settings.agentMode.bridgeUnavailable'))
        return
      }
    try {
      const result = await readAgentProjectDocuments(project.path)
      if (!result.ok) {
        setProjectSettingsStatus(result.message)
        return
      }
      setProjectDocumentDrafts(result.files)
      setSavedProjectDocumentDrafts(result.files)
      setProjectSettingsStatus(t('settings.agentMode.loaded'))
    } catch (error) {
      setProjectSettingsStatus(error instanceof Error ? error.message : String(error))
    }
  }, [project.path, t])

  useEffect(() => {
    if (!agentSettingsOpen) return
    void loadAgentProjectDocuments()
  }, [agentSettingsOpen, loadAgentProjectDocuments])

  const applyProjectContext = useCallback((context: { entries: ProjectContextEntry[]; instructions: string; readOnly: boolean; contextTargetPath?: string }) => {
    setProjectContextEntries(context.entries)
    setProjectContextInstructions(context.instructions)
    setSavedProjectContextInstructions(context.instructions)
    setProjectContextReadOnly(context.readOnly)
    setProjectContextTargetPath(context.contextTargetPath ?? '')
  }, [])

  const loadProjectContext = useCallback(async () => {
    const listProjectContext = window.desktop?.listProjectContext
    if (!listProjectContext) {
      setProjectContextEntries([])
      setProjectContextInstructions('')
      setSavedProjectContextInstructions('')
      setProjectContextReadOnly(false)
      setProjectContextTargetPath('')
      setProjectContextStatus(t('settings.agentMode.bridgeUnavailable'))
      return
    }
    setProjectContextBusy(true)
    try {
      const result = await listProjectContext(project.path)
      if (!result.ok) {
        setProjectContextStatus(result.message)
        return
      }
      applyProjectContext(result)
      setProjectContextStatus(result.readOnly ? t('workspace.agentSettingsContextLoadedReadOnly') : t('workspace.agentSettingsContextLoaded'))
    } catch (error) {
      setProjectContextStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setProjectContextBusy(false)
    }
  }, [applyProjectContext, project.path, t])

  useEffect(() => {
    if (!agentSettingsOpen || agentSettingsPanel !== 'context') return
    void loadProjectContext()
  }, [agentSettingsOpen, agentSettingsPanel, loadProjectContext])

  const addProjectContext = async (mode: ProjectContextAddMode) => {
    const addProjectContextEntries = window.desktop?.addProjectContextEntries
    if (!addProjectContextEntries) {
      setProjectContextStatus(t('settings.agentMode.bridgeUnavailable'))
      return
    }
    setProjectContextBusy(true)
    setProjectContextStatus(mode === 'copy' ? t('workspace.agentSettingsContextCopying') : t('workspace.agentSettingsContextReferencing'))
    try {
      const result = await addProjectContextEntries(project.path, mode)
      if (!result.ok) {
        setProjectContextStatus(result.message)
        return
      }
      applyProjectContext(result)
      if (result.added.length === 0 && result.skipped.length === 0) {
        setProjectContextStatus(t('workspace.agentSettingsContextNoSelection'))
        return
      }
      const skipped = result.skipped.length > 0 ? t('workspace.agentSettingsContextSkipped', { count: result.skipped.length }) : ''
      setProjectContextStatus(
        [t('workspace.agentSettingsContextAdded', { count: result.added.length }), skipped].filter(Boolean).join(' '),
      )
      window.dispatchEvent(new CustomEvent('project-home:refresh'))
    } catch (error) {
      setProjectContextStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setProjectContextBusy(false)
    }
  }

  const saveProjectContextInstructions = async () => {
    const saveProjectContextInstructions = window.desktop?.saveProjectContextInstructions
    if (!saveProjectContextInstructions) {
      setProjectContextStatus(t('settings.agentMode.bridgeUnavailable'))
      return
    }
    setProjectContextBusy(true)
    setProjectContextStatus(t('settings.agentMode.saving'))
    try {
      const result = await saveProjectContextInstructions(project.path, projectContextInstructions)
      if (!result.ok) {
        setProjectContextStatus(result.message)
        return
      }
      applyProjectContext(result)
      setProjectContextStatus(t('settings.agentMode.saved'))
      window.dispatchEvent(new CustomEvent('agentos:project-agent-settings-changed', { detail: { projectPath: project.path } }))
    } catch (error) {
      setProjectContextStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setProjectContextBusy(false)
    }
  }

  const removeProjectContextEntry = async (entry: ProjectContextEntry) => {
    const removeProjectContextEntry = window.desktop?.removeProjectContextEntry
    if (!removeProjectContextEntry) {
      setProjectContextStatus(t('settings.agentMode.bridgeUnavailable'))
      return
    }
    const confirmed = window.confirm(
      entry.mode === 'reference'
        ? t('workspace.agentSettingsContextRemoveReferenceConfirm', { name: entry.name })
        : t('workspace.agentSettingsContextRemoveLocalConfirm', { name: entry.name }),
    )
    if (!confirmed) return

    setProjectContextBusy(true)
    setProjectContextStatus(t('workspace.agentSettingsContextRemoving'))
    try {
      const result = await removeProjectContextEntry(project.path, entry.relativePath)
      if (!result.ok) {
        setProjectContextStatus(result.message)
        return
      }
      applyProjectContext(result)
      setProjectContextStatus(t('workspace.agentSettingsContextRemoved'))
      window.dispatchEvent(new CustomEvent('project-home:refresh'))
    } catch (error) {
      setProjectContextStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setProjectContextBusy(false)
    }
  }

  useEffect(() => {
    const onRefresh = () => {
      void loadHomePlugins()
      void loadProjectSkills()
    }
    window.addEventListener('project-home:refresh', onRefresh)
    return () => window.removeEventListener('project-home:refresh', onRefresh)
  }, [loadHomePlugins, loadProjectSkills])

  useEffect(() => {
    const subscribe = window.desktop?.onHomePluginTaskEvent
    if (!subscribe) return
    let refreshTimer: number | null = null
    const scheduleRefresh = () => {
      if (refreshTimer != null) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null
        outputHashesRef.current = {}
        void loadHomePlugins()
      }, 80)
    }
    const unsubscribe = subscribe((event) => {
      if (!sameProjectPath(event.projectPath, project.path)) return
      scheduleRefresh()
    })
    return () => {
      if (refreshTimer != null) window.clearTimeout(refreshTimer)
      unsubscribe()
    }
  }, [loadHomePlugins, project.path])

  useEffect(() => {
    if (!addMenuOpen) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (target && addMenuRef.current?.contains(target)) return
      setAddMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAddMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [addMenuOpen])

  const visiblePlugins = useMemo(
    () => plugins.filter((item) => item.status !== 'empty' && hasRenderableMessages(item)),
    [plugins],
  )
  const hiddenSkillPathKey = hiddenSkillPaths.join('\n')
  const hiddenSkillPathSet = useMemo(() => new Set(hiddenSkillPaths), [hiddenSkillPathKey])
  const visibleSkills = useMemo(
    () => skills.filter((skill) => !hiddenSkillPathSet.has(skill.path)),
    [hiddenSkillPathSet, skills],
  )
  const homeCards = useMemo(() => {
    const pluginCards: HomeCardItem[] = visiblePlugins.map((item) => {
      const cardId = pluginCardId(item.slug)
      return {
        kind: 'plugin',
        cardId,
        item,
        size: cardLayout.sizes[cardId] ?? item.manifest.preferredSize,
      }
    })
    const skillCards: HomeCardItem[] = visibleSkills.map((skill) => {
      const cardId = skillCardId(skill)
      return {
        kind: 'skill',
        cardId,
        skill,
        size: cardLayout.sizes[cardId] ?? 'small',
      }
    })
    return sortHomeCards([...pluginCards, ...skillCards], cardLayout.order)
  }, [cardLayout.order, cardLayout.sizes, visiblePlugins, visibleSkills])
  const gridItems = useMemo(() => buildHomeGridItems(homeCards), [homeCards])

  useEffect(() => {
    if (!agentSettingsOpen || agentSettingsPanel !== 'card-order') return
    setDraftOrder(homeCards.map((card) => card.cardId))
    setDraftSizes(Object.fromEntries(homeCards.map((card) => [card.cardId, card.size])))
  }, [agentSettingsOpen, agentSettingsPanel, homeCards])

  const saveProjectSettings = async () => {
    const saveAgentModeSettings = window.desktop?.saveAgentModeSettings
    const saveAgentProjectDocuments = window.desktop?.saveAgentProjectDocuments
    if (!saveAgentModeSettings || !saveAgentProjectDocuments) {
      setProjectSettingsStatus(t('settings.agentMode.bridgeUnavailable'))
      return
    }
    const nextProjectPick = modelSettingsSnapshot
      ? validateModelPick(modelSettingsSnapshot.settings, draftProjectModelPick)
      : draftProjectModelPick
    setProjectSettingsSaving(true)
    setProjectSettingsStatus(t('settings.agentMode.saving'))
    try {
      const settingsResult = await saveAgentModeSettings(project.path, { projectModelPick: nextProjectPick })
      if (!settingsResult.ok) {
        setProjectSettingsStatus(settingsResult.message)
        return
      }
      const docsResult = await saveAgentProjectDocuments(project.path, projectDocumentDrafts)
      if (!docsResult.ok) {
        setProjectSettingsStatus(docsResult.message)
        return
      }
      const savedPick = settingsResult.settings.projectModelPick
      const projectModelPickChanged = !sameModelPick(projectModelPick, savedPick)
      setProjectModelPick(savedPick)
      setDraftProjectModelPick(savedPick)
      setProjectDocumentDrafts(docsResult.files)
      setSavedProjectDocumentDrafts(docsResult.files)
      setProjectSettingsStatus(t('settings.agentMode.saved'))
      window.dispatchEvent(new CustomEvent('agentos:project-agent-settings-changed', { detail: { projectPath: project.path, projectModelPickChanged } }))
    } catch (error) {
      setProjectSettingsStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setProjectSettingsSaving(false)
    }
  }

  const saveSkillModelSettings = async () => {
    const saveAgentModeSettings = window.desktop?.saveAgentModeSettings
    if (!saveAgentModeSettings) {
      setSkillSettingsStatus(t('settings.agentMode.bridgeUnavailable'))
      return
    }
    const skillPaths = new Set(skills.map((skill) => skill.path))
    const next = Object.fromEntries(
      Object.entries(draftSkillModelOverrides).filter(([skillPath, pick]) => {
        if (!skillPaths.has(skillPath)) return false
        return modelSettingsSnapshot ? Boolean(validateModelPick(modelSettingsSnapshot.settings, pick)) : true
      }),
    )
    setSkillSettingsSaving(true)
    setSkillSettingsStatus(t('settings.agentMode.saving'))
    try {
      const result = await saveAgentModeSettings(project.path, { skillModelOverrides: next })
      if (!result.ok) {
        setSkillSettingsStatus(result.message)
        return
      }
      const overrides = result.settings.skillModelOverrides ?? {}
      setSkillModelOverrides(overrides)
      setDraftSkillModelOverrides(overrides)
      setSkillSettingsStatus(t('settings.agentMode.saved'))
    } catch (error) {
      setSkillSettingsStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setSkillSettingsSaving(false)
    }
  }

  const saveMcpSettings = async () => {
    const saveAgentModeSettings = window.desktop?.saveAgentModeSettings
    if (!saveAgentModeSettings) {
      setMcpSettingsStatus(t('settings.agentMode.bridgeUnavailable'))
      return
    }
    const requestProjectPath = project.path
    projectMcpProbeSeqRef.current += 1
    setMcpSettingsOperation((operation) => (operation === 'testing' ? 'idle' : operation))
    const nextOverrides = overridesFromMcpServers(draftMcpServers)
    const nextPolicies = normalizeMcpPoliciesForSave(draftMcpToolPolicies)
    const validationError = validateMcpSettings(draftMcpServers, nextPolicies, t)
    if (validationError) {
      setMcpSettingsStatus(validationError)
      return
    }
    setMcpSettingsOperation('saving')
    setMcpSettingsStatus(t('settings.agentMode.saving'))
    try {
      const result = await saveAgentModeSettings(requestProjectPath, {
        mcpServerOverrides: nextOverrides,
        mcpToolPolicies: nextPolicies,
      })
      if (projectPathRef.current !== requestProjectPath) return
      if (!result.ok) {
        setMcpSettingsStatus(result.message)
        return
      }
      const servers = result.settings.mcpServers ?? []
      const serverOverrides = result.settings.mcpServerOverrides ?? {}
      const policies = result.settings.mcpToolPolicies ?? {}
      setMcpServers(servers)
      setDraftMcpServers(servers)
      setMcpServerOverrides(serverOverrides)
      setDraftMcpServerOverrides(serverOverrides)
      setMcpToolPolicies(policies)
      setDraftMcpToolPolicies(policies)
      setMcpServerProbeCache(result.settings.mcpServerProbeCache ?? {})
      setMcpSettingsStatus(t('settings.agentMode.saved'))
      window.dispatchEvent(new CustomEvent('agentos:project-agent-settings-changed', { detail: { projectPath: requestProjectPath } }))
    } catch (error) {
      if (projectPathRef.current !== requestProjectPath) return
      setMcpSettingsStatus(error instanceof Error ? error.message : String(error))
    } finally {
      if (projectPathRef.current === requestProjectPath) setMcpSettingsOperation('idle')
    }
  }

  const refreshProjectMcpProbeStatus = useCallback(async (servers: AgentMcpServerConfig[]) => {
    const enabledServers = servers.filter((server) => server.enabled)
    if (enabledServers.length === 0) return
    const requestProjectPath = project.path
    const requestSeq = projectMcpProbeSeqRef.current + 1
    projectMcpProbeSeqRef.current = requestSeq
    const isCurrentProbe = () =>
      projectMcpProbeSeqRef.current === requestSeq &&
      projectPathRef.current === requestProjectPath &&
      agentSettingsOpenRef.current &&
      agentSettingsPanelRef.current === 'mcp'
    const testGlobalMcpServer = window.desktop?.testGlobalMcpServer
    if (!testGlobalMcpServer) {
      if (!isCurrentProbe()) return
      setMcpSettingsStatus(t('settings.agentMode.bridgeUnavailable'))
      return
    }
    setMcpSettingsOperation('testing')
    setMcpSettingsStatus(t('workspace.agentSettingsMcpTestingEnabled', { count: enabledServers.length }))
    let tested = 0
    let connected = 0
    try {
      for (const server of enabledServers) {
        if (!isCurrentProbe()) return
        setMcpSettingsStatus(t('settings.mcp.testing', { name: server.name }))
        const result = await testGlobalMcpServer(server)
        if (!isCurrentProbe()) return
        const snapshot = result.snapshot
        if (snapshot) {
          setMcpServerProbeCache((current) => ({
            ...current,
            [snapshot.serverName]: snapshot,
          }))
        }
        tested += 1
        if (result.ok && snapshot?.status === 'connected') connected += 1
      }
      setMcpSettingsStatus(t('workspace.agentSettingsMcpTestEnabledDone', { tested, connected }))
    } catch (error) {
      if (!isCurrentProbe()) return
      setMcpSettingsStatus(error instanceof Error ? error.message : String(error))
    } finally {
      if (isCurrentProbe()) setMcpSettingsOperation('idle')
    }
  }, [project.path, t])

  const refreshMcpStatus = useCallback(() => {
    void refreshProjectMcpProbeStatus(mcpServers)
    onRefreshAgentStatus(true)
  }, [mcpServers, onRefreshAgentStatus, refreshProjectMcpProbeStatus])

  useEffect(() => {
    if (!agentSettingsOpen || agentSettingsPanel !== 'mcp') return
    const enabledServers = mcpServers.filter((server) => server.enabled)
    const signature = enabledServers.map((server) => `${server.name}:${buildMcpServerConfigSignature(server)}`).join('|')
    const signatureKey = `${project.path}:${signature}`
    if (!signature || autoTestedProjectMcpSignatureRef.current === signatureKey) return
    autoTestedProjectMcpSignatureRef.current = signatureKey
    void refreshProjectMcpProbeStatus(enabledServers)
  }, [agentSettingsOpen, agentSettingsPanel, mcpServers, project.path, refreshProjectMcpProbeStatus])

  const saveSortOrder = async () => {
    setCardOrderSaving(true)
    setCardOrderStatus(t('settings.agentMode.saving'))
    const cardsById = new Map(homeCards.map((card) => [card.cardId, card]))
    const pluginOrder = draftOrder
      .map((cardId) => cardsById.get(cardId))
      .filter((card): card is Extract<HomeCardItem, { kind: 'plugin' }> => card?.kind === 'plugin')
      .map((card) => card.item.slug)
    const layoutCards = homeCards
      .filter((card): card is Extract<HomeCardItem, { kind: 'plugin' }> => card.kind === 'plugin')
      .map((card) => ({
        slug: card.item.slug,
        preferredSize: draftSizes[card.cardId] ?? card.size,
      }))
    if (layoutCards.length > 0) {
      const result = window.desktop?.saveHomePluginLayout
        ? await window.desktop.saveHomePluginLayout(project.path, pluginOrder, layoutCards)
        : window.desktop?.saveHomePluginOrder
          ? await window.desktop.saveHomePluginOrder(project.path, pluginOrder)
          : null
      if (result && !result.ok) {
        setError(result.message)
        setCardOrderStatus(result.message)
        return
      }
    }
    const nextLayout = normalizeHomeCardLayout({ order: draftOrder, sizes: draftSizes })
    writeHomeCardLayout(project.path, nextLayout)
    setCardLayout(nextLayout)
    setCardOrderStatus(t('settings.agentMode.saved'))
    outputHashesRef.current = {}
    window.dispatchEvent(new CustomEvent('project-home:refresh'))
    setCardOrderSaving(false)
  }

  const saveSortOrderWithGuard = async () => {
    try {
      await saveSortOrder()
    } finally {
      setCardOrderSaving(false)
    }
  }

  const deleteCard = async (item: HomePluginRunItem) => {
    const deleteHomePlugin = window.desktop?.deleteHomePlugin
    if (!deleteHomePlugin) {
      setError(t('workspace.deleteAgentCardUnavailable'))
      return
    }
    if (deletingSlug) return
    const pluginPath = `${project.path}/.agents/home-plugins/${item.slug}`
    const confirmed = window.confirm(t('workspace.deleteAgentCardConfirm', { name: item.manifest.name, path: pluginPath }))
    if (!confirmed) return

    setDeletingSlug(item.slug)
    try {
      const result = await deleteHomePlugin(project.path, item.slug)
      if (!result.ok) {
        setError(result.message)
        return
      }
      const nextPlugins = plugins.filter((plugin) => plugin.slug !== item.slug)
      const nextHashes: Record<string, string> = {}
      for (const plugin of nextPlugins) {
        if (plugin.outputHash) nextHashes[plugin.slug] = plugin.outputHash
      }
      outputHashesRef.current = nextHashes
      pluginCache.set(cacheKey, { hashes: nextHashes, plugins: nextPlugins })
      setPlugins(nextPlugins)
      const cardId = pluginCardId(item.slug)
      setDraftOrder((current) => current.filter((id) => id !== cardId))
      setDraftSizes((current) => {
        const next = { ...current }
        delete next[cardId]
        return next
      })
      window.dispatchEvent(new CustomEvent('project-home:refresh'))
    } catch (error) {
      setError(error instanceof Error ? error.message : t('workspace.deleteAgentCardFailed'))
    } finally {
      setDeletingSlug('')
    }
  }

  return (
    <div className="project-home-area">
      <div className="project-home-toolbar">
        <ProjectHomeProjectSelector
          project={project}
          projects={projects}
          projectOrderIds={projectOrderIds}
          onCreateProject={onCreateProject}
          onSelectProject={onSelectProject}
        />
        <div className="project-home-toolbar__actions">
          <button
            type="button"
            className="project-home-icon-button"
            title={t('workspace.sortAgentCards')}
            aria-label={t('workspace.sortAgentCards')}
            disabled={loading || homeCards.length === 0}
            data-mm-label={t('workspace.sortAgentCards')}
            data-mm-aliases={t('workspace.agentSettings')}
            onClick={() => onOpenAgentSettings('card-order')}
          >
            <IconInline name="sort" />
          </button>
          <div className="project-home-add" ref={addMenuRef}>
            <SemanticButton
              type="button"
              className="project-home-add-button"
              aria-haspopup="menu"
              aria-expanded={addMenuOpen}
              disabled={loading}
              semantic={{
                id: 'agentos.control.projectHome.addCard',
                role: 'button',
                label: t('omni.controls.projectHomeAddCard'),
                actions: ['press'],
                state: { open: addMenuOpen, enabled: !loading },
                hint: { aliases: semanticAliases(t, 'omni.aliases.addAgentCard') },
              }}
              onClick={() => setAddMenuOpen((open) => !open)}
            >
              <IconInline name="plus" />
              <span>{t('workspace.addAgentCard')}</span>
            </SemanticButton>
            {addMenuOpen ? (
              <div className="project-home-add-menu" role="menu" aria-label={t('workspace.addAgentCard')}>
                <SemanticButton
                  type="button"
                  role="menuitem"
                  semantic={{
                    id: 'agentos.control.projectHome.addDataCard',
                    role: 'menuitem',
                    label: t('omni.controls.projectHomeAddDataCard'),
                    actions: ['press'],
                    hint: { aliases: semanticAliases(t, 'omni.aliases.addAgentCard') },
                  }}
                  onClick={() => {
                    setAddMenuOpen(false)
                    onStartDataCardDraft()
                  }}
                >
                  <IconInline name="database" />
                  <span>{t('workspace.addDataCard')}</span>
                </SemanticButton>
                <SemanticButton
                  type="button"
                  role="menuitem"
                  semantic={{
                    id: 'agentos.control.projectHome.addTaskCard',
                    role: 'menuitem',
                    label: t('omni.controls.projectHomeAddTaskCard'),
                    actions: ['press'],
                    hint: { aliases: semanticAliases(t, 'omni.aliases.addAgentCard') },
                  }}
                  onClick={() => {
                    setAddMenuOpen(false)
                    setEditingTaskSlug(undefined)
                    setTaskDialogOpen(true)
                  }}
                >
                  <IconInline name="checklist" />
                  <span>{t('workspace.addTaskCard')}</span>
                </SemanticButton>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {error ? <div className="project-home-surface-error">{error}</div> : null}
      {!error && homeCards.length === 0 ? <ProjectHomeEmptyState /> : null}
      {!error && homeCards.length > 0 ? (
        <div className="project-home-card-grid">
          {gridItems.map((gridItem) => {
            if (gridItem.kind === 'filler') return <HomeGridFiller key={gridItem.id} span={gridItem.span} tone={gridItem.tone} />
            const card = gridItem.card
            if (card.kind === 'skill') {
              return (
                <SkillHomeCard
                  key={card.cardId}
                  skill={card.skill}
                  size={card.size}
                  projectId={project.id}
                  threads={threads}
                  threadRunStates={threadRunStates}
                  fixedModelLabel={skillModelLabelForCard(
                    skillModelOverrides[card.skill.path],
                    modelRows,
                    modelSettingsSnapshot,
                  )}
                  onRun={onRunProjectSkill}
                  onStop={onStopProjectSkillRun}
                />
              )
            }
            return (
              <MultimodalGroup
                key={`${card.cardId}:${card.item.outputHash ?? ''}`}
                className="project-home-card-mm"
                id={`agentos.task-card.${card.item.slug}`}
                role="card"
                label={card.item.manifest.name}
                aliases={[card.item.slug, card.item.manifest.kind]}
                entity={{ type: 'task-card', id: card.item.slug }}
                state={{
                  projectId: project.id,
                  slug: card.item.slug,
                  kind: card.item.manifest.kind,
                  size: card.size,
                }}
              >
                <HomePluginCard
                  item={card.item}
                  size={card.size}
                  projectPath={project.path}
                  onOpenProjectFile={onOpenProjectFile}
                  onEdit={() => {
                    if (card.item.manifest.kind === 'task') {
                      setEditingTaskSlug(card.item.slug)
                      setTaskDialogOpen(true)
                      return
                    }
                    onEditHomePluginCard(card.item)
                  }}
                />
              </MultimodalGroup>
            )
          })}
        </div>
      ) : null}

      {taskDialogOpen ? (
        <TaskCardDialog
          project={project}
          slug={editingTaskSlug}
          todoEnabled={todoEnabled}
          loading={loading}
          onClose={() => {
            setTaskDialogOpen(false)
            setEditingTaskSlug(undefined)
          }}
          onSaved={() => {
            setTaskDialogOpen(false)
            setEditingTaskSlug(undefined)
            outputHashesRef.current = {}
            window.dispatchEvent(new CustomEvent('project-home:refresh'))
          }}
        />
      ) : null}
      {agentSettingsOpen ? (
        <AgentSettingsModal
          agent={agent}
          activePanel={agentSettingsPanel}
          onActivePanelChange={onAgentSettingsPanelChange}
          cards={homeCards}
          draftOrder={draftOrder}
          draftSizes={draftSizes}
          onDraftOrderChange={setDraftOrder}
          onDraftSizeChange={(cardId, preferredSize) => setDraftSizes((prev) => ({ ...prev, [cardId]: preferredSize }))}
          projectModelPick={projectModelPick}
          draftProjectModelPick={draftProjectModelPick}
          projectDocumentDrafts={projectDocumentDrafts}
          savedProjectDocumentDrafts={savedProjectDocumentDrafts}
          projectSettingsStatus={projectSettingsStatus}
          projectSettingsSaving={projectSettingsSaving}
          projectContextEntries={projectContextEntries}
          projectContextInstructions={projectContextInstructions}
          savedProjectContextInstructions={savedProjectContextInstructions}
          projectContextReadOnly={projectContextReadOnly}
          projectContextTargetPath={projectContextTargetPath}
          projectContextStatus={projectContextStatus}
          projectContextBusy={projectContextBusy}
          onDraftProjectModelPickChange={setDraftProjectModelPick}
          onProjectDocumentDraftsChange={setProjectDocumentDrafts}
          onSaveProjectSettings={() => void saveProjectSettings()}
          onProjectContextInstructionsChange={setProjectContextInstructions}
          onAddProjectContext={(mode) => void addProjectContext(mode)}
          onRemoveProjectContextEntry={(entry) => void removeProjectContextEntry(entry)}
          onRefreshProjectContext={() => void loadProjectContext()}
          onSaveProjectContextInstructions={() => void saveProjectContextInstructions()}
          skills={skills}
          modelRows={modelRows}
          modelSettingsSnapshot={modelSettingsSnapshot}
          skillModelOverrides={skillModelOverrides}
          draftSkillModelOverrides={draftSkillModelOverrides}
          skillSettingsStatus={skillSettingsStatus}
          skillSettingsSaving={skillSettingsSaving}
          onDraftSkillModelOverridesChange={setDraftSkillModelOverrides}
          onSaveSkillModelOverrides={() => void saveSkillModelSettings()}
          mcpServers={mcpServers}
          draftMcpServers={draftMcpServers}
          mcpServerOverrides={mcpServerOverrides}
          draftMcpServerOverrides={draftMcpServerOverrides}
          mcpToolPolicies={mcpToolPolicies}
          draftMcpToolPolicies={draftMcpToolPolicies}
          mcpServerProbeCache={mcpServerProbeCache}
          mcpSettingsStatus={mcpSettingsStatus}
          mcpSettingsOperation={mcpSettingsOperation}
          mcpStatusServers={mcpStatusServers}
          onDraftMcpServersChange={setDraftMcpServers}
          onDraftMcpServerOverridesChange={setDraftMcpServerOverrides}
          onDraftMcpToolPoliciesChange={setDraftMcpToolPolicies}
          onRefreshMcpStatus={refreshMcpStatus}
          onSaveMcpSettings={() => void saveMcpSettings()}
          deletingSlug={deletingSlug}
          cardOrderStatus={cardOrderStatus}
          cardOrderSaving={cardOrderSaving}
          onDelete={(item) => void deleteCard(item)}
          onClose={onCloseAgentSettings}
          onSave={() => void saveSortOrderWithGuard()}
        />
      ) : null}
    </div>
  )
}

function HomeGridFiller({ span, tone }: Pick<HomeGridFillerItem, 'span' | 'tone'>) {
  const rowSpan = 10
  return (
    <div
      className={`project-home-filler-card project-home-filler-card--span-${span} project-home-filler-card--${tone}`}
      aria-hidden="true"
      role="presentation"
      style={{ '--home-card-span': span, gridRowEnd: `span ${rowSpan}` } as CSSProperties}
    >
      <div className="project-home-filler-card__rule" />
      <div className="project-home-filler-card__marks">
        {Array.from({ length: span === 1 ? 7 : 12 }, (_, index) => (
          <span key={index} />
        ))}
      </div>
    </div>
  )
}

function HomePluginCard({
  item,
  size,
  projectPath,
  onOpenProjectFile,
  onEdit,
}: {
  item: HomePluginRunItem
  size: HomePluginCardSize
  projectPath: string
  onOpenProjectFile: (node: FileTreeNode) => void
  onEdit: () => void
}) {
  const { t } = useI18n()
  const messages = messagesForSize(item, size)
  const todoCard = isTodoHomeCard(item) ? todoHomeCardDataFromMessages(messages) : null
  const taskCard = item.manifest.kind === 'task' ? taskCardViewModelFromMessages(item, messages) : null
  const [menuOpen, setMenuOpen] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const editable = !todoCard

  useMasonrySpan(cardRef, [messages, size, todoCard])

  return (
    <div
      ref={cardRef}
      className={`project-home-card project-home-card--${size} project-home-card--${item.manifest.kind}`}
      style={{ '--home-card-span': sizeToColumnSpan(size) } as CSSProperties}
    >
      {editable ? <div className="project-home-card__menu">
        <SemanticButton
          type="button"
          className="project-home-card__menu-button"
          aria-label={t('workspace.cardMenuAria', { name: item.manifest.name })}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          semantic={{
            id: `agentos.control.taskCard.${stableSemanticId(item.slug)}.menu`,
            role: 'button',
            label: t('omni.controls.taskCardMenu', { name: item.manifest.name }),
            actions: ['press'],
            state: {
              open: menuOpen,
              slug: item.slug,
              kind: item.manifest.kind,
            },
            hint: { aliases: [item.manifest.name, item.slug, ...semanticAliases(t, 'omni.aliases.cardMenu')] },
          }}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <IconInline name="moreHorizontal" />
        </SemanticButton>
        {menuOpen ? (
          <div className="project-home-card__menu-popover" role="menu">
            <SemanticButton
              type="button"
              role="menuitem"
              semantic={{
                id: `agentos.control.taskCard.${stableSemanticId(item.slug)}.edit`,
                role: 'menuitem',
                label: t('omni.controls.taskCardEdit', { name: item.manifest.name }),
                actions: ['press'],
                state: { slug: item.slug, kind: item.manifest.kind },
                hint: { aliases: [item.manifest.name, item.slug, ...semanticAliases(t, 'omni.aliases.cardMenu')] },
              }}
              onClick={() => {
                setMenuOpen(false)
                onEdit()
              }}
            >
              <IconInline name="edit" />
              <span>{t('workspace.editAgentCard')}</span>
            </SemanticButton>
          </div>
        ) : null}
      </div> : null}
      <div className="project-home-card__measure">
        <div className="project-home-card__surface">
          {todoCard ? (
            <TodoHomeCardView
              todo={todoCard}
              size={size}
              onOpen={() => onOpenProjectFile(createProjectFileNode(projectPath, 'TODO.md'))}
            />
          ) : taskCard ? (
            <TaskHomeCardView task={taskCard} projectPath={projectPath} />
          ) : (
            <MarkdownContext.Provider value={(text) => Promise.resolve(renderMarkdown(text))}>
              <A2uiCardSurface messages={messages} projectPath={projectPath} onEdit={onEdit} />
            </MarkdownContext.Provider>
          )}
        </div>
      </div>
    </div>
  )
}

type TaskHomeCardTone = 'idle' | 'active' | 'done' | 'error' | 'cancelled'

type TaskHomeCardViewModel = {
  slug: string
  title: string
  modeLabel: string
  statusLabel: string
  statusTone: TaskHomeCardTone
  summary: string
  detail: string
  meta: string[]
  threadTitle: string
  active: boolean
}

function TodoHomeCardView({ todo, size, onOpen }: { todo: TodoHomeCardData; size: HomePluginCardSize; onOpen: () => void }) {
  const { t } = useI18n()
  const blockerText = todo.blocker.trim()
  const hasBlocker = Boolean(blockerText && blockerText !== '无' && blockerText.toLowerCase() !== 'none')
  const tone = hasBlocker ? 'error' : todo.percent >= 100 ? 'done' : 'active'
  const visibleTasks = size === 'large'
    ? todo.tasks.slice(0, 6)
    : size === 'medium'
      ? todo.tasks.slice(0, 3)
      : []
  const todoCardRef = useSemanticNodeRef<HTMLElement>({
    id: 'agentos.control.todoCard.open',
    role: 'button',
    label: t('workspace.todoCardOpenAria'),
    actions: ['press'],
    state: {
      percent: todo.percent,
      completed: todo.completed,
      total: todo.total,
      tone,
    },
    hint: { aliases: ['TODO', 'TODO.md'] },
  })
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onOpen()
  }

  return (
    <article
      ref={todoCardRef}
      className={`todo-home-card todo-home-card--${tone}`}
      role="button"
      tabIndex={0}
      aria-label={t('workspace.todoCardOpenAria')}
      data-mm-label={t('workspace.todoCardOpenAria')}
      data-mm-aliases="TODO|TODO.md"
      onClick={onOpen}
      onKeyDown={handleKeyDown}
    >
      <header className="todo-home-card__header">
        <span className="task-home-card__glyph todo-home-card__glyph" aria-hidden="true">
          <IconInline name="checklist" />
        </span>
        <span className="task-home-card__heading">
          <h3>TODO</h3>
          <span>{todo.updatedAt || 'TODO.md'}</span>
        </span>
      </header>

      <div className="todo-home-card__progress" aria-label={t('workspace.todoCardProgressAria', { percent: todo.percent })}>
        <div className="todo-home-card__progress-head">
          <span>{todo.progress || `${todo.completed}/${todo.total}`}</span>
          <strong>{todo.percent}%</strong>
        </div>
        <span className="todo-home-card__bar" aria-hidden="true">
          <span style={{ width: `${Math.min(100, Math.max(0, todo.percent))}%` }} />
        </span>
      </div>

      <div className="todo-home-card__body">
        <p className="task-home-card__summary">{todo.currentTask}</p>
        {size !== 'small' ? <p className="task-home-card__detail">{todo.phase}</p> : null}
      </div>

      <div className="todo-home-card__facts">
        <span>
          <b>{t('workspace.todoCardNext')}</b>
          {todo.nextStep}
        </span>
        <span>
          <b>{t('workspace.todoCardBlocker')}</b>
          {hasBlocker ? blockerText : t('workspace.none')}
        </span>
      </div>

      {visibleTasks.length > 0 ? (
        <div className="todo-home-card__tasks" aria-label={t('workspace.todoCardTasksAria')}>
          {visibleTasks.map((task) => (
            <span key={task.id} className={`todo-home-card__task todo-home-card__task--${task.status || 'todo'}`}>
              <IconInline name={task.checked ? 'check' : 'branch'} />
              <span>{task.id}</span>
              <b>{task.title}</b>
              {size === 'large' && task.priority ? <em>{task.priority}</em> : null}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  )
}

function TaskHomeCardView({ task, projectPath }: { task: TaskHomeCardViewModel; projectPath: string }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const iconName = task.active ? 'stop' : 'play'
  const actionLabel = task.active ? t('workspace.skillCardStop') : t('workspace.skillCardRun')

  const runAction = useCallback(async () => {
    if (busy) return
    const action = task.active ? window.desktop?.stopTaskHomePlugin : window.desktop?.runTaskHomePlugin
    if (!action) return
    setBusy(true)
    try {
      await action(projectPath, task.slug)
    } finally {
      setBusy(false)
      window.dispatchEvent(new CustomEvent('project-home:refresh'))
    }
  }, [busy, projectPath, task.active, task.slug])

  return (
    <article className="task-home-card" aria-label={task.title}>
      <header className="task-home-card__header">
        <span className="task-home-card__glyph" aria-hidden="true">
          <IconInline name="checklist" />
        </span>
        <span className="task-home-card__heading">
          <h3>{task.title}</h3>
          {task.modeLabel ? <span>{task.modeLabel}</span> : null}
        </span>
        {/* {task.statusTone !== 'idle' ? <span className={`task-home-card__status task-home-card__status--${task.statusTone}`}>{task.statusLabel}</span> : null} */}
      </header>

      <div className="task-home-card__body">
        <p className="task-home-card__summary">{task.summary}</p>
        {task.detail ? <p className="task-home-card__detail">{task.detail}</p> : null}
      </div>

      {task.meta.length > 0 || task.threadTitle ? (
        <div className="task-home-card__meta">
          {task.meta.map((label) => (
            <span key={label}>{label}</span>
          ))}
          {task.threadTitle ? (
            <span>
              <IconInline name="branch" />
              {task.threadTitle}
            </span>
          ) : null}
        </div>
      ) : null}

      <footer className="task-home-card__footer">
        <SemanticButton
          type="button"
          className={`task-home-card__action${task.active ? ' task-home-card__action--stop' : ''}`}
          disabled={busy}
          semantic={{
            id: `agentos.control.taskCard.${stableSemanticId(task.slug)}.run`,
            role: 'button',
            label: task.active
              ? t('omni.controls.taskCardStop', { title: task.title })
              : t('omni.controls.taskCardRun', { title: task.title }),
            actions: ['press'],
            state: { active: task.active, busy, slug: task.slug },
            hint: { aliases: [task.title, task.slug, ...semanticAliases(t, 'omni.aliases.taskRun')] },
          }}
          onClick={() => void runAction()}
        >
          <IconInline name={iconName} />
          <span>{busy ? t('workspace.skillCardProcessing') : actionLabel}</span>
        </SemanticButton>
      </footer>
    </article>
  )
}

function SkillHomeCard({
  skill,
  size,
  projectId,
  threads,
  threadRunStates,
  fixedModelLabel,
  onRun,
  onStop,
}: {
  skill: AgentContextSlashItem
  size: HomePluginCardSize
  projectId: string
  threads: WorkspaceThread[]
  threadRunStates: Record<string, ThreadRunState>
  fixedModelLabel: string
  onRun: (projectId: string, skill: ProjectSkillRunRequest) => void
  onStop: (projectId: string, skillPath: string) => void
}) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const runningThread = useMemo(
    () => latestSkillThread(threads, skill.path, (thread) => Boolean(threadRunStates[thread.id])),
    [skill.path, threadRunStates, threads],
  )
  const latestThread = useMemo(
    () => runningThread ?? latestSkillThread(threads, skill.path),
    [runningThread, skill.path, threads],
  )
  const activeRunState = runningThread ? threadRunStates[runningThread.id] : undefined
  const lastStatus = latestThread ? latestThreadMessageStatus(latestThread) : undefined
  const active = Boolean(activeRunState)
  const statusTone: TaskHomeCardTone = active
    ? 'active'
    : lastStatus === 'error'
      ? 'error'
      : lastStatus === 'cancelled'
        ? 'cancelled'
        : lastStatus === 'done'
          ? 'done'
          : 'idle'
  const statusLabel = active
    ? activeRunState?.status === 'waiting'
      ? t('workspace.skillCardWaiting')
      : t('workspace.skillCardRunning')
    : lastStatus === 'error'
      ? t('workspace.skillCardFailed')
      : lastStatus === 'cancelled'
        ? t('workspace.skillCardCancelled')
        : lastStatus === 'done'
          ? t('workspace.skillCardDone')
          : t('workspace.skillCardIdle')
  const summary = active
    ? t('workspace.skillCardRunningSummary')
    : latestThread
      ? t('workspace.skillCardLastRunSummary')
      : t('workspace.skillCardReadySummary')
  const detail = skill.description || skill.relativePath
  const actionLabel = active ? t('workspace.skillCardStop') : t('workspace.skillCardRun')
  const iconName = active ? 'stop' : 'play'
  const semanticSkillId = stableSemanticId(skill.path)

  useInteractionObject({
    id: `agentos.skill.${semanticSkillId}`,
    type: 'composite',
    role: 'skill',
    label: skill.title,
    aliases: [skill.command, skill.relativePath, skill.description].filter(Boolean),
    entity: { type: 'skill', id: skill.path },
    state: {
      active,
      projectId,
      command: skill.command,
      relativePath: skill.relativePath,
      status: statusTone,
      fixedModel: fixedModelLabel,
    },
  })

  useMasonrySpan(cardRef, [size, skill.path, skill.description, active, statusLabel, summary, detail])

  const runAction = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      if (active) {
        onStop(projectId, skill.path)
      } else {
        onRun(projectId, {
          title: skill.title,
          command: skill.command,
          description: skill.description,
          path: skill.path,
          relativePath: skill.relativePath,
        })
      }
    } finally {
      window.setTimeout(() => setBusy(false), 120)
    }
  }, [active, busy, onRun, onStop, projectId, skill.command, skill.description, skill.path, skill.relativePath, skill.title])

  return (
    <div
      ref={cardRef}
      className={`project-home-card project-home-card--${size} project-home-card--skill`}
      style={{ '--home-card-span': sizeToColumnSpan(size) } as CSSProperties}
    >
      <div className="project-home-card__measure">
        <div className="project-home-card__surface">
          <article className="task-home-card skill-home-card" aria-label={skill.title}>
            <header className="task-home-card__header">
              <span className="task-home-card__glyph" aria-hidden="true">
                <IconInline name="chip" />
              </span>
              <span className="task-home-card__heading">
                <h3>{skill.title}</h3>
                <span>{skill.command ? `/${skill.command}` : skill.relativePath}</span>
              </span>
              <span className={`task-home-card__status task-home-card__status--${statusTone}`}>{statusLabel}</span>
            </header>

            <div className="task-home-card__body">
              <p className="task-home-card__summary">{summary}</p>
              {detail ? <p className="task-home-card__detail">{detail}</p> : null}
            </div>

            <div className="task-home-card__meta">
              <span title={skill.relativePath}>{skill.relativePath}</span>
            </div>

            <footer className={`task-home-card__footer${fixedModelLabel ? ' skill-home-card__footer--with-model' : ''}`}>
              {fixedModelLabel ? (
                <span className="skill-home-card__fixed-model" title={t('workspace.skillCardFixedModelTitle', { model: fixedModelLabel })}>
                  {fixedModelLabel}
                </span>
              ) : null}
              <SemanticButton
                type="button"
                className={`task-home-card__action${active ? ' task-home-card__action--stop' : ''}`}
                disabled={busy}
                semantic={{
                  id: `agentos.control.skill.${semanticSkillId}.homeRun`,
                  role: 'button',
                  label: t('omni.controls.skillRun', { title: skill.title }),
                  actions: ['press'],
                  state: {
                    active,
                    busy,
                    projectId,
                    command: skill.command,
                    relativePath: skill.relativePath,
                  },
                  hint: {
                    aliases: [
                      ...semanticAliases(t, 'omni.aliases.skillRun'),
                      skill.title,
                      skill.command,
                      skill.relativePath,
                    ].filter(Boolean),
                  },
                }}
                onClick={() => void runAction()}
              >
                <IconInline name={iconName} />
                <span>{busy ? t('workspace.skillCardProcessing') : actionLabel}</span>
              </SemanticButton>
            </footer>
          </article>
        </div>
      </div>
    </div>
  )
}

function skillModelLabelForCard(
  pick: ChatModelPick | undefined,
  modelRows: ModelPickMenuRow[],
  modelSettingsSnapshot: ClaudeAgentSettingsSnapshot | null,
): string {
  if (!pick || !modelSettingsSnapshot) return ''
  const validPick = validateModelPick(modelSettingsSnapshot.settings, pick)
  if (!validPick) return ''
  return modelRowForPick(modelRows, validPick)?.headline ?? validPick.anthropicModel
}

function A2uiCardSurface({
  messages,
  projectPath,
  onEdit,
}: {
  messages: A2uiMessage[]
  projectPath: string
  onEdit: () => void
}) {
  const surfacesRef = useRef<SurfaceModel<ReactComponentImplementation>[]>([])
  const [surfaces, setSurfaces] = useState<SurfaceModel<ReactComponentImplementation>[]>([])
  const [revision, setRevision] = useState(0)

  const handleAction = useCallback(
    (action: A2uiClientAction) => {
      if (action.name === 'customize_home' || action.name === 'edit_home_card') {
        onEdit()
        return
      }
      if (action.name === 'refresh_home') {
        window.dispatchEvent(new CustomEvent('project-home:refresh'))
        return
      }
      if (action.name === 'task_run') {
        const slug = resolveActionText(action.context?.slug)
        if (!slug) return
        const runTaskHomePlugin = window.desktop?.runTaskHomePlugin
        if (!runTaskHomePlugin) return
        void runTaskHomePlugin(projectPath, slug).finally(() => {
          window.dispatchEvent(new CustomEvent('project-home:refresh'))
        })
        return
      }
      if (action.name === 'task_stop') {
        const slug = resolveActionText(action.context?.slug)
        if (!slug) return
        const stopTaskHomePlugin = window.desktop?.stopTaskHomePlugin
        if (!stopTaskHomePlugin) return
        void stopTaskHomePlugin(projectPath, slug).finally(() => {
          window.dispatchEvent(new CustomEvent('project-home:refresh'))
        })
        return
      }
      if (action.name === 'open_file') {
        const rawPath = resolveActionPath(action.context?.filePath ?? action.context?.path)
        const safePath = rawPath ? normalizeProjectRelativePath(rawPath) : ''
        if (!safePath) return
        const targetPath = `${projectPath}/${safePath}`
        if (window.desktop?.openPath) {
          void window.desktop.openPath(targetPath).catch(() => window.desktop?.showItemInFolder?.(targetPath))
        } else {
          void window.desktop?.showItemInFolder?.(targetPath)
        }
      }
    },
    [onEdit, projectPath],
  )

  const processor = useMemo(() => new MessageProcessor<ReactComponentImplementation>([basicCatalog], handleAction), [handleAction])

  useEffect(() => {
    try {
      Array.from(processor.model.surfacesMap.keys()).forEach((id) => processor.model.deleteSurface(id))
      processor.processMessages(messages)
      const next = Array.from(processor.model.surfacesMap.values())
      surfacesRef.current = next
      setSurfaces(next)
      setRevision((value) => value + 1)
    } catch (error) {
      console.error(error)
      setSurfaces([])
    }
  }, [messages, processor])

  useEffect(() => () => processor.model.dispose(), [processor])

  return (
    <div className="project-home-surface">
      {surfaces.map((surface) => (
        <A2uiSurface key={`${surface.id}:${revision}`} surface={surface} />
      ))}
    </div>
  )
}

function ProjectHomeEmptyState() {
  const { t } = useI18n()
  return (
    <div className="project-home-empty">
      <IconInline name="database" />
      <span>{t('workspace.agentCardsEmptyTitle')}</span>
      <span>{t('workspace.agentCardsEmptyDesc')}</span>
    </div>
  )
}

function TaskCardDialog({
  project,
  slug,
  todoEnabled,
  loading,
  onClose,
  onSaved,
}: {
  project: WorkspaceProject
  slug?: string
  todoEnabled: boolean
  loading: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [title, setTitle] = useState('')
  const [mode, setMode] = useState<HomePluginTaskMode>('agent')
  const [skills, setSkills] = useState<AgentContextSlashItem[]>([])
  const [selectedSkills, setSelectedSkills] = useState<HomePluginTaskSkillStep[]>([])
  const [draftTodoEnabled, setDraftTodoEnabled] = useState(todoEnabled)
  const [runCount, setRunCount] = useState(1)
  const [schedule, setSchedule] = useState<HomePluginTaskSchedule>(() => defaultTaskSchedule())
  const [saving, setSaving] = useState(false)
  const [skillsLoading, setSkillsLoading] = useState(false)
  const [dialogError, setDialogError] = useState('')
  const [draggingStepId, setDraggingStepId] = useState('')
  const editing = Boolean(slug)

  useEffect(() => {
    let cancelled = false
    const listAgentContext = window.desktop?.listAgentContext
    if (!listAgentContext) {
      setSkills([])
      setSkillsLoading(false)
      return () => {
        cancelled = true
      }
    }
    setSkillsLoading(true)
    listAgentContext(project.path)
      .then((result) => {
        if (cancelled) return
        setSkills(result.ok ? result.skills.filter((skill) => skill.kind === 'skill' && skill.scope === 'project') : [])
      })
      .catch(() => {
        if (!cancelled) setSkills([])
      })
      .finally(() => {
        if (!cancelled) setSkillsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [project.path])

  useEffect(() => {
    if (!slug) {
      setTitle('')
      setMode('agent')
      setSelectedSkills([])
      setDraftTodoEnabled(todoEnabled)
      setRunCount(1)
      setSchedule(defaultTaskSchedule())
      setDialogError('')
      return
    }

    let cancelled = false
    const getTaskHomePlugin = window.desktop?.getTaskHomePlugin
    setDialogError('')
    if (!getTaskHomePlugin) {
      setDialogError(t('workspace.taskBridgeUnavailable'))
      setSaving(false)
      return () => {
        cancelled = true
      }
    }
    setSaving(true)
    getTaskHomePlugin(project.path, slug)
      .then((result) => {
        if (cancelled) return
        if (!result.ok) {
          setDialogError(result.message)
          return
        }
        setTitle(result.task.title)
        setMode(result.task.mode)
        setSelectedSkills(result.task.skillSteps)
        setDraftTodoEnabled(result.task.todoEnabled)
        setRunCount(result.task.runCount)
        setSchedule(result.task.schedule)
      })
      .catch((error) => {
        if (!cancelled) setDialogError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!cancelled) setSaving(false)
      })
    return () => {
      cancelled = true
    }
  }, [project.path, slug, todoEnabled, t])

  const addSkill = (skill: AgentContextSlashItem) => {
    setSelectedSkills((prev) => [
      ...prev,
      {
        id: createTaskStepId(),
        command: skill.command,
        path: skill.path,
        title: skill.title || skill.name || skill.command,
        description: skill.description,
        addedAt: new Date().toISOString(),
      },
    ])
  }

  const removeSkillStep = (stepId: string) => {
    setSelectedSkills((prev) => prev.filter((step) => step.id !== stepId))
  }

  const moveSkillStep = (stepId: string, offset: number) => {
    setSelectedSkills((prev) => {
      const index = prev.findIndex((step) => step.id === stepId)
      const nextIndex = index + offset
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev
      const next = [...prev]
      const [step] = next.splice(index, 1)
      next.splice(nextIndex, 0, step)
      return next
    })
  }

  const onStepDrop = (event: DragEvent<HTMLDivElement>, targetStepId: string) => {
    event.preventDefault()
    const sourceStepId = event.dataTransfer.getData('text/plain') || draggingStepId
    if (!sourceStepId || sourceStepId === targetStepId) return
    setSelectedSkills((prev) => {
      const sourceIndex = prev.findIndex((step) => step.id === sourceStepId)
      const targetIndex = prev.findIndex((step) => step.id === targetStepId)
      if (sourceIndex < 0 || targetIndex < 0) return prev
      const next = [...prev]
      const [step] = next.splice(sourceIndex, 1)
      next.splice(targetIndex, 0, step)
      return next
    })
    setDraggingStepId('')
  }

  const updateTime = (value: string) => {
    const [hourRaw, minuteRaw] = value.split(':')
    const hour = clampInt(Number.parseInt(hourRaw ?? '', 10), 0, 23, schedule.hour)
    const minute = clampInt(Number.parseInt(minuteRaw ?? '', 10), 0, 59, schedule.minute)
    setSchedule((prev) => ({ ...prev, hour, minute }))
  }

  const save = async () => {
    const normalizedTitle = title.trim()
    if (!normalizedTitle) {
      setDialogError(t('workspace.taskTitleRequired'))
      return
    }
    if (mode === 'skills' && selectedSkills.length === 0) {
      setDialogError(t('workspace.taskSkillRequired'))
      return
    }
    const saveTaskHomePlugin = window.desktop?.saveTaskHomePlugin
    if (!saveTaskHomePlugin) {
      setDialogError(t('workspace.taskBridgeUnavailable'))
      return
    }

    setSaving(true)
    setDialogError('')
    try {
      const result = await saveTaskHomePlugin(project.path, {
        slug,
        title: normalizedTitle,
        mode,
        skillSteps: mode === 'skills' ? selectedSkills : [],
        todoEnabled: draftTodoEnabled,
        runCount: clampInt(runCount, 1, 100, 1),
        schedule,
        enabled: true,
      })
      if (!result.ok) {
        setDialogError(result.message)
        return
      }
      onSaved()
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const timeValue = `${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}`
  const canSave = title.trim().length > 0 && (mode === 'agent' || selectedSkills.length > 0) && !saving

  return (
    <div className="project-home-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="project-home-modal project-home-modal--task" role="dialog" aria-modal="true" aria-label={t('workspace.addTaskCard')} onMouseDown={(event) => event.stopPropagation()}>
        <div className="project-home-modal__header">
          <h2>{editing ? t('workspace.editTaskCard') : t('workspace.addTaskCard')}</h2>
          <button type="button" className="project-home-icon-button" aria-label={t('filePanel.closeAria')} data-mm-label={t('filePanel.closeAria')} onClick={onClose}>
            <IconInline name="x" />
          </button>
        </div>
        <div className="project-home-task-form">
          <label className="project-home-field">
            <span>{t('workspace.taskTitle')}</span>
            <input
              className="settings-input"
              value={title}
              maxLength={64}
              placeholder={t('workspace.taskTitlePlaceholder')}
              disabled={saving}
              data-mm-label={t('workspace.taskTitle')}
              data-mm-aliases={t('workspace.taskTitlePlaceholder')}
              data-mm-exposure="value"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>

          <div className="project-home-segmented" role="group" aria-label={t('workspace.taskMode')}>
            <button
              type="button"
              className={mode === 'agent' ? 'is-active' : ''}
              aria-pressed={mode === 'agent'}
              disabled={saving}
              data-mm-label={t('workspace.taskModeAgent')}
              data-mm-aliases={t('workspace.taskMode')}
              onClick={() => setMode('agent')}
            >
              <IconInline name="agent" />
              <span>{t('workspace.taskModeAgent')}</span>
            </button>
            <button
              type="button"
              className={mode === 'skills' ? 'is-active' : ''}
              aria-pressed={mode === 'skills'}
              disabled={saving}
              data-mm-label={t('workspace.taskModeSkills')}
              data-mm-aliases={t('workspace.taskMode')}
              onClick={() => setMode('skills')}
            >
              <IconInline name="checklist" />
              <span>{t('workspace.taskModeSkills')}</span>
            </button>
          </div>

          {mode === 'skills' ? (
            <div className="project-home-skill-picker">
              <div className="project-home-skill-pane">
                <div className="project-home-skill-pane__heading">{t('workspace.taskProjectSkills')}</div>
                <div className="project-home-skill-list">
                  {skillsLoading ? <div className="project-home-skill-empty">{t('sidebar.scanning')}</div> : null}
                  {!skillsLoading && skills.length === 0 ? <div className="project-home-skill-empty">{t('workspace.taskNoSkills')}</div> : null}
                  {skills.map((skill) => (
                    <div key={`${skill.path}:${skill.command}`} className="project-home-skill-row">
                      <span>
                        <span>{skill.title || skill.name}</span>
                        <span>{skill.command}</span>
                      </span>
                      <button
                        type="button"
                        className="project-home-icon-button"
                        title={t('workspace.taskAddSkill')}
                        aria-label={t('workspace.taskAddSkill')}
                        disabled={saving}
                        data-mm-label={t('workspace.taskAddSkill')}
                        data-mm-aliases={skill.title || skill.name}
                        onClick={() => addSkill(skill)}
                      >
                        <IconInline name="plus" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="project-home-skill-pane">
                <div className="project-home-skill-pane__heading">{t('workspace.taskSelectedSkills')}</div>
                <div className="project-home-selected-skill-list">
                  {selectedSkills.length === 0 ? <div className="project-home-skill-empty">{t('workspace.taskSelectedSkillsEmpty')}</div> : null}
                  {selectedSkills.map((step, index) => (
                    <div
                      key={step.id}
                      className="project-home-selected-skill-row"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData('text/plain', step.id)
                        event.dataTransfer.effectAllowed = 'move'
                        setDraggingStepId(step.id)
                      }}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => onStepDrop(event, step.id)}
                      onDragEnd={() => setDraggingStepId('')}
                    >
                      <span className="project-home-sort-row__grab" aria-hidden="true">
                        <IconInline name="sort" />
                      </span>
                      <span className="project-home-step-index">{index + 1}</span>
                      <span className="project-home-selected-skill-row__copy">
                        <span>{step.title}</span>
                        <span>{step.command}</span>
                      </span>
                      <button type="button" className="project-home-icon-button" disabled={saving || index === 0} data-mm-label={t('workspace.moveCardUp')} data-mm-aliases={step.title} onClick={() => moveSkillStep(step.id, -1)} aria-label={t('workspace.moveCardUp')}>
                        <IconInline name="arrowUp" />
                      </button>
                      <button type="button" className="project-home-icon-button" disabled={saving || index === selectedSkills.length - 1} data-mm-label={t('workspace.moveCardDown')} data-mm-aliases={step.title} onClick={() => moveSkillStep(step.id, 1)} aria-label={t('workspace.moveCardDown')}>
                        <IconInline name="arrowDown" />
                      </button>
                      <button type="button" className="project-home-icon-button" disabled={saving} data-mm-label={t('workspace.taskRemoveSkill')} data-mm-aliases={step.title} onClick={() => removeSkillStep(step.id)} aria-label={t('workspace.taskRemoveSkill')}>
                        <IconInline name="x" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          <label className="agent-mode-switch project-home-task-switch">
            <span className="agent-mode-switch__copy">
              <span>{t('workspace.todoModeToggle')}</span>
              <span>{t('workspace.todoModeToggleDesc')}</span>
            </span>
            <span className="settings-switch-control">
              <input
                className="settings-switch-input"
                type="checkbox"
                checked={draftTodoEnabled}
                disabled={loading || saving}
                data-mm-label={t('workspace.todoModeToggle')}
                data-mm-aliases={t('workspace.todoModeToggleDesc')}
                data-mm-exposure="value"
                onChange={(event) => setDraftTodoEnabled(event.target.checked)}
              />
              <span className="settings-switch-track" aria-hidden="true">
                <span className="settings-switch-thumb" />
              </span>
            </span>
          </label>

          <label className="project-home-field project-home-field--compact">
            <span>{t('workspace.taskRunCount')}</span>
            <input
              className="settings-input"
              type="number"
              min={1}
              max={100}
              value={runCount}
              disabled={saving}
              data-mm-label={t('workspace.taskRunCount')}
              data-mm-exposure="value"
              onChange={(event) => setRunCount(clampInt(Number.parseInt(event.target.value, 10), 1, 100, 1))}
            />
          </label>

          <label className="agent-mode-switch project-home-task-switch">
            <span className="agent-mode-switch__copy">
              <span>{t('workspace.taskScheduleToggle')}</span>
              {/* <span>{t('workspace.taskScheduleToggleDesc')}</span> */}
            </span>
            <span className="settings-switch-control">
              <input
                className="settings-switch-input"
                type="checkbox"
                checked={schedule.enabled}
                disabled={saving}
                data-mm-label={t('workspace.taskScheduleToggle')}
                data-mm-exposure="value"
                onChange={(event) => setSchedule((prev) => ({ ...prev, enabled: event.target.checked }))}
              />
              <span className="settings-switch-track" aria-hidden="true">
                <span className="settings-switch-thumb" />
              </span>
            </span>
          </label>

          {schedule.enabled ? (
            <div className="project-home-schedule-grid">
              <label className="project-home-field">
                <span>{t('workspace.taskScheduleTime')}</span>
                <input className="settings-input" type="time" value={timeValue} disabled={saving} data-mm-label={t('workspace.taskScheduleTime')} data-mm-exposure="value" onChange={(event) => updateTime(event.target.value)} />
              </label>
              <label className="project-home-field">
                <span>{t('workspace.taskScheduleInterval')}</span>
                <select
                  className="settings-input settings-select"
                  value={schedule.interval}
                  disabled={saving}
                  data-mm-label={t('workspace.taskScheduleInterval')}
                  data-mm-exposure="value"
                  onChange={(event) => setSchedule((prev) => ({ ...prev, interval: event.target.value as HomePluginTaskSchedule['interval'] }))}
                >
                  <option value="off">{t('workspace.taskIntervalOff')}</option>
                  <option value="1h">{t('workspace.taskInterval1h')}</option>
                  <option value="2h">{t('workspace.taskInterval2h')}</option>
                  <option value="3h">{t('workspace.taskInterval3h')}</option>
                  <option value="6h">{t('workspace.taskInterval6h')}</option>
                  <option value="12h">{t('workspace.taskInterval12h')}</option>
                  <option value="1d">{t('workspace.taskInterval1d')}</option>
                </select>
              </label>
            </div>
          ) : null}

          {dialogError ? <div className="project-home-task-error" role="alert">{dialogError}</div> : null}
        </div>
        <div className="project-home-modal__footer">
          <button type="button" className="agent-card-secondary-button" disabled={saving} data-mm-label={t('settings.agentMode.cancel')} onClick={onClose}>
            {t('settings.agentMode.cancel')}
          </button>
          <button type="button" className="agent-card-primary-button" disabled={!canSave} data-mm-label={saving ? t('workspace.taskSaving') : t('settings.agentMode.confirm')} onClick={() => void save()}>
            {saving ? t('workspace.taskSaving') : t('settings.agentMode.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

function AgentSettingsModal({
  agent,
  activePanel,
  onActivePanelChange,
  cards,
  draftOrder,
  draftSizes,
  onDraftOrderChange,
  onDraftSizeChange,
  projectModelPick,
  draftProjectModelPick,
  projectDocumentDrafts,
  savedProjectDocumentDrafts,
  projectSettingsStatus,
  projectSettingsSaving,
  projectContextEntries,
  projectContextInstructions,
  savedProjectContextInstructions,
  projectContextReadOnly,
  projectContextTargetPath,
  projectContextStatus,
  projectContextBusy,
  onDraftProjectModelPickChange,
  onProjectDocumentDraftsChange,
  onSaveProjectSettings,
  onProjectContextInstructionsChange,
  onAddProjectContext,
  onRemoveProjectContextEntry,
  onRefreshProjectContext,
  onSaveProjectContextInstructions,
  skills,
  modelRows,
  modelSettingsSnapshot,
  skillModelOverrides,
  draftSkillModelOverrides,
  skillSettingsStatus,
  skillSettingsSaving,
  onDraftSkillModelOverridesChange,
  onSaveSkillModelOverrides,
  mcpServers,
  draftMcpServers,
  mcpServerOverrides,
  draftMcpServerOverrides,
  mcpToolPolicies,
  draftMcpToolPolicies,
  mcpServerProbeCache,
  mcpSettingsStatus,
  mcpSettingsOperation,
  mcpStatusServers,
  onDraftMcpServersChange,
  onDraftMcpServerOverridesChange,
  onDraftMcpToolPoliciesChange,
  onRefreshMcpStatus,
  onSaveMcpSettings,
  deletingSlug,
  cardOrderStatus,
  cardOrderSaving,
  onDelete,
  onClose,
  onSave,
}: {
  agent: WorkspaceAgentModeState
  activePanel: AgentSettingsPanelId
  onActivePanelChange: (panel: AgentSettingsPanelId) => void
  cards: HomeCardItem[]
  draftOrder: string[]
  draftSizes: Record<string, HomePluginCardSize>
  onDraftOrderChange: (order: string[]) => void
  onDraftSizeChange: (cardId: string, preferredSize: HomePluginCardSize) => void
  projectModelPick?: ChatModelPick
  draftProjectModelPick?: ChatModelPick
  projectDocumentDrafts: Record<AgentProjectDocumentName, string>
  savedProjectDocumentDrafts: Record<AgentProjectDocumentName, string>
  projectSettingsStatus: string
  projectSettingsSaving: boolean
  projectContextEntries: ProjectContextEntry[]
  projectContextInstructions: string
  savedProjectContextInstructions: string
  projectContextReadOnly: boolean
  projectContextTargetPath: string
  projectContextStatus: string
  projectContextBusy: boolean
  onDraftProjectModelPickChange: (pick: ChatModelPick | undefined) => void
  onProjectDocumentDraftsChange: (drafts: Record<AgentProjectDocumentName, string>) => void
  onSaveProjectSettings: () => void
  onProjectContextInstructionsChange: (instructions: string) => void
  onAddProjectContext: (mode: ProjectContextAddMode) => void
  onRemoveProjectContextEntry: (entry: ProjectContextEntry) => void
  onRefreshProjectContext: () => void
  onSaveProjectContextInstructions: () => void
  skills: AgentContextSlashItem[]
  modelRows: ModelPickMenuRow[]
  modelSettingsSnapshot: ClaudeAgentSettingsSnapshot | null
  skillModelOverrides: Record<string, ChatModelPick>
  draftSkillModelOverrides: Record<string, ChatModelPick>
  skillSettingsStatus: string
  skillSettingsSaving: boolean
  onDraftSkillModelOverridesChange: (overrides: Record<string, ChatModelPick>) => void
  onSaveSkillModelOverrides: () => void
  mcpServers: AgentMcpServerConfig[]
  draftMcpServers: AgentMcpServerConfig[]
  mcpServerOverrides: AgentMcpServerOverrides
  draftMcpServerOverrides: AgentMcpServerOverrides
  mcpToolPolicies: AgentMcpToolPolicies
  draftMcpToolPolicies: AgentMcpToolPolicies
  mcpServerProbeCache: AgentMcpServerProbeCache
  mcpSettingsStatus: string
  mcpSettingsOperation: ProjectMcpOperation
  mcpStatusServers?: ClaudeAgentStatusSnapshot['mcpServers']
  onDraftMcpServersChange: (servers: AgentMcpServerConfig[]) => void
  onDraftMcpServerOverridesChange: (overrides: AgentMcpServerOverrides) => void
  onDraftMcpToolPoliciesChange: (policies: AgentMcpToolPolicies) => void
  onRefreshMcpStatus: () => void
  onSaveMcpSettings: () => void
  deletingSlug: string
  cardOrderStatus: string
  cardOrderSaving: boolean
  onDelete: (item: HomePluginRunItem) => void
  onClose: () => void
  onSave: () => void
}) {
  const { t } = useI18n()
  const [confirmDisableOpen, setConfirmDisableOpen] = useState(false)
  const [status, setStatus] = useState('')
  const disableAgentMode = async () => {
    setStatus('')
    const ok = await agent.updateAgentModeState({ enabled: false })
    if (!ok) {
      setStatus(t('workspace.agentModeFailed'))
      return
    }
    setConfirmDisableOpen(false)
    onClose()
  }

  const navItems: { id: AgentSettingsPanelId; label: string; icon: 'settings' | 'sort' | 'chip' | 'folder' | 'files' | 'server' }[] = [
    { id: 'project', label: t('workspace.agentSettingsProject'), icon: 'folder' },
    { id: 'context', label: t('workspace.agentSettingsContext'), icon: 'files' },
    { id: 'mcp', label: t('workspace.agentSettingsMcp'), icon: 'server' },
    { id: 'card-order', label: t('workspace.agentSettingsCardOrder'), icon: 'sort' },
    { id: 'skills', label: t('workspace.agentSettingsSkills'), icon: 'chip' },
    { id: 'general', label: t('workspace.agentSettingsGeneral'), icon: 'settings' },
  ]
  const caption =
    activePanel === 'project'
      ? t('workspace.agentSettingsProject')
      : activePanel === 'context'
      ? t('workspace.agentSettingsContext')
      : activePanel === 'card-order'
      ? t('workspace.agentSettingsCardOrder')
      : activePanel === 'skills'
        ? t('workspace.agentSettingsSkills')
        : activePanel === 'mcp'
          ? t('workspace.agentSettingsMcp')
          : t('workspace.agentModeReady')

  return (
    <div className="project-home-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="project-home-modal project-home-modal--agent-settings" role="dialog" aria-modal="true" aria-labelledby="agent-settings-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="project-home-modal__header">
          <div>
            <h2 id="agent-settings-title">{t('workspace.agentSettings')}</h2>
            <p className="project-home-modal__caption">{caption}</p>
          </div>
          <button type="button" className="project-home-icon-button" aria-label={t('filePanel.closeAria')} data-mm-label={t('filePanel.closeAria')} onClick={onClose}>
            <IconInline name="x" />
          </button>
        </div>
        <div className="agent-settings-layout">
          <nav className="agent-settings-nav" aria-label={t('workspace.agentSettings')}>
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`agent-settings-nav__item${activePanel === item.id ? ' is-active' : ''}`}
                data-testid={item.id === 'mcp' ? 'agent-settings-mcp-tab' : undefined}
                aria-current={activePanel === item.id ? 'page' : undefined}
                data-mm-label={item.label}
                data-mm-aliases={t('workspace.agentSettings')}
                onClick={() => onActivePanelChange(item.id)}
              >
                <IconInline name={item.icon} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="agent-settings-content settings-page">
            {activePanel === 'general' ? (
              <AgentSettingsGeneralPanel
                agent={agent}
                status={status}
                onDisable={() => setConfirmDisableOpen(true)}
              />
            ) : activePanel === 'project' ? (
              <ProjectSettingsPanel
                modelRows={modelRows}
                modelSettingsSnapshot={modelSettingsSnapshot}
                savedProjectModelPick={projectModelPick}
                draftProjectModelPick={draftProjectModelPick}
                documents={projectDocumentDrafts}
                savedDocuments={savedProjectDocumentDrafts}
                status={projectSettingsStatus}
                saving={projectSettingsSaving}
                onDraftProjectModelPickChange={onDraftProjectModelPickChange}
                onDocumentsChange={onProjectDocumentDraftsChange}
                onClose={onClose}
                onSave={onSaveProjectSettings}
              />
            ) : activePanel === 'context' ? (
              <ProjectContextSettingsPanel
                entries={projectContextEntries}
                instructions={projectContextInstructions}
                savedInstructions={savedProjectContextInstructions}
                readOnly={projectContextReadOnly}
                contextTargetPath={projectContextTargetPath}
                status={projectContextStatus}
                busy={projectContextBusy}
                onInstructionsChange={onProjectContextInstructionsChange}
                onAdd={onAddProjectContext}
                onRemove={onRemoveProjectContextEntry}
                onRefresh={onRefreshProjectContext}
                onSaveInstructions={onSaveProjectContextInstructions}
              />
            ) : activePanel === 'skills' ? (
              <SkillsModelSettingsPanel
                skills={skills}
                modelRows={modelRows}
                modelSettingsSnapshot={modelSettingsSnapshot}
                savedOverrides={skillModelOverrides}
                draftOverrides={draftSkillModelOverrides}
                status={skillSettingsStatus}
                saving={skillSettingsSaving}
                onDraftOverridesChange={onDraftSkillModelOverridesChange}
                onClose={onClose}
                onSave={onSaveSkillModelOverrides}
              />
            ) : activePanel === 'mcp' ? (
              <McpSettingsPanel
                savedServers={mcpServers}
                draftServers={draftMcpServers}
                savedOverrides={mcpServerOverrides}
                draftOverrides={draftMcpServerOverrides}
                savedPolicies={mcpToolPolicies}
                draftPolicies={draftMcpToolPolicies}
                probeCache={mcpServerProbeCache}
                status={mcpSettingsStatus}
                operation={mcpSettingsOperation}
                statusServers={mcpStatusServers}
                onDraftServersChange={onDraftMcpServersChange}
                onDraftOverridesChange={onDraftMcpServerOverridesChange}
                onDraftPoliciesChange={onDraftMcpToolPoliciesChange}
                onRefreshStatus={onRefreshMcpStatus}
                onClose={onClose}
                onSave={onSaveMcpSettings}
              />
            ) : (
              <CardOrderSettingsPanel
                cards={cards}
                draftOrder={draftOrder}
                draftSizes={draftSizes}
                onDraftOrderChange={onDraftOrderChange}
                onDraftSizeChange={onDraftSizeChange}
                deletingSlug={deletingSlug}
                status={cardOrderStatus}
                saving={cardOrderSaving}
                onDelete={onDelete}
                onClose={onClose}
                onSave={onSave}
              />
            )}
          </div>
        </div>
        {confirmDisableOpen ? (
          <div className="agent-settings-confirm" role="presentation" onMouseDown={() => setConfirmDisableOpen(false)}>
            <section className="agent-settings-confirm__panel" role="alertdialog" aria-modal="true" aria-labelledby="agent-disable-confirm-title" onMouseDown={(event) => event.stopPropagation()}>
              <h3 id="agent-disable-confirm-title">{t('workspace.disableAgentModeConfirmTitle')}</h3>
              <p>{t('workspace.disableAgentModeConfirmBody')}</p>
              <div className="agent-settings-confirm__actions">
                <button type="button" className="btn btn-ghost" disabled={agent.loading} data-mm-label={t('settings.agentMode.cancel')} onClick={() => setConfirmDisableOpen(false)}>
                  {t('settings.agentMode.cancel')}
                </button>
                <button type="button" className="btn btn-primary" disabled={agent.loading} data-mm-label={t('workspace.disableAgentModeConfirmAction')} onClick={() => void disableAgentMode()}>
                  {t('workspace.disableAgentModeConfirmAction')}
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function AgentSettingsGeneralPanel({
  agent,
  status,
  onDisable,
}: {
  agent: WorkspaceAgentModeState
  status: string
  onDisable: () => void
}) {
  const { t } = useI18n()

  return (
    <section className="settings-stack agent-settings-panel" aria-labelledby="agent-settings-general-heading">
      <section className="settings-section">
        <h3 id="agent-settings-general-heading" className="settings-section-heading">
          {t('workspace.agentSettingsGeneral')}
        </h3>
        <p className="settings-section-caption">{agent.message || t('workspace.agentModeReady')}</p>
        <div className="settings-group">
          <div className="settings-field-row settings-field-row--action">
            <div className="settings-field-row__meta">
              <div className="settings-field-row__label">
                <IconInline name="agent" />
                {t('workspace.agentModeEnabledLabel')}
              </div>
              <p className="settings-field-row__hint">{t('workspace.disableAgentModeHint')}</p>
            </div>
            <div className="settings-field-row__controls">
              <button type="button" className="agent-card-secondary-button" disabled={agent.loading} data-mm-label={t('workspace.disableAgentMode')} onClick={onDisable}>
                {t('workspace.disableAgentMode')}
              </button>
            </div>
          </div>
        </div>
        <p className="settings-switch-status" role="status" aria-live="polite">
          {status || agent.message}
        </p>
      </section>
    </section>
  )
}

function SaveFeedback({ status, dirty, saving, busy = saving }: { status: string; dirty: boolean; saving: boolean; busy?: boolean }) {
  const { t } = useI18n()
  const passiveStatus = !status || status === t('settings.agentMode.loaded') || status === t('settings.agentMode.saved')
  const message = dirty && !busy && passiveStatus
    ? t('workspace.agentSettingsUnsavedChanges')
    : status || t('workspace.agentSettingsNoChanges')
  const tone = busy
    ? ' is-saving'
    : dirty && passiveStatus
      ? ' is-dirty'
      : status === t('settings.agentMode.saved')
      ? ' is-success'
      : ''

  return (
    <p className={`agent-settings-save-feedback${tone}`} role="status" aria-live="polite">
      <IconInline name={busy ? 'refresh' : dirty && passiveStatus ? 'save' : status === t('settings.agentMode.saved') ? 'check' : 'check'} />
      <span>{message}</span>
    </p>
  )
}

function ProjectSettingsPanel({
  modelRows,
  modelSettingsSnapshot,
  savedProjectModelPick,
  draftProjectModelPick,
  documents,
  savedDocuments,
  status,
  saving,
  onDraftProjectModelPickChange,
  onDocumentsChange,
  onClose,
  onSave,
}: {
  modelRows: ModelPickMenuRow[]
  modelSettingsSnapshot: ClaudeAgentSettingsSnapshot | null
  savedProjectModelPick?: ChatModelPick
  draftProjectModelPick?: ChatModelPick
  documents: Record<AgentProjectDocumentName, string>
  savedDocuments: Record<AgentProjectDocumentName, string>
  status: string
  saving: boolean
  onDraftProjectModelPickChange: (pick: ChatModelPick | undefined) => void
  onDocumentsChange: (drafts: Record<AgentProjectDocumentName, string>) => void
  onClose: () => void
  onSave: () => void
}) {
  const { t } = useI18n()
  const hasModels = modelRows.length > 0
  const defaultLabel = t('workspace.agentSettingsProjectDefaultModel')
  const validPick = modelSettingsSnapshot ? validateModelPick(modelSettingsSnapshot.settings, draftProjectModelPick) : draftProjectModelPick
  const row = modelRowForPick(modelRows, validPick)
  const currentValue = row?.pickKey ?? ''
  const setProjectPick = (pickKey: string) => {
    if (!pickKey) {
      onDraftProjectModelPickChange(undefined)
      return
    }
    const nextRow = modelRows.find((item) => item.pickKey === pickKey)
    onDraftProjectModelPickChange(nextRow ? modelPickFromRow(nextRow) : undefined)
  }
  const setDocument = (name: AgentProjectDocumentName, value: string) => {
    onDocumentsChange({ ...documents, [name]: value })
  }
  const reset = () => {
    onDraftProjectModelPickChange(savedProjectModelPick)
    onDocumentsChange(savedDocuments)
  }
  const isDirty = !sameModelPick(savedProjectModelPick, draftProjectModelPick) || !sameProjectDocuments(savedDocuments, documents)

  return (
    <section className="settings-stack agent-settings-panel" aria-labelledby="agent-settings-project-heading">
      <section className="settings-section">
        <h3 id="agent-settings-project-heading" className="settings-section-heading">
          {t('workspace.agentSettingsProject')}
        </h3>
        <p className="settings-section-caption">{t('workspace.agentSettingsProjectHint')}</p>
        <div className="settings-group">
          <div className="settings-field-row settings-field-row--action">
            <div className="settings-field-row__meta">
              <div className="settings-field-row__label">
                <IconInline name="chip" />
                {t('workspace.agentSettingsProjectModel')}
              </div>
              <p className="settings-field-row__hint">{t('workspace.agentSettingsProjectModelHint')}</p>
            </div>
            <div className="settings-field-row__controls">
              <select
                className="settings-input settings-select"
                value={currentValue}
                disabled={!hasModels}
                data-mm-label={t('workspace.agentSettingsProjectModel')}
                data-mm-aliases={t('workspace.agentSettingsProjectModelHint')}
                data-mm-exposure="value"
                onChange={(event) => setProjectPick(event.target.value)}
              >
                <option value="">{defaultLabel}</option>
                {modelRows.map((item) => (
                  <option key={item.pickKey} value={item.pickKey}>
                    {item.headline}{item.metaLine ? ` · ${item.metaLine}` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div className="agent-project-docs">
          {AGENT_PROJECT_DOCUMENT_NAMES.map((name) => (
            <label key={name} className="agent-project-doc-field">
              <span className="agent-project-doc-field__title">{name}</span>
              <p className="agent-project-doc-field__hint">{agentProjectDocumentHint(name, t)}</p>
              <textarea
                className="settings-input agent-project-doc-textarea"
                value={documents[name]}
                spellCheck={false}
                placeholder={agentProjectDocumentPlaceholder(name, t)}
                data-mm-label={name}
                data-mm-aliases={agentProjectDocumentHint(name, t)}
                data-mm-exposure="value"
                onChange={(event) => setDocument(name, event.target.value)}
              />
            </label>
          ))}
        </div>
        <div className="agent-settings-panel-actions">
          <SaveFeedback status={status} dirty={isDirty} saving={saving} />
          <button type="button" className="agent-card-secondary-button" disabled={saving || !isDirty} data-mm-label={t('settings.agentMode.cancel')} onClick={() => {
            reset()
            onClose()
          }}>
            {t('settings.agentMode.cancel')}
          </button>
          <button type="button" className="agent-card-primary-button" disabled={saving || !isDirty} data-mm-label={saving ? t('settings.agentMode.saving') : t('settings.agentMode.confirm')} onClick={onSave}>
            <IconInline name={saving ? 'refresh' : 'save'} />
            <span>{saving ? t('settings.agentMode.saving') : t('settings.agentMode.confirm')}</span>
          </button>
        </div>
      </section>
    </section>
  )
}

function ProjectContextSettingsPanel({
  entries,
  instructions,
  savedInstructions,
  readOnly,
  contextTargetPath,
  status,
  busy,
  onInstructionsChange,
  onAdd,
  onRemove,
  onRefresh,
  onSaveInstructions,
}: {
  entries: ProjectContextEntry[]
  instructions: string
  savedInstructions: string
  readOnly: boolean
  contextTargetPath: string
  status: string
  busy: boolean
  onInstructionsChange: (instructions: string) => void
  onAdd: (mode: ProjectContextAddMode) => void
  onRemove: (entry: ProjectContextEntry) => void
  onRefresh: () => void
  onSaveInstructions: () => void
}) {
  const { t } = useI18n()
  const instructionsDirty = instructions !== savedInstructions

  return (
    <section className="settings-stack agent-settings-panel" aria-labelledby="agent-settings-context-heading">
      <section className="settings-section">
        <h3 id="agent-settings-context-heading" className="settings-section-heading">
          {t('workspace.agentSettingsContext')}
        </h3>
        <p className="settings-section-caption">{t('workspace.agentSettingsContextHint')}</p>
        {readOnly ? (
          <p className="agent-context-readonly-note">
            {t('workspace.agentSettingsContextReadOnlyNotice', {
              path: contextTargetPath || 'Context',
            })}
          </p>
        ) : null}

        <div className="agent-project-docs agent-context-docs">
          <label className="agent-project-doc-field" htmlFor="agent-settings-context-instructions">
            <span className="agent-project-doc-field__title">CONTEXT.md</span>
            <p className="agent-project-doc-field__hint">{t('workspace.agentSettingsContextInstructionsHint')}</p>
            <textarea
              id="agent-settings-context-instructions"
              className="settings-input agent-project-doc-textarea"
              value={instructions}
              spellCheck={false}
              placeholder={t('workspace.agentSettingsContextInstructionsPlaceholder')}
              data-mm-label="CONTEXT.md"
              data-mm-aliases={t('workspace.agentSettingsContextInstructionsHint')}
              data-mm-exposure="value"
              onChange={(event) => onInstructionsChange(event.target.value)}
            />
          </label>
        </div>

        <div className="agent-context-actions" aria-label={t('workspace.agentSettingsContextAdd')}>
          <button type="button" className="agent-card-secondary-button" disabled={busy || readOnly} data-mm-label={t('workspace.agentSettingsContextAddReference')} onClick={() => onAdd('reference')}>
            <IconInline name="paperclip" />
            <span>{t('workspace.agentSettingsContextAddReference')}</span>
          </button>
          <button type="button" className="agent-card-secondary-button" disabled={busy || readOnly} data-mm-label={t('workspace.agentSettingsContextAddCopy')} onClick={() => onAdd('copy')}>
            <IconInline name="copy" />
            <span>{t('workspace.agentSettingsContextAddCopy')}</span>
          </button>
          <button type="button" className="agent-card-secondary-button" disabled={busy} data-mm-label={t('workspace.agentSettingsContextRefresh')} onClick={onRefresh}>
            <IconInline name="refresh" />
            <span>{t('workspace.agentSettingsContextRefresh')}</span>
          </button>
        </div>

        <div className="agent-context-list" role="list" aria-label={t('workspace.agentSettingsContextList')}>
          {entries.length === 0 ? (
            <p className="agent-context-empty">{t('workspace.agentSettingsContextEmpty')}</p>
          ) : (
            entries.map((entry) => (
              <div key={entry.relativePath} className="agent-context-row" role="listitem">
                <div className="agent-context-row__icon" aria-hidden="true">
                  <IconInline name={entry.kind === 'directory' ? 'folder' : 'file'} />
                </div>
                <div className="agent-context-row__body">
                  <div className="agent-context-row__title">
                    <span>{entry.name}</span>
                    <span className={`agent-context-chip agent-context-chip--${readOnly && entry.mode === 'local' ? 'external' : entry.mode}`}>
                      {t(
                        entry.mode === 'reference'
                          ? 'workspace.agentSettingsContextModeReference'
                          : readOnly
                            ? 'workspace.agentSettingsContextModeExternal'
                            : 'workspace.agentSettingsContextModeLocal',
                      )}
                    </span>
                    <span className="agent-context-chip">
                      {t(
                        entry.kind === 'directory'
                          ? 'workspace.agentSettingsContextKindDirectory'
                          : entry.kind === 'file'
                            ? 'workspace.agentSettingsContextKindFile'
                            : 'workspace.agentSettingsContextKindOther',
                      )}
                    </span>
                    {entry.targetMissing ? (
                      <span className="agent-context-chip agent-context-chip--warning">
                        {t('workspace.agentSettingsContextTargetMissing')}
                      </span>
                    ) : null}
                  </div>
                  <p className="agent-context-row__meta">
                    {projectContextEntryMeta(entry, t)}
                  </p>
                </div>
                <button
                  type="button"
                  className="project-home-icon-button agent-context-row__remove"
                  disabled={busy || readOnly}
                  title={t('workspace.agentSettingsContextRemove')}
                  aria-label={t('workspace.agentSettingsContextRemoveNamed', { name: entry.name })}
                  data-mm-label={t('workspace.agentSettingsContextRemoveNamed', { name: entry.name })}
                  data-mm-aliases={entry.relativePath}
                  onClick={() => onRemove(entry)}
                >
                  <IconInline name="trash" />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="agent-settings-panel-actions">
          <SaveFeedback status={status} dirty={instructionsDirty} saving={busy} />
          <button type="button" className="agent-card-primary-button" disabled={busy || readOnly || !instructionsDirty} data-mm-label={busy ? t('settings.agentMode.saving') : t('workspace.agentSettingsContextSaveInstructions')} onClick={onSaveInstructions}>
            <IconInline name={busy ? 'refresh' : 'save'} />
            <span>{busy ? t('settings.agentMode.saving') : t('workspace.agentSettingsContextSaveInstructions')}</span>
          </button>
        </div>
      </section>
    </section>
  )
}

function SkillsModelSettingsPanel({
  skills,
  modelRows,
  modelSettingsSnapshot,
  savedOverrides,
  draftOverrides,
  status,
  saving,
  onDraftOverridesChange,
  onClose,
  onSave,
}: {
  skills: AgentContextSlashItem[]
  modelRows: ModelPickMenuRow[]
  modelSettingsSnapshot: ClaudeAgentSettingsSnapshot | null
  savedOverrides: Record<string, ChatModelPick>
  draftOverrides: Record<string, ChatModelPick>
  status: string
  saving: boolean
  onDraftOverridesChange: (overrides: Record<string, ChatModelPick>) => void
  onClose: () => void
  onSave: () => void
}) {
  const { t } = useI18n()
  const hasModels = modelRows.length > 0
  const defaultLabel = t('workspace.agentSettingsSkillDefaultModel')
  const isDirty = JSON.stringify(savedOverrides) !== JSON.stringify(draftOverrides)
  const setSkillPick = (skillPath: string, pickKey: string) => {
    const next = { ...draftOverrides }
    if (!pickKey) {
      delete next[skillPath]
    } else {
      const row = modelRows.find((item) => item.pickKey === pickKey)
      if (row) next[skillPath] = modelPickFromRow(row)
    }
    onDraftOverridesChange(next)
  }
  const reset = () => onDraftOverridesChange(savedOverrides)

  return (
    <section className="settings-stack agent-settings-panel" aria-labelledby="agent-settings-skills-heading">
      <section className="settings-section">
        <h3 id="agent-settings-skills-heading" className="settings-section-heading">
          {t('workspace.agentSettingsSkills')}
        </h3>
        <p className="settings-section-caption">{t('workspace.agentSettingsSkillsHint')}</p>
        <div className="agent-skill-model-list" role="list">
          {skills.length === 0 ? (
            <div className="project-home-skill-empty">{t('workspace.taskNoSkills')}</div>
          ) : null}
          {skills.map((skill) => {
            const rawPick = draftOverrides[skill.path]
            const validPick = modelSettingsSnapshot ? validateModelPick(modelSettingsSnapshot.settings, rawPick) : rawPick
            const row = modelRowForPick(modelRows, validPick)
            const currentValue = row?.pickKey ?? ''
            return (
              <div key={skill.path} className="agent-skill-model-row" role="listitem">
                <span className="agent-skill-model-row__icon" aria-hidden="true">
                  <IconInline name="chip" />
                </span>
                <span className="agent-skill-model-row__copy">
                  <span>{skill.title || skill.name}</span>
                  <span>{skill.command ? `/${skill.command}` : skill.relativePath}</span>
                </span>
                <label className="agent-skill-model-row__selector">
                  <span className="sr-only">{t('workspace.agentSettingsSkillModelFor', { name: skill.title || skill.name })}</span>
                  <select
                    className="settings-input settings-select"
                    value={currentValue}
                    disabled={!hasModels}
                    data-mm-label={t('workspace.agentSettingsSkillModelFor', { name: skill.title || skill.name })}
                    data-mm-aliases={skill.command ? `/${skill.command}` : skill.relativePath}
                    data-mm-exposure="value"
                    onChange={(event) => setSkillPick(skill.path, event.target.value)}
                  >
                    <option value="">{defaultLabel}</option>
                    {modelRows.map((item) => (
                      <option key={item.pickKey} value={item.pickKey}>
                        {item.headline}{item.metaLine ? ` · ${item.metaLine}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )
          })}
        </div>
        <div className="agent-settings-panel-actions">
          <SaveFeedback status={status} dirty={isDirty} saving={saving} />
          <button type="button" className="agent-card-secondary-button" disabled={saving || !isDirty} data-mm-label={t('settings.agentMode.cancel')} onClick={() => {
            reset()
            onClose()
          }}>
            {t('settings.agentMode.cancel')}
          </button>
          <button type="button" className="agent-card-primary-button" disabled={saving || !isDirty || (!hasModels && skills.length > 0)} data-mm-label={saving ? t('settings.agentMode.saving') : t('settings.agentMode.confirm')} onClick={onSave}>
            <IconInline name={saving ? 'refresh' : 'save'} />
            <span>{saving ? t('settings.agentMode.saving') : t('settings.agentMode.confirm')}</span>
          </button>
        </div>
      </section>
    </section>
  )
}

function McpSettingsPanel({
  savedServers,
  draftServers,
  savedOverrides,
  draftOverrides,
  savedPolicies,
  draftPolicies,
  probeCache,
  status,
  operation,
  statusServers,
  onDraftServersChange,
  onDraftOverridesChange,
  onDraftPoliciesChange,
  onRefreshStatus,
  onClose,
  onSave,
}: {
  savedServers: AgentMcpServerConfig[]
  draftServers: AgentMcpServerConfig[]
  savedOverrides: AgentMcpServerOverrides
  draftOverrides: AgentMcpServerOverrides
  savedPolicies: AgentMcpToolPolicies
  draftPolicies: AgentMcpToolPolicies
  probeCache: AgentMcpServerProbeCache
  status: string
  operation: ProjectMcpOperation
  statusServers?: ClaudeAgentStatusSnapshot['mcpServers']
  onDraftServersChange: (servers: AgentMcpServerConfig[]) => void
  onDraftOverridesChange: (overrides: AgentMcpServerOverrides) => void
  onDraftPoliciesChange: (policies: AgentMcpToolPolicies) => void
  onRefreshStatus: () => void
  onClose: () => void
  onSave: () => void
}) {
  const { t } = useI18n()
  const saving = operation === 'saving'
  const testing = operation === 'testing'
  const discoveredTools = useMemo<DiscoveredMcpToolOption[]>(() => {
    return draftServers.flatMap((server) => {
      if (!server.enabled) return []
      const snapshot = getMatchingMcpProbeSnapshot(server, probeCache)
      if (snapshot?.status !== 'connected') return []
      return snapshot.tools.map((tool) => ({
        serverName: server.name,
        toolName: tool.name,
        fullName: `mcp__${server.name}__${tool.name}`,
        description: tool.description,
      }))
    })
  }, [draftServers, probeCache])
  const discoveredToolNames = useMemo(() => new Set(discoveredTools.map((tool) => tool.fullName)), [discoveredTools])
  const discoveredToolGroups = useMemo(() => groupMcpDiscoveredTools(discoveredTools), [discoveredTools])
  const policyEntries = Object.entries(draftPolicies).filter(([toolName]) => !discoveredToolNames.has(toolName))
  const isDirty =
    JSON.stringify(savedOverrides) !== JSON.stringify(draftOverrides) ||
    !sameMcpSettings(savedServers, draftServers, savedPolicies, draftPolicies)
  const envRefs = collectMcpEnvReferences(draftServers)
  const statusByName = useMemo(() => {
    return new Map((statusServers ?? []).map((server) => [server.name.trim(), server]))
  }, [statusServers])
  const updateServer = (index: number, patch: Partial<AgentMcpServerConfig>) => {
    const nextServers = draftServers.map((server, serverIndex) => (serverIndex === index ? { ...server, ...patch } : server))
    onDraftServersChange(nextServers)
    const target = nextServers[index]
    if (target && Object.prototype.hasOwnProperty.call(patch, 'enabled')) {
      onDraftOverridesChange({ ...draftOverrides, [target.name]: { enabled: target.enabled } })
    }
  }
  const reset = () => {
    onDraftServersChange(savedServers)
    onDraftOverridesChange(savedOverrides)
    onDraftPoliciesChange(savedPolicies)
  }
  const addPolicy = () => {
    const nextName = uniquePolicyName(draftPolicies, draftServers)
    onDraftPoliciesChange({ ...draftPolicies, [nextName]: 'ask' })
  }
  const updatePolicyName = (oldName: string, nextName: string) => {
    const trimmed = nextName.trim()
    const next = { ...draftPolicies }
    const policy = next[oldName] ?? 'ask'
    delete next[oldName]
    if (trimmed) next[trimmed] = policy
    onDraftPoliciesChange(next)
  }
  const updatePolicy = (toolName: string, policy: AgentMcpToolPolicy) => {
    onDraftPoliciesChange({ ...draftPolicies, [toolName]: policy })
  }
  const removePolicy = (toolName: string) => {
    const next = { ...draftPolicies }
    delete next[toolName]
    onDraftPoliciesChange(next)
  }

  return (
    <section className="settings-stack agent-settings-panel" data-testid="agent-settings-mcp-panel" aria-labelledby="agent-settings-mcp-heading">
      <section className="settings-section">
        <h3 id="agent-settings-mcp-heading" className="settings-section-heading">
          {t('workspace.agentSettingsMcp')}
        </h3>
        <p className="settings-section-caption">{t('workspace.agentSettingsMcpHint')}</p>

        <section className="agent-mcp-installed" aria-labelledby="agent-settings-mcp-installed-heading">
          <div className="agent-mcp-installed__head">
            <div>
              <h4 id="agent-settings-mcp-installed-heading">{t('workspace.agentSettingsMcpInstalledHeading')}</h4>
              <p>{t('workspace.agentSettingsMcpInstallHint')}</p>
            </div>
            <button type="button" className="agent-card-secondary-button" disabled={saving || testing} onClick={onRefreshStatus} data-mm-label={t('workspace.agentSettingsMcpRefreshStatus')}>
              <IconInline name="refresh" />
              <span>{t('workspace.agentSettingsMcpRefreshStatus')}</span>
            </button>
          </div>
          <div className="agent-mcp-installed-list" role="list" data-testid="mcp-installed-server-list">
            {draftServers.length === 0 ? (
              <p className="agent-context-empty">{t('workspace.agentSettingsMcpGlobalEmpty')}</p>
            ) : null}
            {draftServers.map((server, index) => {
              const displayName = server.name.trim() || t('workspace.agentSettingsMcpUnnamed')
              const savedName = savedServers[index]?.name?.trim() ?? ''
              const runtimeStatus = statusByName.get(server.name.trim()) ?? (savedName ? statusByName.get(savedName) : undefined)
              const probeSnapshot = getMatchingMcpProbeSnapshot(server, probeCache)
              const statusMeta = formatMcpSettingsServerStatus(server, runtimeStatus, probeSnapshot, t)
              const recoveryHint = formatMcpProjectRecoveryHint(server, runtimeStatus, probeSnapshot, t)
              return (
                <div
                  key={`${server.name}-${index}`}
                  className={`agent-mcp-installed-row agent-mcp-installed-row--${statusMeta.tone}`}
                  role="listitem"
                >
                  <span className="agent-mcp-installed-row__avatar" aria-hidden="true">
                    <span>{displayName.slice(0, 1).toUpperCase()}</span>
                    <span className={`agent-mcp-installed-row__dot agent-mcp-installed-row__dot--${statusMeta.tone}`} />
                  </span>
                  <span className="agent-mcp-installed-row__copy">
                    <strong>{displayName}</strong>
                    <span title={statusMeta.title}>{statusMeta.text}</span>
                    {recoveryHint ? <small data-testid="mcp-recovery-hint">{recoveryHint}</small> : null}
                  </span>
                  <label className="agent-mcp-installed-row__switch">
                    <span className="sr-only">{t('workspace.agentSettingsMcpToggleServer', { name: displayName })}</span>
                    <span className="settings-switch-control">
                      <input
                        type="checkbox"
                        className="settings-switch-input"
                        checked={server.enabled}
                        disabled={saving}
                        data-mm-label={t('workspace.agentSettingsMcpToggleServer', { name: displayName })}
                        data-mm-aliases={displayName}
                        data-mm-exposure="value"
                        onChange={(event) => updateServer(index, { enabled: event.target.checked })}
                      />
                      <span className="settings-switch-track" aria-hidden="true">
                        <span className="settings-switch-thumb" />
                      </span>
                    </span>
                  </label>
                </div>
              )
            })}
          </div>
          <p className="agent-mcp-session-hint" data-testid="mcp-session-effect-hint">
            {t('workspace.agentSettingsMcpSessionEffectHint')}
          </p>
        </section>

        {envRefs.length > 0 ? (
          <p className="agent-mcp-warning" data-testid="mcp-env-resolution-error">
            {t('workspace.agentSettingsMcpEnvRefNotice', { count: envRefs.length })}
          </p>
        ) : null}

        <section className="agent-mcp-policy" aria-labelledby="agent-settings-mcp-policy-heading">
          <div className="agent-mcp-policy__head">
            <div>
              <h4 id="agent-settings-mcp-policy-heading">{t('workspace.agentSettingsMcpPolicies')}</h4>
              <p>{t('workspace.agentSettingsMcpPoliciesHint')}</p>
            </div>
            <button type="button" className="agent-card-secondary-button" disabled={saving} data-mm-label={t('workspace.agentSettingsMcpAddPolicy')} onClick={addPolicy}>
              <IconInline name="plus" />
              <span>{t('workspace.agentSettingsMcpAddPolicy')}</span>
            </button>
          </div>
          {discoveredToolGroups.length > 0 ? (
            <div className="agent-mcp-discovered-tools" role="list" data-testid="mcp-discovered-tool-policy-list">
              <div className="agent-mcp-discovered-tools__head">
                <strong>{t('workspace.agentSettingsMcpDiscoveredTools')}</strong>
                <span>{t('workspace.agentSettingsMcpDiscoveredToolsHint')}</span>
              </div>
              {discoveredToolGroups.map((group) => (
                <div className="agent-mcp-discovered-tools__group" key={group.serverName}>
                  <div className="agent-mcp-discovered-tools__group-head">
                    <strong>{group.serverName}</strong>
                    <span>{t('workspace.agentSettingsMcpDiscoveredServerTools', { count: group.tools.length })}</span>
                  </div>
                  {group.tools.map((tool) => {
                    const risk = formatMcpToolRisk(tool.toolName, tool.description, t)
                    const hasExplicitPolicy = Object.prototype.hasOwnProperty.call(draftPolicies, tool.fullName)
                    return (
                      <div className="agent-mcp-discovered-tool-row" role="listitem" key={tool.fullName}>
                        <span className="agent-mcp-discovered-tool-row__copy">
                          <strong>{tool.toolName}</strong>
                          <small>{tool.description || tool.fullName}</small>
                          <span className="agent-mcp-discovered-tool-row__meta">
                            <span className={`agent-mcp-risk agent-mcp-risk--${risk.tone}`} data-testid="mcp-tool-risk-annotation">
                              {risk.label}
                            </span>
                            <small data-testid="mcp-policy-source-hint">
                              {hasExplicitPolicy ? t('workspace.agentSettingsMcpPolicySourceProject') : t('workspace.agentSettingsMcpPolicySourceDefault')}
                            </small>
                          </span>
                        </span>
                        <label className="agent-mcp-field">
                          <span>{t('workspace.agentSettingsMcpPolicy')}</span>
                          <select
                            className="settings-input settings-select"
                            value={draftPolicies[tool.fullName] ?? 'ask'}
                            disabled={saving}
                            data-mm-label={`${tool.toolName} ${t('workspace.agentSettingsMcpPolicy')}`}
                            data-mm-aliases={tool.fullName}
                            data-mm-exposure="value"
                            onChange={(event) => updatePolicy(tool.fullName, event.target.value as AgentMcpToolPolicy)}
                          >
                            <option value="ask">{t('workspace.agentSettingsMcpPolicyAsk')}</option>
                            <option value="allow">{t('workspace.agentSettingsMcpPolicyAllow')}</option>
                            <option value="deny">{t('workspace.agentSettingsMcpPolicyDeny')}</option>
                          </select>
                        </label>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          ) : null}
          <div className="agent-mcp-policy__list" role="list" data-testid="mcp-tool-policy-list">
            {policyEntries.length === 0 ? (
              <p className="agent-context-empty">{t('workspace.agentSettingsMcpPolicyEmpty')}</p>
            ) : null}
            {policyEntries.map(([toolName, policy]) => (
              <div className="agent-mcp-policy-row" role="listitem" key={toolName}>
                <label className="agent-mcp-field">
                  <span>{t('workspace.agentSettingsMcpToolName')}</span>
                  <input
                    className="settings-input"
                    value={toolName}
                    disabled={saving}
                    spellCheck={false}
                    placeholder="mcp__github__create_issue"
                    data-mm-label={t('workspace.agentSettingsMcpToolName')}
                    data-mm-aliases={toolName}
                    data-mm-exposure="value"
                    onChange={(event) => updatePolicyName(toolName, event.target.value)}
                  />
                </label>
                <label className="agent-mcp-field">
                  <span>{t('workspace.agentSettingsMcpPolicy')}</span>
                  <select
                    className="settings-input settings-select"
                    value={policy}
                    disabled={saving}
                    data-mm-label={`${toolName} ${t('workspace.agentSettingsMcpPolicy')}`}
                    data-mm-aliases={toolName}
                    data-mm-exposure="value"
                    onChange={(event) => updatePolicy(toolName, event.target.value as AgentMcpToolPolicy)}
                  >
                    <option value="ask">{t('workspace.agentSettingsMcpPolicyAsk')}</option>
                    <option value="allow">{t('workspace.agentSettingsMcpPolicyAllow')}</option>
                    <option value="deny">{t('workspace.agentSettingsMcpPolicyDeny')}</option>
                  </select>
                  <small className="settings-field-row__hint" data-testid="mcp-policy-source-hint">
                    {t('workspace.agentSettingsMcpPolicySourceManual')}
                  </small>
                </label>
                <button
                  type="button"
                  className="project-home-icon-button project-home-icon-button--danger"
                  disabled={saving}
                  title={t('workspace.agentSettingsMcpRemovePolicy')}
                  aria-label={t('workspace.agentSettingsMcpRemovePolicyNamed', { name: toolName })}
                  data-mm-label={t('workspace.agentSettingsMcpRemovePolicyNamed', { name: toolName })}
                  data-mm-aliases={toolName}
                  onClick={() => removePolicy(toolName)}
                >
                  <IconInline name="trash" />
                </button>
              </div>
            ))}
          </div>
        </section>

        <div className="agent-settings-panel-actions">
          <SaveFeedback status={status} dirty={isDirty} saving={saving} busy={saving || testing} />
          <button type="button" className="agent-card-secondary-button" disabled={saving || !isDirty} data-mm-label={t('settings.agentMode.cancel')} onClick={() => {
            reset()
            onClose()
          }}>
            {t('settings.agentMode.cancel')}
          </button>
          <button type="button" className="agent-card-primary-button" disabled={saving || !isDirty} data-mm-label={saving ? t('settings.agentMode.saving') : t('settings.agentMode.confirm')} onClick={onSave}>
            <IconInline name={saving ? 'refresh' : 'save'} />
            <span>{saving ? t('settings.agentMode.saving') : t('settings.agentMode.confirm')}</span>
          </button>
        </div>
      </section>
    </section>
  )
}

function CardOrderSettingsPanel({
  cards,
  draftOrder,
  draftSizes,
  onDraftOrderChange,
  onDraftSizeChange,
  deletingSlug,
  status,
  saving,
  onDelete,
  onClose,
  onSave,
}: {
  cards: HomeCardItem[]
  draftOrder: string[]
  draftSizes: Record<string, HomePluginCardSize>
  onDraftOrderChange: (order: string[]) => void
  onDraftSizeChange: (cardId: string, preferredSize: HomePluginCardSize) => void
  deletingSlug: string
  status: string
  saving: boolean
  onDelete: (item: HomePluginRunItem) => void
  onClose: () => void
  onSave: () => void
}) {
  const { t } = useI18n()
  const byId = new Map(cards.map((item) => [item.cardId, item]))
  const ordered = draftOrder.map((cardId) => byId.get(cardId)).filter((item): item is HomeCardItem => Boolean(item))
  const isDirty = !sameCardLayout(cards, draftOrder, draftSizes)
  const move = (cardId: string, offset: number) => {
    const index = draftOrder.indexOf(cardId)
    const nextIndex = index + offset
    if (index < 0 || nextIndex < 0 || nextIndex >= draftOrder.length) return
    const next = [...draftOrder]
    const [item] = next.splice(index, 1)
    next.splice(nextIndex, 0, item)
    onDraftOrderChange(next)
  }

  const onDragStart = (event: DragEvent<HTMLDivElement>, cardId: string) => {
    event.dataTransfer.setData('text/plain', cardId)
    event.dataTransfer.effectAllowed = 'move'
  }
  const onDrop = (event: DragEvent<HTMLDivElement>, targetCardId: string) => {
    event.preventDefault()
    const sourceCardId = event.dataTransfer.getData('text/plain')
    if (!sourceCardId || sourceCardId === targetCardId) return
    const sourceIndex = draftOrder.indexOf(sourceCardId)
    const targetIndex = draftOrder.indexOf(targetCardId)
    if (sourceIndex < 0 || targetIndex < 0) return
    const next = [...draftOrder]
    const [item] = next.splice(sourceIndex, 1)
    next.splice(targetIndex, 0, item)
    onDraftOrderChange(next)
  }

  return (
    <section className="settings-stack agent-settings-panel" aria-labelledby="agent-settings-card-order-heading">
      <section className="settings-section">
        <h3 id="agent-settings-card-order-heading" className="settings-section-heading">
          {t('workspace.agentSettingsCardOrder')}
        </h3>
        <p className="settings-section-caption">{t('workspace.agentSettingsCardOrderHint')}</p>
        <div className="project-home-sort-list project-home-sort-list--settings" role="list">
          {ordered.map((card, index) => {
            const displaySize = draftSizes[card.cardId] ?? card.size
            const title = card.kind === 'plugin' ? card.item.manifest.name : card.skill.title
            const subtitle = card.kind === 'plugin' ? card.item.slug : card.skill.relativePath
            const badge =
              card.kind === 'skill'
                ? t('workspace.addSkillCard')
                : card.item.manifest.kind === 'task'
                  ? t('workspace.addTaskCard')
                  : t('workspace.addDataCard')
            return (
            <div
              key={card.cardId}
              className="project-home-sort-row"
              role="listitem"
              draggable
              onDragStart={(event) => onDragStart(event, card.cardId)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => onDrop(event, card.cardId)}
            >
              <span className="project-home-sort-row__grab" aria-hidden="true">
                <IconInline name="sort" />
              </span>
              <span className="project-home-sort-row__copy">
                <span>{title}</span>
                <span>{subtitle}</span>
              </span>
              <div className="project-home-size-switch" role="group" aria-label={t('workspace.sortAgentCards')}>
                {(['small', 'medium', 'large'] as const).map((size) => (
                  <button
                    key={size}
                    type="button"
                    className={`project-home-size-switch__button${displaySize === size ? ' is-active' : ''}`}
                    aria-pressed={displaySize === size}
                    data-mm-label={t(`workspace.cardSize.${size}`)}
                    data-mm-aliases={title}
                    onClick={() => onDraftSizeChange(card.cardId, size)}
                  >
                    {t(`workspace.cardSize.${size}`)}
                  </button>
                ))}
              </div>
              <span className="project-home-kind-badge">{badge}</span>
              <button type="button" className="project-home-icon-button" disabled={index === 0} data-mm-label={t('workspace.moveCardUp')} data-mm-aliases={title} onClick={() => move(card.cardId, -1)} aria-label={t('workspace.moveCardUp')}>
                <IconInline name="arrowUp" />
              </button>
              <button type="button" className="project-home-icon-button" disabled={index === ordered.length - 1} data-mm-label={t('workspace.moveCardDown')} data-mm-aliases={title} onClick={() => move(card.cardId, 1)} aria-label={t('workspace.moveCardDown')}>
                <IconInline name="arrowDown" />
              </button>
              {card.kind === 'plugin' && !isTodoHomeCard(card.item) ? (
                <button
                  type="button"
                  className="project-home-icon-button project-home-icon-button--danger"
                  disabled={Boolean(deletingSlug)}
                  title={t('workspace.deleteAgentCard')}
                  data-mm-label={t('workspace.deleteAgentCard')}
                  data-mm-aliases={title}
                  onClick={() => onDelete(card.item)}
                  aria-label={t('workspace.deleteAgentCard')}
                >
                  <IconInline name={deletingSlug === card.item.slug ? 'refresh' : 'trash'} />
                </button>
              ) : (
                <span className="project-home-sort-row__spacer" aria-hidden="true" />
              )}
            </div>
            )
          })}
        </div>
        <div className="agent-settings-panel-actions">
          <SaveFeedback status={status} dirty={isDirty} saving={saving} />
          <button type="button" className="agent-card-secondary-button" disabled={saving} data-mm-label={t('settings.agentMode.cancel')} onClick={onClose}>
            {t('settings.agentMode.cancel')}
          </button>
          <button type="button" className="agent-card-primary-button" disabled={saving || !isDirty} data-mm-label={saving ? t('settings.agentMode.saving') : t('settings.agentMode.confirm')} onClick={onSave}>
            <IconInline name={saving ? 'refresh' : 'save'} />
            <span>{saving ? t('settings.agentMode.saving') : t('settings.agentMode.confirm')}</span>
          </button>
        </div>
      </section>
    </section>
  )
}

function buildHomeGridItems(cards: HomeCardItem[]): HomeGridItem[] {
  const output: HomeGridItem[] = []
  let column = 1
  let fillerCount = 0

  const createFiller = (id: string, span: number): HomeGridFillerItem | null => {
    if (span !== 1 && span !== 2) return null
    const tones: HomeGridFillerItem['tone'][] = ['grid', 'signal', 'trace']
    const filler: HomeGridFillerItem = {
      kind: 'filler',
      id,
      span,
      tone: tones[fillerCount % tones.length],
    }
    fillerCount += 1
    return filler
  }

  cards.forEach((card, index) => {
    const span = Math.min(HOME_GRID_COLUMNS, Math.max(1, sizeToColumnSpan(card.size)))
    const remaining = HOME_GRID_COLUMNS - column + 1
    if (column > 1 && span > remaining) {
      const filler = createFiller(`before-${card.cardId}-${index}`, remaining)
      if (filler) output.push(filler)
      column = 1
    }

    output.push({ kind: 'card', card })
    column = span >= HOME_GRID_COLUMNS ? 1 : column + span
    if (column > HOME_GRID_COLUMNS) column = 1
  })

  if (cards.length > 0 && column > 1) {
    const remaining = HOME_GRID_COLUMNS - column + 1
    const filler = createFiller(`after-${cards[cards.length - 1]?.cardId ?? 'last'}`, remaining)
    if (filler) output.push(filler)
  }

  return output
}

function sameProjectDocuments(
  left: Record<AgentProjectDocumentName, string>,
  right: Record<AgentProjectDocumentName, string>,
): boolean {
  return AGENT_PROJECT_DOCUMENT_NAMES.every((name) => left[name] === right[name])
}

function sameCardLayout(
  cards: HomeCardItem[],
  draftOrder: string[],
  draftSizes: Record<string, HomePluginCardSize>,
): boolean {
  const currentOrder = cards.map((card) => card.cardId)
  if (currentOrder.length !== draftOrder.length) return false
  if (currentOrder.some((cardId, index) => cardId !== draftOrder[index])) return false
  return cards.every((card) => (draftSizes[card.cardId] ?? card.size) === card.size)
}

function uniquePolicyName(policies: AgentMcpToolPolicies, servers: AgentMcpServerConfig[]): string {
  const serverName = servers.find((server) => server.name.trim())?.name.trim() || 'server'
  const base = `mcp__${serverName}__tool`
  let name = base
  let suffix = 2
  while (Object.prototype.hasOwnProperty.call(policies, name)) {
    name = `${base}_${suffix}`
    suffix += 1
  }
  return name
}

function normalizeMcpServersForSave(servers: AgentMcpServerConfig[]): AgentMcpServerConfig[] {
  const usedNames = new Set<string>()
  return servers.map((server) => {
    const rawName = server.name.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64) || 'mcp-server'
    let name = rawName
    let suffix = 2
    while (usedNames.has(name)) {
      name = `${rawName}-${suffix}`
      suffix += 1
    }
    usedNames.add(name)
    return {
      name,
      enabled: server.enabled,
      transport: server.transport === 'http' || server.transport === 'sse' ? server.transport : 'stdio',
      command: server.command.trim(),
      args: server.args.map((arg) => arg.trim()).filter(Boolean),
      env: cleanStringRecord(server.env),
      cwd: server.cwd.trim(),
      url: server.url.trim(),
      headers: cleanStringRecord(server.headers),
      alwaysLoad: server.alwaysLoad,
    }
  })
}

function normalizeMcpPoliciesForSave(policies: AgentMcpToolPolicies): AgentMcpToolPolicies {
  const next: AgentMcpToolPolicies = {}
  for (const [rawName, policy] of Object.entries(policies)) {
    const name = rawName.trim()
    if (!name) continue
    next[name] = policy === 'allow' || policy === 'deny' ? policy : 'ask'
  }
  return next
}

function overridesFromMcpServers(servers: AgentMcpServerConfig[]): AgentMcpServerOverrides {
  return Object.fromEntries(servers.map((server) => [server.name, { enabled: server.enabled }]))
}

type DiscoveredMcpToolOption = {
  serverName: string
  toolName: string
  fullName: string
  description?: string
}

type McpSettingsStatusTone = 'ready' | 'pending' | 'error' | 'disabled'

function groupMcpDiscoveredTools(tools: DiscoveredMcpToolOption[]): { serverName: string; tools: DiscoveredMcpToolOption[] }[] {
  const groups = new Map<string, DiscoveredMcpToolOption[]>()
  for (const tool of tools) {
    const groupTools = groups.get(tool.serverName) ?? []
    groupTools.push(tool)
    groups.set(tool.serverName, groupTools)
  }
  return [...groups.entries()].map(([serverName, groupTools]) => ({ serverName, tools: groupTools }))
}

function formatMcpToolRisk(
  toolName: string,
  description: string | undefined,
  t: (path: string, params?: Record<string, string | number>) => string,
): { tone: 'low' | 'medium' | 'high'; label: string } {
  const text = `${toolName} ${description ?? ''}`.toLowerCase()
  if (/(delete|remove|destroy|drop|reset|execute|exec|shell|bash|terminal|run|deploy|publish)/.test(text)) {
    return { tone: 'high', label: t('workspace.agentSettingsMcpRiskHigh') }
  }
  if (/(write|create|update|edit|upload|send|post|commit|merge|move|rename|apply|patch)/.test(text)) {
    return { tone: 'medium', label: t('workspace.agentSettingsMcpRiskMedium') }
  }
  return { tone: 'low', label: t('workspace.agentSettingsMcpRiskLow') }
}

function formatMcpProjectRecoveryHint(
  server: AgentMcpServerConfig,
  runtimeStatus: NonNullable<ClaudeAgentStatusSnapshot['mcpServers']>[number] | undefined,
  probeSnapshot: AgentMcpServerProbeSnapshot | undefined,
  t: (path: string, params?: Record<string, string | number>) => string,
): string {
  if (!server.enabled) return ''
  const status = runtimeStatus?.status ?? probeSnapshot?.status
  if (status !== 'failed' && status !== 'needs-auth') return ''
  const error = `${runtimeStatus?.error ?? ''} ${probeSnapshot?.error ?? ''}`.toLowerCase()
  if (error.includes('env') || error.includes('environment') || error.includes('variable') || error.includes('${')) {
    return t('workspace.agentSettingsMcpRecoveryEnv')
  }
  if (status === 'needs-auth' || error.includes('auth') || error.includes('token') || error.includes('key')) {
    return t('workspace.agentSettingsMcpRecoveryAuth')
  }
  return server.transport === 'stdio' ? t('workspace.agentSettingsMcpRecoveryCommand') : t('workspace.agentSettingsMcpRecoveryUrl')
}

function formatMcpSettingsServerStatus(
  server: AgentMcpServerConfig,
  runtimeStatus: NonNullable<ClaudeAgentStatusSnapshot['mcpServers']>[number] | undefined,
  probeSnapshot: AgentMcpServerProbeSnapshot | undefined,
  t: (path: string, params?: Record<string, string | number>) => string,
): { tone: McpSettingsStatusTone; text: string; title?: string } {
  if (!server.enabled) {
    return { tone: 'disabled', text: t('workspace.agentSettingsMcpStatusDisabled') }
  }
  if (runtimeStatus?.status === 'connected') {
    if (typeof runtimeStatus.toolCount === 'number') {
      return {
        tone: 'ready',
        text: t('workspace.agentSettingsMcpStatusRuntimeConnectedTools', { count: runtimeStatus.toolCount }),
      }
    }
    return { tone: 'ready', text: t('workspace.agentSettingsMcpStatusRuntimeConnected') }
  }
  if (runtimeStatus?.status === 'failed') {
    const message = runtimeStatus.error?.trim()
    return {
      tone: 'error',
      text: message
        ? t('workspace.agentSettingsMcpStatusFailedDetail', { message })
        : t('workspace.agentSettingsMcpStatusFailed'),
      title: message,
    }
  }
  if (runtimeStatus?.status === 'needs-auth') {
    const message = runtimeStatus.error?.trim()
    return {
      tone: 'error',
      text: message
        ? t('workspace.agentSettingsMcpStatusNeedsAuthDetail', { message })
        : t('workspace.agentSettingsMcpStatusNeedsAuth'),
      title: message,
    }
  }
  if (runtimeStatus?.error?.trim()) {
    return {
      tone: 'error',
      text: t('workspace.agentSettingsMcpStatusFailedDetail', { message: runtimeStatus.error.trim() }),
      title: runtimeStatus.error.trim(),
    }
  }
  if (probeSnapshot?.status === 'connected') {
    return {
      tone: 'ready',
      text: t('workspace.agentSettingsMcpStatusProjectAvailableTools', { count: probeSnapshot.tools.length }),
    }
  }
  if (probeSnapshot?.status === 'needs-auth') {
    const message = probeSnapshot.error?.trim()
    return {
      tone: 'error',
      text: message
        ? t('workspace.agentSettingsMcpStatusNeedsAuthDetail', { message })
        : t('workspace.agentSettingsMcpStatusNeedsAuth'),
      title: message,
    }
  }
  if (probeSnapshot?.status === 'failed') {
    const message = probeSnapshot.error?.trim()
    return {
      tone: 'error',
      text: message
        ? t('workspace.agentSettingsMcpStatusFailedDetail', { message })
        : t('workspace.agentSettingsMcpStatusFailed'),
      title: message,
    }
  }
  if (probeSnapshot?.status === 'disabled') {
    return { tone: 'disabled', text: t('workspace.agentSettingsMcpStatusDisabled') }
  }
  if (runtimeStatus?.status) {
    return {
      tone: 'pending',
      text: t('workspace.agentSettingsMcpStatusRuntime', { status: runtimeStatus.status }),
    }
  }
  return { tone: 'pending', text: t('settings.mcp.notTested') }
}

function validateMcpSettings(
  servers: AgentMcpServerConfig[],
  policies: AgentMcpToolPolicies,
  t: (path: string, params?: Record<string, string | number>) => string,
): string {
  for (const server of servers) {
    if (!server.enabled) continue
    if (server.transport === 'stdio' && !server.command.trim()) {
      return t('workspace.agentSettingsMcpMissingCommand', { name: server.name })
    }
    if (server.transport !== 'stdio' && !server.url.trim()) {
      return t('workspace.agentSettingsMcpMissingUrl', { name: server.name })
    }
  }
  for (const toolName of Object.keys(policies)) {
    if (!toolName.startsWith('mcp__') || !/^mcp__(.+?)__(.+)$/.test(toolName)) {
      return t('workspace.agentSettingsMcpInvalidToolName', { name: toolName })
    }
  }
  return ''
}

function sameMcpSettings(
  savedServers: AgentMcpServerConfig[],
  draftServers: AgentMcpServerConfig[],
  savedPolicies: AgentMcpToolPolicies,
  draftPolicies: AgentMcpToolPolicies,
): boolean {
  return JSON.stringify(normalizeMcpServersForSave(savedServers)) === JSON.stringify(normalizeMcpServersForSave(draftServers)) &&
    JSON.stringify(normalizeMcpPoliciesForSave(savedPolicies)) === JSON.stringify(normalizeMcpPoliciesForSave(draftPolicies))
}

function getMatchingMcpProbeSnapshot(
  server: AgentMcpServerConfig,
  probeCache: AgentMcpServerProbeCache,
): AgentMcpServerProbeSnapshot | undefined {
  const snapshot = probeCache[server.name]
  if (!snapshot) return undefined
  if (snapshot.configSignature !== buildMcpServerConfigSignature(server)) return undefined
  return snapshot
}

function buildMcpServerConfigSignature(server: AgentMcpServerConfig): string {
  return JSON.stringify({
    transport: server.transport === 'http' || server.transport === 'sse' ? server.transport : 'stdio',
    command: server.command.trim(),
    args: server.args.map((arg) => arg.trim()).filter(Boolean),
    env: cleanStringRecord(server.env),
    cwd: server.cwd.trim(),
    url: server.url.trim(),
    headers: cleanStringRecord(server.headers),
  })
}

function cleanStringRecord(record: Record<string, string>): Record<string, string> {
  const output: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries(record)) {
    const key = rawKey.trim()
    const value = rawValue.trim()
    if (key && value) output[key] = value
  }
  return output
}

function collectMcpEnvReferences(servers: AgentMcpServerConfig[]): string[] {
  const refs = new Set<string>()
  const collect = (value: string) => {
    for (const match of value.matchAll(/\$\{([A-Z_a-z][A-Z_a-z0-9]*)\}/g)) refs.add(match[1])
  }
  for (const server of servers) {
    collect(server.command)
    server.args.forEach(collect)
    collect(server.url)
    Object.values(server.env).forEach(collect)
    Object.values(server.headers).forEach(collect)
  }
  return [...refs]
}

function useMasonrySpan(ref: RefObject<HTMLElement | null>, deps: unknown[]) {
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const content = element.querySelector('.project-home-card__measure') as HTMLElement | null
    if (!content) return
    const sync = () => {
      const grid = element.parentElement
      const gridStyle = grid ? window.getComputedStyle(grid) : null
      const rowHeight = Number.parseFloat(gridStyle?.gridAutoRows || '') || 8
      const rowGap = Number.parseFloat(gridStyle?.rowGap || '') || Number.parseFloat(gridStyle?.gap || '') || 24
      const contentHeight = content.scrollHeight || content.getBoundingClientRect().height
      const span = Math.max(1, Math.ceil((contentHeight + rowGap) / (rowHeight + rowGap)))
      element.style.gridRowEnd = `span ${span}`
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(element)
    window.addEventListener('resize', sync)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', sync)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

function messagesForSize(item: HomePluginRunItem, size: HomePluginCardSize): A2uiMessage[] {
  return ((item.variants?.[size] ?? item.variants?.medium ?? item.variants?.large ?? item.variants?.small ?? item.messages ?? []) as A2uiMessage[])
}

function isTodoHomeCard(item: HomePluginRunItem): boolean {
  return item.manifest.id === TODO_HOME_PLUGIN_ID
}

function todoHomeCardDataFromMessages(messages: A2uiMessage[]): TodoHomeCardData | null {
  const data = messages
    .map((message) => {
      if (!isRecord(message) || !isRecord(message.updateDataModel)) return null
      const value = message.updateDataModel.value
      return isRecord(value) && isRecord(value.todo) ? value.todo : null
    })
    .find((todo): todo is Record<string, unknown> => Boolean(todo))

  if (!data) return null
  return {
    phase: readTaskText(data.phase),
    progress: readTaskText(data.progress),
    currentTask: readTaskText(data.currentTask),
    nextStep: readTaskText(data.nextStep),
    blocker: readTaskText(data.blocker),
    updatedAt: readTaskText(data.updatedAt),
    completed: readFiniteNumber(data.completed),
    total: readFiniteNumber(data.total),
    percent: Math.round(Math.min(100, Math.max(0, readFiniteNumber(data.percent)))),
    tasks: Array.isArray(data.tasks)
      ? data.tasks.filter(isRecord).map((task) => ({
          id: readTaskText(task.id),
          title: readTaskText(task.title),
          checked: task.checked === true,
          status: readTaskText(task.status),
          priority: readTaskText(task.priority),
        })).filter((task) => task.id && task.title)
      : [],
  }
}

function readFiniteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function createProjectFileNode(projectPath: string, relativePath: string): FileTreeNode {
  const normalizedProjectPath = projectPath.replace(/[\\/]+$/, '')
  const normalizedRelativePath = normalizeProjectRelativePath(relativePath)
  const name = normalizedRelativePath.split('/').filter(Boolean).at(-1) ?? normalizedRelativePath
  return {
    name,
    path: `${normalizedProjectPath}/${normalizedRelativePath}`,
    relativePath: normalizedRelativePath,
    type: 'file',
  }
}

function agentProjectDocumentHint(
  name: AgentProjectDocumentName,
  t: (path: string, values?: Record<string, string | number>) => string,
): string {
  if (name === 'AGENTS.md') return t('workspace.agentSettingsProjectDocumentAgentsHint')
  if (name === 'SOUL.md') return t('workspace.agentSettingsProjectDocumentSoulHint')
  return t('workspace.agentSettingsProjectDocumentGoalHint')
}

function agentProjectDocumentPlaceholder(
  name: AgentProjectDocumentName,
  t: (path: string, values?: Record<string, string | number>) => string,
): string {
  if (name === 'AGENTS.md') return t('workspace.agentSettingsProjectDocumentAgentsPlaceholder')
  if (name === 'SOUL.md') return t('workspace.agentSettingsProjectDocumentSoulPlaceholder')
  return t('workspace.agentSettingsProjectDocumentGoalPlaceholder')
}

function projectContextEntryMeta(
  entry: ProjectContextEntry,
  t: (path: string, values?: Record<string, string | number>) => string,
): string {
  const parts = [
    entry.mode === 'reference' && entry.targetPath
      ? t('workspace.agentSettingsContextTargetPath', { path: entry.targetPath })
      : entry.relativePath,
    typeof entry.size === 'number' ? formatBytes(entry.size) : '',
  ].filter(Boolean)
  return parts.join(' · ')
}

function taskCardViewModelFromMessages(item: HomePluginRunItem, messages: A2uiMessage[]): TaskHomeCardViewModel | null {
  const data = messages
    .map((message) => {
      if (!isRecord(message) || !isRecord(message.updateDataModel)) return null
      const value = message.updateDataModel.value
      return isRecord(value) && isRecord(value.task) ? value.task : null
    })
    .find((task): task is Record<string, unknown> => Boolean(task))

  if (!data) return null

  const scheduleLabel = readTaskText(data.scheduleLabel)
  const todoLabel = readTaskText(data.todoLabel)
  const runCountLabel = readTaskText(data.runCountLabel)
  const threadTitle = readTaskText(data.threadTitle)
  const statusLabel = readTaskText(data.statusLabel) || '待执行'
  const summary = readTaskText(data.summary) || '等待执行'
  const rawDetail = readTaskText(data.detail)
  const detail = [scheduleLabel, todoLabel].includes(rawDetail) ? '' : rawDetail
  const statusTone = taskStatusTone(statusLabel)

  return {
    slug: readTaskText(data.slug) || item.slug,
    title: readTaskText(data.title) || item.manifest.name,
    modeLabel: readTaskText(data.modeLabel),
    statusLabel,
    statusTone,
    summary,
    detail,
    meta: [scheduleLabel, todoLabel, runCountLabel].filter(Boolean),
    threadTitle,
    active: statusTone === 'active',
  }
}

function readTaskText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function taskStatusTone(label: string): TaskHomeCardTone {
  const normalized = label.toLowerCase()
  if (normalized.includes('失败') || normalized.includes('error')) return 'error'
  if (normalized.includes('完成') || normalized.includes('done')) return 'done'
  if (normalized.includes('终止') || normalized.includes('cancel')) return 'cancelled'
  if (normalized.includes('正在执行') || normalized.includes('等待中') || normalized.includes('running') || normalized.includes('queued') || normalized.includes('waiting')) {
    return 'active'
  }
  return 'idle'
}

function hasRenderableMessages(item: HomePluginRunItem): boolean {
  return messagesForSize(item, item.manifest.preferredSize).length > 0
}

function sizeToColumnSpan(size: HomePluginCardSize): number {
  if (size === 'large') return 3
  if (size === 'medium') return 2
  return 1
}

function sortHomeCards(cards: HomeCardItem[], order: string[]): HomeCardItem[] {
  const orderIndex = new Map(order.map((cardId, index) => [cardId, index]))
  return [...cards].sort((a, b) => {
    const ao = orderIndex.get(a.cardId)
    const bo = orderIndex.get(b.cardId)
    if (ao !== undefined || bo !== undefined) return (ao ?? Number.MAX_SAFE_INTEGER) - (bo ?? Number.MAX_SAFE_INTEGER)
    return a.cardId.localeCompare(b.cardId)
  })
}

function pluginCardId(slug: string): string {
  return `plugin-${slug}`
}

function skillCardId(skill: AgentContextSlashItem): string {
  return `skill-${skill.command}-${shortHash(skill.relativePath || skill.path)}`
}

function shortHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36).slice(0, 7)
}

function stableSemanticId(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized || 'item'
}

function readHomeCardLayout(projectPath: string): HomeCardLayout {
  if (typeof window === 'undefined') return { order: [], sizes: {} }
  try {
    const raw = window.localStorage.getItem(HOME_CARD_LAYOUT_STORAGE_KEY)
    if (!raw) return { order: [], sizes: {} }
    const parsed = JSON.parse(raw)
    return normalizeHomeCardLayout(isRecord(parsed) ? parsed[projectPath] : undefined)
  } catch {
    return { order: [], sizes: {} }
  }
}

function writeHomeCardLayout(projectPath: string, layout: HomeCardLayout): void {
  if (typeof window === 'undefined') return
  try {
    const raw = window.localStorage.getItem(HOME_CARD_LAYOUT_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    const next = isRecord(parsed) ? { ...parsed } : {}
    next[projectPath] = normalizeHomeCardLayout(layout)
    window.localStorage.setItem(HOME_CARD_LAYOUT_STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
}

function normalizeHomeCardLayout(value: unknown): HomeCardLayout {
  if (!isRecord(value)) return { order: [], sizes: {} }
  const order = Array.isArray(value.order)
    ? value.order.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
  const sizes: Record<string, HomePluginCardSize> = {}
  if (isRecord(value.sizes)) {
    for (const [cardId, size] of Object.entries(value.sizes)) {
      if (size === 'small' || size === 'medium' || size === 'large') sizes[cardId] = size
    }
  }
  return { order, sizes }
}

function latestSkillThread(
  threads: WorkspaceThread[],
  skillPath: string,
  predicate: (thread: WorkspaceThread) => boolean = () => true,
): WorkspaceThread | undefined {
  return threads
    .filter((thread) => thread.purpose === 'skill-run' && thread.skillPath === skillPath && !thread.archivedAt && predicate(thread))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
}

function latestThreadMessageStatus(thread: WorkspaceThread): 'done' | 'error' | 'cancelled' | undefined {
  const assistant = [...thread.chatState.items]
    .reverse()
    .find((item) => item.type === 'message' && item.role === 'assistant')
  if (!assistant || assistant.type !== 'message') return undefined
  return assistant.status === 'error' || assistant.status === 'cancelled' ? assistant.status : 'done'
}

function defaultTaskSchedule(): HomePluginTaskSchedule {
  return { enabled: false, hour: 9, minute: 0, interval: 'off' }
}

function emptyAgentProjectDocuments(): Record<AgentProjectDocumentName, string> {
  return Object.fromEntries(AGENT_PROJECT_DOCUMENT_NAMES.map((name) => [name, ''])) as Record<AgentProjectDocumentName, string>
}

function createTaskStepId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `step-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

function sameProjectPath(a: string, b: string): boolean {
  return normalizeComparablePath(a) === normalizeComparablePath(b)
}

function normalizeComparablePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}

function resolveActionPath(value: unknown): string {
  if (typeof value === 'string') return value
  if (!isRecord(value)) return ''
  return resolveActionPath(value.path)
}

function resolveActionText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (!isRecord(value)) return ''
  return resolveActionText(value.value ?? value.slug ?? value.path)
}

function normalizeProjectRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '').trim()
  if (!normalized || normalized.split('/').some((segment) => segment === '..')) return ''
  return normalized
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
