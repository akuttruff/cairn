import { useEffect, useState } from 'react'
import { Drawer } from 'vaul'
import { toast } from 'sonner'
import { api } from '../lib/api.ts'
import { LABELS, UNITS } from '../lib/nutrition.ts'
import { parseNum } from '../lib/format.ts'
import { NUTRIENTS } from '../types.ts'
import type { Goals, NutrientKey, PublicSettings } from '../types.ts'

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
  const [key, setKey] = useState('')
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.settings().then(setSettings).catch(() => { /* the placeholder just stays generic */ })
  }, [])

  const parsed = Object.fromEntries(NUTRIENTS.map((k) => [k, parseNum(draft[k])])) as Record<NutrientKey, number | null>
  const invalid = NUTRIENTS.filter((k) => parsed[k] == null || parsed[k]! < 0)
  const macroKcal = (parsed.protein ?? 0) * 4 + (parsed.carbs ?? 0) * 4 + (parsed.fat ?? 0) * 9

  const save = async (): Promise<void> => {
    if (invalid.length) return
    setBusy(true)
    try {
      await api.setGoals(parsed as Goals)
      if (key.trim()) await api.setSettings({ usdaApiKey: key.trim() })
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
          </div>
          <div className="drawer-actions">
            <div className="row">
              <button type="button" onClick={onClose}>Cancel</button>
              <button type="button" className="primary" disabled={busy || invalid.length > 0} onClick={() => void save()}>Save</button>
            </div>
          </div>
    </>
  )
}
