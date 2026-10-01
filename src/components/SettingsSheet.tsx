import { useEffect, useState } from 'react'
import { Drawer } from 'vaul'
import { toast } from 'sonner'
import { api } from '../lib/api.ts'
import { parseNum } from '../lib/format.ts'
import { DAY_TYPES } from '../types.ts'
import type { DayType, DayTypeGoals, Goals, LmModelOption, PublicSettings } from '../types.ts'

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

const MACRO_KEYS = ['protein', 'carbs', 'fat'] as const
type MacroKey = (typeof MACRO_KEYS)[number]
const MACRO_LABELS: Record<MacroKey, string> = { protein: 'Protein', carbs: 'Carbs', fat: 'Fat' }
const DAY_TYPE_LABELS: Record<DayType, string> = { training: 'Training day', rest: 'Rest day' }

/** A day type's macro ranges, as editable text. */
type ProfileDraft = Record<MacroKey, { min: string; max: string }>

const profileToDraft = (p: DayTypeGoals): ProfileDraft => ({
  protein: { min: String(p.protein.min), max: String(p.protein.max) },
  carbs: { min: String(p.carbs.min), max: String(p.carbs.max) },
  fat: { min: String(p.fat.min), max: String(p.fat.max) },
})

/** Parses a profile draft; null fields mean something didn't parse. */
function parseProfile(draft: ProfileDraft): { profile: DayTypeGoals | null; invalid: boolean } {
  const parsed: Record<MacroKey, { min: number | null; max: number | null }> = {
    protein: { min: parseNum(draft.protein.min), max: parseNum(draft.protein.max) },
    carbs: { min: parseNum(draft.carbs.min), max: parseNum(draft.carbs.max) },
    fat: { min: parseNum(draft.fat.min), max: parseNum(draft.fat.max) },
  }
  const invalid = MACRO_KEYS.some((k) => {
    const { min, max } = parsed[k]
    return min == null || max == null || min < 0 || max < min
  })
  if (invalid) return { profile: null, invalid: true }
  return {
    profile: {
      protein: { min: parsed.protein.min!, max: parsed.protein.max! },
      carbs: { min: parsed.carbs.min!, max: parsed.carbs.max! },
      fat: { min: parsed.fat.min!, max: parsed.fat.max! },
    },
    invalid: false,
  }
}

/** Calories implied by a macro profile's own ends -- same math as resolveGoals(), for a live preview. */
function derivedCalories(profile: DayTypeGoals): { min: number; max: number } {
  return {
    min: Math.round(profile.protein.min * 4 + profile.carbs.min * 4 + profile.fat.min * 9),
    max: Math.round(profile.protein.max * 4 + profile.carbs.max * 4 + profile.fat.max * 9),
  }
}

function ProfileFields({ dayType, draft, onChange }: {
  dayType: DayType
  draft: ProfileDraft
  onChange: (draft: ProfileDraft) => void
}) {
  const { profile, invalid } = parseProfile(draft)
  return (
    <div className={`profile-fields ${dayType}`}>
      <h3 className="sheet-h">{DAY_TYPE_LABELS[dayType]}</h3>
      <div className="nutrient-fields">
        {MACRO_KEYS.map((k) => (
          <div key={k} className={`field nf ${k}`}>
            <label htmlFor={`${dayType}-${k}-min`}>{MACRO_LABELS[k]} (g)</label>
            <div className="range-inputs">
              <input
                id={`${dayType}-${k}-min`}
                type="text"
                inputMode="decimal"
                aria-label={`${MACRO_LABELS[k]} minimum`}
                placeholder="min"
                value={draft[k].min}
                onChange={(e) => onChange({ ...draft, [k]: { ...draft[k], min: e.target.value } })}
              />
              <span className="range-sep">–</span>
              <input
                type="text"
                inputMode="decimal"
                aria-label={`${MACRO_LABELS[k]} maximum`}
                placeholder="max"
                value={draft[k].max}
                onChange={(e) => onChange({ ...draft, [k]: { ...draft[k], max: e.target.value } })}
              />
            </div>
          </div>
        ))}
      </div>
      {invalid && <div className="hint bad">Each field needs a non-negative number, with min not greater than max.</div>}
      {profile && (
        <div className="hint">
          Works out to {derivedCalories(profile).min}{'–'}{derivedCalories(profile).max} kcal.
        </div>
      )}
    </div>
  )
}

function SettingsForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [drafts, setDrafts] = useState<Record<DayType, ProfileDraft> | null>(null)
  const [fiberDraft, setFiberDraft] = useState('')
  const [waterDraft, setWaterDraft] = useState('')
  const [alcoholDraft, setAlcoholDraft] = useState('')
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
      setDrafts({ training: profileToDraft(g.training), rest: profileToDraft(g.rest) })
      setFiberDraft(String(g.fiber))
      setWaterDraft(String(g.water))
      setAlcoholDraft(String(g.alcoholWeekly))
    }).catch((err) => toast.error((err as Error).message))
    api.settings().then(setSettings).catch(() => { /* the placeholder just stays generic */ })
    api.lmModels()
      .then((r) => { setModels(Array.isArray(r.models) ? r.models : []); setModelsError(r.error ?? null) })
      .catch(() => { /* the picker just offers "whichever is loaded" */ })
  }, [])

  const chosenModel = lmModel ?? settings?.researchModel ?? ''

  const training = drafts ? parseProfile(drafts.training) : { profile: null, invalid: true }
  const rest = drafts ? parseProfile(drafts.rest) : { profile: null, invalid: true }
  const fiber = parseNum(fiberDraft)
  const fiberInvalid = fiber == null || fiber < 0
  const water = parseNum(waterDraft)
  const waterInvalid = water == null || water < 0
  const alcoholWeekly = parseNum(alcoholDraft)
  const alcoholInvalid = alcoholWeekly == null || alcoholWeekly < 0
  const formInvalid = !drafts || training.invalid || rest.invalid || fiberInvalid || waterInvalid || alcoholInvalid

  const save = async (): Promise<void> => {
    if (formInvalid || !training.profile || !rest.profile) return
    setBusy(true)
    try {
      const next: Goals = { training: training.profile, rest: rest.profile, fiber: fiber!, water: water!, alcoholWeekly: alcoholWeekly! }
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

  return (
    <>
          <div className="drawer-scroll" data-vaul-no-drag>
            {!drafts && <div className="hint">Loading…</div>}
            {drafts && DAY_TYPES.map((dayType) => (
              <ProfileFields
                key={dayType}
                dayType={dayType}
                draft={drafts[dayType]}
                onChange={(d) => setDrafts({ ...drafts, [dayType]: d })}
              />
            ))}

            <div className="field">
              <label htmlFor="goal-fiber">Fiber (g)</label>
              <input
                id="goal-fiber"
                type="text"
                inputMode="decimal"
                value={fiberDraft}
                onChange={(e) => setFiberDraft(e.target.value)}
              />
              <div className="hint">Same target on any day type.</div>
              {fiberInvalid && <div className="hint bad">Fiber needs a non-negative number.</div>}
            </div>

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

            <div className="field">
              <label htmlFor="goal-alcohol">Alcohol (drinks per week)</label>
              <input
                id="goal-alcohol"
                type="text"
                inputMode="decimal"
                value={alcoholDraft}
                onChange={(e) => setAlcoholDraft(e.target.value)}
              />
              <div className="hint">A weekly cap, not a daily one -- shown against the running total for the week.</div>
              {alcoholInvalid && <div className="hint bad">Alcohol needs a non-negative number.</div>}
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
