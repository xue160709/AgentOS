import type { LocalAppDefinition } from '../../src/components/types'
import type { RuntimeEditCoordinator, RuntimeEditIntent } from '../runtime-edit-coordinator'
import { inspectLocalAppDirectory, type LocalAppInspectResult } from './inspect'
import type { LocalAppRuntimeManager } from './manager'


/**
 * Narrow adapter from Agent edit facts to the Revision 5 Runtime. It owns no
 * edit/session state: the coordinator remains the generation fence, while the
 * Runtime remains the sole owner of dev processes, builds and last-good.
 */
export class RuntimeEditRuntimeBridge {
  private readonly activeDevelopmentConsumers = new Set<string>()

  constructor(private readonly options: {
    coordinator: Pick<RuntimeEditCoordinator, 'beginBuild' | 'completeBuild'>
    manager: Pick<LocalAppRuntimeManager, 'register' | 'start' | 'release' | 'build' | 'cancelBuild' | 'updateToLatest'>
    resolveDefinition: (projectId: string) => LocalAppDefinition | null
    inspect?: (rootPath: string) => Promise<LocalAppInspectResult>
  }) {}

  async handle(intent: RuntimeEditIntent): Promise<void> {
    if (intent.type === 'potential-run-registered') {
      // A new potential writer invalidates a currently settling generation.
      // Cancelling is bounded by the Runtime; a later build is started only by
      // the coordinator's newest settle intent.
      const definition = this.options.resolveDefinition(intent.projectId)
      if (definition) await this.options.manager.cancelBuild(definition.id)
      return
    }
    if (intent.type === 'agent-lease-acquired') {
      await this.startTemporaryDevelopment(intent.projectId, editConsumerId(intent.projectId, intent.requestId, intent.toolUseId))
      return
    }
    if (intent.type === 'agent-lease-released') {
      await this.releaseTemporaryDevelopment(intent.projectId, editConsumerId(intent.projectId, intent.requestId, intent.toolUseId))
      return
    }
    if (intent.type !== 'settle') return

    const definition = this.options.resolveDefinition(intent.projectId)
    if (!definition) return
    const inspected = await (this.options.inspect ?? inspectLocalAppDirectory)(definition.rootPath)
    // A served bundle catches up with the edit through the same freshness
    // path as every other checkpoint (`C-RSM-501/503`).
    if (inspected.ok && inspected.servePlan?.kind === 'production') {
      await this.options.manager.updateToLatest(definition.id)
      return
    }
    // Development-only, static-less and invalid declarations are deliberately
    // no-ops. There is no command inference path here.
    if (!inspected.ok || inspected.mode !== 'static' || !inspected.agentos) return
    const operationId = this.options.coordinator.beginBuild(intent.projectId, intent.editGeneration)
    if (!operationId) return
    try {
      this.options.manager.register({ ...definition, mode: 'static', agentos: inspected.agentos })
      await this.options.manager.build(definition.id)
    } finally {
      this.options.coordinator.completeBuild(intent.projectId, intent.editGeneration, operationId)
    }
  }

  private async startTemporaryDevelopment(projectId: string, consumerId: string): Promise<void> {
    const definition = this.options.resolveDefinition(projectId)
    if (!definition) return
    const inspected = await (this.options.inspect ?? inspectLocalAppDirectory)(definition.rootPath)
    // Editing a static workbench intentionally transitions it to its declared
    // npm development script so the page can update live. Static projects
    // without a dev script remain on their last-good artifact.
    if (!inspected.ok || (inspected.mode === 'static' && !inspected.hasDevScript)) return
    const developmentDefinition: LocalAppDefinition = inspected.mode === 'static'
      ? { ...definition, mode: 'development', agentos: undefined, serveScript: 'dev' }
      : { ...definition, mode: 'development', serveScript: 'dev' }
    this.options.manager.register(developmentDefinition)
    await this.options.manager.start(definition.id, consumerId)
    this.activeDevelopmentConsumers.add(consumerId)
  }

  private async releaseTemporaryDevelopment(projectId: string, consumerId: string): Promise<void> {
    if (!this.activeDevelopmentConsumers.delete(consumerId)) return
    const definition = this.options.resolveDefinition(projectId)
    if (!definition) return
    await this.options.manager.release(definition.id, consumerId)
  }
}

function editConsumerId(projectId: string, requestId: string, toolUseId: string): string {
  return `runtime-edit:${projectId}:${requestId}:${toolUseId}`
}

