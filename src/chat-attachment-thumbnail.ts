/**
 * 附件缩略图策略：`dataUrl` 只承载 UI 缩略图，不承载原图。
 * Attachment thumbnail policy shared by Main and the renderer.
 *
 * `ClaudeChatAttachment.dataUrl` is documented as a UI thumbnail, but both
 * ingest paths used to store the full-resolution image there. It is the only
 * attachment field that survives normalization into the durable workspace, so a
 * single pasted screenshot could add megabytes to every subsequent workspace
 * read, write, and broker snapshot. The image is only ever painted into a 42px
 * `.attachment-thumb` box, so the stored form is capped here.
 */

/** Longest edge kept for a stored thumbnail; 42px box at up to ~3.8x DPI. */
export const ATTACHMENT_THUMBNAIL_MAX_EDGE = 160

/**
 * A correctly sized 160px thumbnail lands far below this. Anything larger is a
 * full-resolution image that predates the thumbnail policy (or came from a path
 * that could not downscale) and should be shrunk before it is persisted again.
 */
export const ATTACHMENT_THUMBNAIL_MAX_CHARS = 48_000

/** True when a stored dataUrl is too large to be a thumbnail. */
export function isOversizedAttachmentThumbnail(dataUrl: string | undefined): dataUrl is string {
  return typeof dataUrl === 'string' && dataUrl.length > ATTACHMENT_THUMBNAIL_MAX_CHARS
}

/** Target box for a source image, preserving aspect ratio and never upscaling. */
export function thumbnailSizeFor(width: number, height: number, maxEdge = ATTACHMENT_THUMBNAIL_MAX_EDGE): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: maxEdge, height: maxEdge }
  }
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) }
  const scale = maxEdge / longest
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}
