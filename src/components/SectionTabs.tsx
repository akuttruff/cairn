import { Dumbbell, Salad } from 'lucide-react'
import type { Section } from './Header.tsx'

interface SectionTabsProps {
  section: Section
  onChange: (section: Section) => void
}

const SECTIONS: { value: Section; label: string; Icon: typeof Salad }[] = [
  { value: 'nutrition', label: 'Nutrition', Icon: Salad },
  { value: 'train', label: 'Train', Icon: Dumbbell },
]

/** The app's two sections, along the bottom where a thumb reaches them. */
export default function SectionTabs({ section, onChange }: SectionTabsProps) {
  return (
    <nav className="section-tabs" aria-label="Sections">
      {SECTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          className={`section-tab${section === value ? ' active' : ''}`}
          aria-current={section === value ? 'page' : undefined}
          onClick={() => onChange(value)}
        >
          <Icon size={18} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}
