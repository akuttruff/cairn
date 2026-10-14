import { useState } from 'react'
import { Drawer } from 'vaul'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../lib/api.ts'
import { MEAL_LABELS } from '../lib/format.ts'
import { MEALS } from '../types.ts'
import type { Food, Meal, MealPreset, NewEntry } from '../types.ts'
import { Amount } from './add/Amount.tsx'
import { ManualTab } from './add/ManualTab.tsx'
import { MineTab } from './add/MineTab.tsx'
import { SearchTab } from './add/SearchTab.tsx'

type Tab = 'search' | 'mine' | 'manual'

interface AddSheetProps {
  open: boolean
  /** Changes on every opening, so each one starts fresh. */
  session: number
  date: string
  meal: Meal
  onClose: () => void
  onLogged: () => void
}

export default function AddSheet({ open, session, onClose, ...rest }: AddSheetProps) {
  return (
    <Drawer.Root open={open} onOpenChange={(v) => { if (!v) onClose() }} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="drawer-overlay" />
        <Drawer.Content className="drawer-content tall" aria-describedby={undefined}>
          <div className="drawer-handle" />
          <AddBody key={session} open={open} onClose={onClose} {...rest} />
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

function AddBody({ open, date, meal: initialMeal, onClose, onLogged }: Omit<AddSheetProps, 'session'>) {
  const [tab, setTab] = useState<Tab>('mine')
  const [meal, setMeal] = useState<Meal>(initialMeal)
  const [picked, setPicked] = useState<Food | null>(null)

  const log = async (entry: Omit<NewEntry, 'date' | 'meal'>): Promise<void> => {
    try {
      await api.addEntry({ ...entry, date, meal })
      toast.success(`Logged ${entry.name}`)
      onLogged()
      onClose()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const applyMeal = async (preset: MealPreset): Promise<void> => {
    try {
      await api.applyMeal(preset.id, date, meal)
      toast.success(`Logged ${preset.name}`)
      onLogged()
      onClose()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <>
          <div className="sheet-top">
            {picked && (
              <button type="button" className="icon-btn" aria-label="Back to results" onClick={() => setPicked(null)}>
                <ArrowLeft size={18} aria-hidden="true" />
              </button>
            )}
            <Drawer.Title className="drawer-title">Add to</Drawer.Title>
            <select className="meal-select" aria-label="Meal" value={meal} onChange={(e) => setMeal(e.target.value as Meal)}>
              {MEALS.map((m) => <option key={m} value={m}>{MEAL_LABELS[m]}</option>)}
            </select>
          </div>

          {picked
            ? <Amount food={picked} onChange={setPicked} onLog={log} />
            : (
              <>
                <div className="tabs" role="tablist">
                  {(['mine', 'search', 'manual'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="tab"
                      aria-selected={tab === t}
                      className={tab === t ? 'active' : ''}
                      onClick={() => setTab(t)}
                    >
                      {t === 'search' ? 'Search' : t === 'mine' ? 'My foods' : 'Manual'}
                    </button>
                  ))}
                </div>
                {tab === 'search' && <SearchTab open={open} onPick={setPicked} />}
                {tab === 'mine' && <MineTab onPick={setPicked} onApplyMeal={applyMeal} />}
                {tab === 'manual' && <ManualTab onLog={log} onSaved={() => setTab('mine')} />}
              </>
            )}
    </>
  )
}

// ---------------------------------------------------------------------------
