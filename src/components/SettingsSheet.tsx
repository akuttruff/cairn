import { useEffect, useState } from 'react'
import { Drawer } from 'vaul'
import { toast } from 'sonner'
import { api } from '../lib/api.ts'
import { LABELS, UNITS } from '../lib/nutrition.ts'
import { parseNum } from '../lib/format.ts'
import { NUTRIENTS } from '../types.ts'
import type { Goals, LmModelOption, NutrientKey, PublicSettings } from '../types.ts'

interface SettingsSheetProps {
  open: boolean
  session: number
  goals: Goals | null
  onClose: () => void
  onSaved: () => void
}

export default function SettingsSheet({ open, session, goals, onClose, onSaved }: SettingsSheetProps) {
  return (
    <Drawer.Root open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <Drawer.Portal>
        <Drawer.Overlay className="drawer-overlay" />
        <Drawer.Content className="drawer-content" aria-describedby={undefined}>
          <div className="drawer-handle" />
          <Drawer.Title className="drawer-title">Daily goals</Drawer.Title>
          {goals && <SettingsForm key={session} goals={goals} onClose={onClose} onSaved={onSaved} />}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

function SettingsForm({ goals, onClose, onSaved }: { goals: Goals; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<Record<NutrientKey, string>>(() => ({
    calories: String(goals.calories), protein: String(goals.protein), fat: String(goals.fat),
    carbs: String(goals.carbs), fiber: String(goals.fiber),
  }))
  const [waterDraft, setWaterDraft] = useState(String(goals.water))
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
    api.settings().then(setSettings).catch(() => { /* the placeholder just stays generic */ })
    api.lmModels()
      .then((r) => { setModels(Array.isArray(r.models) ? r.models : []); setModelsError(r.error ?? null) })
      .catch(() => { /* the picker just offers "whichever is loaded" */ })
  }, [])

  const chosenModel = lmModel ?? settings?.researchModel ?? ''

  const parsed = Object.fromEntries(NUTRIENTS.map((k) => [k, parseNum(draft[k])])) as Record<NutrientKey, number | null>
  const invalid = NUTRIENTS.filter((k) => parsed[k] == null || parsed[k]! < 0)
  const macroKcal = (parsed.protein ?? 0) * 4 + (parsed.carbs ?? 0) * 4 + (parsed.fat ?? 0) * 9
  const water = parseNum(waterDraft)
  const waterInvalid = water == null || water < 0

  const save = async (): Promise<void> => {
    if (invalid.length || waterInvalid) return
    setBusy(true)
    try {
      await api.setGoals({ ...parsed, water } as Goals)
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

  return (
    <>
          <div className="drawer-scroll" data-vaul-no-drag>
            <div className="nutrient-fields">
              {NUTRIENTS.map((k) => (
                <div key={k} className={`field nf ${k}`}>
                  <label htmlFor={`goal-${k}`}>{LABELS[k]} ({UNITS[k]})</label>
                  <input
                    id={`goal-${k}`}
                    type="text"
                    inputMode="decimal"
                    value={draft[k]}
                    onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                  />
                </div>
              ))}
            </div>
            {invalid.length > 0 && <div className="hint bad">Each goal needs a non-negative number.</div>}
            {invalid.length === 0 && parsed.calories! > 0 && (
              <div className="hint">
                Protein, fat and carb goals add up to {Math.round(macroKcal)} kcal
                ({Math.round((macroKcal / parsed.calories!) * 100)}% of your calorie goal).
              </div>
            )}

            <div className="field">
              <label htmlFor="goal-water">Water (oz)</label>
              <input
                id="goal-water"
                type="text"
                inputMode="decimal"
                value={waterDraft}
                onChange={(e) => setWaterDraft(e.target.value)}
              />
              <div className="hint">Defaults to 96oz -- 3 x 32oz bottles.</div>
              {waterInvalid && <div className="hint bad">Water needs a non-negative number.</div>}
            </div>

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
              <button type="button" className="primary" disabled={busy || invalid.length > 0 || waterInvalid} onClick={() => void save()}>Save</button>
            </div>
          </div>
    </>
  )
}
