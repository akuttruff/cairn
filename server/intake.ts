import { chatText, chooseModel, extractJson, toFoods } from './research.ts'
import type { Food, Settings } from '../src/types.ts'

/**
 * Another way in than typing a name: a photo of a Nutrition Facts panel,
 * read by the model.
 */

// ---------------------------------------------------------------------------
// A photo of a label
// ---------------------------------------------------------------------------

export const LABEL_PROMPT = [
  'You read Nutrition Facts panels from photos. Reply with ONLY a JSON object -- no prose before or after:',
  '{"found": boolean, "items": [{"name": string, "brand": string|null,',
  ' "serving": {"label": string, "grams": number|null},',
  ' "nutrients": {"calories": number, "protein": number|null, "fat": number|null, "carbs": number|null, "fiber": number|null},',
  ' "other_servings": [{"label": string, "grams": number}], "source_url": null}], "note": string}',
  'Rules:',
  '- One item: the product in the photo. Nutrients are for ONE serving, exactly as printed in the per-serving column.',
  '- serving.label is the household measure as printed, without the weight ("2/3 cup", "1 bar", "2 cookies");',
  '  serving.grams is the weight printed beside it, or null if none is printed. Never estimate a weight.',
  '- carbs is Total Carbohydrate; fiber is Dietary Fiber; fat is Total Fat; calories is Calories.',
  '- If the panel also gives a per-container column and the container weight can be read or worked out from',
  '  "servings per container" times the serving weight, add {"label": "1 container", "grams": <weight>} to other_servings.',
  '- name and brand come from the packaging if visible; otherwise name the food from the panel\'s context, brand null.',
  '- If a number is unreadable, use null for it. If there is no readable Nutrition Facts panel,',
  '  reply {"found": false, "items": [], "note": "<what the photo shows instead>"}.',
  '- Mention anything doubtful (a blurry figure, a cropped panel) in note.',
].join('\n')

const LABEL_MAX_TOKENS = 600

export interface LabelImage {
  /** A data URL: data:image/jpeg;base64,... */
  dataUrl: string
}

export interface LabelResult {
  foods: Food[]
  note?: string
  model: string
  seconds: number
}

/** Read one label photo into a food, ready to log or correct. */
export async function readLabel(image: LabelImage, hint: string, settings: Settings, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<LabelResult> {
  const started = Date.now()
  const { model, reasoning, vision } = await chooseModel(settings, fetchImpl, signal)
  if (vision === false) throw new Error(`${model} can't look at pictures. Choose a model that can in Settings.`)
  const body: Record<string, unknown> = {
    model,
    system_prompt: LABEL_PROMPT,
    input: [
      { type: 'text', content: hint.trim() ? `Read this nutrition label. The product is: ${hint.trim()}` : 'Read this nutrition label.' },
      { type: 'image', data_url: image.dataUrl },
    ],
    max_output_tokens: LABEL_MAX_TOKENS,
  }
  if (reasoning) body.reasoning = reasoning
  const text = await chatText(settings, body, fetchImpl, signal)
  const data = extractJson(text)
  if (data == null) throw new Error("The model's answer wasn't in the expected format. Try again.")
  const { foods, note } = toFoods(data, hint.trim() || 'Scanned label')
  return {
    // What a label says is the product's own word for itself, not something found on the web.
    foods: foods.map((f) => ({ ...f, id: f.id.replace(/^web:/, 'label:'), source: 'custom' as const, sources: undefined })),
    note,
    model,
    seconds: Math.round((Date.now() - started) / 1000),
  }
}
