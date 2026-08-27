/**
 * Main reads this once during module initialization; it is intentionally not
 * user configurable. Project Chat is now the production default. Keeping an
 * explicit `0` escape hatch lets a broken rollout fall back to the legacy
 * renderer without making the switch renderer-controlled.
 */
export function projectChatBrokerV2Enabled(environment: NodeJS.ProcessEnv): boolean {
  return environment.AGENTOS_PROJECT_CHAT_BROKER_V2 !== '0'
}

export type ProjectChatHandlerRegistrar = {
  handle(channel: string, handler: Function): void
}

/** Register a frozen handler map once. Duplicate channels are a startup error, never an override. */
export function registerProjectChatHandlerMap(
  registrar: ProjectChatHandlerRegistrar,
  handlers: ReadonlyMap<string, Function>,
): void {
  const seen = new Set<string>()
  for (const [channel, handler] of handlers) {
    if (seen.has(channel)) throw new Error(`project-chat-duplicate-handler:${channel}`)
    seen.add(channel)
    registrar.handle(channel, handler)
  }
}

type Capability = { webContentsId: number }
type MainWindow = {
  webContents: { id: number }
  isVisible(): boolean
  isFocused(): boolean
  on(event: 'focus' | 'show' | 'hide' | 'blur' | 'closed', listener: () => void): void
}

/**
 * Transactional enabled-path assembly. Electron itself remains injected so this
 * module can prove rollback without importing Main globals or registering IPC.
 */
export function createProjectChatProductionComposition<TBroker, TCollaborator>(options: {
  multiplexer: { setSinks(sinks: readonly { publish(event: unknown): void }[]): void }
  legacySinks: readonly { publish(event: unknown): void }[]
  broker: TBroker & { refreshPromptOwners(projectId?: string): Promise<void>; onWebContentsUnavailable(webContentsId: number): Promise<void> }
  taskHomeSink: { publish(event: unknown): void }
  capabilities: { registerMainWindow(webContentsId: number): Capability | null; unregister(webContentsId: number): void }
  presence: { register(capability: Capability): void; unregister(webContentsId: number): void; setWindowState(webContentsId: number, state: { visible: boolean; focused: boolean }): boolean }
  mainWindow: MainWindow
  registrar: ProjectChatHandlerRegistrar & { removeHandler?(channel: string): void }
  createCollaborator(lifecycle: {
    onCapabilityRegistered(capability: Capability): void
    onWindowState(webContentsId: number, state: { visible: boolean; focused: boolean }): void
    onWindowCleanup(webContentsId: number): void
  }): TCollaborator
  createHandlers(collaborator: TCollaborator): Record<string, Function>
  disposeCollaborator?(collaborator: TCollaborator): void
}): { broker: TBroker; dispose(): void } {
  const installed: string[] = []
  const disposers: Array<() => void> = []
  let mainCapability: Capability | null = null
  let collaborator: TCollaborator | undefined
  let disposed = false
  const cleaned = new Set<number>()
  const refresh = () => { void options.broker.refreshPromptOwners() }
  const orderedCleanup = (webContentsId: number) => {
    if (cleaned.has(webContentsId)) return
    cleaned.add(webContentsId)
    options.presence.unregister(webContentsId)
    void options.broker.onWebContentsUnavailable(webContentsId)
    options.capabilities.unregister(webContentsId)
  }
  const dispose = () => {
    if (disposed) return
    disposed = true
    for (const disposeListener of disposers.splice(0).reverse()) disposeListener()
    if (mainCapability) orderedCleanup(mainCapability.webContentsId)
    if (collaborator !== undefined) options.disposeCollaborator?.(collaborator)
    for (const channel of installed.splice(0).reverse()) options.registrar.removeHandler?.(channel)
    options.multiplexer.setSinks(options.legacySinks)
  }
  try {
    collaborator = options.createCollaborator({
      onCapabilityRegistered: (capability) => { options.presence.register(capability) },
      onWindowState: (webContentsId, state) => { options.presence.setWindowState(webContentsId, state); refresh() },
      onWindowCleanup: orderedCleanup,
    })
    const handlers = options.createHandlers(collaborator)
    const seen = new Set<string>()
    for (const [channel, handler] of Object.entries(handlers)) {
      if (seen.has(channel)) throw new Error(`project-chat-duplicate-handler:${channel}`)
      seen.add(channel); options.registrar.handle(channel, handler); installed.push(channel)
    }
    mainCapability = options.capabilities.registerMainWindow(options.mainWindow.webContents.id)
    if (!mainCapability) throw new Error('project-chat-main-capability-invalid')
    options.presence.register(mainCapability)
    const updateMain = (visible: boolean, focused: boolean) => { options.presence.setWindowState(mainCapability!.webContentsId, { visible, focused }); refresh() }
    updateMain(options.mainWindow.isVisible(), options.mainWindow.isFocused())
    const listeners: Array<['focus' | 'show' | 'hide' | 'blur' | 'closed', () => void]> = [
      ['focus', () => updateMain(options.mainWindow.isVisible(), true)], ['show', () => updateMain(true, options.mainWindow.isFocused())],
      ['hide', () => updateMain(false, false)], ['blur', () => updateMain(options.mainWindow.isVisible(), false)], ['closed', () => orderedCleanup(mainCapability!.webContentsId)],
    ]
    for (const [event, listener] of listeners) options.mainWindow.on(event, listener)
    options.multiplexer.setSinks([options.broker as unknown as { publish(event: unknown): void }, options.taskHomeSink])
    return { broker: options.broker, dispose }
  } catch (error) {
    dispose()
    throw error
  }
}
