/**
 * The picture a paste or a drop carries, if any. Both arrive as a
 * DataTransfer: a screenshot pasted from the clipboard, or a file dragged in
 * from the desktop or another window. During dragover the browser withholds
 * the files themselves, so `carriesPicture` goes by kind and type alone, which
 * is what decides whether the drop is allowed at all.
 */

const isPicture = (type: string): boolean => type.startsWith('image/')

export function carriesPicture(dt: DataTransfer | null | undefined): boolean {
  if (!dt) return false
  return Array.from(dt.items ?? []).some((item) => item.kind === 'file' && isPicture(item.type))
}

/** The first picture among what was pasted or dropped; null when there is none. */
export function pictureOf(dt: DataTransfer | null | undefined): File | null {
  if (!dt) return null
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind !== 'file' || !isPicture(item.type)) continue
    const file = item.getAsFile()
    if (file) return file
  }
  // Some browsers list a dropped file under files alone.
  for (const file of Array.from(dt.files ?? [])) if (isPicture(file.type)) return file
  return null
}
