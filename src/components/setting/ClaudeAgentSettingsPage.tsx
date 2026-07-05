/**
 * Claude Agent 多提供商模型配置 UI。
 * Multi-provider Claude Agent credentials UI backed by `claudeChat.getSettings`.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { MultimodalGroup, useInteractionObjects, type InteractionObject } from '@xue160709/omni-ui-react'
import type {
  ClaudeAgentConfigSource,
  ClaudeAgentModelProvider,
  ClaudeAgentSettings,
  ClaudeAgentSettingsSnapshot,
} from '../../claude-chat-types'
import { CLAUDE_AGENT_SETTINGS_CHANGED_EVENT } from '../../app-events'
import { IconInline } from '../../icon-inline'
import { getInitialLocale, translate, useI18n } from '../../i18n/i18n'
import {
  createModelProvider,
  LOCAL_PROVIDER_PRESET_CATALOG,
  localizeProviderPresetName,
  normalizePresetCatalog,
  type ProviderPreset,
  type ProviderPresetCatalog,
} from '../../model-provider-presets'
import type {
  AgentMcpServerProbeCache,
  AgentMcpServerProbeResult,
  AgentMcpServerProbeSnapshot,
  AgentMcpServerConfig,
  AgentMcpServerTransport,
  AgentWebSearchMode,
  AgentWebSearchProviderId,
  AgentWebSearchProviderTestResult,
  AgentWebSearchSettings,
} from '../../desktop-types'
import type { AgentSettingsPanelId, WorkspaceProject } from '../types'
import { SemanticButton, semanticAliases } from '../../multimodal/semantic-controls'

const IS_DEV_BUILD = import.meta.env.DEV
const REMOTE_PROVIDER_PRESETS_URL =
  typeof import.meta.env.VITE_MODEL_PROVIDER_PRESETS_URL === 'string'
    ? import.meta.env.VITE_MODEL_PROVIDER_PRESETS_URL.trim()
    : ''

type ProviderPresetSource = 'remote' | 'local'

type ProviderTestState = {
  busy: boolean
  message: string
  ok?: boolean
}

const MCP_TRANSPORTS: AgentMcpServerTransport[] = ['stdio', 'http', 'sse']
const WEB_SEARCH_PROVIDERS: AgentWebSearchProviderId[] = ['duckduckgo', 'brave', 'tavily']

type GlobalMcpSettingsPageProps = {
  activeProject: WorkspaceProject
  onOpenAgentSettings: (panel: AgentSettingsPanelId) => void
}

const DEFAULT_WEB_SEARCH_SETTINGS: AgentWebSearchSettings = {
  mode: 'native',
  provider: 'duckduckgo',
  braveApiKey: '',
  tavilyApiKey: '',
  braveApiKeys: [],
  tavilyApiKeys: [],
}

function normalizeWebSearchSettingsDraft(settings: AgentWebSearchSettings): AgentWebSearchSettings {
  const braveApiKeys = normalizeApiKeyPoolDraft(settings.braveApiKeys, settings.braveApiKey)
  const tavilyApiKeys = normalizeApiKeyPoolDraft(settings.tavilyApiKeys, settings.tavilyApiKey)
  return {
    mode: settings.mode === 'agentos' ? 'agentos' : 'native',
    provider: WEB_SEARCH_PROVIDERS.includes(settings.provider) ? settings.provider : 'duckduckgo',
    braveApiKey: braveApiKeys[0] ?? '',
    tavilyApiKey: tavilyApiKeys[0] ?? '',
    braveApiKeys,
    tavilyApiKeys,
  }
}

function normalizeApiKeyPoolDraft(keys: string[] | undefined, legacyKey: string): string[] {
  const source = Array.isArray(keys) ? keys : [legacyKey]
  return source.map((key) => key.trim()).filter(Boolean)
}

type TranslateFn = (path: string, vars?: Record<string, string | number>) => string
type GlobalMcpOperation = 'idle' | 'saving' | 'testing'

function formatWebSearchProviderTestStatus(result: AgentWebSearchProviderTestResult, t: TranslateFn): string {
  if (result.ok) {
    const fallbackCount = result.credentialFallbackCount ?? 0
    if (fallbackCount > 0) {
      return t('settings.search.testConnectedWithFallback', {
        provider: result.providerName,
        count: result.resultCount,
        attempts: result.credentialAttemptCount ?? fallbackCount + 1,
        fallbackCount,
      })
    }
    return t('settings.search.testConnected', {
      provider: result.providerName,
      count: result.resultCount,
    })
  }
  const recovery = t(`settings.search.recovery.${result.errorKind}`)
  return `${t('settings.search.testFailed', {
    provider: result.providerName,
    message: result.message,
  })} ${recovery}`
}

function getWebSearchCredentialHint(
  settings: AgentWebSearchSettings,
  result: AgentWebSearchProviderTestResult | null,
  t: TranslateFn,
): string {
  if (settings.mode !== 'agentos') return ''
  if (result?.providerId === settings.provider) return t(`settings.search.credential.${result.credentialStatus}`)
  if (settings.provider === 'duckduckgo') return t('settings.search.credential.notRequired')

  const keys = normalizeApiKeyPoolDraft(getWebSearchApiKeyPool(settings, settings.provider), '')
  if (keys.length === 0) return t('settings.search.credential.missing')
  if (keys.some((key) => /\$\{[A-Z_a-z][A-Z_a-z0-9]*\}/.test(key))) return t('settings.search.credential.envPending')
  return t('settings.search.credential.configured')
}

function getWebSearchApiKeyPool(settings: AgentWebSearchSettings, provider: AgentWebSearchProviderId): string[] {
  if (provider === 'brave') return settings.braveApiKeys.length > 0 ? settings.braveApiKeys : settings.braveApiKey ? [settings.braveApiKey] : []
  if (provider === 'tavily') return settings.tavilyApiKeys.length > 0 ? settings.tavilyApiKeys : settings.tavilyApiKey ? [settings.tavilyApiKey] : []
  return []
}

function withWebSearchApiKeyPool(
  settings: AgentWebSearchSettings,
  provider: AgentWebSearchProviderId,
  keys: string[],
): AgentWebSearchSettings {
  if (provider === 'brave') {
    return { ...settings, braveApiKeys: keys, braveApiKey: keys.find((key) => key.trim())?.trim() ?? '' }
  }
  if (provider === 'tavily') {
    return { ...settings, tavilyApiKeys: keys, tavilyApiKey: keys.find((key) => key.trim())?.trim() ?? '' }
  }
  return settings
}

// --- Snapshot helpers / 快照辅助 ---

function cloneSettingsSnapshot(snapshot: ClaudeAgentSettingsSnapshot): ClaudeAgentSettingsSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as ClaudeAgentSettingsSnapshot
}

function isSettingsDirty(
  configSource: ClaudeAgentConfigSource,
  activeProviderId: string,
  activeAnthropicModel: string,
  providers: ClaudeAgentModelProvider[],
  snapshot: ClaudeAgentSettingsSnapshot,
): boolean {
  const { settings } = snapshot
  if (configSource !== settings.configSource) return true
  if (activeProviderId !== settings.activeProviderId) return true
  if ((activeAnthropicModel ?? '') !== (settings.activeAnthropicModel ?? '')) return true
  return JSON.stringify(providers) !== JSON.stringify(settings.providers)
}

type EditableProviderField = Exclude<keyof ClaudeAgentModelProvider, 'id'>

// --- Settings page / 模型设置页面 ---

/** `#settings/general` Claude Agent UI / Claude credentials UI route */
export function ClaudeAgentSettingsPage() {
  const { t, locale } = useI18n()
  const [configSource, setConfigSource] = useState<ClaudeAgentConfigSource>('settings')
  const [providers, setProviders] = useState<ClaudeAgentModelProvider[]>(() => [createModelProvider()])
  /** 手风琴展开 id（编辑 UX）；非聊天激活条目 / Accordion UX id not tied to chat-active provider */
  const [expandedProviderId, setExpandedProviderId] = useState('')
  /** 持久化字段：与聊天输入框模型菜单一致，保存设置时不得被「编辑中」条目覆盖 */
  const [chatActiveProviderId, setChatActiveProviderId] = useState('')
  /** 选中的实际请求模型；空则沿用该条目的默认模型字段 */
  const [chatActiveAnthropicModel, setChatActiveAnthropicModel] = useState('')
  const [envStatusTags, setEnvStatusTags] = useState<string[]>(() => [translate(getInitialLocale(), 'settings.models.envNotLoaded')])
  const [status, setStatus] = useState('')
  const [saveDisabled, setSaveDisabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [providerPresets, setProviderPresets] = useState<ProviderPreset[]>(
    () => normalizePresetCatalog(LOCAL_PROVIDER_PRESET_CATALOG, locale).providers,
  )
  const [providerPresetVersion, setProviderPresetVersion] = useState(() => LOCAL_PROVIDER_PRESET_CATALOG.version)
  const [providerPresetSource, setProviderPresetSource] = useState<ProviderPresetSource>('local')
  const [providerTestStates, setProviderTestStates] = useState<Record<string, ProviderTestState>>({})
  const latestRef = useRef({
    providers,
    configSource,
    chatActiveProviderId,
    chatActiveAnthropicModel,
  })
  const saveSeqRef = useRef(0)
  /** 相对磁盘是否有未落盘的本地编辑（用于切回窗口时是否静默重新拉取） */
  const dirtyRef = useRef(false)
  const busyRef = useRef(false)
  /** 最近一次成功 load / save 的快照，用于「取消」恢复当前厂商条目 */
  const lastSyncedSnapshotRef = useRef<ClaudeAgentSettingsSnapshot | null>(null)
  const [lastSyncedSeq, setLastSyncedSeq] = useState(0)
  const [addProviderDialogOpen, setAddProviderDialogOpen] = useState(false)
  const [deleteConfirmDialogOpen, setDeleteConfirmDialogOpen] = useState(false)
  const [pendingDeleteProviderId, setPendingDeleteProviderId] = useState('')
  const addProviderDialogRef = useRef<HTMLDialogElement>(null)
  const deleteConfirmDialogRef = useRef<HTMLDialogElement>(null)
  const effectiveConfigSource = IS_DEV_BUILD ? configSource : 'settings'
  useEffect(() => {
    latestRef.current = { providers, configSource, chatActiveProviderId, chatActiveAnthropicModel }
  }, [providers, configSource, chatActiveProviderId, chatActiveAnthropicModel])

  useEffect(() => {
    busyRef.current = busy
  }, [busy])

  const isDirty = useMemo(() => {
    const snap = lastSyncedSnapshotRef.current
    if (!snap) return false
    return isSettingsDirty(configSource, chatActiveProviderId, chatActiveAnthropicModel, providers, snap)
  }, [chatActiveAnthropicModel, chatActiveProviderId, configSource, providers, lastSyncedSeq])

  useEffect(() => {
    const snap = lastSyncedSnapshotRef.current
    dirtyRef.current = snap ? isSettingsDirty(configSource, chatActiveProviderId, chatActiveAnthropicModel, providers, snap) : false
  }, [chatActiveAnthropicModel, chatActiveProviderId, configSource, providers, lastSyncedSeq])

  useEffect(() => {
    let cancelled = false

    const applyCatalog = (catalog: ProviderPresetCatalog, source: ProviderPresetSource) => {
      if (cancelled || !catalog.providers.length) return
      setProviderPresets(catalog.providers)
      setProviderPresetVersion(catalog.version)
      setProviderPresetSource(source)
    }

    async function loadProviderPresets() {
      if (!REMOTE_PROVIDER_PRESETS_URL) {
        applyCatalog(normalizePresetCatalog(LOCAL_PROVIDER_PRESET_CATALOG, locale), 'local')
        return
      }
      try {
        const response = await fetch(REMOTE_PROVIDER_PRESETS_URL, { cache: 'no-store' })
        if (!response.ok) throw new Error(`Preset request failed: ${response.status}`)
        applyCatalog(normalizePresetCatalog(await response.json(), locale), 'remote')
      } catch {
        applyCatalog(normalizePresetCatalog(LOCAL_PROVIDER_PRESET_CATALOG, locale), 'local')
      }
    }

    void loadProviderPresets()

    return () => {
      cancelled = true
    }
  }, [locale])

  const applySnapshot = useCallback((snapshot: ClaudeAgentSettingsSnapshot) => {
    const nextProviders = snapshot.settings.providers.length
      ? snapshot.settings.providers.map((provider) => localizeProviderPresetName(provider, providerPresets))
      : [createModelProvider()]
    const nextChatActiveId = nextProviders.some((provider) => provider.id === snapshot.settings.activeProviderId)
      ? snapshot.settings.activeProviderId
      : nextProviders[0].id

    setConfigSource(IS_DEV_BUILD ? snapshot.settings.configSource : 'settings')
    setProviders(nextProviders)
    setChatActiveProviderId(nextChatActiveId)
    setChatActiveAnthropicModel(snapshot.settings.activeAnthropicModel ?? '')
    setExpandedProviderId((prev) =>
      nextProviders.some((provider) => provider.id === prev) ? prev : nextProviders[0]?.id ?? '',
    )
    setEnvStatusTags(createEnvStatusTags(snapshot, t))
  }, [providerPresets, t])

  const persist = useCallback(async () => {
    if (!window.claudeChat) {
      setStatus(t('settings.models.bridgeUnavailable'))
      return
    }
    const { providers: pList, configSource: src, chatActiveProviderId: chatId, chatActiveAnthropicModel: overlayRaw } =
      latestRef.current
    const nextProviders = pList.length ? pList : [createModelProvider()]
    const persistedChatId = nextProviders.some((provider) => provider.id === chatId)
      ? chatId
      : nextProviders[0].id
    const overlay = pruneStoredAnthropicOverlay(nextProviders, persistedChatId, overlayRaw)
    const payload: ClaudeAgentSettings = {
      configSource: IS_DEV_BUILD ? src : 'settings',
      activeProviderId: persistedChatId,
      activeAnthropicModel: overlay,
      providers: nextProviders,
    }

    const seq = ++saveSeqRef.current
    setBusy(true)
    setStatus(t('settings.models.saving'))
    try {
      const snapshot = await window.claudeChat.saveSettings(payload)
      if (seq !== saveSeqRef.current) return
      applySnapshot(snapshot)
      lastSyncedSnapshotRef.current = cloneSettingsSnapshot(snapshot)
      setLastSyncedSeq((n) => n + 1)
      window.dispatchEvent(new CustomEvent(CLAUDE_AGENT_SETTINGS_CHANGED_EVENT, { detail: snapshot }))
      setStatus(t('settings.models.saved'))
    } catch (error) {
      if (seq === saveSeqRef.current) {
        setStatus(error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (seq === saveSeqRef.current) {
        setBusy(false)
      }
    }
  }, [applySnapshot, t])

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent === true
      if (!window.claudeChat) {
        setStatus(t('settings.models.bridgeUnavailable'))
        setSaveDisabled(true)
        return
      }
      if (!silent) {
        setStatus(t('settings.models.loading'))
      }
      try {
        const snapshot = await window.claudeChat.getSettings()
        applySnapshot(snapshot)
        lastSyncedSnapshotRef.current = cloneSettingsSnapshot(snapshot)
        setLastSyncedSeq((n) => n + 1)
        setSaveDisabled(false)
        if (!silent) {
          setStatus(t('settings.models.loaded'))
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error))
      }
    },
    [applySnapshot, t],
  )

  const addProvider = (preset?: ProviderPreset) => {
    const provider = createModelProvider(preset)
    setProviders((current) => [...current, provider])
    setExpandedProviderId(provider.id)
    setAddProviderDialogOpen(false)
    setStatus(t('settings.models.addedProvider'))
  }

  const openAddProviderDialog = useCallback(() => {
    setAddProviderDialogOpen(true)
  }, [])

  const closeAddProviderDialog = useCallback(() => {
    setAddProviderDialogOpen(false)
  }, [])

  const openExternalLink = useCallback((event: MouseEvent<HTMLAnchorElement>, url: string) => {
    event.preventDefault()
    if (!url) return
    void window.desktop?.openExternal?.(url)
  }, [])

  const testProviderConnection = useCallback(
    async (provider: ClaudeAgentModelProvider) => {
      if (!window.claudeChat?.testProvider) {
        setStatus(t('settings.models.bridgeUnavailable'))
        return
      }
      setProviderTestStates((current) => ({
        ...current,
        [provider.id]: { busy: true, message: t('settings.models.testingConnection') },
      }))
      try {
        const result = await window.claudeChat.testProvider(provider)
        setProviderTestStates((current) => ({
          ...current,
          [provider.id]: { busy: false, message: result.message, ok: result.ok },
        }))
        setStatus(result.message)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setProviderTestStates((current) => ({
          ...current,
          [provider.id]: { busy: false, message, ok: false },
        }))
        setStatus(message)
      }
    },
    [t],
  )

  const removeProvider = useCallback(
    (providerId: string) => {
      if (providers.length <= 1) return

      const nextProviders = providers.filter((provider) => provider.id !== providerId)
      setProviders(nextProviders)
      setExpandedProviderId((prev) => (prev === providerId ? nextProviders[0]?.id ?? '' : prev))
      if (chatActiveProviderId === providerId) {
        setChatActiveProviderId(nextProviders[0]?.id ?? '')
      }
      setStatus(t('settings.models.removedProvider'))
    },
    [chatActiveProviderId, providers, t],
  )

  const confirmDeleteProvider = useCallback(() => {
    const id = pendingDeleteProviderId
    if (id) {
      removeProvider(id)
    }
    deleteConfirmDialogRef.current?.close()
  }, [pendingDeleteProviderId, removeProvider])

  const updateProvider = <K extends EditableProviderField>(
    providerId: string,
    field: K,
    value: ClaudeAgentModelProvider[K],
  ) => {
    setProviders((current) =>
      current.map((provider) => (provider.id === providerId ? { ...provider, [field]: value } : provider)),
    )
    setProviderTestStates((current) => {
      if (!current[providerId]) return current
      const next = { ...current }
      delete next[providerId]
      return next
    })
  }

  const toggleProviderExpanded = (providerId: string) => {
    setExpandedProviderId((prev) => (prev === providerId ? '' : providerId))
  }

  const cancelExpandedProviderEdits = useCallback(() => {
    const snap = lastSyncedSnapshotRef.current
    if (!snap || !expandedProviderId) return
    const eid = expandedProviderId
    const saved = snap.settings.providers.find((p) => p.id === eid)

    let nextProviders: ClaudeAgentModelProvider[]
    let nextChatActiveId = chatActiveProviderId

    if (saved) {
      nextProviders = providers.map((p) => (p.id === eid ? { ...saved } : p))
    } else if (providers.length > 1) {
      nextProviders = providers.filter((p) => p.id !== eid)
      if (chatActiveProviderId === eid) {
        nextChatActiveId = nextProviders[0]?.id ?? ''
      }
    } else {
      nextProviders =
        snap.settings.providers.length > 0
          ? snap.settings.providers.map((p) => ({ ...p }))
          : [createModelProvider()]
      nextChatActiveId = nextProviders[0]?.id ?? ''
    }

    setProviders(nextProviders)
    if (nextChatActiveId !== chatActiveProviderId) {
      setChatActiveProviderId(nextChatActiveId)
    }
    setStatus(t('settings.models.editorReverted'))
  }, [chatActiveProviderId, expandedProviderId, providers, t])

  useEffect(() => {
    const onExternal = (event: Event) => {
      const detail = (event as CustomEvent<ClaudeAgentSettingsSnapshot>).detail
      const id = detail.settings.activeProviderId
      if (detail.settings.providers.some((provider) => provider.id === id)) {
        setChatActiveProviderId(id)
        setChatActiveAnthropicModel(detail.settings.activeAnthropicModel ?? '')
      }
    }
    window.addEventListener(CLAUDE_AGENT_SETTINGS_CHANGED_EVENT, onExternal)
    return () => window.removeEventListener(CLAUDE_AGENT_SETTINGS_CHANGED_EVENT, onExternal)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      if (dirtyRef.current || busyRef.current || saveDisabled) return
      void load({ silent: true })
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [load, saveDisabled])

  useEffect(() => {
    const el = addProviderDialogRef.current
    if (!el) return
    if (addProviderDialogOpen) {
      if (!el.open) el.showModal()
    } else if (el.open) {
      el.close()
    }
  }, [addProviderDialogOpen])

  useEffect(() => {
    const el = deleteConfirmDialogRef.current
    if (!el) return
    if (deleteConfirmDialogOpen) {
      if (!el.open) el.showModal()
    } else if (el.open) {
      el.close()
    }
  }, [deleteConfirmDialogOpen])

  const pendingDeleteProvider = useMemo(
    () => (pendingDeleteProviderId ? providers.find((p) => p.id === pendingDeleteProviderId) : undefined),
    [pendingDeleteProviderId, providers],
  )

  const modelSettingsSummaryObjects = useMemo<InteractionObject[]>(() => {
    const providerNames = providers.map((provider) => providerDisplayName(provider, t))
    const activeProvider = providers.find((provider) => provider.id === chatActiveProviderId) ?? providers[0]
    const activeModel = activeProvider ? activeProviderModel(activeProvider, chatActiveAnthropicModel) : ''
    const expandedProvider = providers.find((provider) => provider.id === expandedProviderId)
    return [
      {
        id: 'agentos.settings.models.summary',
        type: 'composite',
        role: 'settings_summary',
        label: t('omni.controls.settingsModelSummary'),
        aliases: semanticAliases(t, 'omni.aliases.settingsModelSummary'),
        entity: { type: 'settings-summary', id: 'models' },
        state: {
          category: 'models',
          configSource: effectiveConfigSource,
          providerCount: providers.length,
          providerNames,
          configuredProviderCount: providers.filter(providerHasConfiguredCredential).length,
          activeProviderId: activeProvider?.id ?? '',
          activeProviderName: activeProvider ? providerDisplayName(activeProvider, t) : '',
          activeModel,
          expandedProviderId,
          expandedProviderName: expandedProvider ? providerDisplayName(expandedProvider, t) : '',
          dirty: isDirty,
          busy,
        },
      },
    ]
  }, [busy, chatActiveAnthropicModel, chatActiveProviderId, effectiveConfigSource, expandedProviderId, isDirty, providers, t])
  useInteractionObjects(modelSettingsSummaryObjects)

  const openDeleteConfirmDialog = useCallback((providerId: string) => {
    setPendingDeleteProviderId(providerId)
    setDeleteConfirmDialogOpen(true)
  }, [])

  const closeDeleteConfirmDialog = useCallback(() => {
    setDeleteConfirmDialogOpen(false)
    setPendingDeleteProviderId('')
  }, [])

  return (
    <section className="app-main-inner settings-page settings-page--models" id="panel-settings" aria-hidden={false}>
      <header className="settings-page-header">
        <h1 className="app-main-heading">{t('settings.models.pageTitle')}</h1>
        <p className="settings-lede">{t('settings.models.pageLede')}</p>
      </header>

      <form
        className="settings-stack"
        id="claude-settings-form"
        onSubmit={(event) => {
          event.preventDefault()
        }}
      >
        {IS_DEV_BUILD ? (
          <section className="settings-section" aria-labelledby="settings-section-source-heading">
            <h2 id="settings-section-source-heading" className="settings-section-heading">
              {t('settings.models.configSource')}
            </h2>
            <div className="settings-group">
              <div className="settings-select-row">
                <div className="settings-field-row__meta">
                  <p className="settings-select-row__lede">
                    {configSource === 'settings'
                      ? t('settings.models.settingsFirstDesc')
                      : t('settings.models.envOnlyDesc')}
                  </p>
                </div>
                <div className="settings-select-wrap">
                  <select
                    id="claude-config-source"
                    className="settings-input settings-select"
                    value={configSource}
                    aria-labelledby="settings-section-source-heading"
                    aria-label={t('settings.models.configSourceRadiogroup')}
                    data-mm-label={t('settings.models.configSource')}
                    data-mm-exposure="value"
                    onChange={(event) => {
                      setConfigSource(event.target.value as ClaudeAgentConfigSource)
                    }}
                  >
                    <option value="settings">{t('settings.models.settingsFirst')}</option>
                    <option value="env">{t('settings.models.envOnly')}</option>
                  </select>
                  <span className="settings-select-wrap__chevron" aria-hidden>
                    <IconInline name="chevron" />
                  </span>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {effectiveConfigSource === 'settings' ? (
          <section className="settings-section" aria-labelledby="settings-section-providers-heading">
            <div className="settings-section-header">
              <h2 id="settings-section-providers-heading" className="settings-section-heading">
                {t('settings.models.providersHeading')}
              </h2>
              <SemanticButton
                type="button"
                className="btn btn-ghost btn-compact"
                semantic={{
                  id: 'agentos.control.settings.models.addProvider',
                  role: 'button',
                  label: t('omni.controls.settingsAddProvider'),
                  hint: { aliases: semanticAliases(t, 'omni.aliases.settingsAddProvider') },
                  state: { providerCount: providers.length, enabled: !busy },
                }}
                onClick={openAddProviderDialog}
              >
                <IconInline name="plus" />
                <span>{t('settings.models.add')}</span>
              </SemanticButton>
            </div>
            <p className="settings-section-caption">{t('settings.models.providersCaption')}</p>
            <div
              className="settings-provider-list"
              role="list"
              aria-label={t('settings.models.providerListAria')}
              data-testid="settings-model-provider-list"
            >
              {providers.map((provider) => {
                const isExpanded = provider.id === expandedProviderId
                const bodyId = `provider-body-${provider.id}`
                const triggerId = `provider-trigger-${provider.id}`
                const pid = provider.id
                const testState = providerTestStates[pid]
                const modelRows = [
                  {
                    field: 'model' as const,
                    supportField: 'modelSupportsImages' as const,
                    inputId: `claude-primary-model-${pid}`,
                    toggleId: `claude-primary-images-${pid}`,
                    label: t('settings.models.fieldPrimary'),
                    hint: t('settings.models.fieldPrimaryHint'),
                    placeholder: 'glm-5.1',
                    value: provider.model,
                    supportsImages: provider.modelSupportsImages,
                  },
                  {
                    field: 'defaultHaikuModel' as const,
                    supportField: 'defaultHaikuSupportsImages' as const,
                    inputId: `claude-haiku-model-${pid}`,
                    toggleId: `claude-haiku-images-${pid}`,
                    label: t('settings.models.fieldHaiku'),
                    hint: t('settings.models.fieldHaikuHint'),
                    placeholder: 'glm-4.7',
                    value: provider.defaultHaikuModel,
                    supportsImages: provider.defaultHaikuSupportsImages,
                  },
                  {
                    field: 'defaultSonnetModel' as const,
                    supportField: 'defaultSonnetSupportsImages' as const,
                    inputId: `claude-sonnet-model-${pid}`,
                    toggleId: `claude-sonnet-images-${pid}`,
                    label: t('settings.models.fieldSonnet'),
                    hint: t('settings.models.fieldSonnetHint'),
                    placeholder: 'glm-5',
                    value: provider.defaultSonnetModel,
                    supportsImages: provider.defaultSonnetSupportsImages,
                  },
                  {
                    field: 'defaultOpusModel' as const,
                    supportField: 'defaultOpusSupportsImages' as const,
                    inputId: `claude-opus-model-${pid}`,
                    toggleId: `claude-opus-images-${pid}`,
                    label: t('settings.models.fieldOpus'),
                    hint: t('settings.models.fieldOpusHint'),
                    placeholder: 'glm-5.1',
                    value: provider.defaultOpusModel,
                    supportsImages: provider.defaultOpusSupportsImages,
                  },
                ]
                return (
                  <MultimodalGroup
                    key={provider.id}
                    id={`agentos.settings.modelProvider.${provider.id}`}
                    role="list_item"
                    label={providerDisplayName(provider, t)}
                    aliases={[
                      provider.name,
                      provider.model,
                      provider.baseUrl,
                      provider.presetId,
                      ...semanticAliases(t, 'omni.aliases.settingsModelProvider', { name: providerDisplayName(provider, t) }),
                    ].filter((alias): alias is string => Boolean(alias))}
                    entity={{ type: 'model-provider', id: provider.id }}
                    state={{
                      providerId: provider.id,
                      presetId: provider.presetId,
                      expanded: isExpanded,
                      active: chatActiveProviderId === provider.id,
                      apiKeyConfigured: providerHasConfiguredCredential(provider),
                      baseUrl: provider.baseUrl,
                      model: provider.model,
                      defaultHaikuModel: provider.defaultHaikuModel,
                      defaultSonnetModel: provider.defaultSonnetModel,
                      defaultOpusModel: provider.defaultOpusModel,
                      supportsImages: providerSupportsAnyImages(provider),
                    }}
                    className={['settings-provider-accordion', isExpanded ? 'is-expanded' : ''].filter(Boolean).join(' ')}
                  >
                    <div className="settings-provider-row">
                      <SemanticButton
                        type="button"
                        className="settings-provider-select"
                        id={triggerId}
                        semantic={{
                          id: `agentos.control.settings.models.provider.${provider.id}.expand`,
                          role: 'button',
                          label: t('omni.controls.settingsModelProvider', { name: providerDisplayName(provider, t) }),
                          hint: { aliases: semanticAliases(t, 'omni.aliases.settingsModelProvider', { name: providerDisplayName(provider, t) }) },
                          state: { expanded: isExpanded, active: chatActiveProviderId === provider.id, providerId: provider.id },
                        }}
                        aria-expanded={isExpanded}
                        aria-controls={bodyId}
                        onClick={() => toggleProviderExpanded(provider.id)}
                      >
                        <span className="settings-provider-chevron" aria-hidden="true">
                          <IconInline name="chevron" />
                        </span>
                        <span className="settings-provider-copy">
                          <span className="settings-provider-model">{providerDisplayName(provider, t)}</span>
                          <span className="settings-provider-meta">{providerMeta(provider, t)}</span>
                        </span>
                      </SemanticButton>
                    </div>
                    {isExpanded ? (
                      <div
                        className="settings-provider-body"
                        id={bodyId}
                        role="region"
                        aria-labelledby={triggerId}
                      >
                        <h3 className="settings-provider-body__title">{t('settings.models.detailHeading')}</h3>
                        <p className="settings-section-caption settings-provider-body__caption">
                          {t('settings.models.detailCaption')}
                        </p>
                        <div className="settings-group settings-group--provider-fields">
                          <div className="settings-field-row">
                            <div className="settings-field-row__meta">
                              <label htmlFor={`claude-provider-name-${pid}`} className="settings-field-row__label">
                                <IconInline name="settings" />
                                {t('settings.models.fieldName')}
                              </label>
                              <p className="settings-field-row__hint">{t('settings.models.fieldNameHint')}</p>
                            </div>
                            <input
                              id={`claude-provider-name-${pid}`}
                              type="text"
                              className="settings-input"
                              data-mm-label={t('omni.controls.settingsProviderNameField', { name: providerDisplayName(provider, t) })}
                              data-mm-aliases={semanticAliases(t, 'omni.aliases.settingsProviderNameField').join('|')}
                              data-mm-exposure="value"
                              autoComplete="off"
                              spellCheck={false}
                              placeholder={t('settings.models.fieldNamePlaceholder')}
                              value={provider.name}
                              onChange={(event) => updateProvider(pid, 'name', event.target.value)}
                            />
                          </div>
                          <div className="settings-field-row">
                            <div className="settings-field-row__meta">
                              <label htmlFor={`claude-api-key-${pid}`} className="settings-field-row__label">
                                <IconInline name="key" />
                                {t('settings.models.fieldApiKey')}
                              </label>
                              {/* <p className="settings-field-row__hint">{t('settings.models.fieldApiKeyHint')}</p> */}
                              {provider.apiKeyUrl ? (
                                <a
                                  className="settings-api-key-link"
                                  href={provider.apiKeyUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  data-mm-label={t('settings.models.getApiKey')}
                                  data-mm-aliases={provider.name}
                                  onClick={(event) => openExternalLink(event, provider.apiKeyUrl)}
                                >
                                  {t('settings.models.getApiKey')}
                                </a>
                              ) : null}
                            </div>
                            <input
                              id={`claude-api-key-${pid}`}
                              type="password"
                              className="settings-input"
                              data-mm-label={t('omni.controls.settingsProviderApiKeyField', { name: providerDisplayName(provider, t) })}
                              data-mm-aliases={semanticAliases(t, 'omni.aliases.settingsProviderApiKeyField').join('|')}
                              data-mm-sensitive="true"
                              autoComplete="off"
                              spellCheck={false}
                              placeholder="sk-ant-..."
                              value={provider.apiKey}
                              onChange={(event) => updateProvider(pid, 'apiKey', event.target.value)}
                            />
                          </div>
                          <div className="settings-field-row">
                            <div className="settings-field-row__meta">
                              <label htmlFor={`claude-base-url-${pid}`} className="settings-field-row__label">
                                <IconInline name="server" />
                                {t('settings.models.fieldBaseUrl')}
                              </label>
                              <p className="settings-field-row__hint">{t('settings.models.fieldBaseUrlHint')}</p>
                            </div>
                            <input
                              id={`claude-base-url-${pid}`}
                              type="url"
                              className="settings-input"
                              data-mm-label={t('omni.controls.settingsProviderBaseUrlField', { name: providerDisplayName(provider, t) })}
                              data-mm-aliases={semanticAliases(t, 'omni.aliases.settingsProviderBaseUrlField').join('|')}
                              data-mm-exposure="value"
                              autoComplete="off"
                              spellCheck={false}
                              placeholder="https://open.bigmodel.cn/api/anthropic"
                              value={provider.baseUrl}
                              onChange={(event) => updateProvider(pid, 'baseUrl', event.target.value)}
                            />
                          </div>
                          <div className="settings-model-map" aria-label={t('settings.models.modelMappingsAria')}>
                            {modelRows.map((row) => (
                              <MultimodalGroup
                                className="settings-field-row settings-model-row"
                                key={row.field}
                                id={`agentos.settings.modelProvider.${provider.id}.${row.field}`}
                                role="form_field"
                                label={t('omni.controls.settingsProviderModelField', {
                                  name: providerDisplayName(provider, t),
                                  slot: row.label,
                                })}
                                aliases={[
                                  row.label,
                                  row.value,
                                  ...semanticAliases(t, 'omni.aliases.settingsProviderModelField', { slot: row.label }),
                                ].filter((alias): alias is string => Boolean(alias))}
                                entity={{ type: 'model-provider-field', id: `${provider.id}:${row.field}` }}
                                state={{
                                  providerId: provider.id,
                                  field: row.field,
                                  model: row.value,
                                  supportsImages: row.supportsImages,
                                }}
                              >
                                <div className="settings-field-row__meta">
                                  <label htmlFor={row.inputId} className="settings-field-row__label">
                                    <IconInline name="chip" />
                                    {row.label}
                                  </label>
                                  <p className="settings-field-row__hint">{row.hint}</p>
                                </div>
                                <input
                                  id={row.inputId}
                                  type="text"
                                  className="settings-input"
                                  data-mm-label={t('omni.controls.settingsProviderModelField', {
                                    name: providerDisplayName(provider, t),
                                    slot: row.label,
                                  })}
                                  data-mm-aliases={semanticAliases(t, 'omni.aliases.settingsProviderModelField', { slot: row.label }).join('|')}
                                  data-mm-exposure="value"
                                  autoComplete="off"
                                  spellCheck={false}
                                  placeholder={row.placeholder}
                                  value={row.value}
                                  onChange={(event) => updateProvider(pid, row.field, event.target.value)}
                                />
                                <label
                                  className="settings-model-image-toggle"
                                  title={t('settings.models.modelImageToggleTitle', { slot: row.label })}
                                >
                                  <span className="settings-model-image-toggle__glyph" aria-hidden="true">
                                    <IconInline name="image" />
                                  </span>
                                  <span className="settings-switch-control">
                                    <input
                                      id={row.toggleId}
                                      type="checkbox"
                                      className="settings-switch-input"
                                      data-mm-label={t('omni.controls.settingsProviderImageToggle', {
                                        name: providerDisplayName(provider, t),
                                        slot: row.label,
                                      })}
                                      data-mm-aliases={semanticAliases(t, 'omni.aliases.settingsProviderImageToggle', { slot: row.label }).join('|')}
                                      checked={row.supportsImages}
                                      aria-label={t('settings.models.modelImageToggleAria', { slot: row.label })}
                                      onChange={(event) => updateProvider(pid, row.supportField, event.target.checked)}
                                    />
                                    <span className="settings-switch-track" aria-hidden="true">
                                      <span className="settings-switch-thumb" />
                                    </span>
                                  </span>
                                </label>
                              </MultimodalGroup>
                            ))}
                          </div>
                        </div>
                        <div className="settings-provider-body__actions" aria-label={t('settings.models.editorActionsAria')}>
                          <p className="settings-provider-body__actions-hint">{t('settings.models.editorActionsHint')}</p>
                          {testState?.message ? (
                            <p
                              className={[
                                'settings-provider-test-status',
                                testState.ok === true ? 'is-success' : '',
                                testState.ok === false ? 'is-error' : '',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                            >
                              {testState.message}
                            </p>
                          ) : null}
                          <div className="settings-provider-body__actions-row">
                            <SemanticButton
                              type="button"
                              className="btn btn-ghost btn-compact"
                              semantic={{
                                id: `agentos.control.settings.models.provider.${provider.id}.test`,
                                role: 'button',
                                label: t('omni.controls.settingsProviderTest', { name: providerDisplayName(provider, t) }),
                                hint: { aliases: semanticAliases(t, 'omni.aliases.settingsProviderTest') },
                                state: { providerId: provider.id, busy: Boolean(testState?.busy), enabled: !(busy || Boolean(testState?.busy)) },
                              }}
                              disabled={busy || Boolean(testState?.busy)}
                              onClick={() => void testProviderConnection(provider)}
                            >
                              <IconInline name={testState?.ok ? 'check' : 'refresh'} />
                              <span>
                                {testState?.busy
                                  ? t('settings.models.testingConnection')
                                  : t('settings.models.testConnection')}
                              </span>
                            </SemanticButton>
                            <SemanticButton
                              type="button"
                              className="btn btn-primary btn-compact"
                              semantic={{
                                id: `agentos.control.settings.models.provider.${provider.id}.confirm`,
                                role: 'button',
                                label: t('omni.controls.settingsProviderConfirm', { name: providerDisplayName(provider, t) }),
                                hint: { aliases: semanticAliases(t, 'omni.aliases.settingsProviderConfirm') },
                                state: { providerId: provider.id, dirty: isDirty, enabled: !(!isDirty || busy || saveDisabled) },
                              }}
                              disabled={!isDirty || busy || saveDisabled}
                              onClick={() => void persist()}
                            >
                              {t('settings.models.editorConfirm')}
                            </SemanticButton>
                            <SemanticButton
                              type="button"
                              className="btn btn-ghost btn-compact"
                              semantic={{
                                id: `agentos.control.settings.models.provider.${provider.id}.cancel`,
                                role: 'button',
                                label: t('omni.controls.settingsProviderCancel', { name: providerDisplayName(provider, t) }),
                                hint: { aliases: semanticAliases(t, 'omni.aliases.settingsProviderCancel') },
                                state: { providerId: provider.id, dirty: isDirty, enabled: !(!isDirty || busy) },
                              }}
                              disabled={!isDirty || busy}
                              onClick={cancelExpandedProviderEdits}
                            >
                              {t('settings.models.editorCancel')}
                            </SemanticButton>
                            <SemanticButton
                              type="button"
                              className="settings-provider-delete-link"
                              semantic={{
                                id: `agentos.control.settings.models.provider.${provider.id}.delete`,
                                role: 'button',
                                label: t('omni.controls.settingsProviderDelete', { name: providerDisplayName(provider, t) }),
                                hint: { aliases: semanticAliases(t, 'omni.aliases.settingsProviderDelete') },
                                state: { providerId: provider.id, enabled: !(providers.length <= 1 || busy) },
                              }}
                              disabled={providers.length <= 1 || busy}
                              title={providers.length <= 1 ? t('settings.models.deleteKeepOne') : undefined}
                              onClick={() => openDeleteConfirmDialog(pid)}
                            >
                              {t('settings.models.deleteProviderEntry')}
                            </SemanticButton>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </MultimodalGroup>
                )
              })}
            </div>
          </section>
        ) : null}

        {effectiveConfigSource === 'env' ? (
          <section className="settings-section" aria-labelledby="settings-section-env-heading">
            <h2 id="settings-section-env-heading" className="settings-section-heading">
              {t('settings.models.envHeading')}
            </h2>
            <p id="settings-section-env-desc" className="settings-section-caption">
              {t('settings.models.envCaption')}
            </p>
            <ul className="settings-env-tags" aria-describedby="settings-section-env-desc">
              {envStatusTags.map((tag) => (
                <li key={tag}>{tag}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="settings-footer">
          <div className="settings-actions">
            <SemanticButton
              type="button"
              className="btn btn-primary btn-compact"
              semantic={{
                id: 'agentos.control.settings.models.save',
                role: 'button',
                label: t('omni.controls.settingsSaveModels'),
                hint: { aliases: semanticAliases(t, 'omni.aliases.settingsSaveModels') },
                state: { dirty: isDirty, busy, enabled: !(!isDirty || busy || saveDisabled) },
              }}
              disabled={!isDirty || busy || saveDisabled}
              onClick={() => void persist()}
              aria-controls="claude-settings-form"
            >
              {t('settings.models.saveChanges')}
            </SemanticButton>
            <span className="settings-status" id="claude-settings-status" role="status" aria-live="polite">
              {status}
            </span>
          </div>
        </div>
      </form>
      {effectiveConfigSource === 'settings' ? (
        <dialog
          ref={addProviderDialogRef}
          className="settings-restart-dialog settings-provider-preset-dialog"
          aria-labelledby="claude-provider-preset-dialog-title"
          onClose={closeAddProviderDialog}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              addProviderDialogRef.current?.close()
            }
          }}
        >
          <div className="settings-restart-dialog__panel" onClick={(event) => event.stopPropagation()}>
            <h3 id="claude-provider-preset-dialog-title" className="settings-restart-dialog__title">
              {t('settings.models.addProviderDialogTitle')}
            </h3>
            <p className="settings-restart-dialog__body">{t('settings.models.addProviderDialogBody')}</p>
            <p className="settings-provider-preset-source">
              {t(
                providerPresetSource === 'remote'
                  ? 'settings.models.presetSourceRemote'
                  : 'settings.models.presetSourceLocal',
                { version: providerPresetVersion },
              )}
            </p>
            <div className="settings-provider-preset-grid">
              {providerPresets.map((preset) => (
                <SemanticButton
                  key={preset.id}
                  type="button"
                  className="settings-provider-preset-card"
                  semantic={{
                    id: `agentos.control.settings.models.addPreset.${preset.id}`,
                    role: 'button',
                    label: t('omni.controls.settingsProviderPreset', { name: preset.name }),
                    hint: { aliases: [preset.name, preset.baseUrl, ...semanticAliases(t, 'omni.aliases.settingsProviderPreset')] },
                    state: { presetId: preset.id, baseUrl: preset.baseUrl, model: preset.model },
                  }}
                  onClick={() => addProvider(preset)}
                >
                  <span className="settings-provider-preset-card__title">{preset.name}</span>
                  <span className="settings-provider-preset-card__meta">{preset.baseUrl}</span>
                </SemanticButton>
              ))}
              <SemanticButton
                type="button"
                className="settings-provider-preset-card"
                semantic={{
                  id: 'agentos.control.settings.models.addCustomProvider',
                  role: 'button',
                  label: t('omni.controls.settingsCustomProvider'),
                  hint: { aliases: semanticAliases(t, 'omni.aliases.settingsCustomProvider') },
                }}
                onClick={() => addProvider()}
              >
                <span className="settings-provider-preset-card__title">{t('settings.models.customProvider')}</span>
                <span className="settings-provider-preset-card__meta">{t('settings.models.customProviderMeta')}</span>
              </SemanticButton>
            </div>
            <div className="settings-restart-dialog__actions">
              <button type="button" className="btn btn-ghost" data-mm-label={t('settings.models.deleteDialogDismiss')} onClick={() => addProviderDialogRef.current?.close()}>
                {t('settings.models.deleteDialogDismiss')}
              </button>
            </div>
          </div>
        </dialog>
      ) : null}
      {effectiveConfigSource === 'settings' ? (
        <dialog
          ref={deleteConfirmDialogRef}
          className="settings-restart-dialog"
          aria-labelledby="claude-provider-delete-dialog-title"
          onClose={closeDeleteConfirmDialog}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              deleteConfirmDialogRef.current?.close()
            }
          }}
        >
          <div className="settings-restart-dialog__panel" onClick={(event) => event.stopPropagation()}>
            <h3 id="claude-provider-delete-dialog-title" className="settings-restart-dialog__title">
              {t('settings.models.deleteDialogTitle')}
            </h3>
            <p className="settings-restart-dialog__body">
              {pendingDeleteProvider
                ? t('settings.models.deleteDialogBody', { name: providerDisplayName(pendingDeleteProvider, t) })
                : t('settings.models.deleteDialogBodyFallback')}
            </p>
            <div className="settings-restart-dialog__actions">
              <button type="button" className="btn btn-ghost" data-mm-label={t('settings.models.deleteDialogDismiss')} onClick={() => deleteConfirmDialogRef.current?.close()}>
                {t('settings.models.deleteDialogDismiss')}
              </button>
              <button type="button" className="btn btn-primary" data-mm-label={t('settings.models.deleteDialogConfirm')} onClick={confirmDeleteProvider}>
                {t('settings.models.deleteDialogConfirm')}
              </button>
            </div>
          </div>
        </dialog>
      ) : null}
    </section>
  )
}

/** `#settings/mcp` global MCP server management route */
export function GlobalMcpSettingsPage({
  activeProject,
}: GlobalMcpSettingsPageProps) {
  const { t } = useI18n()
  const [globalMcpServers, setGlobalMcpServers] = useState<AgentMcpServerConfig[]>([])
  const [draftGlobalMcpServers, setDraftGlobalMcpServers] = useState<AgentMcpServerConfig[]>([])
  const [globalMcpProbeCache, setGlobalMcpProbeCache] = useState<AgentMcpServerProbeCache>({})
  const [editingGlobalMcpServer, setEditingGlobalMcpServer] = useState<{
    index: number | null
    server: AgentMcpServerConfig
  } | null>(null)
  const [globalMcpStatus, setGlobalMcpStatus] = useState('')
  const [globalMcpOperation, setGlobalMcpOperation] = useState<GlobalMcpOperation>('idle')
  const autoTestedGlobalMcpSignatureRef = useRef('')
  const globalMcpDirty = JSON.stringify(globalMcpServers) !== JSON.stringify(draftGlobalMcpServers)
  const globalMcpBusy = globalMcpOperation !== 'idle'

  const loadGlobalMcpSettings = useCallback(async () => {
    const getGlobalMcpSettings = window.desktop?.getGlobalMcpSettings
    if (!getGlobalMcpSettings) {
      setGlobalMcpStatus(t('settings.mcp.bridgeUnavailable'))
      return
    }
    try {
      const result = await getGlobalMcpSettings()
      if (!result.ok) {
        setGlobalMcpStatus(result.message)
        return
      }
      const servers = result.settings.mcpServers ?? []
      setGlobalMcpServers(servers)
      setDraftGlobalMcpServers(servers)
      setGlobalMcpProbeCache(result.settings.mcpServerProbeCache ?? {})
      setGlobalMcpStatus(t('settings.mcp.loaded'))
    } catch (error) {
      setGlobalMcpStatus(error instanceof Error ? error.message : String(error))
    }
  }, [t])

  const persistGlobalMcpSettings = useCallback(async (servers: AgentMcpServerConfig[]) => {
    const saveGlobalMcpSettings = window.desktop?.saveGlobalMcpSettings
    if (!saveGlobalMcpSettings) {
      setGlobalMcpStatus(t('settings.mcp.bridgeUnavailable'))
      return undefined
    }
    const nextServers = normalizeGlobalMcpServers(servers)
    const validationError = validateGlobalMcpServers(nextServers, t)
    if (validationError) {
      setGlobalMcpStatus(validationError)
      return undefined
    }
    setGlobalMcpOperation('saving')
    setGlobalMcpStatus(t('settings.mcp.saving'))
    try {
      const result = await saveGlobalMcpSettings({ mcpServers: nextServers })
      if (!result.ok) {
        setGlobalMcpStatus(result.message)
        return undefined
      }
      const savedServers = result.settings.mcpServers ?? []
      setGlobalMcpServers(savedServers)
      setDraftGlobalMcpServers(savedServers)
      setGlobalMcpProbeCache(result.settings.mcpServerProbeCache ?? {})
      setGlobalMcpStatus(t('settings.mcp.saved'))
      return savedServers
    } catch (error) {
      setGlobalMcpStatus(error instanceof Error ? error.message : String(error))
      return undefined
    } finally {
      setGlobalMcpOperation('idle')
    }
  }, [t])

  const saveGlobalMcpSettings = useCallback(async () => {
    await persistGlobalMcpSettings(draftGlobalMcpServers)
  }, [draftGlobalMcpServers, persistGlobalMcpSettings])

  const testGlobalMcpServer = useCallback(async (server: AgentMcpServerConfig): Promise<AgentMcpServerProbeResult | undefined> => {
    const testServer = window.desktop?.testGlobalMcpServer
    if (!testServer) {
      setGlobalMcpStatus(t('settings.mcp.bridgeUnavailable'))
      return undefined
    }
    setGlobalMcpOperation('testing')
    setGlobalMcpStatus(t('settings.mcp.testing', { name: server.name }))
    try {
      const result = await testServer(server)
      const snapshot = result.snapshot
      if (snapshot) {
        setGlobalMcpProbeCache((current) => ({
          ...current,
          [snapshot.serverName]: snapshot,
        }))
      }
      if (result.ok && snapshot) {
        setGlobalMcpStatus(t('settings.mcp.testConnected', { name: server.name, count: snapshot.tools.length }))
      } else {
        setGlobalMcpStatus(result.ok ? t('settings.mcp.saved') : result.message)
      }
      return result
    } catch (error) {
      setGlobalMcpStatus(error instanceof Error ? error.message : String(error))
      return undefined
    } finally {
      setGlobalMcpOperation('idle')
    }
  }, [t])

  const testEnabledGlobalMcpServers = useCallback(async (servers: AgentMcpServerConfig[]) => {
    const enabledServers = servers.filter((server) => server.enabled)
    if (enabledServers.length === 0) return
    const testServer = window.desktop?.testGlobalMcpServer
    if (!testServer) {
      setGlobalMcpStatus(t('settings.mcp.bridgeUnavailable'))
      return
    }
    setGlobalMcpOperation('testing')
    setGlobalMcpStatus(t('settings.mcp.testingEnabled', { count: enabledServers.length }))
    let tested = 0
    let connected = 0
    try {
      for (const server of enabledServers) {
        setGlobalMcpStatus(t('settings.mcp.testing', { name: server.name }))
        const result = await testServer(server)
        const snapshot = result.snapshot
        if (snapshot) {
          setGlobalMcpProbeCache((current) => ({
            ...current,
            [snapshot.serverName]: snapshot,
          }))
        }
        tested += 1
        if (result.ok && snapshot?.status === 'connected') connected += 1
      }
      setGlobalMcpStatus(t('settings.mcp.testEnabledDone', { tested, connected }))
    } catch (error) {
      setGlobalMcpStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setGlobalMcpOperation('idle')
    }
  }, [t])

  const saveAndTestGlobalMcpEditor = useCallback(async (server: AgentMcpServerConfig, shouldTest: boolean) => {
    const nextServers =
      editingGlobalMcpServer?.index === null
        ? [...draftGlobalMcpServers, server]
        : draftGlobalMcpServers.map((item, index) => (index === editingGlobalMcpServer?.index ? server : item))
    const savedServers = await persistGlobalMcpSettings(nextServers)
    if (!savedServers) return
    const savedIndex = editingGlobalMcpServer?.index === null ? savedServers.length - 1 : editingGlobalMcpServer?.index ?? 0
    const savedServer = savedServers[savedIndex]
    if (!savedServer) {
      setEditingGlobalMcpServer(null)
      return
    }
    if (!shouldTest) {
      setEditingGlobalMcpServer(null)
      return
    }
    const result = await testGlobalMcpServer(savedServer)
    if (result?.ok) {
      setEditingGlobalMcpServer(null)
      return
    }
    setEditingGlobalMcpServer({ index: savedIndex, server: savedServer })
  }, [draftGlobalMcpServers, editingGlobalMcpServer?.index, persistGlobalMcpSettings, testGlobalMcpServer])

  const updateGlobalMcpServer = useCallback((index: number, patch: Partial<AgentMcpServerConfig>) => {
    setDraftGlobalMcpServers((current) =>
      current.map((server, serverIndex) => (serverIndex === index ? { ...server, ...patch } : server)),
    )
  }, [])

  const openGlobalMcpEditor = useCallback((index: number | null) => {
    setEditingGlobalMcpServer({
      index,
      server: index === null ? createDraftGlobalMcpServer(draftGlobalMcpServers) : draftGlobalMcpServers[index],
    })
  }, [draftGlobalMcpServers])

  const updateGlobalMcpEditor = useCallback((patch: Partial<AgentMcpServerConfig>) => {
    setEditingGlobalMcpServer((current) => (current ? { ...current, server: { ...current.server, ...patch } } : current))
  }, [])

  const removeGlobalMcpServer = useCallback((index: number) => {
    setDraftGlobalMcpServers((current) => current.filter((_, serverIndex) => serverIndex !== index))
    setEditingGlobalMcpServer((current) => (current?.index === index ? null : current))
  }, [])

  const confirmRemoveGlobalMcpServer = useCallback((index: number) => {
    const name = draftGlobalMcpServers[index]?.name.trim() || t('workspace.agentSettingsMcpUnnamed')
    if (!window.confirm(t('settings.mcp.deleteConfirm', { name }))) return
    removeGlobalMcpServer(index)
  }, [draftGlobalMcpServers, removeGlobalMcpServer, t])

  const duplicateGlobalMcpServer = useCallback((index: number) => {
    setDraftGlobalMcpServers((current) => {
      const source = current[index]
      if (!source) return current
      return [...current, cloneGlobalMcpServer(source, current)]
    })
    setEditingGlobalMcpServer(null)
    setGlobalMcpStatus(t('settings.mcp.duplicated'))
  }, [t])

  const resetGlobalMcpServers = useCallback(() => {
    setDraftGlobalMcpServers(globalMcpServers)
    setEditingGlobalMcpServer(null)
    setGlobalMcpStatus(t('settings.mcp.reverted'))
  }, [globalMcpServers, t])

  useEffect(() => {
    void loadGlobalMcpSettings()
  }, [loadGlobalMcpSettings])

  useEffect(() => {
    if (editingGlobalMcpServer || globalMcpDirty) return
    const enabledServers = globalMcpServers.filter((server) => server.enabled)
    const signature = enabledServers.map((server) => `${server.name}:${buildGlobalMcpServerConfigSignature(server)}`).join('|')
    if (!signature || autoTestedGlobalMcpSignatureRef.current === signature) return
    autoTestedGlobalMcpSignatureRef.current = signature
    void testEnabledGlobalMcpServers(enabledServers)
  }, [editingGlobalMcpServer, globalMcpDirty, globalMcpServers, testEnabledGlobalMcpServers])

  return (
    <section
      className="app-main-inner settings-page settings-page--mcp"
      id="panel-settings-mcp"
      data-testid="global-mcp-settings-page"
      aria-hidden={false}
    >
      <header className="settings-page-header">
        <h1 className="app-main-heading">{t('settings.mcp.pageTitle')}</h1>
        <p className="settings-lede">{t('settings.mcp.pageLede')}</p>
      </header>

      <GlobalMcpSettingsSection
        activeProjectName={activeProject.name}
        projectPathMissing={Boolean(activeProject.pathMissing)}
        servers={draftGlobalMcpServers}
        probeCache={globalMcpProbeCache}
        editingServer={editingGlobalMcpServer}
        dirty={globalMcpDirty}
        busy={globalMcpBusy}
        operation={globalMcpOperation}
        status={globalMcpStatus}
        onServerChange={updateGlobalMcpServer}
        onOpenEditor={openGlobalMcpEditor}
        onEditorChange={updateGlobalMcpEditor}
        onEditorCancel={() => setEditingGlobalMcpServer(null)}
        onEditorSave={(server) => void saveAndTestGlobalMcpEditor(server, false)}
        onEditorSaveAndTest={(server) => void saveAndTestGlobalMcpEditor(server, true)}
        onDuplicateServer={duplicateGlobalMcpServer}
        onRemoveServer={confirmRemoveGlobalMcpServer}
        onReset={resetGlobalMcpServers}
        onSave={() => void saveGlobalMcpSettings()}
      />
    </section>
  )
}

/** `#settings/search` global WebSearch routing settings route */
export function GlobalWebSearchSettingsPage() {
  const { t } = useI18n()
  const [savedSettings, setSavedSettings] = useState<AgentWebSearchSettings>(DEFAULT_WEB_SEARCH_SETTINGS)
  const [draftSettings, setDraftSettings] = useState<AgentWebSearchSettings>(DEFAULT_WEB_SEARCH_SETTINGS)
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [testingProvider, setTestingProvider] = useState(false)
  const [providerTestResult, setProviderTestResult] = useState<AgentWebSearchProviderTestResult | null>(null)
  const dirty = JSON.stringify(savedSettings) !== JSON.stringify(draftSettings)
  const usingAgentOs = draftSettings.mode === 'agentos'
  const activeKeyProvider = draftSettings.provider === 'brave' || draftSettings.provider === 'tavily' ? draftSettings.provider : null
  const activeApiKeys = activeKeyProvider ? getWebSearchApiKeyPool(draftSettings, activeKeyProvider) : []
  const visibleApiKeys = activeApiKeys.length > 0 ? activeApiKeys : ['']
  const credentialHint = getWebSearchCredentialHint(draftSettings, providerTestResult, t)

  const updateDraftSettings = useCallback((updater: (current: AgentWebSearchSettings) => AgentWebSearchSettings) => {
    setProviderTestResult(null)
    setDraftSettings(updater)
  }, [])

  const updateWebSearchApiKeyPool = useCallback(
    (provider: AgentWebSearchProviderId, updater: (keys: string[]) => string[]) => {
      updateDraftSettings((current) => withWebSearchApiKeyPool(current, provider, updater(getWebSearchApiKeyPool(current, provider))))
    },
    [updateDraftSettings],
  )

  const loadWebSearchSettings = useCallback(async () => {
    const getGlobalWebSearchSettings = window.desktop?.getGlobalWebSearchSettings
    if (!getGlobalWebSearchSettings) {
      setStatus(t('settings.search.bridgeUnavailable'))
      return
    }
    try {
      const result = await getGlobalWebSearchSettings()
      if (!result.ok) {
        setStatus(result.message)
        return
      }
      setSavedSettings(result.settings)
      setDraftSettings(result.settings)
      setProviderTestResult(null)
      setStatus(t('settings.search.loaded'))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }, [t])

  const saveWebSearchSettings = useCallback(async () => {
    const saveGlobalWebSearchSettings = window.desktop?.saveGlobalWebSearchSettings
    if (!saveGlobalWebSearchSettings) {
      setStatus(t('settings.search.bridgeUnavailable'))
      return
    }
    setSaving(true)
    setStatus(t('settings.search.saving'))
    try {
      const result = await saveGlobalWebSearchSettings(normalizeWebSearchSettingsDraft(draftSettings))
      if (!result.ok) {
        setStatus(result.message)
        return
      }
      setSavedSettings(result.settings)
      setDraftSettings(result.settings)
      setStatus(t('settings.search.saved'))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }, [draftSettings, t])

  const testWebSearchProvider = useCallback(async () => {
    const testGlobalWebSearchProvider = window.desktop?.testGlobalWebSearchProvider
    if (!testGlobalWebSearchProvider) {
      setStatus(t('settings.search.testBridgeUnavailable'))
      return
    }
    if (!usingAgentOs) {
      setProviderTestResult(null)
      setStatus(t('settings.search.nativeTestUnavailable'))
      return
    }
    setTestingProvider(true)
    setStatus(t('settings.search.testing'))
    try {
      const result = await testGlobalWebSearchProvider(normalizeWebSearchSettingsDraft(draftSettings))
      setProviderTestResult(result)
      setStatus(formatWebSearchProviderTestStatus(result, t))
    } catch (error) {
      setProviderTestResult(null)
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setTestingProvider(false)
    }
  }, [draftSettings, t, usingAgentOs])

  useEffect(() => {
    void loadWebSearchSettings()
  }, [loadWebSearchSettings])

  return (
    <section
      className="app-main-inner settings-page settings-page--search"
      id="panel-settings-search"
      data-testid="global-web-search-settings-page"
      aria-hidden={false}
    >
      <header className="settings-page-header">
        <h1 className="app-main-heading">{t('settings.search.pageTitle')}</h1>
        <p className="settings-lede">{t('settings.search.pageLede')}</p>
      </header>

      <section className="settings-mcp-boundary settings-mcp-boundary--global" aria-labelledby="settings-search-mode-heading">
        <div className="settings-mcp-boundary__header">
          <div className="settings-mcp-boundary__copy">
            <span className="settings-mcp-boundary__eyebrow">{t('settings.search.boundaryEyebrow')}</span>
            <h2 id="settings-search-mode-heading">{t('settings.search.boundaryHeading')}</h2>
            <p>{t('settings.search.boundaryCaption')}</p>
          </div>
        </div>

        <div className="agent-mcp-list" role="radiogroup" aria-label={t('settings.search.modeAria')} data-testid="web-search-mode-options">
          {(['native', 'agentos'] as AgentWebSearchMode[]).map((mode) => (
            <label className="agent-mcp-checkbox" key={mode}>
              <input
                type="radio"
                name="web-search-mode"
                value={mode}
                checked={draftSettings.mode === mode}
                disabled={saving || testingProvider}
                data-mm-label={t(`settings.search.mode.${mode}.title`)}
                data-mm-aliases={t('settings.search.modeAria')}
                data-mm-exposure="value"
                onChange={() => updateDraftSettings((current) => ({ ...current, mode }))}
              />
              <span>
                <strong>{t(`settings.search.mode.${mode}.title`)}</strong>
                <small>{t(`settings.search.mode.${mode}.description`)}</small>
              </span>
            </label>
          ))}
        </div>

        <div className="agent-mcp-policy" data-testid="web-search-provider-options">
          <div className="agent-mcp-policy__head">
            <div>
              <h4>{t('settings.search.providerHeading')}</h4>
              <p>{t('settings.search.providerCaption')}</p>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-compact"
              data-testid="web-search-provider-test"
              disabled={saving || testingProvider || !usingAgentOs}
              data-mm-label={testingProvider ? t('settings.search.testingShort') : t('settings.search.test')}
              data-mm-aliases={t('settings.search.providerHeading')}
              onClick={() => void testWebSearchProvider()}
            >
              <IconInline name={providerTestResult?.ok ? 'check' : 'refresh'} />
              <span>{testingProvider ? t('settings.search.testingShort') : t('settings.search.test')}</span>
            </button>
          </div>

          <div className="agent-mcp-list" role="radiogroup" aria-label={t('settings.search.providerAria')}>
            {WEB_SEARCH_PROVIDERS.map((provider) => (
              <label className="agent-mcp-checkbox" key={provider}>
                <input
                  type="radio"
                  name="web-search-provider"
                  value={provider}
                  checked={draftSettings.provider === provider}
                  disabled={saving || testingProvider || !usingAgentOs}
                  data-mm-label={t(`settings.search.provider.${provider}.title`)}
                  data-mm-aliases={t('settings.search.providerAria')}
                  data-mm-exposure="value"
                  onChange={() => updateDraftSettings((current) => ({ ...current, provider }))}
                />
                <span>
                  <strong>{t(`settings.search.provider.${provider}.title`)}</strong>
                  <small>{t(`settings.search.provider.${provider}.description`)}</small>
                </span>
              </label>
            ))}
          </div>

          {activeKeyProvider ? (
            <div className="agent-mcp-row__grid">
              <div className="agent-mcp-field agent-mcp-field--wide" data-testid="web-search-key-pool">
                <span>{t(`settings.search.${activeKeyProvider}ApiKeyPool`)}</span>
                <div
                  className="web-search-key-pool"
                  role="list"
                  aria-label={t('settings.search.apiKeyPoolAria', { provider: t(`settings.search.provider.${activeKeyProvider}.title`) })}
                >
                  {visibleApiKeys.map((apiKey, index) => {
                    const rowId = `web-search-${activeKeyProvider}-key-${index}`
                    const moveDisabled = saving || testingProvider || !usingAgentOs
                    return (
                      <div className="web-search-key-pool__row" role="listitem" key={`${activeKeyProvider}-${index}`}>
                        <label className="sr-only" htmlFor={rowId}>
                          {t('settings.search.apiKeyPoolItemLabel', { index: index + 1 })}
                        </label>
                        <input
                          id={rowId}
                          className="settings-input web-search-key-pool__input"
                          data-testid={`web-search-key-pool-input-${index}`}
                          value={apiKey}
                          disabled={saving || testingProvider || !usingAgentOs}
                          spellCheck={false}
                          placeholder={activeKeyProvider === 'brave' ? '${BRAVE_SEARCH_API_KEY}' : '${TAVILY_API_KEY}'}
                          data-mm-label={t('settings.search.apiKeyPoolItemLabel', { index: index + 1 })}
                          data-mm-sensitive="true"
                          onChange={(event) =>
                            updateWebSearchApiKeyPool(activeKeyProvider, (keys) => {
                              const next = keys.length > 0 ? [...keys] : ['']
                              next[index] = event.target.value
                              return next
                            })
                          }
                        />
                        <div className="web-search-key-pool__actions">
                          <button
                            type="button"
                            className="btn btn-ghost btn-compact web-search-key-pool__button"
                            aria-label={t('settings.search.apiKeyMoveUp', { index: index + 1 })}
                            disabled={moveDisabled || index === 0}
                            data-mm-label={t('settings.search.apiKeyMoveUp', { index: index + 1 })}
                            onClick={() =>
                              updateWebSearchApiKeyPool(activeKeyProvider, (keys) => {
                                const next = [...keys]
                                const previous = next[index - 1]
                                next[index - 1] = next[index]
                                next[index] = previous
                                return next
                              })
                            }
                          >
                            <IconInline name="arrowUp" />
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-compact web-search-key-pool__button"
                            aria-label={t('settings.search.apiKeyMoveDown', { index: index + 1 })}
                            disabled={moveDisabled || index >= visibleApiKeys.length - 1}
                            data-mm-label={t('settings.search.apiKeyMoveDown', { index: index + 1 })}
                            onClick={() =>
                              updateWebSearchApiKeyPool(activeKeyProvider, (keys) => {
                                const next = [...keys]
                                const currentValue = next[index]
                                next[index] = next[index + 1]
                                next[index + 1] = currentValue
                                return next
                              })
                            }
                          >
                            <IconInline name="arrowDown" />
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-compact web-search-key-pool__button web-search-key-pool__button--danger"
                            aria-label={t('settings.search.apiKeyRemove', { index: index + 1 })}
                            disabled={saving || testingProvider || !usingAgentOs}
                            data-mm-label={t('settings.search.apiKeyRemove', { index: index + 1 })}
                            onClick={() =>
                              updateWebSearchApiKeyPool(activeKeyProvider, (keys) => keys.filter((_key, keyIndex) => keyIndex !== index))
                            }
                          >
                            <IconInline name="trash" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="web-search-key-pool__footer">
                  <small className="settings-field-row__hint" data-testid="web-search-key-status">{credentialHint}</small>
                  <button
                    type="button"
                    className="btn btn-ghost btn-compact"
                    disabled={saving || testingProvider || !usingAgentOs}
                    data-mm-label={t('settings.search.apiKeyAdd')}
                    onClick={() => updateWebSearchApiKeyPool(activeKeyProvider, (keys) => [...keys, ''])}
                  >
                    <IconInline name="plus" />
                    <span>{t('settings.search.apiKeyAdd')}</span>
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {usingAgentOs && draftSettings.provider === 'duckduckgo' ? (
            <p className="settings-provider-test-status" data-testid="web-search-key-status">{credentialHint}</p>
          ) : null}

          {providerTestResult ? (
            <p
              className={`settings-provider-test-status ${providerTestResult.ok ? 'is-success' : 'is-error'}`}
              data-testid="web-search-provider-test-status"
            >
              {formatWebSearchProviderTestStatus(providerTestResult, t)}
            </p>
          ) : null}
        </div>

        <div className="settings-footer settings-footer--inline">
          <span>{status}</span>
          <div className="settings-footer__actions">
            <button type="button" className="btn btn-ghost" disabled={saving || testingProvider || !dirty} data-mm-label={t('settings.search.revert')} onClick={() => {
              setDraftSettings(savedSettings)
              setProviderTestResult(null)
              setStatus(t('settings.search.reverted'))
            }}>
              {t('settings.search.revert')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="web-search-settings-save"
              disabled={saving || testingProvider || !dirty}
              data-mm-label={t('settings.search.save')}
              onClick={() => void saveWebSearchSettings()}
            >
              <IconInline name="save" />
              <span>{t('settings.search.save')}</span>
            </button>
          </div>
        </div>
      </section>
    </section>
  )
}

function GlobalMcpSettingsSection({
  activeProjectName,
  projectPathMissing,
  servers,
  probeCache,
  editingServer,
  dirty,
  busy,
  operation,
  status,
  onServerChange,
  onOpenEditor,
  onEditorChange,
  onEditorCancel,
  onEditorSave,
  onEditorSaveAndTest,
  onDuplicateServer,
  onRemoveServer,
  onReset,
  onSave,
}: {
  activeProjectName: string
  projectPathMissing: boolean
  servers: AgentMcpServerConfig[]
  probeCache: AgentMcpServerProbeCache
  editingServer: { index: number | null; server: AgentMcpServerConfig } | null
  dirty: boolean
  busy: boolean
  operation: GlobalMcpOperation
  status: string
  onServerChange: (index: number, patch: Partial<AgentMcpServerConfig>) => void
  onOpenEditor: (index: number | null) => void
  onEditorChange: (patch: Partial<AgentMcpServerConfig>) => void
  onEditorCancel: () => void
  onEditorSave: (server: AgentMcpServerConfig) => void
  onEditorSaveAndTest: (server: AgentMcpServerConfig) => void
  onDuplicateServer: (index: number) => void
  onRemoveServer: (index: number) => void
  onReset: () => void
  onSave: () => void
}) {
  const { t } = useI18n()
  const editingSnapshot = editingServer ? getMatchingGlobalMcpProbeSnapshot(editingServer.server, probeCache) : undefined
  const editingIndex = editingServer?.index ?? null
  return (
    <section className="settings-mcp-boundary settings-mcp-boundary--global" data-testid="mcp-settings-boundary-note" aria-labelledby="settings-mcp-boundary-heading">
      <div className="settings-mcp-boundary__header">
        <div className="settings-mcp-boundary__copy">
          <span className="settings-mcp-boundary__eyebrow">{t('settings.mcp.boundaryEyebrow')}</span>
          <h2 id="settings-mcp-boundary-heading">{t('settings.mcp.boundaryHeading')}</h2>
          <p>{t('settings.mcp.boundaryCaption')}</p>
          <span>{t('settings.mcp.boundaryProject', { name: activeProjectName })}</span>
        </div>
      </div>

      {projectPathMissing ? (
        <div className="settings-mcp-empty" data-testid="mcp-settings-no-project-empty" role="status">
          <strong>{t('settings.mcp.noProjectTitle')}</strong>
          <span>{t('settings.mcp.noProjectBody')}</span>
        </div>
      ) : null}

      {editingServer ? (
        <GlobalMcpServerEditor
          server={editingServer.server}
          snapshot={editingSnapshot}
          busy={busy}
          operation={operation}
          status={status}
          isNew={editingServer.index === null}
          onChange={onEditorChange}
          onCancel={onEditorCancel}
          onDelete={editingIndex === null ? undefined : () => onRemoveServer(editingIndex)}
          onSave={() => onEditorSave(editingServer.server)}
          onSaveAndTest={() => onEditorSaveAndTest(editingServer.server)}
        />
      ) : (
        <>
          <div className="agent-mcp-installed__head">
            <div>
              <h4>{t('settings.mcp.globalHeading')}</h4>
              <p>{t('settings.mcp.globalCaption')}</p>
            </div>
          </div>

          <div className="agent-mcp-installed-list" role="list" data-testid="global-mcp-server-list">
            {servers.length === 0 ? (
              <p className="agent-context-empty">{t('settings.mcp.globalEmpty')}</p>
            ) : null}
            {servers.map((server, index) => {
              const displayName = server.name.trim() || t('workspace.agentSettingsMcpUnnamed')
              const snapshot = getMatchingGlobalMcpProbeSnapshot(server, probeCache)
              const statusView = formatGlobalMcpProbeStatus(server, snapshot, t)
              return (
                <div key={`${server.name}-${index}`} className={`agent-mcp-installed-row agent-mcp-installed-row--${statusView.tone}`} role="listitem">
                  <button type="button" className="global-mcp-installed-row__main" disabled={busy} data-mm-label={displayName} data-mm-aliases={statusView.text} onClick={() => onOpenEditor(index)}>
                    <span className="agent-mcp-installed-row__avatar" aria-hidden="true">
                      <span>{displayName.slice(0, 1).toUpperCase()}</span>
                      <span className={`agent-mcp-installed-row__dot agent-mcp-installed-row__dot--${statusView.tone}`} />
                    </span>
                    <span className="agent-mcp-installed-row__copy">
                      <strong>{displayName}</strong>
                      <span>{statusView.text}</span>
                    </span>
                  </button>
                  <span className="global-mcp-installed-row__actions">
                    <button
                      type="button"
                      className="project-home-icon-button"
                      disabled={busy}
                      title={t('settings.mcp.duplicateServer')}
                      aria-label={t('settings.mcp.duplicateServerNamed', { name: displayName })}
                      data-mm-label={t('settings.mcp.duplicateServerNamed', { name: displayName })}
                      onClick={() => onDuplicateServer(index)}
                    >
                      <IconInline name="copy" />
                    </button>
                    <label className="agent-mcp-installed-row__switch">
                      <span className="sr-only">{t('workspace.agentSettingsMcpToggleServer', { name: displayName })}</span>
                      <span className="settings-switch-control">
                        <input
                          type="checkbox"
                          className="settings-switch-input"
                          checked={server.enabled}
                          disabled={busy}
                          data-mm-label={t('workspace.agentSettingsMcpToggleServer', { name: displayName })}
                          data-mm-aliases={displayName}
                          data-mm-exposure="value"
                          onChange={(event) => onServerChange(index, { enabled: event.target.checked })}
                        />
                        <span className="settings-switch-track" aria-hidden="true">
                          <span className="settings-switch-thumb" />
                        </span>
                      </span>
                    </label>
                  </span>
                </div>
              )
            })}
            <button type="button" className="agent-mcp-installed-row agent-mcp-installed-row--add" data-testid="global-mcp-add-server" disabled={busy} data-mm-label={t('workspace.agentSettingsMcpNewServer')} data-mm-aliases={t('workspace.agentSettingsMcpAddCustomServer')} onClick={() => onOpenEditor(null)}>
              <span className="agent-mcp-installed-row__avatar" aria-hidden="true">
                <IconInline name="plus" />
              </span>
              <span className="agent-mcp-installed-row__copy">
                <strong>{t('workspace.agentSettingsMcpNewServer')}</strong>
                <span>{t('workspace.agentSettingsMcpAddCustomServer')}</span>
              </span>
            </button>
          </div>

          <div className="agent-settings-panel-actions">
            <p className={`agent-settings-save-feedback${dirty && !busy ? ' is-dirty' : ''}`} role="status" aria-live="polite">
              <IconInline name={busy ? 'refresh' : dirty ? 'save' : 'check'} />
              <span>{status || (dirty ? t('workspace.agentSettingsUnsavedChanges') : t('workspace.agentSettingsNoChanges'))}</span>
            </p>
            <button type="button" className="agent-card-secondary-button" disabled={busy || !dirty} data-mm-label={t('settings.mcp.cancel')} onClick={onReset}>
              {t('settings.mcp.cancel')}
            </button>
            <button type="button" className="agent-card-primary-button" disabled={busy || !dirty} data-mm-label={operation === 'saving' ? t('settings.mcp.saving') : t('settings.mcp.save')} onClick={onSave}>
              <IconInline name={operation === 'saving' ? 'refresh' : 'save'} />
              <span>{operation === 'saving' ? t('settings.mcp.saving') : t('settings.mcp.save')}</span>
            </button>
          </div>
        </>
      )}
    </section>
  )
}

function GlobalMcpServerEditor({
  server,
  snapshot,
  busy,
  operation,
  status,
  isNew,
  onChange,
  onCancel,
  onDelete,
  onSave,
  onSaveAndTest,
}: {
  server: AgentMcpServerConfig
  snapshot?: AgentMcpServerProbeSnapshot
  busy: boolean
  operation: GlobalMcpOperation
  status: string
  isNew: boolean
  onChange: (patch: Partial<AgentMcpServerConfig>) => void
  onCancel: () => void
  onDelete?: () => void
  onSave: () => void
  onSaveAndTest: () => void
}) {
  const { t } = useI18n()
  const serverId = isNew ? 'global-mcp-server-new' : `global-mcp-server-${server.name || 'edit'}`
  const statusView = formatGlobalMcpProbeStatus(server, snapshot, t)
  const envHints = getGlobalMcpFieldEnvHints(server, snapshot, t)
  const serverInfo = formatMcpServerInfo(snapshot, t)
  const recoveryHint = getGlobalMcpRecoveryHint(server, snapshot, t)

  return (
    <div className="global-mcp-editor" data-testid="global-mcp-server-editor">
      <div className="global-mcp-editor__topbar">
        <button type="button" className="agent-card-secondary-button" disabled={busy} data-mm-label={t('settings.mcp.backToList')} onClick={onCancel}>
          <IconInline name="back" />
          <span>{t('settings.mcp.backToList')}</span>
        </button>
        {onDelete ? (
          <button type="button" className="project-home-icon-button project-home-icon-button--danger" disabled={busy} title={t('workspace.agentSettingsMcpRemoveServer')} data-mm-label={t('workspace.agentSettingsMcpRemoveServer')} onClick={onDelete}>
            <IconInline name="trash" />
          </button>
        ) : null}
      </div>

      <div className="global-mcp-editor__status">
        <span className={`agent-mcp-installed-row__dot agent-mcp-installed-row__dot--${statusView.tone}`} aria-hidden="true" />
        <span className="global-mcp-editor__status-stack">
          <span>{statusView.text}</span>
          {serverInfo ? <span className="global-mcp-editor__server-info" data-testid="mcp-server-info-detail">{serverInfo}</span> : null}
        </span>
      </div>

      {recoveryHint ? (
        <p className="agent-mcp-warning agent-mcp-warning--compact" data-testid="mcp-recovery-hint">{recoveryHint}</p>
      ) : null}

      <div className="agent-mcp-row agent-mcp-row--editor">
        <label className="agent-mcp-field agent-mcp-field--wide" htmlFor={`${serverId}-name`}>
          <span>{t('workspace.agentSettingsMcpServerName')}</span>
          <input
            id={`${serverId}-name`}
            className="settings-input"
            value={server.name}
            disabled={busy}
            spellCheck={false}
            placeholder="chrome-devtools"
            data-mm-label={t('workspace.agentSettingsMcpServerName')}
            data-mm-exposure="value"
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </label>

        <div className="global-mcp-segmented" role="tablist" aria-label={t('workspace.agentSettingsMcpTransportLabel')}>
          {MCP_TRANSPORTS.map((transport) => (
            <button
              key={transport}
              type="button"
              role="tab"
              aria-selected={server.transport === transport}
              className={`global-mcp-segmented__item${server.transport === transport ? ' is-active' : ''}`}
              disabled={busy}
              data-mm-label={t(`workspace.agentSettingsMcpTransport.${transport}`)}
              data-mm-aliases={t('workspace.agentSettingsMcpTransportLabel')}
              onClick={() => onChange({ transport })}
            >
              {t(`workspace.agentSettingsMcpTransport.${transport}`)}
            </button>
          ))}
        </div>

        <div className="agent-mcp-row__grid">
          {server.transport === 'stdio' ? (
            <>
              <label className="agent-mcp-field agent-mcp-field--wide" htmlFor={`${serverId}-command`}>
                <span>{t('workspace.agentSettingsMcpCommand')}</span>
                <input
                  id={`${serverId}-command`}
                  className="settings-input"
                  value={server.command}
                  disabled={busy}
                  spellCheck={false}
                  placeholder="npx"
                  data-mm-label={t('workspace.agentSettingsMcpCommand')}
                  data-mm-exposure="value"
                  onChange={(event) => onChange({ command: event.target.value })}
                />
                <GlobalMcpEnvHint hint={envHints.command} />
              </label>
              <label className="agent-mcp-field agent-mcp-field--wide" htmlFor={`${serverId}-args`}>
                <span>{t('workspace.agentSettingsMcpArgs')}</span>
                <textarea
                  id={`${serverId}-args`}
                  className="settings-input agent-mcp-textarea"
                  value={server.args.join('\n')}
                  disabled={busy}
                  spellCheck={false}
                  placeholder="-y\nchrome-devtools-mcp@latest"
                  data-mm-label={t('workspace.agentSettingsMcpArgs')}
                  onChange={(event) => onChange({ args: linesToList(event.target.value) })}
                />
                <GlobalMcpEnvHint hint={envHints.args} />
              </label>
              <label className="agent-mcp-field agent-mcp-field--wide" htmlFor={`${serverId}-cwd`}>
                <span>{t('workspace.agentSettingsMcpCwd')}</span>
                <input
                  id={`${serverId}-cwd`}
                  className="settings-input"
                  value={server.cwd}
                  disabled={busy}
                  spellCheck={false}
                  placeholder="~/code"
                  data-mm-label={t('workspace.agentSettingsMcpCwd')}
                  data-mm-exposure="value"
                  onChange={(event) => onChange({ cwd: event.target.value })}
                />
                <GlobalMcpEnvHint hint={envHints.cwd} />
              </label>
            </>
          ) : (
            <>
              <label className="agent-mcp-field agent-mcp-field--wide" htmlFor={`${serverId}-url`}>
                <span>{t('workspace.agentSettingsMcpUrl')}</span>
                <input
                  id={`${serverId}-url`}
                  className="settings-input"
                  value={server.url}
                  disabled={busy}
                  spellCheck={false}
                  placeholder="https://mcp.example.com/mcp"
                  data-mm-label={t('workspace.agentSettingsMcpUrl')}
                  data-mm-exposure="value"
                  onChange={(event) => onChange({ url: event.target.value })}
                />
                <GlobalMcpEnvHint hint={envHints.url} />
              </label>
              <label className="agent-mcp-field agent-mcp-field--wide" htmlFor={`${serverId}-headers`}>
                <span>{t('workspace.agentSettingsMcpHeaders')}</span>
                <textarea
                  id={`${serverId}-headers`}
                  className="settings-input agent-mcp-textarea"
                  value={recordToKeyValueLines(server.headers)}
                  disabled={busy}
                  spellCheck={false}
                  placeholder="Authorization=Bearer ${MCP_TOKEN}"
                  data-mm-label={t('workspace.agentSettingsMcpHeaders')}
                  data-mm-sensitive="true"
                  onChange={(event) => onChange({ headers: keyValueLinesToRecord(event.target.value) })}
                />
                <GlobalMcpEnvHint hint={envHints.headers} />
              </label>
            </>
          )}

          <label className="agent-mcp-field agent-mcp-field--wide" htmlFor={`${serverId}-env`}>
            <span>{t('workspace.agentSettingsMcpEnv')}</span>
            <textarea
              id={`${serverId}-env`}
              className="settings-input agent-mcp-textarea"
              value={recordToKeyValueLines(server.env)}
              disabled={busy}
              spellCheck={false}
              placeholder="GITHUB_PERSONAL_ACCESS_TOKEN=${GITHUB_TOKEN}"
              data-mm-label={t('workspace.agentSettingsMcpEnv')}
              data-mm-sensitive="true"
              onChange={(event) => onChange({ env: keyValueLinesToRecord(event.target.value) })}
            />
            <GlobalMcpEnvHint hint={envHints.env} />
          </label>

          <label className="agent-mcp-checkbox">
            <input
              type="checkbox"
              checked={server.alwaysLoad}
              disabled={busy}
              data-mm-label={t('workspace.agentSettingsMcpAlwaysLoad')}
              data-mm-aliases={t('workspace.agentSettingsMcpAlwaysLoadHint')}
              data-mm-exposure="value"
              onChange={(event) => onChange({ alwaysLoad: event.target.checked })}
            />
            <span>
              <strong>{t('workspace.agentSettingsMcpAlwaysLoad')}</strong>
              <small>{t('workspace.agentSettingsMcpAlwaysLoadHint')}</small>
            </span>
          </label>
        </div>
      </div>

      <div className="agent-settings-panel-actions">
        <p className="agent-settings-save-feedback" role="status" aria-live="polite">
          <IconInline name={busy ? 'refresh' : statusView.tone === 'ready' ? 'check' : 'server'} />
          <span>{status || statusView.text}</span>
        </p>
        <button type="button" className="agent-card-secondary-button" disabled={busy} data-mm-label={t('settings.mcp.save')} onClick={onSave}>
          <IconInline name="save" />
          <span>{t('settings.mcp.save')}</span>
        </button>
        <button type="button" className="agent-card-primary-button" disabled={busy} data-mm-label={operation === 'saving' ? t('settings.mcp.savingShort') : operation === 'testing' ? t('settings.mcp.testingShort') : t('settings.mcp.saveAndTest')} onClick={onSaveAndTest}>
          <IconInline name={busy ? 'refresh' : 'server'} />
          <span>
            {operation === 'saving'
              ? t('settings.mcp.savingShort')
              : operation === 'testing'
                ? t('settings.mcp.testingShort')
                : t('settings.mcp.saveAndTest')}
          </span>
        </button>
      </div>
    </div>
  )
}

type GlobalMcpEnvHintTone = 'success' | 'pending' | 'error'

type GlobalMcpEnvHintModel = {
  tone: GlobalMcpEnvHintTone
  text: string
}

function GlobalMcpEnvHint({ hint }: { hint?: GlobalMcpEnvHintModel }) {
  if (!hint) return null
  return (
    <small
      className={`settings-field-row__hint global-mcp-env-hint global-mcp-env-hint--${hint.tone}`}
      data-testid={hint.tone === 'success' ? 'mcp-env-resolution-status' : 'mcp-env-resolution-error'}
    >
      {hint.text}
    </small>
  )
}

type GlobalMcpFieldEnvHints = Partial<Record<'command' | 'args' | 'cwd' | 'url' | 'headers' | 'env', GlobalMcpEnvHintModel>>

function getGlobalMcpFieldEnvHints(
  server: AgentMcpServerConfig,
  snapshot: AgentMcpServerProbeSnapshot | undefined,
  t: TranslateFn,
): GlobalMcpFieldEnvHints {
  return {
    command: formatGlobalMcpFieldEnvHint([server.command], snapshot, t),
    args: formatGlobalMcpFieldEnvHint(server.args, snapshot, t),
    cwd: formatGlobalMcpFieldEnvHint([server.cwd], snapshot, t),
    url: formatGlobalMcpFieldEnvHint([server.url], snapshot, t),
    headers: formatGlobalMcpFieldEnvHint(Object.values(server.headers), snapshot, t),
    env: formatGlobalMcpFieldEnvHint(Object.values(server.env), snapshot, t),
  }
}

function formatGlobalMcpFieldEnvHint(
  values: string[],
  snapshot: AgentMcpServerProbeSnapshot | undefined,
  t: TranslateFn,
): GlobalMcpEnvHintModel | undefined {
  const refs = collectGlobalMcpEnvReferenceNames(values)
  if (refs.length === 0) return undefined
  const names = refs.join(', ')
  if (snapshot?.status === 'connected') {
    return { tone: 'success', text: t('settings.mcp.fieldEnvResolved', { names }) }
  }
  if (snapshot?.status === 'failed' || snapshot?.status === 'needs-auth') {
    return { tone: 'error', text: t('settings.mcp.fieldEnvUnresolved', { names }) }
  }
  return { tone: 'pending', text: t('settings.mcp.fieldEnvPending', { names }) }
}

function collectGlobalMcpEnvReferenceNames(values: string[]): string[] {
  const refs = new Set<string>()
  for (const value of values) {
    for (const match of value.matchAll(/\$\{([A-Z_a-z][A-Z_a-z0-9]*)\}/g)) {
      refs.add(match[1])
    }
  }
  return [...refs]
}

function formatMcpServerInfo(snapshot: AgentMcpServerProbeSnapshot | undefined, t: TranslateFn): string {
  const serverInfo = snapshot?.serverInfo
  if (!serverInfo?.name) return ''
  if (serverInfo.version) return t('settings.mcp.serverInfoVersion', { name: serverInfo.name, version: serverInfo.version })
  return t('settings.mcp.serverInfo', { name: serverInfo.name })
}

function getGlobalMcpRecoveryHint(
  server: AgentMcpServerConfig,
  snapshot: AgentMcpServerProbeSnapshot | undefined,
  t: TranslateFn,
): string {
  if (!server.enabled) return ''
  if (!snapshot) return t('settings.mcp.recoveryTest')
  if (snapshot.status === 'connected' || snapshot.status === 'disabled') return ''
  const error = snapshot.error?.toLowerCase() ?? ''
  if (error.includes('env') || error.includes('environment') || error.includes('variable') || error.includes('${')) {
    return t('settings.mcp.recoveryEnv')
  }
  if (snapshot.status === 'needs-auth' || error.includes('auth') || error.includes('token') || error.includes('key')) {
    return t('settings.mcp.recoveryAuth')
  }
  return server.transport === 'stdio' ? t('settings.mcp.recoveryCommand') : t('settings.mcp.recoveryUrl')
}

function getMatchingGlobalMcpProbeSnapshot(
  server: AgentMcpServerConfig,
  probeCache: AgentMcpServerProbeCache,
): AgentMcpServerProbeSnapshot | undefined {
  const snapshot = probeCache[server.name]
  if (!snapshot) return undefined
  if (snapshot.configSignature !== buildGlobalMcpServerConfigSignature(server)) return undefined
  return snapshot
}

function formatGlobalMcpProbeStatus(
  server: AgentMcpServerConfig,
  snapshot: AgentMcpServerProbeSnapshot | undefined,
  t: (path: string, params?: Record<string, string | number>) => string,
): { tone: 'ready' | 'pending' | 'error' | 'disabled'; text: string } {
  if (!server.enabled) {
    return { tone: 'disabled', text: t('workspace.agentSettingsMcpStatusDisabled') }
  }
  if (!snapshot) {
    return { tone: 'pending', text: t('settings.mcp.notTested') }
  }
  if (snapshot.status === 'connected') {
    return {
      tone: 'ready',
      text: t('workspace.agentSettingsMcpStatusConnectedTools', { count: snapshot.tools.length }),
    }
  }
  if (snapshot.status === 'needs-auth') {
    return {
      tone: 'error',
      text: snapshot.error
        ? t('workspace.agentSettingsMcpStatusNeedsAuthDetail', { message: snapshot.error })
        : t('workspace.agentSettingsMcpStatusNeedsAuth'),
    }
  }
  if (snapshot.status === 'failed') {
    return {
      tone: 'error',
      text: snapshot.error
        ? t('workspace.agentSettingsMcpStatusFailedDetail', { message: snapshot.error })
        : t('workspace.agentSettingsMcpStatusFailed'),
    }
  }
  if (snapshot.status === 'disabled') {
    return { tone: 'disabled', text: t('workspace.agentSettingsMcpStatusDisabled') }
  }
  return { tone: 'pending', text: t('workspace.agentSettingsMcpStatusWaiting') }
}

function buildGlobalMcpServerConfigSignature(server: AgentMcpServerConfig): string {
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

function createDraftGlobalMcpServer(existing: AgentMcpServerConfig[]): AgentMcpServerConfig {
  return {
    name: uniqueGlobalMcpServerName(existing, 'local-tools'),
    enabled: true,
    transport: 'stdio',
    command: '',
    args: [],
    env: {},
    cwd: '',
    url: '',
    headers: {},
    alwaysLoad: false,
  }
}

function cloneGlobalMcpServer(source: AgentMcpServerConfig, existing: AgentMcpServerConfig[]): AgentMcpServerConfig {
  const baseName = `${source.name.trim() || 'mcp-server'}-copy`
  return {
    ...source,
    name: uniqueGlobalMcpServerName(existing, baseName),
    enabled: false,
  }
}

function normalizeGlobalMcpServers(servers: AgentMcpServerConfig[]): AgentMcpServerConfig[] {
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

function uniqueGlobalMcpServerName(existing: AgentMcpServerConfig[], preferred: string): string {
  const used = new Set(existing.map((server) => server.name.trim()).filter(Boolean))
  let name = preferred
  let suffix = 2
  while (used.has(name)) {
    name = `${preferred}-${suffix}`
    suffix += 1
  }
  return name
}

function validateGlobalMcpServers(
  servers: AgentMcpServerConfig[],
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
  return ''
}

function linesToList(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function recordToKeyValueLines(record: Record<string, string>): string {
  return Object.entries(record).map(([key, value]) => `${key}=${value}`).join('\n')
}

function keyValueLinesToRecord(value: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const separator = trimmed.indexOf('=')
    if (separator <= 0) continue
    const key = trimmed.slice(0, separator).trim()
    const nextValue = trimmed.slice(separator + 1).trim()
    if (key) out[key] = nextValue
  }
  return out
}

function cleanStringRecord(record: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries(record)) {
    const key = rawKey.trim()
    const value = rawValue.trim()
    if (key && value) out[key] = value
  }
  return out
}

function pruneStoredAnthropicOverlay(
  providers: ClaudeAgentModelProvider[],
  activeProviderId: string,
  overlayRaw: string,
): string {
  const provider = providers.find((p) => p.id === activeProviderId)
  const overlay = overlayRaw.trim()
  if (!provider || !overlay) return ''
  const primary = provider.model.trim()
  if (overlay === primary || !providerKnowsAnthropicModelId(provider, overlay)) return ''
  return overlay
}

function providerKnowsAnthropicModelId(provider: ClaudeAgentModelProvider, id: string): boolean {
  const m = id.trim()
  if (!m) return false
  const pool = [provider.model, provider.defaultHaikuModel, provider.defaultSonnetModel, provider.defaultOpusModel]
    .map((s) => s.trim())
    .filter(Boolean)
  return pool.includes(m)
}

function providerDisplayName(
  provider: ClaudeAgentModelProvider,
  t: (path: string, vars?: Record<string, string | number>) => string,
): string {
  return provider.name || provider.model || t('settings.models.unnamedModel')
}

function activeProviderModel(provider: ClaudeAgentModelProvider, overlay: string): string {
  return overlay.trim() || provider.model || provider.defaultSonnetModel || provider.defaultOpusModel || provider.defaultHaikuModel
}

function providerHasConfiguredCredential(provider: ClaudeAgentModelProvider): boolean {
  return Boolean(provider.apiKey.trim() || provider.authToken.trim())
}

function providerSupportsAnyImages(provider: ClaudeAgentModelProvider): boolean {
  return Boolean(
    provider.modelSupportsImages ||
    provider.defaultHaikuSupportsImages ||
    provider.defaultSonnetSupportsImages ||
    provider.defaultOpusSupportsImages
  )
}

function providerMeta(
  provider: ClaudeAgentModelProvider,
  t: (path: string, vars?: Record<string, string | number>) => string,
): string {
  const primaryModel =
    provider.model || provider.defaultSonnetModel || provider.defaultOpusModel || provider.defaultHaikuModel
  const parts = [
    primaryModel,
    provider.baseUrl,
    providerImageSupportSummary(provider, t),
    provider.apiKey ? t('settings.models.apiKeySet') : '',
  ].filter(Boolean)

  return parts.length ? parts.join(' · ') : t('settings.models.metaNoCredentials')
}

function providerImageSupportSummary(
  provider: ClaudeAgentModelProvider,
  t: (path: string, vars?: Record<string, string | number>) => string,
): string {
  const rows = [
    { model: provider.defaultHaikuModel, supportsImages: provider.defaultHaikuSupportsImages },
    { model: provider.defaultSonnetModel, supportsImages: provider.defaultSonnetSupportsImages },
    { model: provider.defaultOpusModel, supportsImages: provider.defaultOpusSupportsImages },
  ].filter((row) => row.model.trim())
  const enabled = rows.filter((row) => row.supportsImages).length
  if (!enabled) return ''
  return t('settings.models.metaSupportsImageCount', { enabled, total: rows.length || 3 })
}

function createEnvStatusTags(
  snapshot: ClaudeAgentSettingsSnapshot,
  t: (path: string, vars?: Record<string, string | number>) => string,
): string[] {
  const env = snapshot.env
  const modelMapping = [
    env.defaultHaikuModel ? `Haiku ${env.defaultHaikuModel}` : '',
    env.defaultSonnetModel ? `Sonnet ${env.defaultSonnetModel}` : '',
    env.defaultOpusModel ? `Opus ${env.defaultOpusModel}` : '',
  ]
    .filter(Boolean)
    .join(' / ')

  return [
    env.hasApiKey
      ? t('settings.models.envApiKeySet')
      : env.hasAuthToken
        ? t('settings.models.envAuthTokenSet')
        : t('settings.models.envCredentialsUnset'),
    env.baseUrl ? t('settings.models.envBaseUrlValue', { value: env.baseUrl }) : t('settings.models.envBaseUrlDefault'),
    env.model ? t('settings.models.envModelValue', { value: env.model }) : t('settings.models.envModelDefault'),
    env.supportsImages ? t('settings.models.envImagesOn') : t('settings.models.envImagesOff'),
    modelMapping ? t('settings.models.envMappingValue', { value: modelMapping }) : t('settings.models.envMappingDefault'),
  ]
}
