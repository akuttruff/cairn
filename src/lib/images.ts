/**
 * A label photo, made ready to send: scaled so its longest edge is at most
 * MAX_EDGE and re-encoded as JPEG. The small print on a Nutrition Facts panel
 * needs more pixels than a vision model usually gets, so this is generous;
 * a phone photo is still 2-3x larger and only costs upload time.
 */
export const MAX_EDGE = 1600
export const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']

const readAsDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error ?? new Error('could not read the photo'))
    r.readAsDataURL(blob)
  })

const loadImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('that is not a readable photo'))
    img.src = url
  })

/** The photo as a data URL the server accepts. Where there is no canvas (tests), the file goes as it is. */
export async function prepareImage(file: File): Promise<string> {
  if (!ACCEPTED.includes(file.type)) throw new Error('Use a JPEG, PNG or WebP photo.')
  const original = await readAsDataUrl(file)
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null
  const ctx = canvas?.getContext?.('2d')
  if (!canvas || !ctx) return original
  const img = await loadImage(original)
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
  if (scale === 1 && file.type === 'image/jpeg') return original
  canvas.width = Math.round(img.naturalWidth * scale)
  canvas.height = Math.round(img.naturalHeight * scale)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.88)
}
