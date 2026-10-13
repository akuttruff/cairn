import { chatText, chooseModel, extractJson } from './research.ts'
import { NUTRIENTS } from '../src/types.ts'
import type { LabelReading, Nutrients, Settings } from '../src/types.ts'

/**
 * Reading a nutrition label from a photo (or a screenshot of one): a vision
 * model in LM Studio looks at the picture and answers in JSON, which fills
 * in the Manual tab for a person to check before anything is logged. The
 * numbers are validated but can still be misread, as any label can be.
 */

/** Cold, a vision model takes a while to load; warm, a label reads in seconds. */
export const LABEL_TIMEOUT_MS = 180_000
/** A downscaled phone photo is well under this; a raw one is refused rather than sent to the model. */
export const LABEL_MAX_BYTES = 8_000_000
export const LABEL_MAX_TOKENS = 400

export const LABEL_PROMPT = [
  'You read nutrition labels. The image is a food label (a photo or a screenshot). Reply with ONLY a JSON object',
  '-- no prose before or after:',
  '{"name": string|null, "brand": string|null, "serving": {"label": string, "grams": number|null},',
  ' "nutrients": {"calories": number|null, "protein": number|null, "fat": number|null, "carbs": number|null, "fiber": number|null},',
  ' "note": string|null}',
  'Rules:',
  '- Nutrients are for ONE serving as the label states it ("1 cup", "2 cookies", "1/4 pkg"), in kcal and grams.',
  '- If the label gives per 100 g and per serving, use the per-serving column. If it gives only per 100 g, the serving is "100 g" with grams 100.',
  '- serving.grams is the serving weight printed on the label (e.g. "1 cup (240g)" is 240); null if not printed. Never estimate.',
  '- fat is total fat; carbs is total carbohydrate; fiber is dietary fiber. Calories may be printed as Energy in kcal; ignore kJ.',
  '- name and brand only if the picture shows them (the front of a package); otherwise null. Never invent them.',
  '- Use null for anything not legible. If the image is not a nutrition label, reply {"name": null, "brand": null,',
  '  "serving": {"label": "", "grams": null}, "nutrients": {"calories": null, "protein": null, "fat": null, "carbs": null, "fiber": null}, "note": "<what it is>"}.',
].join('\n')

const num = (v: unknown, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < max ? Math.round(v * 100) / 100 : null

const str = (v: unknown, max = 200): string | null =>
  (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

/** A JPEG, PNG or WebP as a base64 data URL, and nothing else: the only thing the model is sent. */
export function isImageDataUrl(v: unknown): v is string {
  return typeof v === 'string' && v.length <= LABEL_MAX_BYTES && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(v)
}

/**
 * The reading the model's JSON describes, or null when it read no numbers
 * at all (the picture was not a label, or nothing on it was legible).
 */
export function toReading(data: unknown, model: string): LabelReading | null {
  const obj = (data && typeof data === 'object' ? data : {}) as {
    name?: unknown; brand?: unknown; serving?: { label?: unknown; grams?: unknown }; nutrients?: Record<string, unknown>; note?: unknown
  }
  const nutrients = {} as Nutrients
  for (const key of NUTRIENTS) nutrients[key] = num(obj.nutrients?.[key], key === 'calories' ? 10_000 : 1_000)
  if (NUTRIENTS.every((key) => nutrients[key] == null)) return null
  const grams = num(obj.serving?.grams, 5_000)
  const reading: LabelReading = {
    name: str(obj.name),
    brand: str(obj.brand),
    serving: { label: str(obj.serving?.label, 100) ?? '1 serving', grams: grams && grams > 0 ? grams : null },
    nutrients,
    model,
  }
  const note = str(obj.note, 500)
  if (note) reading.note = note
  return reading
}

/** Read one label image with the label model (else whichever vision model LM Studio has). */
export async function readLabel(image: string, settings: Settings, fetchImpl: typeof fetch): Promise<LabelReading> {
  const signal = AbortSignal.timeout(LABEL_TIMEOUT_MS)
  const { model, reasoning } = await chooseModel(settings, fetchImpl, signal, settings.labelModel, true)
  const body: Record<string, unknown> = {
    model,
    system_prompt: LABEL_PROMPT,
    input: [
      { type: 'text', content: 'Read this nutrition label.' },
      { type: 'image', data_url: image },
    ],
    max_output_tokens: LABEL_MAX_TOKENS,
  }
  if (reasoning) body.reasoning = reasoning
  const text = await chatText(settings, body, fetchImpl, signal)
  const reading = toReading(extractJson(text), model)
  if (!reading) {
    const why = str((extractJson(text) as { note?: unknown } | null)?.note, 200)
    throw new Error(why ? `Couldn't read a nutrition label there: ${why}` : "Couldn't read a nutrition label in that picture. Try a closer, straighter shot.")
  }
  return reading
}
