import { ChevronLeft, ChevronRight, Settings } from 'lucide-react'

export type ViewMode = 'day' | 'week' | 'month' | 'train'

const MODES: { value: ViewMode; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'train', label: 'Train' },
]

interface HeaderProps {
  mode: ViewMode
  onModeChange: (mode: ViewMode) => void
  /** What the nav is showing: a day's label ("Today"), a week's or a month's. */
  label: string
  /** Whether it's the current day/week/month -- the label click is a no-op then (nothing to jump to). */
  isCurrent: boolean
  onPrev: () => void
  onNext: () => void
  onJumpToCurrent: () => void
  onSettings: () => void
}

/**
 * Same nav shell for all three views: only what "previous", "next" and the
 * label mean changes. Two rows, not one -- the date nav, the settings
 * button and three tab labels don't all fit one line on a phone.
 */
export default function Header({ mode, onModeChange, label, isCurrent, onPrev, onNext, onJumpToCurrent, onSettings }: HeaderProps) {
  return (
    <>
      <header className="app-header">
        <div className="date-nav">
          <button type="button" className="icon-btn" aria-label={`Previous ${mode === 'train' ? 'day' : mode}`} onClick={onPrev}>
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
          <button type="button" className="icon-btn" aria-label={`Next ${mode === 'train' ? 'day' : mode}`} onClick={onNext}>
            <ChevronRight size={20} aria-hidden="true" />
          </button>
          {/* Only once you've moved off the current day/week/month: there's nowhere to jump otherwise. */}
          {!isCurrent && (
            <button type="button" className="today-btn" onClick={onJumpToCurrent} aria-label={`Jump to the current ${mode === 'train' ? 'day' : mode}`}>
              Today
            </button>
          )}
        </div>
        <button type="button" className="icon-btn" aria-label="Settings" onClick={onSettings}>
          <Settings size={19} aria-hidden="true" />
        </button>
      </header>
      <div className="mode-tabs" role="tablist" aria-label="View">
        {MODES.map((m) => (
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
