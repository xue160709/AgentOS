/**
 * 主进程侧缩略图生成与历史数据迁移。
 * Main-process thumbnail generation plus the one-time migration that shrinks
 * full-resolution `dataUrl` values written before the thumbnail policy existed.
 */

import { nativeImage } from 'electron'
import {
  ATTACHMENT_THUMBNAIL_MAX_EDGE,
  isOversizedAttachmentThumbnail,
  thumbnailSizeFor,
} from '../src/chat-attachment-thumbnail'
import type { ChatWorkspaceState } from '../src/components/types'

/**
 * Downscale an image data URL to a stored thumbnail. Returns the input when it
 * cannot be decoded, so an unsupported format degrades to today's behaviour
 * rather than losing the preview.
 */
export function shrinkAttachmentThumbnail(dataUrl: string): string {
  try {
    const image = nativeImage.createFromDataURL(dataUrl)
    if (image.isEmpty()) return dataUrl
    const { width, height } = image.getSize()
    const target = thumbnailSizeFor(width, height, ATTACHMENT_THUMBNAIL_MAX_EDGE)
    if (target.width >= width && target.height >= height) return dataUrl
    const resized = image.resize({ width: target.width, height: target.height, quality: 'good' })
    if (resized.isEmpty()) return dataUrl
    const shrunk = resized.toDataURL()
    // PNG re-encoding can beat the original only when it really is smaller.
    return shrunk.length < dataUrl.length ? shrunk : dataUrl
  } catch {
    return dataUrl
  }
}

export type AttachmentThumbnailMigrationResult = {
  state: ChatWorkspaceState
  changed: boolean
  shrunkCount: number
  bytesSaved: number
}

/**
 * Replace every oversized attachment thumbnail in the workspace. Runs once at
 * startup; threads whose attachments are already within policy are returned by
 * identity so an unchanged workspace triggers no write.
 */
export function migrateAttachmentThumbnails(state: ChatWorkspaceState): AttachmentThumbnailMigrationResult {
  let shrunkCount = 0
  let bytesSaved = 0

  const threads = state.threads.map((thread) => {
    let threadChanged = false
    const items = thread.chatState.items.map((item) => {
      if (item.type !== 'message' || !item.attachments?.length) return item
      let itemChanged = false
      const attachments = item.attachments.map((attachment) => {
        if (attachment.kind !== 'image' || !isOversizedAttachmentThumbnail(attachment.dataUrl)) return attachment
        const shrunk = shrinkAttachmentThumbnail(attachment.dataUrl)
        if (shrunk === attachment.dataUrl) return attachment
        itemChanged = true
        shrunkCount += 1
        bytesSaved += attachment.dataUrl.length - shrunk.length
        return { ...attachment, dataUrl: shrunk }
      })
      if (!itemChanged) return item
      threadChanged = true
      return { ...item, attachments }
    })
    return threadChanged ? { ...thread, chatState: { ...thread.chatState, items } } : thread
  })

  if (shrunkCount === 0) return { state, changed: false, shrunkCount: 0, bytesSaved: 0 }
  return { state: { ...state, threads }, changed: true, shrunkCount, bytesSaved }
}
