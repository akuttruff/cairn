import { useState } from 'react'
import { Toaster } from 'sonner'
import { Plus } from 'lucide-react'
import Header from './components/Header.tsx'
import type { ViewMode } from './components/Header.tsx'
import Totals from './components/Totals.tsx'
import WaterTracker from './components/WaterTracker.tsx'
import AlcoholTracker from './components/AlcoholTracker.tsx'
import WorkoutTracker from './components/WorkoutTracker.tsx'
import MeditationTracker from './components/MeditationTracker.tsx'
import MealList from './components/MealList.tsx'
import RangeSummary from './components/RangeSummary.tsx'
import AddSheet from './components/AddSheet.tsx'
import EntrySheet from './components/EntrySheet.tsx'
import SettingsSheet from './components/SettingsSheet.tsx'
import useDay from './hooks/useDay.ts'
import useRange from './hooks/useRange.ts'
import { addDays, localDate, mealForHour } from './lib/nutrition.ts'
import { dayLabel } from './lib/format.ts'
import { api } from './lib/api.ts'
import type { DayType, Entry, Meal } from './types.ts'
import './App.css'

type Sheet = 'add' | 'entry' | 'settings' | null

export default function App() {
  const day = useDay()
  const [mode, setMode] = useState<ViewMode>('day')
  // Both kept mounted (not just the active one) so switching Week -> Month
  // -> Week back doesn't lose either one's navigated position -- each only
  // fetches once it's actually the mode on screen.
  const week = useRange('week', mode === 'week')
  const month = useRange('month', mode === 'month')
  const range = mode === 'week' ? week : mode === 'month' ? month : null

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
  const setDayType = (type: DayType): void => { void api.setDayType(day.date, type).then(refresh) }

  /** A range chart's bar was tapped: go look at that day. */
  const selectDay = (date: string): void => {
    day.setDate(date)
    setMode('day')
  }

  const today = localDate()
  const header = mode === 'day'
    ? {
      label: dayLabel(day.date, today),
      isCurrent: day.date === today,
      onPrev: () => day.setDate(addDays(day.date, -1)),
      onNext: () => day.setDate(addDays(day.date, 1)),
      onJumpToCurrent: () => day.setDate(today),
    }
    : {
      label: range!.label,
      isCurrent: range!.isCurrent,
      onPrev: range!.prev,
      onNext: range!.next,
      onJumpToCurrent: range!.jumpToCurrent,
    }

  return (
    <div className="app">
      <Toaster position="top-center" theme="dark" />
      <Header mode={mode} onModeChange={setMode} onSettings={() => open('settings')} {...header} />

      <main className="scroll">
        {mode === 'day' ? (
          <>
            {day.error && !view && (
              <div className="error-card" role="alert">
                Couldn&apos;t load this day: {day.error}
                <button type="button" onClick={refresh}>Retry</button>
              </div>
            )}
            {view && (
              <>
                <Totals
                  totals={view.totals} missing={view.missing} goals={view.goals} dayType={view.dayType} onSetDayType={setDayType}
                  alcoholCalories={view.alcohol.calories}
                />
                <WaterTracker date={day.date} water={view.water} onLogged={refresh} />
                <AlcoholTracker date={day.date} alcohol={view.alcohol} onLogged={refresh} />
                <WorkoutTracker date={day.date} workouts={view.workouts} onLogged={refresh} />
                <MeditationTracker date={day.date} meditation={view.meditation} onLogged={refresh} />
                <MealList
                  entries={view.entries}
                  onOpen={(e) => { setEditing(e); open('entry') }}
                  onAdd={(m) => { setAddMeal(m); open('add') }}
                />
              </>
            )}
          </>
        ) : (
          <>
            {range!.error && !range!.view && (
              <div className="error-card" role="alert">
                Couldn&apos;t load this {mode}: {range!.error}
                <button type="button" onClick={() => void range!.refresh()}>Retry</button>
              </div>
            )}
            {range!.view && <RangeSummary view={range!.view} onSelectDay={selectDay} />}
          </>
        )}
      </main>

      {mode === 'day' && (
        <button
          type="button"
          className="fab"
          aria-label="Add food"
          onClick={() => { setAddMeal(mealForHour(new Date().getHours())); open('add') }}
        >
          <Plus size={26} aria-hidden="true" />
        </button>
      )}

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
        onClose={close}
        onSaved={refresh}
      />
    </div>
  )
}
