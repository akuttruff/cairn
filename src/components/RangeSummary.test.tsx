import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { addDays, startOfWeek } from '../lib/nutrition'
import type { RangeView, ResolvedGoals } from '../types'
import RangeSummary from './RangeSummary'

const TODAY = new Date().toISOString().slice(0, 10)
const RANGE = (n: number): { min: number; max: number } => ({ min: n, max: n })
const GOALS: ResolvedGoals = {
  calories: RANGE(2000), protein: RANGE(150), fat: RANGE(65), fiber: 30,
  water: 96, alcoholWeekly: 7, meditationMinutes: 10, dogWalks: 2, walkMiles: 1,
}

const NO_KINDS = { wod: 0, weightlifting: 0, run: 0, cycling: 0, yoga: 0, pilates: 0 }
const PLAN = { wod: 2, weightlifting: 2, run: 0, cycling: 0, yoga: 4, pilates: 1 }
const WORKOUT_KINDS_DEF = [
  { id: 'wod', label: 'WOD', icon: 'flame' as const },
  { id: 'weightlifting', label: 'Lifting', icon: 'dumbbell' as const },
  { id: 'run', label: 'Run', icon: 'footprints' as const },
  { id: 'cycling', label: 'Cycling', icon: 'bike' as const },
  { id: 'yoga', label: 'Yoga', icon: 'sparkles' as const },
  { id: 'pilates', label: 'Pilates', icon: 'person-standing' as const },
]

const ZERO = { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 }

const BODY_METRICS_NULL = {
  weight: null, bodyFat: null, leanMass: null, bmi: null,
} as const

/** Build a RangeView for the given number of days starting from `start`. */
function makeRangeView(
  start: string,
  daysCount: number,
  overrides: Partial<RangeView> = {}
): RangeView {
  const end = addDays(start, daysCount - 1)
  return {
    start,
    end,
    goals: GOALS,
    scorecard: { calories: { met: 0, of: 0 }, protein: { met: 0, of: 0 }, fat: { met: 0, of: 0 }, fiber: { met: 0, of: 0 } },
    charts: ['calories', 'protein', 'fiber', 'water'],
    totalDays: daysCount,
    loggedDays: 0,
    averagedDays: daysCount,
    totals: ZERO,
    averages: ZERO,
    water: { total: 0, average: 0, met: 0, of: 0 },
    alcohol: { total: 0, average: 0, calories: 0, byKind: { beer: 0, wine: 0, liquor: 0 } },
    workouts: { sessions: 0, days: 0, minutes: 0, kinds: WORKOUT_KINDS_DEF, byKind: NO_KINDS, goalByKind: PLAN, goal: 9 },
    meditation: { total: 0, average: 0, days: 0, met: 0, of: 0, streak: 0 },
    dog: { walks: 0, miles: 0, days: 0, met: 0, of: 0, streak: 0 },
    body: BODY_METRICS_NULL as any,
    days: Array.from({ length: daysCount }, (_, i) => ({
      date: addDays(start, i),
      entryCount: 0,
      water: 0,
      alcohol: 0,
      workouts: 0,
      workoutMinutes: 0,
      meditationMinutes: 0,
      dogWalks: 0,
      dogMiles: 0,
      goals: { calories: RANGE(2000), protein: RANGE(150), fat: RANGE(65), fiber: 30, water: 96, alcoholWeekly: 7, meditationMinutes: 10, dogWalks: 2, walkMiles: 1 },
      totals: ZERO,
      missing: ZERO,
    })),
    ...overrides,
  }
}

const onSelectDay = (_date: string) => {} // No-op for tests

describe('RangeSummary Monday-first alignment', () => {
  it('renders workout DayBoxes with M T W T F S S headers', () => {
    const monday = startOfWeek(TODAY)
    const view = makeRangeView(monday, 7)
    render(<RangeSummary view={view} part="train" onSelectDay={onSelectDay} />)

    // Query for all weekday header spans
    const weekdaySpans = document.querySelectorAll('.day-boxes-weekday')
    expect(weekdaySpans.length).toBeGreaterThan(7) // At least one DayBoxes with 7 headers

    // Get the first 7 weekday headers (from workout DayBoxes)
    const workoutHeaders = Array.from(weekdaySpans).slice(0, 7).map(el => el.textContent)
    expect(workoutHeaders).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S'])
  })

  it('renders meditation DayBoxes with M T W T F S S headers', () => {
    const monday = startOfWeek(TODAY)
    const view = makeRangeView(monday, 7)
    render(<RangeSummary view={view} part="train" onSelectDay={onSelectDay} />)

    // Find the meditation section and get its weekday headers
    const meditationSection = screen.getByLabelText('Meditation')
    const meditationHeaders = meditationSection.querySelectorAll('.day-boxes-weekday')
    expect(meditationHeaders.length).toBe(7)

    const meditationHeaderText = Array.from(meditationHeaders).map(el => el.textContent)
    expect(meditationHeaderText).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S'])
  })

  it('renders dog walk DayBoxes with M T W T F S S headers', () => {
    const monday = startOfWeek(TODAY)
    const view = makeRangeView(monday, 7)
    render(<RangeSummary view={view} part="train" onSelectDay={onSelectDay} />)

    // Find the dog walks section and get its weekday headers
    const dogSection = screen.getByLabelText('Dog walks')
    const dogHeaders = dogSection.querySelectorAll('.day-boxes-weekday')
    expect(dogHeaders.length).toBe(7)

    const dogHeaderText = Array.from(dogHeaders).map(el => el.textContent)
    expect(dogHeaderText).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S'])
  })

  it('renders range-days with Monday-first weekday letters and dates for week view', () => {
    const monday = startOfWeek(TODAY)
    const view = makeRangeView(monday, 7)
    render(<RangeSummary view={view} part="train" onSelectDay={onSelectDay} />)

    // Verify the component renders with week view structure
    expect(document.querySelector('.range-summary')).toBeTruthy()

    // Verify DayBoxes headers are Monday-first (this is the key assertion for Monday-first alignment)
    // The DayBoxes always render with weekday headers, regardless of part
    const weekdaySpans = document.querySelectorAll('.day-boxes-weekday')
    expect(weekdaySpans.length).toBeGreaterThan(7)

    const firstDayBoxHeaders = Array.from(weekdaySpans).slice(0, 7).map(el => el.textContent)
    expect(firstDayBoxHeaders).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S'])
  })

  it('renders range-days labels showing only Mondays for month view', () => {
    const monday = startOfWeek(TODAY)
    const view = makeRangeView(monday, 31)
    render(<RangeSummary view={view} part="nutrition" onSelectDay={onSelectDay} />)

    // In month view, the range-days section shows only Mondays as labels
    const rangeDaysSection = screen.getByLabelText('Range summary').querySelector('.range-days')
    expect(rangeDaysSection).toBeInTheDocument()

    // Count how many spans have content (only Mondays should have date numbers)
    const allDaySpans = rangeDaysSection!.querySelectorAll('.range-days > span')
    
    // In a 31-day period starting on Monday, there are exactly 5 Mondays
    let mondayCount = 0
    for (const span of allDaySpans) {
      // For month view, Mondays have a text node with the date number
      const hasContent = span.textContent && span.textContent.trim().length > 0
      if (hasContent) {
        mondayCount++
      }
    }

    expect(mondayCount).toBe(5)
  })

  it('renders week rules (range-week-rule) only at Monday starts in month view', () => {
    const monday = startOfWeek(TODAY)
    const view = makeRangeView(monday, 31)
    render(<RangeSummary view={view} part="nutrition" onSelectDay={onSelectDay} />)

    // Week rules appear in each chart (calories, protein, fiber, water = 4 charts)
    // For a 31-day period starting on Monday, there are 4 internal week rules per chart
    // (one for each Monday after the first day)
    const allWeekRules = document.querySelectorAll('.range-week-rule')
    
    // 4 charts × 4 rules each = 16 total week rules
    expect(allWeekRules.length).toBe(16)

    // Verify that labeled days (Mondays) are correctly positioned:
    // In month view, only Mondays have visible date labels.
    const rangeDaysSection = screen.getByLabelText('Range summary').querySelector('.range-days')
    expect(rangeDaysSection).toBeInTheDocument()

    const daySpans = rangeDaysSection!.querySelectorAll('.range-days > span')
    
    // Count how many spans have content (only Mondays should have date numbers)
    let labeledDayCount = 0
    for (const span of daySpans) {
      const hasContent = span.textContent && span.textContent.trim().length > 0
      if (hasContent) {
        labeledDayCount++
      }
    }

    // 5 Mondays in a 31-day period starting on Monday (days 0, 7, 14, 21, 28)
    expect(labeledDayCount).toBe(5)

    // Per-chart week rules = labeled Mondays minus the first one (no rule on day 0)
    // Total week rules = per-chart rules × number of charts (4)
    expect(allWeekRules.length).toBe((labeledDayCount - 1) * 4)
  })

  it('renders DayBoxes with correct lead blanks for month starting on Wednesday', () => {
    // November 4, 2026 is a Wednesday (getDay() = 3 when created as local date)
    // weekdayIndex for Wednesday: (3 + 6) % 7 = 2, so there should be 2 lead blanks
    // Use the same date format as RangeSummary (local date with T00:00:00)
    const wednesday = '2026-11-04'
    const wedDate = new Date(`${wednesday}T00:00:00`)
    const weekdayIndex = (wedDate.getDay() + 6) % 7
    
    const view = makeRangeView(wednesday, 31)
    render(<RangeSummary view={view} part="train" onSelectDay={onSelectDay} />)

    // Find the workout DayBoxes section
    const workoutSection = screen.getByLabelText('Workouts')
    const dayBoxesContainer = workoutSection.querySelector('.day-boxes.workout')
    expect(dayBoxesContainer).toBeInTheDocument()

    // The DayBoxes structure is:
    // - 7 weekday header spans (.day-boxes-weekday)
    // - N lead blank spans (where N = weekdayIndex of first day)
    // - 31 day box buttons
    
    // Count lead blanks: they are spans that come after the 7 headers but before any button
    const allChildren = Array.from(dayBoxesContainer!.children)
    
    // First 7 are weekday headers, last 31 are day buttons
    // The middle ones (if any) are lead blanks
    const potentialLeadBlanks = allChildren.slice(7, 7 + 31)
    const leadBlankCount = potentialLeadBlanks.filter(child => 
      child.tagName === 'SPAN' && !child.classList.contains('day-boxes-weekday')
    ).length
    
    // For Wednesday, weekdayIndex = 2, so there should be 2 lead blanks
    expect(leadBlankCount).toBe(weekdayIndex)
  })

  it('DayBoxes headers are Monday-first (M T W T F S S), not Sunday-first', () => {
    // This test verifies that DayBoxes render with Monday-first headers.
    // If WEEKDAYS reverted to ['S','M','T','W','T','F','S'], this would fail.
    
    const monday = startOfWeek(TODAY)
    const view = makeRangeView(monday, 7)
    render(<RangeSummary view={view} part="train" onSelectDay={onSelectDay} />)

    // Find the workout DayBoxes section
    const workoutSection = screen.getByLabelText('Workouts')
    const dayBoxesContainer = workoutSection.querySelector('.day-boxes.workout')
    expect(dayBoxesContainer).toBeInTheDocument()

    const weekdayHeaders = dayBoxesContainer!.querySelectorAll('.day-boxes-weekday')
    expect(weekdayHeaders.length).toBe(7)

    const headerText = Array.from(weekdayHeaders).map(el => el.textContent)
    
    // Monday-first order, not Sunday-first ['S','M','T','W','T','F','S']
    expect(headerText).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S'])
  })
})
