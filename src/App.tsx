import { useState } from 'react'
import { Toaster, toast } from 'sonner'
import { Plus } from 'lucide-react'
import Header from './components/Header.tsx'
import type { NutritionMode, Section, TrainMode } from './components/Header.tsx'
import SectionTabs from './components/SectionTabs.tsx'
import Totals from './components/Totals.tsx'
import WaterTracker from './components/WaterTracker.tsx'
import AlcoholTracker from './components/AlcoholTracker.tsx'
import ExtraWorkouts from './components/train/ExtraWorkouts.tsx'
import WeekGoals from './components/train/WeekGoals.tsx'
import MeditationTracker from './components/MeditationTracker.tsx'
import DogWalkTracker from './components/DogWalkTracker.tsx'
import BodyCard from './components/BodyCard.tsx'
import MealList from './components/MealList.tsx'
import RangeSummary from './components/RangeSummary.tsx'
import { TrainBlock, TrainToday, TrainWeek } from './components/train/TrainView.tsx'
import Library from './components/train/Library.tsx'
import CoachSheet from './components/train/CoachSheet.tsx'
import AddSheet from './components/AddSheet.tsx'
import EntrySheet from './components/EntrySheet.tsx'
import SettingsSheet from './components/SettingsSheet.tsx'
import Unreachable from './components/Unreachable.tsx'
import useDay from './hooks/useDay.ts'
import useRange from './hooks/useRange.ts'
import useTraining from './hooks/useTraining.ts'
import useTrainWeek, { mondayOf } from './hooks/useTrainWeek.ts'
import { addDays, alcoholCaloriesLogged, localDate, mealForHour } from './lib/nutrition.ts'
import { dayLabel } from './lib/format.ts'
import { api } from './lib/api.ts'
import type { Entry, Meal } from './types.ts'
import './App.css'

type Sheet = 'add' | 'entry' | 'settings' | null

export default function App() {
  const day = useDay()
  // Two sections, each remembering its own view; the app opens on Nutrition's day.
  const [section, setSection] = useState<Section>('nutrition')
  const [nutritionMode, setNutritionMode] = useState<NutritionMode>('day')
  const [trainMode, setTrainMode] = useState<TrainMode>('today')
  const [coachOpen, setCoachOpen] = useState(false)
  // Something to ask the coach as it opens (typed into Block's box); numbered so asking the same thing twice still asks.
  const [coachAsk, setCoachAsk] = useState<{ text: string; n: number } | null>(null)
  const openCoach = (text?: string): void => {
    setCoachAsk(text ? { text, n: Date.now() } : null)
    setCoachOpen(true)
  }
  const mode = section === 'nutrition' ? nutritionMode : trainMode
  // Both kept mounted (not just the active one) so switching Week -> Month
  // -> Week back doesn't lose either one's navigated position -- each only
  // fetches once it's actually the mode on screen.
  const nutrition = section === 'nutrition'
  const week = useRange('week', nutrition && nutritionMode === 'week')
  const month = useRange('month', nutrition && nutritionMode === 'month')
  const range = !nutrition ? null : nutritionMode === 'week' ? week : nutritionMode === 'month' ? month : null
  // Train's views all walk the same date as Nutrition's day, so switching sections keeps the day in view.
  const training = useTraining(day.date, !nutrition)
  const trainWeek = useTrainWeek(day.date, !nutrition && trainMode === 'week')

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
  /** The server is answering again: whatever is on screen fetches afresh. */
  const refreshAll = (): void => {
    refresh()
    void range?.refresh()
    if (!nutrition) { void training.refresh(); if (trainMode === 'week') void trainWeek.refresh() }
  }
  /** Logged in Train: the day's workout dots and the week's summaries move too. */
  const trainLogged = (): void => { refresh(); if (trainMode === 'week') void trainWeek.refresh() }
  const openTrainDay = (date: string): void => {
    day.setDate(date)
    setSection('train')
    setTrainMode('today')
  }

  /** A range chart's bar was tapped: go look at that day. */
  const selectDay = (date: string): void => {
    day.setDate(date)
    setNutritionMode('day')
  }

  const today = localDate()
  const thisMonday = mondayOf(today)
  const header = !nutrition && trainMode === 'week'
    ? {
      unit: 'week' as const,
      label: mondayOf(day.date) === thisMonday ? 'This week' : `Week of ${dayLabel(mondayOf(day.date), today)}`,
      isCurrent: mondayOf(day.date) === thisMonday,
      onPrev: () => day.setDate(addDays(day.date, -7)),
      onNext: () => day.setDate(addDays(day.date, 7)),
      onJumpToCurrent: () => day.setDate(today),
    }
    : !nutrition || nutritionMode === 'day'
    ? {
      unit: 'day' as const,
      label: dayLabel(day.date, today),
      isCurrent: day.date === today,
      onPrev: () => day.setDate(addDays(day.date, -1)),
      onNext: () => day.setDate(addDays(day.date, 1)),
      onJumpToCurrent: () => day.setDate(today),
    }
    : {
      unit: nutritionMode as 'week' | 'month',
      label: range!.label,
      isCurrent: range!.isCurrent,
      onPrev: range!.prev,
      onNext: range!.next,
      onJumpToCurrent: range!.jumpToCurrent,
    }

  return (
    <div className="app">
      <Toaster position="top-center" theme="dark" />
      <Unreachable app="Cairn" onBack={refreshAll} />
      <Header
        section={section}
        mode={mode}
        onModeChange={(m) => (nutrition ? setNutritionMode(m as NutritionMode) : setTrainMode(m as TrainMode))}
        onSettings={() => open('settings')}
        title={!nutrition && trainMode === 'library' ? 'Library' : undefined}
        {...header}
      />

      <main className="scroll">
        {nutrition && nutritionMode === 'day' ? (
          <>
            {day.error && !view && (
              <div className="error-card" role="alert">
                Couldn&apos;t load this day: {day.error}
                <button type="button" onClick={refresh}>Retry</button>
              </div>
            )}
            {view && (
              <>
                <Totals totals={view.totals} missing={view.missing} goals={view.goals} alcoholCalories={alcoholCaloriesLogged(view.entries)} />
                <WaterTracker date={day.date} water={view.water} onLogged={refresh} />
                <AlcoholTracker date={day.date} alcohol={view.alcohol} onLogged={refresh} />
                <MealList
                  entries={view.entries}
                  onOpen={(e) => { setEditing(e); open('entry') }}
                  onAdd={(m) => { setAddMeal(m); open('add') }}
                  onDeleteMany={async (chosen) => {
                    // Gone at once; Undo logs the same entries again from the copies kept here.
                    try {
                      await Promise.all(chosen.map((e) => api.deleteEntry(e.id)))
                    } catch (err) {
                      toast.error((err as Error).message)
                      refresh()
                      return
                    }
                    refresh()
                    toast(`Deleted ${chosen.length} ${chosen.length === 1 ? 'entry' : 'entries'}`, {
                      action: {
                        label: 'Undo',
                        onClick: () => {
                          void Promise.all(chosen.map(({ id: _id, createdAt: _createdAt, ...rest }) => api.addEntry(rest)))
                            .then(refresh, (err: Error) => toast.error(err.message))
                        },
                      },
                    })
                  }}
                />
              </>
            )}
          </>
        ) : !nutrition && trainMode === 'today' ? (
          <>
            <TrainToday date={day.date} training={training} onSelectDate={day.setDate} onLogged={trainLogged} onCoach={openCoach} />
            {view && (
              <>
                <ExtraWorkouts date={day.date} workouts={view.workouts} onLogged={() => { refresh(); void training.refresh() }} />
                <MeditationTracker date={day.date} meditation={view.meditation} onLogged={refresh} />
                <DogWalkTracker date={day.date} dog={view.dog} onLogged={refresh} />
              </>
            )}
          </>
        ) : !nutrition && trainMode === 'week' ? (
          <>
            <TrainWeek training={training} onSelectDay={openTrainDay} />
            {trainWeek.error && !trainWeek.view && (
              <div className="error-card" role="alert">
                Couldn&apos;t load this week: {trainWeek.error}
                <button type="button" onClick={() => void trainWeek.refresh()}>Retry</button>
              </div>
            )}
            {trainWeek.view && (
              <RangeSummary
                view={trainWeek.view} onSelectDay={openTrainDay} part="train"
                workoutGoals={view && <WeekGoals workouts={view.workouts} onSaved={() => { refresh(); void trainWeek.refresh() }} />}
              />
            )}
          </>
        ) : !nutrition && trainMode === 'library' ? (
          <Library training={training} />
        ) : !nutrition ? (
          <>
            <TrainBlock date={day.date} training={training} onLogged={trainLogged} onCoach={openCoach} />
            {view && <BodyCard date={day.date} body={view.body} />}
          </>
        ) : (
          <>
            {range!.error && !range!.view && (
              <div className="error-card" role="alert">
                Couldn&apos;t load this {nutritionMode}: {range!.error}
                <button type="button" onClick={() => void range!.refresh()}>Retry</button>
              </div>
            )}
            {range!.view && <RangeSummary view={range!.view} onSelectDay={selectDay} />}
          </>
        )}
      </main>

      {nutrition && nutritionMode === 'day' && (
        <button
          type="button"
          className="fab"
          aria-label="Add food"
          onClick={() => { setAddMeal(mealForHour(new Date().getHours())); open('add') }}
        >
          <Plus size={26} aria-hidden="true" />
        </button>
      )}

      <SectionTabs section={section} onChange={setSection} />

      <CoachSheet
        open={coachOpen}
        ask={coachAsk}
        onClose={() => { setCoachOpen(false); setCoachAsk(null) }}
        // Applied or undone: the plan, the week and the day's workout dots all fetch afresh.
        onChanged={() => { void training.refresh(); trainLogged() }}
      />

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
        // Goals and the chart choice shape the open range view too, so it reloads with the day.
        onSaved={() => { refresh(); if (range) void range.refresh() }}
      />
    </div>
  )
}
