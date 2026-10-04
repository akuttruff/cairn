import { useEffect, useState } from 'react'
import { Drawer } from 'vaul'
import { toast } from 'sonner'
import { api } from '../lib/api.ts'
import { parseNum } from '../lib/format.ts'
import type { Goals, LmModelOption, PublicSettings } from '../types.ts'

interface SettingsSheetProps {
  open: boolean
  session: number
  onClose: () => void
  onSaved: () => void
}

export default function SettingsSheet({ open, session, onClose, onSaved }: SettingsSheetProps) {
  return (
    <Drawer.Root open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <Drawer.Portal>
        <Drawer.Overlay className="drawer-overlay" />
        <Drawer.Content className="drawer-content" aria-describedby={undefined}>
          <div className="drawer-handle" />
          <Drawer.Title className="drawer-title">Daily goals</Drawer.Title>
          {open && <SettingsForm key={session} onClose={onClose} onSaved={onSaved} />}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

/** The number fields, as typed; each is parsed and checked on every render. */
type NumberField = 'protein' | 'fat' | 'carbs' | 'trainingCarbs' | 'calorieBuffer' | 'fiber' | 'water' | 'alcoholWeekly' | 'workoutsWeekly' | 'meditationMinutes'
const NUMBER_FIELDS: { key: NumberField; label: string; hint?: string }[] = [
  { key: 'protein', label: 'Protein (g)' },
  { key: 'fat', label: 'Fat (g)' },
  { key: 'carbs', label: 'Carbs (g)' },
  { key: 'trainingCarbs', label: 'Extra carbs on training days (g)', hint: 'Fast carbs before the workout; 35 g is about 140 kcal. Tick a day as a training day in Day view.' },
  { key: 'calorieBuffer', label: 'Calorie buffer (kcal)', hint: 'Added to the calorie goal every day, on top of what the macros add up to.' },
  { key: 'fiber', label: 'Fiber (g)', hint: 'Same target on any day.' },
  { key: 'water', label: 'Water (oz)', hint: 'Defaults to 96oz -- 3 x 32oz bottles.' },
  { key: 'alcoholWeekly', label: 'Alcohol (drinks per week)', hint: 'A weekly cap, not a daily one -- shown against the running total for the week.' },
  { key: 'workoutsWeekly', label: 'Workouts (sessions per week)', hint: 'Counted Monday to Sunday. Logging a WOD or weightlifting session also ticks the day as a training day.' },
  { key: 'meditationMinutes', label: 'Meditation (minutes per day)', hint: 'Sits are 25 minutes each, so 50 is two a day.' },
]

/** Calories the macros add up to at 4/4/9 -- the same math as resolveGoals(), for a live preview. */
const kcal = (protein: number, fat: number, carbs: number, buffer = 0): number => Math.round(protein * 4 + carbs * 4 + fat * 9 + buffer)

function SettingsForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [drafts, setDrafts] = useState<Record<NumberField, string> | null>(null)
  const [key, setKey] = useState('')
  const [lmUrl, setLmUrl] = useState<string | null>(null)
  const [lmToken, setLmToken] = useState('')
  const [lmModel, setLmModel] = useState<string | null>(null)
  const [autoLookup, setAutoLookup] = useState<boolean | null>(null)
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [models, setModels] = useState<LmModelOption[]>([])
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.goals().then((g) => {
      setDrafts({
        protein: String(g.protein), fat: String(g.fat), carbs: String(g.carbs), trainingCarbs: String(g.trainingCarbs), calorieBuffer: String(g.calorieBuffer),
        fiber: String(g.fiber), water: String(g.water), alcoholWeekly: String(g.alcoholWeekly),
        workoutsWeekly: String(g.workoutsWeekly), meditationMinutes: String(g.meditationMinutes),
      })
    }).catch((err) => toast.error((err as Error).message))
    api.settings().then(setSettings).catch(() => { /* the placeholder just stays generic */ })
    api.lmModels()
      .then((r) => { setModels(Array.isArray(r.models) ? r.models : []); setModelsError(r.error ?? null) })
      .catch(() => { /* the picker just offers "whichever is loaded" */ })
  }, [])

  const chosenModel = lmModel ?? settings?.researchModel ?? ''

  const parsed = drafts
    ? Object.fromEntries(NUMBER_FIELDS.map((f) => [f.key, parseNum(drafts[f.key])])) as Record<NumberField, number | null>
    : null
  const invalid = parsed ? NUMBER_FIELDS.filter((f) => parsed[f.key] == null || parsed[f.key]! < 0).map((f) => f.key) : []
  const formInvalid = !parsed || invalid.length > 0
  // The preview leaves the buffer out while it's being typed wrong, rather than hiding the whole line.
  const buffer = parsed && !invalid.includes('calorieBuffer') ? parsed.calorieBuffer! : 0

  const save = async (): Promise<void> => {
    if (!parsed || formInvalid) return
    setBusy(true)
    try {
      const next: Goals = {
        protein: parsed.protein!, fat: parsed.fat!, carbs: parsed.carbs!, trainingCarbs: parsed.trainingCarbs!, calorieBuffer: parsed.calorieBuffer!,
        fiber: parsed.fiber!, water: parsed.water!, alcoholWeekly: parsed.alcoholWeekly!,
        workoutsWeekly: parsed.workoutsWeekly!, meditationMinutes: parsed.meditationMinutes!,
      }
      await api.setGoals(next)
      const changes: Parameters<typeof api.setSettings>[0] = {}
      if (key.trim()) changes.usdaApiKey = key.trim()
      if (lmToken.trim()) changes.lmStudioToken = lmToken.trim()
      if (lmUrl != null && lmUrl.trim() !== settings?.lmStudioUrl) changes.lmStudioUrl = lmUrl.trim()
      if (lmModel != null && lmModel.trim() !== settings?.researchModel) changes.researchModel = lmModel.trim()
      if (autoLookup != null && autoLookup !== settings?.autoLookup) changes.autoLookup = autoLookup
      if (Object.keys(changes).length) await api.setSettings(changes)
      toast.success('Saved')
      onSaved()
      onClose()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const field = (f: (typeof NUMBER_FIELDS)[number]) => drafts && (
    <div key={f.key} className={`field nf ${f.key}`}>
      <label htmlFor={`goal-${f.key}`}>{f.label}</label>
      <input
        id={`goal-${f.key}`}
        type="text"
        inputMode="decimal"
        value={drafts[f.key]}
        onChange={(e) => setDrafts({ ...drafts, [f.key]: e.target.value })}
      />
      {f.hint && <div className="hint">{f.hint}</div>}
      {invalid.includes(f.key) && <div className="hint bad">Needs a non-negative number.</div>}
    </div>
  )

  return (
    <>
          <div className="drawer-scroll" data-vaul-no-drag>
            {!drafts && <div className="hint">Loading…</div>}
            <div className="nutrient-fields">
              {NUMBER_FIELDS.slice(0, 3).map(field)}
            </div>
            {parsed && !invalid.includes('protein') && !invalid.includes('fat') && !invalid.includes('carbs') && (
              <div className="hint">
                Every day: {kcal(parsed.protein!, parsed.fat!, parsed.carbs!, buffer)} kcal
                {buffer > 0 && <> ({kcal(parsed.protein!, parsed.fat!, parsed.carbs!)} from the macros + {buffer} buffer)</>}.
                {!invalid.includes('trainingCarbs') && (
                  <> Training days: {kcal(parsed.protein!, parsed.fat!, parsed.carbs! + parsed.trainingCarbs!, buffer)} kcal
                  with {parsed.carbs! + parsed.trainingCarbs!} g carbs.</>
                )}
              </div>
            )}
            {NUMBER_FIELDS.slice(3).map(field)}

            <h3 className="sheet-h">Food search</h3>
            <div className="field">
              <label htmlFor="usda-key">USDA API key</label>
              <input
                id="usda-key"
                type="text"
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                placeholder={settings?.hasUsdaKey ? 'saved — type to replace' : 'optional'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <div className="hint">
                Without one, whole-food search shares USDA&apos;s demo key: 30 searches
                an hour. A free key from <b>api.data.gov/signup</b> allows 1,000.
                It&apos;s kept on the server and never sent back to this page.
              </div>
            </div>

            <h3 className="sheet-h">Online lookup</h3>
            <div className="hint">
              “Look up online” asks your LM Studio model to research a food with the{' '}
              <b>mcp/deep-research</b> MCP. LM Studio needs that server in its mcp.json.
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={autoLookup ?? settings?.autoLookup ?? true}
                onChange={(e) => setAutoLookup(e.target.checked)}
              />
              Look up online automatically
            </label>
            <div className="hint" style={{ marginTop: -8 }}>
              Starts once you pause typing a search. Each lookup keeps your model busy for a minute or two;
              turn this off to start them with a button instead.
            </div>
            <div className="field">
              <label htmlFor="lm-url">LM Studio address</label>
              <input
                id="lm-url"
                type="text"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={lmUrl ?? settings?.lmStudioUrl ?? ''}
                placeholder="http://127.0.0.1:1234"
                onChange={(e) => setLmUrl(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="lm-token">LM Studio API token</label>
              <input
                id="lm-token"
                type="text"
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                placeholder={settings?.hasLmStudioToken ? 'saved — paste to replace' : 'needed when authentication is on'}
                value={lmToken}
                onChange={(e) => setLmToken(e.target.value)}
              />
              <div className="hint">Paste it rather than typing: tokens are case-sensitive. Kept on the server only.</div>
            </div>
            <div className="field">
              <label htmlFor="lm-model">Model</label>
              <select id="lm-model" value={chosenModel} onChange={(e) => setLmModel(e.target.value)}>
                <option value="">Whichever is loaded</option>
                {/* A saved choice LM Studio doesn't list (or can't be asked) stays selectable. */}
                {chosenModel && !models.some((m) => m.key === chosenModel) && <option value={chosenModel}>{chosenModel}</option>}
                {models.map((m) => <option key={m.key} value={m.key}>{m.key}{m.loaded ? ' (loaded)' : ''}</option>)}
              </select>
              {modelsError
                ? <div className="hint bad">{modelsError}</div>
                : (
                  <div className="hint">
                    LM Studio loads a model that isn&apos;t loaded yet the first time a lookup asks for it. Leave this on
                    &ldquo;whichever is loaded&rdquo; and lookups fail whenever nothing is loaded, as after a restart.
                  </div>
                )}
            </div>
          </div>
          <div className="drawer-actions">
            <div className="row">
              <button type="button" onClick={onClose}>Cancel</button>
              <button
                type="button"
                className="primary"
                disabled={busy || formInvalid}
                onClick={() => void save()}
              >
                Save
              </button>
            </div>
          </div>
    </>
  )
}
