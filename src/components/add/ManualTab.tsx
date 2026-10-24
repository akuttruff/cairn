import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { Camera, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../lib/api.ts'
import { chime } from '../../lib/chime.ts'
import { shrinkImage } from '../../lib/image.ts'
import { carriesPicture, pictureOf } from '../../lib/pictures.ts'
import { calorieMismatch } from '../../lib/nutrition.ts'
import { draftOf, emptyDraft, fmtGrams, nutrientsOf, parseNum } from '../../lib/format.ts'
import { NUTRIENTS } from '../../types.ts'
import type { Food, NewEntry, Nutrients } from '../../types.ts'
import NutrientFields from '../NutrientFields.tsx'
import useNutrientDraft from '../../hooks/useNutrientDraft.ts'
import { useElapsed } from '../../hooks/useElapsed.ts'

/**
 * Type a food in, or scan its label: a photo (or a screenshot) goes to a
 * vision model in LM Studio, which fills these fields in for checking. The
 * picture can be chosen, pasted from the clipboard, or dropped anywhere on
 * the page. A scanned food is ticked for My foods, since a label worth
 * photographing is one you'll log again. A food can also be saved there
 * without logging it, for one you're stocking up on rather than eating now.
 */
export function ManualTab({ onLog, onSaved }: {
  onLog: (e: Omit<NewEntry, 'date' | 'meal'>) => Promise<void>
  /** A food was saved to My foods without being logged. */
  onSaved?: (food: Food) => void
}) {
  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [serving, setServing] = useState('')
  const [grams, setGrams] = useState('')
  const [draft, setDraft, caloriesIsAuto] = useNutrientDraft()
  const [save, setSave] = useState(false)
  const [busy, setBusy] = useState(false)
  /** When the current scan began; null while none is running. */
  const [scanStarted, setScanStarted] = useState<number | null>(null)
  const scanning = scanStarted != null
  const [scanned, setScanned] = useState<{ note?: string; model: string } | null>(null)
  /** A picture is being dragged over the page. */
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const scanSeconds = useElapsed(scanStarted)

  const scan = async (file: File): Promise<void> => {
    setScanStarted(Date.now())
    try {
      const { reading } = await api.readLabel(await shrinkImage(file))
      // What the label said replaces what was typed; what it didn't say is left as it was.
      if (reading.name) setName(reading.name)
      if (reading.brand) setBrand(reading.brand)
      setServing(reading.serving.label)
      setGrams(reading.serving.grams == null ? '' : fmtGrams(reading.serving.grams))
      setDraft(reading.nutrients.calories == null && reading.nutrients.protein == null && reading.nutrients.fat == null && reading.nutrients.carbs == null
        ? emptyDraft()
        : draftOf(reading.nutrients))
      setSave(true)
      setScanned({ note: reading.note, model: reading.model })
      chime('done')
      if (!reading.name && !name.trim()) nameRef.current?.focus()
    } catch (err) {
      chime('failed')
      toast.error((err as Error).message)
    } finally {
      setScanStarted(null)
    }
  }
  // Always the latest scan (with this render's fields) for the listeners
  // below, without re-adding them on every keystroke.
  const scanPicture = useEffectEvent((file: File) => { void scan(file) })

  // A pasted screenshot or a dropped picture scans too, from anywhere on
  // the page: a label dragged in from the desktop shouldn't have to land on
  // the button exactly. Without preventDefault on dragover the browser
  // refuses the drop (and would open the picture as a page instead); a
  // dragleave to outside the window (relatedTarget null) clears the
  // highlight. Text pastes go through untouched.
  useEffect(() => {
    if (scanning) return
    const paste = (e: ClipboardEvent): void => {
      const file = pictureOf(e.clipboardData)
      if (!file) return
      e.preventDefault()
      scanPicture(file)
    }
    const over = (e: DragEvent): void => {
      if (!carriesPicture(e.dataTransfer)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      setDragging(true)
    }
    const leave = (e: DragEvent): void => { if (e.relatedTarget == null) setDragging(false) }
    const drop = (e: DragEvent): void => {
      setDragging(false)
      const file = pictureOf(e.dataTransfer)
      if (!file) return
      e.preventDefault()
      scanPicture(file)
    }
    document.addEventListener('paste', paste)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      document.removeEventListener('paste', paste)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
      setDragging(false)
    }
  }, [scanning])

  const n = nutrientsOf(draft)
  const g = parseNum(grams)
  const label = serving.trim() || '1 serving'
  const badNumber = NUTRIENTS.some((k) => draft[k].trim() && (n[k] == null || n[k]! < 0))
  const badGrams = grams.trim() !== '' && (g == null || g <= 0 || g > 10_000)
  const valid = name.trim() !== '' && n.calories != null && !badNumber && !badGrams
  const mismatch = calorieMismatch(n)

  /** The form as a food for My foods. */
  const foodOf = (): Food => {
    const food: Food = {
      id: '', name: name.trim(), brand: brand.trim() || undefined, source: 'custom',
      perServing: { label, grams: g, nutrients: n },
    }
    if (g) {
      const per100g = {} as Nutrients
      for (const k of NUTRIENTS) per100g[k] = n[k] == null ? null : Math.round((n[k]! * 1000) / g) / 10
      food.per100g = per100g
      food.servings = [{ label, grams: g }]
    }
    return food
  }

  const submit = async (): Promise<void> => {
    if (!valid) return
    setBusy(true)
    const trimmed = name.trim()
    const b = brand.trim() || undefined
    const amount = { quantity: 1, unit: label, unitGrams: g }
    let foodId: string | undefined
    if (save) {
      try {
        foodId = (await api.saveFood(foodOf())).id
      } catch (err) {
        toast.error(`Couldn't save to My foods: ${(err as Error).message}`)
      }
    }
    await onLog({ name: trimmed, brand: b, grams: g, perUnit: n, amount, foodId, source: 'custom' })
    setBusy(false)
  }

  const saveOnly = async (): Promise<void> => {
    if (!valid) return
    setBusy(true)
    try {
      const saved = await api.saveFood(foodOf())
      toast.success(`Saved ${saved.name} to My foods`)
      onSaved?.(saved)
    } catch (err) {
      toast.error(`Couldn't save to My foods: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="drawer-scroll" data-vaul-no-drag>
        {/* No `capture`: the phone then offers the camera and the photo library (screenshots live there) both. */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          aria-label="Label picture"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void scan(file)
          }}
        />
        {scanning
          ? (
            <div className="lookup-status" role="status">
              <span className="spinner" aria-hidden="true" />
              <span>Reading the label… {scanSeconds}s</span>
            </div>
          )
          : (
            <button type="button" className={`lookup-btn${dragging ? ' dragging' : ''}`} onClick={() => fileRef.current?.click()}>
              <Camera size={16} aria-hidden="true" />
              {dragging ? 'Drop the picture to scan it' : scanned ? 'Scan another label' : 'Scan a nutrition label'}
            </button>
          )}
        {!scanning && !scanned && <div className="hint">Or paste a screenshot, or drop a picture here.</div>}
        {scanned && !scanning && (
          <div className="hint warn" role="status">
            <TriangleAlert size={13} aria-hidden="true" />
            <span>
              Filled in from the label by {scanned.model}. Check the numbers against the package before logging.
              {scanned.note ? ` ${scanned.note}` : ''}
              {!name.trim() ? ' The label gave no name: add one.' : ''}
            </span>
          </div>
        )}
        <div className="field">
          <label htmlFor="manual-name">Name</label>
          <input ref={nameRef} id="manual-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Burrito bowl" />
        </div>
        <div className="field">
          <label htmlFor="manual-brand">Brand (optional)</label>
          <input id="manual-brand" type="text" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. Trader Joe's" />
        </div>
        <div className="amount-row">
          <div className="field">
            <label htmlFor="manual-serving">Serving</label>
            <input id="manual-serving" type="text" value={serving} onChange={(e) => setServing(e.target.value)} placeholder="1 serving" />
          </div>
          <div className="field">
            <label htmlFor="manual-grams">Weighs (g, optional)</label>
            <input id="manual-grams" type="text" inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} />
          </div>
        </div>
        <div className="hint">Numbers below are for {label}: “1 bowl”, “2 cookies”, “1 cup”.</div>
        <NutrientFields idPrefix="manual" value={draft} onChange={setDraft} autoCalories={caloriesIsAuto} />
        {badNumber && <div className="hint bad">Amounts must be non-negative numbers.</div>}
        {badGrams && <div className="hint bad">Weight must be between 0 and 10,000 g.</div>}
        {mismatch && (
          <div className="hint warn" role="status">
            <TriangleAlert size={13} aria-hidden="true" /> Protein, fat and carbs add up to about{' '}
            {Math.round(n.protein! * 4 + n.carbs! * 4 + n.fat! * 9)} kcal, not {n.calories}. Worth a second look.
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
          Save to My foods
        </label>
      </div>
      <div className="drawer-actions">
        <div className="row">
          <button type="button" disabled={!valid || busy} onClick={() => void saveOnly()}>Save without logging</button>
          <button type="button" className="primary" disabled={!valid || busy} onClick={() => void submit()}>Log {label}</button>
        </div>
      </div>
    </>
  )
}
