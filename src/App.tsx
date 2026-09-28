import { useState } from 'react'
import { Toaster } from 'sonner'
import { Plus } from 'lucide-react'
import Header from './components/Header.tsx'
import Totals from './components/Totals.tsx'
import WaterTracker from './components/WaterTracker.tsx'
import MealList from './components/MealList.tsx'
import AddSheet from './components/AddSheet.tsx'
import EntrySheet from './components/EntrySheet.tsx'
import SettingsSheet from './components/SettingsSheet.tsx'
import useDay from './hooks/useDay.ts'
import { mealForHour } from './lib/nutrition.ts'
import type { Entry, Meal } from './types.ts'
import './App.css'

type Sheet = 'add' | 'entry' | 'settings' | null

export default function App() {
  const day = useDay()
  const [sheet, setSheet] = useState<Sheet>(null)
  // Bumped on every opening so a sheet's form starts fresh each time, while
  // its last contents stay put during the closing animation.
  const [session, setSession] = useState(0)
  const [addMeal, setAddMeal] = useState<Meal>('snack')
  const [editing, setEditing] = useState<Entry | null>(null)
  const view = day.view

  const open = (s: Exclude<Sheet, null>): void => {
    setSession((n) => n + 1)
    setSheet(s)
  }
  const close = (): void => setSheet(null)
  const refresh = (): void => { void day.refresh() }

  return (
    <div className="app">
      <Toaster position="top-center" theme="dark" />
      <Header date={day.date} onDate={day.setDate} onSettings={() => open('settings')} />

      <main className="scroll">
        {day.error && !view && (
          <div className="error-card" role="alert">
            Couldn&apos;t load this day: {day.error}
            <button type="button" onClick={refresh}>Retry</button>
          </div>
        )}
        {view && (
          <>
            <Totals totals={view.totals} missing={view.missing} goals={view.goals} />
            <WaterTracker date={day.date} water={view.water} onLogged={refresh} />
            <MealList
              entries={view.entries}
              onOpen={(e) => { setEditing(e); open('entry') }}
              onAdd={(m) => { setAddMeal(m); open('add') }}
            />
          </>
        )}
      </main>

      <button
        type="button"
        className="fab"
        aria-label="Add food"
        onClick={() => { setAddMeal(mealForHour(new Date().getHours())); open('add') }}
      >
        <Plus size={26} aria-hidden="true" />
      </button>

      <AddSheet
        open={sheet === 'add'}
        session={session}
        date={day.date}
        meal={addMeal}
        onClose={close}
        onLogged={refresh}
      />
      <EntrySheet open={sheet === 'entry'} session={session} entry={editing} onClose={close} onChanged={refresh} />
      <SettingsSheet
        open={sheet === 'settings'}
        session={session}
        goals={view?.goals ?? null}
        onClose={close}
        onSaved={refresh}
      />
    </div>
  )
}
