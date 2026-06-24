/**
 * Claude Agent 多提供商模型配置 UI。
 * Multi-provider Claude Agent credentials UI backed by `claudeChat.getSettings`.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
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
  AgentWebSearchSettings,
} from '../../desktop-types'
import type { AgentSettingsPanelId, WorkspaceProject } from '../types'

const IS_DEV_BUILD = import.meta.env.DEV
const REMOTE_PROVIDER_PRESETS_URL =
  'https://raw.githubusercontent.com/xuezhirong/AgentOS/main/src/model-provider-presets.json'

type ProviderPresetSource = 'remote' | 'local'

type ProviderTestState = {
  busy: boolean
  message: string
  ok?: boolean
}

const MCP_TRANSPORTS: AgentMcpServerTransport[] = ['stdio', 'http', 'sse']
const WEB_SEARCH_PROVIDERS: AgentWebSearchProviderId[] = ['duckduckgo-instant', 'brave', 'tavily']

type GlobalMcpSettingsPageProps = {
  activeProject: WorkspaceProject
  onOpenAgentSettings: (panel: AgentSettingsPanelId) => void
}

const DEFAULT_WEB_SEARCH_SETTINGS: AgentWebSearchSettings = {
  mode: 'native',
  provider: 'duckduckgo-instant',
  maxResults: 5,
  braveApiKey: '',
  tavilyApiKey: '',
}

function normalizeWebSearchSettingsDraft(settings: AgentWebSearchSettings): AgentWebSearchSettings {
  return {
    mode: settings.mode === 'agentos' ? 'agentos' : 'native',
    provider: WEB_SEARCH_PROVIDERS.includes(settings.provider) ? settings.provider : 'duckduckgo-instant',
    maxResults: clampUiNumber(settings.maxResults, 1, 10, DEFAULT_WEB_SEARCH_SETTINGS.maxResults),
    braveApiKey: settings.braveApiKey.trim(),
    tavilyApiKey: settings.tavilyApiKey.trim(),
  }
}

function clampUiNumber(value: string | number, min: number, max: number, fallback: number): number {
  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.min(max, Math.max(min, Math.floor(numberValue)))
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
              <button type="button" className="btn btn-ghost btn-compact" onClick={openAddProviderDialog}>
                <IconInline name="plus" />
                <span>{t('settings.models.add')}</span>
              </button>
            </div>
            <p className="settings-section-caption">{t('settings.models.providersCaption')}</p>
            <div className="settings-provider-list" role="list" aria-label={t('settings.models.providerListAria')}>
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
                  <div
                    key={provider.id}
                    className={['settings-provider-accordion', isExpanded ? 'is-expanded' : ''].filter(Boolean).join(' ')}
                    role="listitem"
                  >
                    <div className="settings-provider-row">
                      <button
                        type="button"
                        className="settings-provider-select"
                        id={triggerId}
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
                      </button>
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
                              autoComplete="off"
                              spellCheck={false}
                              placeholder="https://open.bigmodel.cn/api/anthropic"
                              value={provider.baseUrl}
                              onChange={(event) => updateProvider(pid, 'baseUrl', event.target.value)}
                            />
                          </div>
                          <div className="settings-model-map" aria-label={t('settings.models.modelMappingsAria')}>
                            {modelRows.map((row) => (
                              <div className="settings-field-row settings-model-row" key={row.field}>
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
                                      checked={row.supportsImages}
                                      aria-label={t('settings.models.modelImageToggleAria', { slot: row.label })}
                                      onChange={(event) => updateProvider(pid, row.supportField, event.target.checked)}
                                    />
                                    <span className="settings-switch-track" aria-hidden="true">
                                      <span className="settings-switch-thumb" />
                                    </span>
                                  </span>
                                </label>
                              </div>
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
                            <button
                              type="button"
                              className="btn btn-ghost btn-compact"
                              disabled={busy || Boolean(testState?.busy)}
                              onClick={() => void testProviderConnection(provider)}
                            >
                              <IconInline name={testState?.ok ? 'check' : 'refresh'} />
                              <span>
                                {testState?.busy
                                  ? t('settings.models.testingConnection')
                                  : t('settings.models.testConnection')}
                              </span>
                            </button>
                            <button
                              type="button"
                              className="btn btn-primary btn-compact"
                              disabled={!isDirty || busy || saveDisabled}
                              onClick={() => void persist()}
                            >
                              {t('settings.models.editorConfirm')}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-compact"
                              disabled={!isDirty || busy}
                              onClick={cancelExpandedProviderEdits}
                            >
                              {t('settings.models.editorCancel')}
                            </button>
                            <button
                              type="button"
                              className="settings-provider-delete-link"
                              disabled={providers.length <= 1 || busy}
                              title={providers.length <= 1 ? t('settings.models.deleteKeepOne') : undefined}
                              onClick={() => openDeleteConfirmDialog(pid)}
                            >
                              {t('settings.models.deleteProviderEntry')}
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
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
            <button
              type="button"
              className="btn btn-primary btn-compact"
              disabled={!isDirty || busy || saveDisabled}
              onClick={() => void persist()}
              aria-controls="claude-settings-form"
            >
              {t('settings.models.saveChanges')}
            </button>
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
                <button
                  key={preset.id}
                  type="button"
                  className="settings-provider-preset-card"
                  onClick={() => addProvider(preset)}
                >
                  <span className="settings-provider-preset-card__title">{preset.name}</span>
                  <span className="settings-provider-preset-card__meta">{preset.baseUrl}</span>
                </button>
              ))}
              <button type="button" className="settings-provider-preset-card" onClick={() => addProvider()}>
                <span className="settings-provider-preset-card__title">{t('settings.models.customProvider')}</span>
                <span className="settings-provider-preset-card__meta">{t('settings.models.customProviderMeta')}</span>
              </button>
            </div>
            <div className="settings-restart-dialog__actions">
              <button type="button" className="btn btn-ghost" onClick={() => addProviderDialogRef.current?.close()}>
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
              <button type="button" className="btn btn-ghost" onClick={() => deleteConfirmDialogRef.current?.close()}>
                {t('settings.models.deleteDialogDismiss')}
              </button>
              <button type="button" className="btn btn-primary" onClick={confirmDeleteProvider}>
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
  const [globalMcpSaving, setGlobalMcpSaving] = useState(false)
  const globalMcpDirty = JSON.stringify(globalMcpServers) !== JSON.stringify(draftGlobalMcpServers)

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
    setGlobalMcpSaving(true)
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
      setGlobalMcpSaving(false)
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
    setGlobalMcpSaving(true)
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
      setGlobalMcpSaving(false)
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

  const resetGlobalMcpServers = useCallback(() => {
    setDraftGlobalMcpServers(globalMcpServers)
    setEditingGlobalMcpServer(null)
    setGlobalMcpStatus(t('settings.mcp.reverted'))
  }, [globalMcpServers, t])

  useEffect(() => {
    void loadGlobalMcpSettings()
  }, [loadGlobalMcpSettings])

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
        servers={draftGlobalMcpServers}
        probeCache={globalMcpProbeCache}
        editingServer={editingGlobalMcpServer}
        dirty={globalMcpDirty}
        saving={globalMcpSaving}
        status={globalMcpStatus}
        onServerChange={updateGlobalMcpServer}
        onOpenEditor={openGlobalMcpEditor}
        onEditorChange={updateGlobalMcpEditor}
        onEditorCancel={() => setEditingGlobalMcpServer(null)}
        onEditorSave={(server) => void saveAndTestGlobalMcpEditor(server, false)}
        onEditorSaveAndTest={(server) => void saveAndTestGlobalMcpEditor(server, true)}
        onRemoveServer={removeGlobalMcpServer}
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
  const dirty = JSON.stringify(savedSettings) !== JSON.stringify(draftSettings)
  const usingAgentOs = draftSettings.mode === 'agentos'

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
                disabled={saving}
                onChange={() => setDraftSettings((current) => ({ ...current, mode }))}
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
          </div>

          <div className="agent-mcp-list" role="radiogroup" aria-label={t('settings.search.providerAria')}>
            {WEB_SEARCH_PROVIDERS.map((provider) => (
              <label className="agent-mcp-checkbox" key={provider}>
                <input
                  type="radio"
                  name="web-search-provider"
                  value={provider}
                  checked={draftSettings.provider === provider}
                  disabled={saving || !usingAgentOs}
                  onChange={() => setDraftSettings((current) => ({ ...current, provider }))}
                />
                <span>
                  <strong>{t(`settings.search.provider.${provider}.title`)}</strong>
                  <small>{t(`settings.search.provider.${provider}.description`)}</small>
                </span>
              </label>
            ))}
          </div>

          <div className="agent-mcp-row__grid">
            <label className="agent-mcp-field" htmlFor="web-search-max-results">
              <span>{t('settings.search.maxResults')}</span>
              <input
                id="web-search-max-results"
                className="settings-input"
                type="number"
                min={1}
                max={10}
                value={draftSettings.maxResults}
                disabled={saving || !usingAgentOs}
                onChange={(event) =>
                  setDraftSettings((current) => ({
                    ...current,
                    maxResults: clampUiNumber(event.target.value, 1, 10, current.maxResults),
                  }))
                }
              />
            </label>

            {draftSettings.provider === 'brave' ? (
              <label className="agent-mcp-field agent-mcp-field--wide" htmlFor="web-search-brave-key">
                <span>{t('settings.search.braveApiKey')}</span>
                <input
                  id="web-search-brave-key"
                  className="settings-input"
                  value={draftSettings.braveApiKey}
                  disabled={saving || !usingAgentOs}
                  spellCheck={false}
                  placeholder="${BRAVE_SEARCH_API_KEY}"
                  onChange={(event) => setDraftSettings((current) => ({ ...current, braveApiKey: event.target.value }))}
                />
              </label>
            ) : null}

            {draftSettings.provider === 'tavily' ? (
              <label className="agent-mcp-field agent-mcp-field--wide" htmlFor="web-search-tavily-key">
                <span>{t('settings.search.tavilyApiKey')}</span>
                <input
                  id="web-search-tavily-key"
                  className="settings-input"
                  value={draftSettings.tavilyApiKey}
                  disabled={saving || !usingAgentOs}
                  spellCheck={false}
                  placeholder="${TAVILY_API_KEY}"
                  onChange={(event) => setDraftSettings((current) => ({ ...current, tavilyApiKey: event.target.value }))}
                />
              </label>
            ) : null}
          </div>
        </div>

        <div className="settings-footer settings-footer--inline">
          <span>{status}</span>
          <div className="settings-footer__actions">
            <button type="button" className="btn btn-ghost" disabled={saving || !dirty} onClick={() => {
              setDraftSettings(savedSettings)
              setStatus(t('settings.search.reverted'))
            }}>
              {t('settings.search.revert')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="web-search-settings-save"
              disabled={saving || !dirty}
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
  servers,
  probeCache,
  editingServer,
  dirty,
  saving,
  status,
  onServerChange,
  onOpenEditor,
  onEditorChange,
  onEditorCancel,
  onEditorSave,
  onEditorSaveAndTest,
  onRemoveServer,
  onReset,
  onSave,
}: {
  activeProjectName: string
  servers: AgentMcpServerConfig[]
  probeCache: AgentMcpServerProbeCache
  editingServer: { index: number | null; server: AgentMcpServerConfig } | null
  dirty: boolean
  saving: boolean
  status: string
  onServerChange: (index: number, patch: Partial<AgentMcpServerConfig>) => void
  onOpenEditor: (index: number | null) => void
  onEditorChange: (patch: Partial<AgentMcpServerConfig>) => void
  onEditorCancel: () => void
  onEditorSave: (server: AgentMcpServerConfig) => void
  onEditorSaveAndTest: (server: AgentMcpServerConfig) => void
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

      {editingServer ? (
        <GlobalMcpServerEditor
          server={editingServer.server}
          snapshot={editingSnapshot}
          saving={saving}
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
                  <button type="button" className="global-mcp-installed-row__main" disabled={saving} onClick={() => onOpenEditor(index)}>
                    <span className="agent-mcp-installed-row__avatar" aria-hidden="true">
                      <span>{displayName.slice(0, 1).toUpperCase()}</span>
                      <span className={`agent-mcp-installed-row__dot agent-mcp-installed-row__dot--${statusView.tone}`} />
                    </span>
                    <span className="agent-mcp-installed-row__copy">
                      <strong>{displayName}</strong>
                      <span>{statusView.text}</span>
                    </span>
                  </button>
                  <label className="agent-mcp-installed-row__switch">
                    <span className="sr-only">{t('workspace.agentSettingsMcpToggleServer', { name: displayName })}</span>
                    <span className="settings-switch-control">
                      <input
                        type="checkbox"
                        className="settings-switch-input"
                        checked={server.enabled}
                        disabled={saving}
                        onChange={(event) => onServerChange(index, { enabled: event.target.checked })}
                      />
                      <span className="settings-switch-track" aria-hidden="true">
                        <span className="settings-switch-thumb" />
                      </span>
                    </span>
                  </label>
                </div>
              )
            })}
            <button type="button" className="agent-mcp-installed-row agent-mcp-installed-row--add" data-testid="global-mcp-add-server" disabled={saving} onClick={() => onOpenEditor(null)}>
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
            <p className={`agent-settings-save-feedback${dirty && !saving ? ' is-dirty' : ''}`} role="status" aria-live="polite">
              <IconInline name={saving ? 'refresh' : dirty ? 'save' : 'check'} />
              <span>{status || (dirty ? t('workspace.agentSettingsUnsavedChanges') : t('workspace.agentSettingsNoChanges'))}</span>
            </p>
            <button type="button" className="agent-card-secondary-button" disabled={saving || !dirty} onClick={onReset}>
              {t('settings.mcp.cancel')}
            </button>
            <button type="button" className="agent-card-primary-button" disabled={saving || !dirty} onClick={onSave}>
              <IconInline name={saving ? 'refresh' : 'save'} />
              <span>{saving ? t('settings.mcp.saving') : t('settings.mcp.save')}</span>
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
  saving,
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
  saving: boolean
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

  return (
    <div className="global-mcp-editor" data-testid="global-mcp-server-editor">
      <div className="global-mcp-editor__topbar">
        <button type="button" className="agent-card-secondary-button" disabled={saving} onClick={onCancel}>
          <IconInline name="back" />
          <span>{t('settings.mcp.backToList')}</span>
        </button>
        {onDelete ? (
          <button type="button" className="project-home-icon-button project-home-icon-button--danger" disabled={saving} title={t('workspace.agentSettingsMcpRemoveServer')} onClick={onDelete}>
            <IconInline name="trash" />
          </button>
        ) : null}
      </div>

      <div className="global-mcp-editor__status">
        <span className={`agent-mcp-installed-row__dot agent-mcp-installed-row__dot--${statusView.tone}`} aria-hidden="true" />
        <span>{statusView.text}</span>
      </div>

      <div className="agent-mcp-row agent-mcp-row--editor">
        <label className="agent-mcp-field agent-mcp-field--wide" htmlFor={`${serverId}-name`}>
          <span>{t('workspace.agentSettingsMcpServerName')}</span>
          <input
            id={`${serverId}-name`}
            className="settings-input"
            value={server.name}
            disabled={saving}
            spellCheck={false}
            placeholder="chrome-devtools"
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
              disabled={saving}
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
                  disabled={saving}
                  spellCheck={false}
                  placeholder="npx"
                  onChange={(event) => onChange({ command: event.target.value })}
                />
              </label>
              <label className="agent-mcp-field agent-mcp-field--wide" htmlFor={`${serverId}-args`}>
                <span>{t('workspace.agentSettingsMcpArgs')}</span>
                <textarea
                  id={`${serverId}-args`}
                  className="settings-input agent-mcp-textarea"
                  value={server.args.join('\n')}
                  disabled={saving}
                  spellCheck={false}
                  placeholder="-y\nchrome-devtools-mcp@latest"
                  onChange={(event) => onChange({ args: linesToList(event.target.value) })}
                />
              </label>
              <label className="agent-mcp-field agent-mcp-field--wide" htmlFor={`${serverId}-cwd`}>
                <span>{t('workspace.agentSettingsMcpCwd')}</span>
                <input
                  id={`${serverId}-cwd`}
                  className="settings-input"
                  value={server.cwd}
                  disabled={saving}
                  spellCheck={false}
                  placeholder="~/code"
                  onChange={(event) => onChange({ cwd: event.target.value })}
                />
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
                  disabled={saving}
                  spellCheck={false}
                  placeholder="https://mcp.example.com/mcp"
                  onChange={(event) => onChange({ url: event.target.value })}
                />
              </label>
              <label className="agent-mcp-field agent-mcp-field--wide" htmlFor={`${serverId}-headers`}>
                <span>{t('workspace.agentSettingsMcpHeaders')}</span>
                <textarea
                  id={`${serverId}-headers`}
                  className="settings-input agent-mcp-textarea"
                  value={recordToKeyValueLines(server.headers)}
                  disabled={saving}
                  spellCheck={false}
                  placeholder="Authorization=Bearer ${MCP_TOKEN}"
                  onChange={(event) => onChange({ headers: keyValueLinesToRecord(event.target.value) })}
                />
              </label>
            </>
          )}

          <label className="agent-mcp-field agent-mcp-field--wide" htmlFor={`${serverId}-env`}>
            <span>{t('workspace.agentSettingsMcpEnv')}</span>
            <textarea
              id={`${serverId}-env`}
              className="settings-input agent-mcp-textarea"
              value={recordToKeyValueLines(server.env)}
              disabled={saving}
              spellCheck={false}
              placeholder="GITHUB_PERSONAL_ACCESS_TOKEN=${GITHUB_TOKEN}"
              onChange={(event) => onChange({ env: keyValueLinesToRecord(event.target.value) })}
            />
          </label>

          <label className="agent-mcp-checkbox">
            <input
              type="checkbox"
              checked={server.alwaysLoad}
              disabled={saving}
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
          <IconInline name={saving ? 'refresh' : statusView.tone === 'ready' ? 'check' : 'server'} />
          <span>{status || statusView.text}</span>
        </p>
        <button type="button" className="agent-card-secondary-button" disabled={saving} onClick={onSave}>
          <IconInline name="save" />
          <span>{t('settings.mcp.save')}</span>
        </button>
        <button type="button" className="agent-card-primary-button" disabled={saving} onClick={onSaveAndTest}>
          <IconInline name={saving ? 'refresh' : 'server'} />
          <span>{saving ? t('settings.mcp.testingShort') : t('settings.mcp.saveAndTest')}</span>
        </button>
      </div>
    </div>
  )
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
