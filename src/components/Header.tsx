import { ChevronLeft, ChevronRight, Settings } from 'lucide-react'

export type Section = 'nutrition' | 'train'
export type NutritionMode = 'day' | 'week' | 'month'
export type TrainMode = 'today' | 'week' | 'block' | 'library'

/** Each section's views, in tab order. */
export const MODES = {
  nutrition: [{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }],
  train: [{ value: 'today', label: 'Today' }, { value: 'week', label: 'Week' }, { value: 'block', label: 'Block' }, { value: 'library', label: 'Library' }],
} as const satisfies Record<Section, { value: string; label: string }[]>

interface HeaderProps {
  section: Section
  mode: NutritionMode | TrainMode
  onModeChange: (mode: string) => void
  /** What one step of the arrows is, for their labels. */
  unit: 'day' | 'week' | 'month'
  /** What the nav is showing: a day's label ("Today"), a week's or a month's. */
  label: string
  /** Whether it's the current day/week/month -- the label click is a no-op then (nothing to jump to). */
  isCurrent: boolean
  onPrev: () => void
  onNext: () => void
  onJumpToCurrent: () => void
  onSettings: () => void
  /** A view with no dates to walk (the Library) shows its name instead of the arrows. */
  title?: string
}

/**
 * Same nav shell for all three views: only what "previous", "next" and the
 * label mean changes. Two rows, not one -- the date nav, the settings
 * button and three tab labels don't all fit one line on a phone. The two
 * sections (Nutrition and Train) are the bottom bar's; these tabs are the
 * views within the one on screen.
 */
export default function Header({ section, mode, onModeChange, unit, label, isCurrent, onPrev, onNext, onJumpToCurrent, onSettings, title }: HeaderProps) {
  return (
    <>
      <header className="app-header">
        {title ? <h1 className="date-label header-title">{title}</h1> : <div className="date-nav">
          <button type="button" className="icon-btn" aria-label={`Previous ${unit}`} onClick={onPrev}>
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="date-label"
            onClick={onJumpToCurrent}
            aria-label={isCurrent ? label : `${label} — jump to today`}
          >
            {label}
          </button>
          <button type="button" className="icon-btn" aria-label={`Next ${unit}`} onClick={onNext}>
            <ChevronRight size={20} aria-hidden="true" />
          </button>
          {/* Only once you've moved off the current day/week/month: there's nowhere to jump otherwise. */}
          {!isCurrent && (
            <button type="button" className="today-btn" onClick={onJumpToCurrent} aria-label={`Jump to the current ${unit}`}>
              Today
            </button>
          )}
        </div>}
        <button type="button" className="icon-btn" aria-label="Settings" onClick={onSettings}>
          <Settings size={19} aria-hidden="true" />
        </button>
      </header>
      <div className="mode-tabs" role="tablist" aria-label={section === 'nutrition' ? 'Nutrition view' : 'Train view'}>
        {MODES[section].map((m) => (
          <button
            key={m.value}
            type="button"
            role="tab"
            aria-selected={mode === m.value}
            className={`mode-tab${mode === m.value ? ' active' : ''}`}
            onClick={() => onModeChange(m.value)}
          >
            {m.label}
          </button>
        ))}
      </div>
    </>
  )
}
