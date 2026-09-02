/**
 * A2UI 卡片渲染面：Home Plugin 卡片的 A2UI runtime 宿主。
 * A2UI card renderer. Split out of ProjectHomeSurface so the @a2ui runtime and
 * its lit dependency load on demand instead of sitting in the first-paint
 * bundle: the project home shell paints without them, and only cards that are
 * actually A2UI-rendered pay for the runtime.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { A2uiSurface, basicCatalog, MarkdownContext, type ReactComponentImplementation } from '@a2ui/react/v0_9'
import { MessageProcessor, type A2uiClientAction, type A2uiMessage, type SurfaceModel } from '@a2ui/web_core/v0_9'
import { renderMarkdown } from './markdown'

export type A2uiCardSurfaceProps = {
  messages: A2uiMessage[]
  projectPath: string
  onEdit: () => void
}

/** Markdown 上下文 + A2UI 表面，一起构成卡片的可渲染单元。 */
export function A2uiCardSurface({ messages, projectPath, onEdit }: A2uiCardSurfaceProps) {
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
    <MarkdownContext.Provider value={(text) => Promise.resolve(renderMarkdown(text))}>
      <div className="project-home-surface">
        {surfaces.map((surface) => (
          <A2uiSurface key={`${surface.id}:${revision}`} surface={surface} />
        ))}
      </div>
    </MarkdownContext.Provider>
  )
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
