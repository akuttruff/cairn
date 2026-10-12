import { useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import { api } from '../lib/api.ts'
import { prepareImage } from '../lib/images.ts'
import type { Food } from '../types.ts'

/**
 * A photo of a Nutrition Facts panel, read by the model into a food, which
 * then opens on the amount screen like any other result -- numbers can be
 * corrected there, and the food starred into My foods. On a phone the
 * button opens the camera; elsewhere, the file picker.
 */
export default function LabelScan({ onFound, compact = false }: { onFound: (food: Food) => void; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const read = async (file: File): Promise<void> => {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const image = await prepareImage(file)
      const result = await api.readLabel(image)
      const food = result.foods[0]
      if (!food) {
        setError(`No nutrition label there. ${result.note ?? ''}`.trim())
        return
      }
      if (result.note) setNote(result.note)
      onFound(food)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`label-scan${compact ? ' compact' : ''}`}>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        hidden
        aria-label="Nutrition label photo"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void read(file)
        }}
      />
      <button type="button" className="lookup-btn" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <span className="spinner" aria-hidden="true" /> : <Camera size={15} aria-hidden="true" />}
        {busy ? 'Reading the label…' : compact ? 'Scan the label instead' : 'Scan a nutrition label'}
      </button>
      {error && <div className="hint bad" role="alert">{error}</div>}
      {note && <div className="hint" role="status">{note}</div>}
    </div>
  )
}
