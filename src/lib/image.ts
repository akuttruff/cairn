/**
 * A photo, made small enough to send: the model reads a label fine at a
 * thousand pixels or so, and a phone's 12-megapixel shot would be several
 * megabytes of JSON for nothing. The browser applies the photo's EXIF
 * rotation when it decodes it, so the result is upright too.
 */
export const LABEL_MAX_SIDE = 1280

export async function shrinkImage(file: Blob, maxSide = LABEL_MAX_SIDE): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error("Couldn't open that picture. Try a JPEG or PNG."))
      el.src = url
    })
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error("This browser can't resize pictures.")
    // A label on a transparent PNG (a screenshot crop) stays readable on white.
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.85)
  } finally {
    URL.revokeObjectURL(url)
  }
}
