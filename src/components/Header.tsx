import { ChevronLeft, ChevronRight, Settings } from 'lucide-react'
import { addDays, localDate } from '../lib/nutrition.ts'
import { dayLabel } from '../lib/format.ts'

interface HeaderProps {
  date: string
  onDate: (date: string) => void
  onSettings: () => void
}

export default function Header({ date, onDate, onSettings }: HeaderProps) {
  const today = localDate()
  return (
    <header className="app-header">
      <div className="date-nav">
        <button type="button" className="icon-btn" aria-label="Previous day" onClick={() => onDate(addDays(date, -1))}>
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="date-label"
          onClick={() => onDate(today)}
          aria-label={date === today ? 'Today' : `${dayLabel(date, today)} — jump to today`}
        >
          {dayLabel(date, today)}
        </button>
        <button type="button" className="icon-btn" aria-label="Next day" onClick={() => onDate(addDays(date, 1))}>
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </div>
      <button type="button" className="icon-btn" aria-label="Settings" onClick={onSettings}>
        <Settings size={19} aria-hidden="true" />
      </button>
    </header>
  )
}
