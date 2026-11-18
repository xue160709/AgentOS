/**
 * 设置路由分发器：模型 / 技能 / Agent Mode 子页。
 * Router component switching settings categories (models, skills, agent mode).
 */

import '../../styles/settings-page.css'
import { AgentModeSettingsPage } from './AgentModeSettingsPage'
import { AppUpdateSettingsPage } from './AppUpdateSettingsPage'
import { DeveloperSettingsPage } from './DeveloperSettingsPage'
import { ClaudeAgentSettingsPage, GlobalMcpSettingsPage, GlobalWebSearchSettingsPage } from './ClaudeAgentSettingsPage'
import { ProjectSkillsSettingsPage } from './ProjectSkillsSettingsPage'
import { WebsiteBindingsSettingsPage } from './WebsiteBindingsSettingsPage'
import { isDeveloperSettingsEnabled } from '../app-shell-constants'
import type { AgentSettingsPanelId, SettingsCategoryId, WorkspaceProject } from '../types'

type SettingsPageProps = {
  hidden: boolean
  settingsCategory: SettingsCategoryId
  activeProject: WorkspaceProject
  projects: WorkspaceProject[]
  showProjectSkillsInSidebar: boolean
  onShowProjectSkillsInSidebarChange: (enabled: boolean) => void
  onOpenAgentSettings: (panel: AgentSettingsPanelId) => void
}

/** `#settings/<category>` 容器 / Host for hash-routed settings sections */
export function SettingsPage({
  hidden,
  settingsCategory,
  activeProject,
  projects,
  showProjectSkillsInSidebar,
  onShowProjectSkillsInSidebarChange,
  onOpenAgentSettings,
}: SettingsPageProps) {
  if (hidden) {
    return null
  }

  if (settingsCategory === 'skills') {
    return (
      <ProjectSkillsSettingsPage
        enabled={showProjectSkillsInSidebar}
        onEnabledChange={onShowProjectSkillsInSidebarChange}
      />
    )
  }

  if (settingsCategory === 'agent') {
    return <AgentModeSettingsPage project={activeProject} />
  }

  if (settingsCategory === 'website-bindings') {
    return <WebsiteBindingsSettingsPage projects={projects} />
  }

  if (settingsCategory === 'mcp') {
    return <GlobalMcpSettingsPage activeProject={activeProject} onOpenAgentSettings={onOpenAgentSettings} />
  }

  if (settingsCategory === 'search') {
    return <GlobalWebSearchSettingsPage />
  }

  if (settingsCategory === 'updates') {
    return <AppUpdateSettingsPage />
  }

  if (settingsCategory === 'developer' && isDeveloperSettingsEnabled()) {
    return <DeveloperSettingsPage />
  }

  return <ClaudeAgentSettingsPage />
}
