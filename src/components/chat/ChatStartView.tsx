/**
 * 空状态起始卡片网格（快捷提示插入 Composer）。
 * Empty-state starter grid feeding canned prompts into the composer.
 */

import { useSyncExternalStore, type ReactNode } from 'react'
import type { ClaudeAgentStatusSnapshot } from '../../claude-chat-types'
import { useI18n } from '../../i18n/i18n'
import type { HomePluginRunItem } from '../../desktop-types'
import type { AgentSettingsPanelId, FileTreeNode, ProjectSkillRunRequest, ThreadMetadata, ThreadRunState, WorkspaceProject } from '../types'
import type { WorkspaceAgentModeState } from '../useWorkspaceAgentMode'
import { ProjectHomeProjectSelector, ProjectHomeSurface } from './ProjectHomeSurface'
import { ProjectHomeRuntimeView, type ProjectHomeRuntimeController } from './ProjectHomeRuntimeView'

export type ProjectHomeRuntimeContext = ProjectHomeRuntimeController & {
  viewMode: 'overview' | 'runtime'
  onViewModeChange: (mode: 'overview' | 'runtime') => void
}
let projectHomeRuntimeContext: ProjectHomeRuntimeContext | null = null
const projectHomeRuntimeListeners = new Set<() => void>()

/** AppShell configures the project-home-only Runtime host without changing the existing overview surface. */
export function configureProjectHomeRuntime(context: ProjectHomeRuntimeContext | null) {
  projectHomeRuntimeContext = context
  projectHomeRuntimeListeners.forEach((listener) => listener())
}

function useProjectHomeRuntimeContext() {
  return useSyncExternalStore(
    (listener) => { projectHomeRuntimeListeners.add(listener); return () => projectHomeRuntimeListeners.delete(listener) },
    () => projectHomeRuntimeContext,
    () => null,
  )
}

type ChatStartViewProps = {
  project: WorkspaceProject
  projects: WorkspaceProject[]
  projectOrderIds: readonly string[]
  composer: ReactNode
  agentMode: WorkspaceAgentModeState
  agentModeEnabled: boolean
  todoEnabled: boolean
  agentModeLoading: boolean
  agentStatusSnapshot: ClaudeAgentStatusSnapshot | null
  agentSettingsOpen: boolean
  agentSettingsPanel: AgentSettingsPanelId
  onOpenAgentSettings: (panel: AgentSettingsPanelId) => void
  onAgentSettingsPanelChange: (panel: AgentSettingsPanelId) => void
  onCloseAgentSettings: () => void
  threads: ThreadMetadata[]
  threadRunStates: Record<string, ThreadRunState>
  hiddenSkillPaths: string[]
  heading?: string
  onStartDataCardDraft: () => void
  onCreateProject: (mode: 'scratch' | 'existing') => void | Promise<void>
  onSelectProject: (projectId: string) => void
  onEditHomePluginCard: (item: HomePluginRunItem) => void
  onOpenProjectFile: (node: FileTreeNode) => void
  onRunProjectSkill: (projectId: string, skill: ProjectSkillRunRequest) => void
  onStopProjectSkillRun: (projectId: string, skillPath: string) => void
  onRefreshAgentStatus: (refresh?: boolean) => void
}

/** 项目主页空状态 / Project home empty rail */
export function ChatStartView({
  project,
  projects,
  projectOrderIds,
  composer,
  agentMode,
  agentModeEnabled,
  todoEnabled,
  agentModeLoading,
  agentStatusSnapshot,
  agentSettingsOpen,
  agentSettingsPanel,
  onOpenAgentSettings,
  onAgentSettingsPanelChange,
  onCloseAgentSettings,
  threads,
  threadRunStates,
  hiddenSkillPaths,
  heading,
  onStartDataCardDraft,
  onCreateProject,
  onSelectProject,
  onEditHomePluginCard,
  onOpenProjectFile,
  onRunProjectSkill,
  onStopProjectSkillRun,
  onRefreshAgentStatus,
}: ChatStartViewProps) {
  const { t } = useI18n()
  const runtimeContext = useProjectHomeRuntimeContext()
  const projectHomeViewMode = runtimeContext?.viewMode ?? 'overview'

  return (
    <div className="chat-start-view">
      {project.pathMissing ? (
        <div className="project-path-missing-banner" role="status">
          <strong>{t('shell.projectPathMissing')}</strong>
          <p>{t('shell.projectPathMissingHint')}</p>
        </div>
      ) : null}
      <div className="chat-start-view__hero" id="chat-project-home">
        <h1>{heading ?? t('chat.emptyHeading')}</h1>
      </div>
      {composer}
      <div className="chat-start-view__below-composer">
        <div className="project-home-view-tabs" data-testid="project-home-view-tabs" role="tablist" aria-label={t('runtime.projectRuntime')}>
          <button type="button" role="tab" aria-selected={projectHomeViewMode === 'overview'} data-testid="project-home-view-tab-overview" onClick={() => runtimeContext?.onViewModeChange('overview')}>{t('runtime.overview')}</button>
          <button type="button" role="tab" aria-selected={projectHomeViewMode === 'runtime'} data-testid="project-home-view-tab-runtime" onClick={() => runtimeContext?.onViewModeChange('runtime')}>{t('runtime.runtimeTab')}</button>
        </div>
        {projectHomeViewMode === 'runtime' && runtimeContext ? (
          <div className="project-home-runtime-panel" data-testid="project-home-runtime-panel">
            <ProjectHomeRuntimeView controller={runtimeContext} />
          </div>
        ) : (
          <div className="project-home-overview-panel" data-testid="project-home-overview-panel">
            {agentModeEnabled ? (
              <ProjectHomeSurface
                project={project}
                projects={projects}
                projectOrderIds={projectOrderIds}
                agent={agentMode}
                todoEnabled={todoEnabled}
                loading={agentModeLoading}
                agentStatusSnapshot={agentStatusSnapshot}
                agentSettingsOpen={agentSettingsOpen}
                agentSettingsPanel={agentSettingsPanel}
                onOpenAgentSettings={onOpenAgentSettings}
                onAgentSettingsPanelChange={onAgentSettingsPanelChange}
                onCloseAgentSettings={onCloseAgentSettings}
                threads={threads}
                threadRunStates={threadRunStates}
                hiddenSkillPaths={hiddenSkillPaths}
                onStartDataCardDraft={onStartDataCardDraft}
                onCreateProject={onCreateProject}
                onSelectProject={onSelectProject}
                onEditHomePluginCard={onEditHomePluginCard}
                onOpenProjectFile={onOpenProjectFile}
                onRunProjectSkill={onRunProjectSkill}
                onStopProjectSkillRun={onStopProjectSkillRun}
                onRefreshAgentStatus={onRefreshAgentStatus}
              />
            ) : (
              <ProjectHomeProjectSelector
                project={project}
                projects={projects}
                projectOrderIds={projectOrderIds}
                onCreateProject={onCreateProject}
                onSelectProject={onSelectProject}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
