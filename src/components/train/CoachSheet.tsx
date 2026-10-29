import { useEffect, useRef, useState } from 'react'
import { Drawer } from 'vaul'
import { ArrowUp, Eraser, ImagePlus, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../lib/api.ts'
import { localDate } from '../../lib/nutrition.ts'
import { shrinkImage } from '../../lib/image.ts'
import { pictureOf } from '../../lib/pictures.ts'
import type { CoachMessage, CoachStats, CoachStatus, TrainingDay } from '../../types.ts'

interface CoachSheetProps {
  open: boolean
  /** Asked as the coach opens. */
  ask?: { text: string; n: number } | null
  /** The day on screen behind the sheet: the coach is told, so "this session" means that day's. */
  viewing?: string
  onClose: () => void
  /** A change was applied or undone: the plan on screen fetches afresh. */
  onChanged: (day?: TrainingDay) => void
}

const POLL_MS = 700
/** Screenshots keep more detail than a label photo: small text should stay readable. */
const SHOT_MAX_SIDE = 1600

/** "qwen/qwen3.8-27b" -> "qwen3.8-27b": the model's own name, without who published it. */
const shortModel = (m: string): string => m.split('/').pop() ?? m

/** What the coach is doing, as a line: "Reading your prompt 63% · 4s". */
function statusLine(s: CoachStatus | null, now: number): string {
  if (!s) return 'Starting…'
  const secs = Math.max(0, Math.round((now - s.startedAt) / 1000))
  const pct = s.progress !== null ? ` ${Math.round(s.progress * 100)}%` : ''
  const what = {
    loading: `Loading ${s.model ? shortModel(s.model) : 'the model'}${pct}`,
    // Read in full, then a quiet stretch before the first word: say so rather than sit at 100%.
    reading: s.progress !== null && s.progress >= 1 ? 'Starting to answer…' : `Reading your prompt${pct}`,
    thinking: `Thinking… ${s.tokens} tokens`,
    writing: `Writing… ${s.tokens} tokens`,
    checking: 'Checking the change against your plan…',
    retrying: 'Fixing the change…',
  }[s.phase]
  return `${what} · ${secs}s`
}

/** How a reply was made, in one quiet line, as LM Chat shows it. */
function statsLine(s: CoachStats): string {
  const thinking = s.reasoningTokens ? ` (${s.reasoningTokens.toLocaleString()} thinking)` : ''
  return `${shortModel(s.model)} · ${s.seconds}s · ${s.tokensPerSecond} tok/s · ${s.inputTokens.toLocaleString()} in / ${s.outputTokens.toLocaleString()} out${thinking} · ${s.firstTokenSeconds}s to first token`
}

/** Ways in, for an empty conversation. */
const STARTERS = [
  'How is my training going?',
  "I'm traveling this week with only dumbbells",
  "I'm sore today",
  'Swap two of this week\'s days',
  'Make this week lighter',
  'Rewrite the rest of the plan',
]

/**
 * The coach: talk about the training plan with the local model -- ask how
 * it's going, get feedback, or ask for a change. A change comes back as a
 * card spelling out what it would do, applied only on Apply, and undoable.
 */
export default function CoachSheet({ open, ask, viewing, onClose, onChanged }: CoachSheetProps) {
  const [messages, setMessages] = useState<CoachMessage[]>([])
  const [draft, setDraft] = useState('')
  const [thinking, setThinking] = useState(false)
  const [shot, setShot] = useState<string | null>(null)
  // Screenshots sent this session, shown at once from the copy here while the server's copy loads.
  const [sentShots, setSentShots] = useState<Record<string, string>>({})
  const fileInput = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<CoachStatus | null>(null)
  const [now, setNow] = useState(Date.now())
  const end = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  /** Ask the server what the coach is doing until the reply is in. */
  const poll = (): void => {
    clearTimeout(timer.current)
    api.coach().then((r) => {
      setStatus(r.status)
      setThinking(r.busy)
      setNow(Date.now())
      if (r.busy) timer.current = setTimeout(poll, POLL_MS)
      else setMessages(r.messages)
    }, (err: Error) => { setThinking(false); toast.error(err.message) })
  }

  useEffect(() => {
    if (!open) return
    api.coach().then((r) => {
      setMessages(r.messages)
      setThinking(r.busy)
      setStatus(r.status)
      if (r.busy) timer.current = setTimeout(poll, POLL_MS)
      // Read ahead while a message is typed; a miss only means the first reply takes longer.
      else api.warmCoach(localDate()).catch(() => {})
    }, (err: Error) => toast.error(err.message))
    return () => clearTimeout(timer.current)
    // poll is a fresh closure each render; opening is what starts it.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }) }, [messages, thinking])

  // Asked from Block's box: sent as the sheet opens, once per ask.
  const asked = useRef<number | null>(null)
  useEffect(() => {
    if (open && ask && asked.current !== ask.n) {
      asked.current = ask.n
      void send(ask.text)
    }
    // send is a fresh closure each render; the ask's number is what decides.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ask?.n])

  /** A picture from the file picker, a paste or a drop, made small enough to send. */
  const attach = async (file: File | null | undefined): Promise<void> => {
    if (!file) return
    try {
      setShot(await shrinkImage(file, SHOT_MAX_SIDE))
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const send = async (text: string): Promise<void> => {
    const message = text.trim()
    const image = shot
    if ((!message && !image) || thinking) return
    setDraft('')
    setShot(null)
    setThinking(true)
    // Shown at once; the server's copy replaces it with the reply.
    const pendingId = `pending-${Date.now()}`
    if (image) setSentShots((s) => ({ ...s, [pendingId]: image }))
    setMessages((m) => [...m, { id: pendingId, role: 'user', text: message, proposal: null, status: null, note: null, stats: null, image: Boolean(image), createdAt: Date.now() }])
    try {
      const r = await api.askCoach(message, localDate(), image ?? undefined, viewing)
      // The server's id for the message just sent, so its screenshot keeps showing from the copy here.
      const mine = image ? [...r.messages].reverse().find((m) => m.role === 'user' && m.image) : undefined
      if (mine && image) setSentShots((s) => ({ ...s, [mine.id]: image }))
      setMessages(r.messages)
      setStatus(r.status)
      if (r.busy) timer.current = setTimeout(poll, POLL_MS)
      else setThinking(false)
    } catch (err) {
      toast.error((err as Error).message)
      setDraft(message)
      setShot(image)
      setMessages((m) => m.filter((x) => !x.id.startsWith('pending-')))
      setThinking(false)
    }
  }

  const act = async (id: string, action: 'apply' | 'decline' | 'undo'): Promise<void> => {
    try {
      const r = await api.coachAction(id, action, localDate())
      setMessages(r.messages)
      if (action !== 'decline') onChanged(r.day)
      if (action === 'apply') toast.success('Plan updated')
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const clear = async (): Promise<void> => {
    if (!window.confirm('Clear this conversation? The coach starts fresh, without what was said here. Your plan, your logs and any changes you applied stay as they are.')) return
    try {
      setMessages((await api.clearCoach()).messages)
      setSentShots({})
      toast.success('Conversation cleared')
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <Drawer.Root open={open} onOpenChange={(v) => { if (!v) onClose() }} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="drawer-overlay" />
        <Drawer.Content className="drawer-content tall" aria-describedby={undefined}>
          <div className="drawer-handle" />
          <div className="sheet-top coach-top">
            <Drawer.Title className="drawer-title">Coach</Drawer.Title>
            {messages.length > 0 && (
              <button type="button" className="coach-clear" onClick={() => void clear()} disabled={thinking}>
                <Eraser size={14} aria-hidden="true" /> Clear chat
              </button>
            )}
          </div>
          <div className="drawer-scroll coach-log" data-vaul-no-drag role="log" aria-label="Conversation with the coach">
            {messages.length === 0 && !thinking && (
              <div className="coach-empty">
                <p className="hint">
                  Ask how your training is going, get feedback on the plan, or ask for a change: a day off, a lighter
                  week, travel, a sore joint, or a rewrite. Changes show exactly what they&apos;d do before you apply them.
                </p>
                <div className="coach-starters">
                  {STARTERS.map((s) => <button key={s} type="button" className="coach-chip" onClick={() => void send(s)}>{s}</button>)}
                </div>
              </div>
            )}
            {messages.map((m) => <Message key={m.id} m={m} shot={sentShots[m.id]} onAct={act} />)}
            {thinking && <div className="coach-msg coach coach-working" role="status"><span className="spinner" aria-hidden="true" /> {statusLine(status, now)}</div>}
            <div ref={end} />
          </div>
          {shot && (
            <div className="coach-shot-pending">
              <img src={shot} alt="Screenshot to send" />
              <button type="button" className="icon-btn" aria-label="Remove the screenshot" onClick={() => setShot(null)}><X size={14} aria-hidden="true" /></button>
            </div>
          )}
          <form
            className="coach-compose"
            onSubmit={(e) => { e.preventDefault(); void send(draft) }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { const file = pictureOf(e.dataTransfer); if (file) { e.preventDefault(); void attach(file) } }}
          >
            <input ref={fileInput} type="file" accept="image/*" hidden aria-label="Screenshot file" onChange={(e) => { void attach(e.target.files?.[0]); e.target.value = '' }} />
            <button type="button" className="coach-attach" aria-label="Attach a screenshot" onClick={() => fileInput.current?.click()} disabled={thinking}>
              <ImagePlus size={18} aria-hidden="true" />
            </button>
            <textarea
              onPaste={(e) => { const file = pictureOf(e.clipboardData); if (file) { e.preventDefault(); void attach(file) } }}
              aria-label="Message the coach"
              placeholder="Ask, or ask for a change…"
              value={draft}
              rows={1}
              maxLength={2000}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(draft) } }}
            />
            <button type="submit" className="coach-send" aria-label="Send" disabled={(!draft.trim() && !shot) || thinking}>
              <ArrowUp size={18} aria-hidden="true" />
            </button>
          </form>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

function Message({ m, shot, onAct }: { m: CoachMessage; shot?: string; onAct: (id: string, action: 'apply' | 'decline' | 'undo') => Promise<void> }) {
  const rewrite = m.proposal?.edits.some((e) => e.op === 'rewrite')
  return (
    <div className={`coach-msg ${m.role === 'user' ? 'me' : 'coach'}`}>
      {m.image && (
        <img className="coach-shot" alt="Screenshot sent to the coach" src={shot ?? `/api/training/chat/${encodeURIComponent(m.id)}/image`} />
      )}
      {m.text && <div className="coach-text">{m.text}</div>}
      {m.proposal && (
        <div className={`coach-proposal ${m.status ?? ''}`} aria-label="Proposed change">
          <ul>{m.proposal.preview.map((l) => <li key={l}>{l}</li>)}</ul>
          {m.status === 'proposed' && (
            <div className="coach-actions">
              <button type="button" className="coach-apply" onClick={() => void onAct(m.id, 'apply')}>{rewrite ? 'Write it' : 'Apply'}</button>
              <button type="button" className="link-btn" onClick={() => void onAct(m.id, 'decline')}>Not that</button>
            </div>
          )}
          {m.status === 'applied' && (
            <div className="coach-actions">
              <span className="coach-status">{rewrite ? 'Started' : 'Applied'}</span>
              <button type="button" className="link-btn accent" onClick={() => void onAct(m.id, 'undo')}>Undo</button>
            </div>
          )}
          {m.status === 'declined' && <div className="coach-status">Not applied</div>}
          {m.status === 'undone' && <div className="coach-status">Undone</div>}
        </div>
      )}
      {m.note && <div className="coach-note">{m.note}</div>}
      {m.stats && <div className="coach-stats">{statsLine(m.stats)}</div>}
    </div>
  )
}
