import { useEffect, useRef, useState } from 'react'
import { Drawer } from 'vaul'
import { ArrowUp, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../lib/api.ts'
import { localDate } from '../../lib/nutrition.ts'
import type { CoachMessage, TrainingDay } from '../../types.ts'

interface CoachSheetProps {
  open: boolean
  onClose: () => void
  /** A change was applied or undone: the plan on screen fetches afresh. */
  onChanged: (day?: TrainingDay) => void
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
export default function CoachSheet({ open, onClose, onChanged }: CoachSheetProps) {
  const [messages, setMessages] = useState<CoachMessage[]>([])
  const [draft, setDraft] = useState('')
  const [thinking, setThinking] = useState(false)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    api.coach().then((r) => { setMessages(r.messages); setThinking(r.busy) }, (err: Error) => toast.error(err.message))
  }, [open])

  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }) }, [messages, thinking])

  const send = async (text: string): Promise<void> => {
    const message = text.trim()
    if (!message || thinking) return
    setDraft('')
    setThinking(true)
    // Shown at once; the server's copy replaces it with the reply.
    setMessages((m) => [...m, { id: `pending-${Date.now()}`, role: 'user', text: message, proposal: null, status: null, note: null, createdAt: Date.now() }])
    try {
      setMessages((await api.askCoach(message, localDate())).messages)
    } catch (err) {
      toast.error((err as Error).message)
      setDraft(message)
      setMessages((m) => m.filter((x) => !x.id.startsWith('pending-')))
    } finally {
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
    if (!window.confirm('Start a new conversation? Changes already applied stay.')) return
    try {
      setMessages((await api.clearCoach()).messages)
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
              <button type="button" className="link-btn accent" onClick={() => void clear()}>
                <RotateCcw size={13} aria-hidden="true" /> New chat
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
            {messages.map((m) => <Message key={m.id} m={m} onAct={act} />)}
            {thinking && <div className="coach-msg coach"><span className="spinner" aria-hidden="true" /> Thinking…</div>}
            <div ref={end} />
          </div>
          <form className="coach-compose" onSubmit={(e) => { e.preventDefault(); void send(draft) }}>
            <textarea
              aria-label="Message the coach"
              placeholder="Ask, or ask for a change…"
              value={draft}
              rows={1}
              maxLength={2000}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(draft) } }}
            />
            <button type="submit" className="coach-send" aria-label="Send" disabled={!draft.trim() || thinking}>
              <ArrowUp size={18} aria-hidden="true" />
            </button>
          </form>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

function Message({ m, onAct }: { m: CoachMessage; onAct: (id: string, action: 'apply' | 'decline' | 'undo') => Promise<void> }) {
  const rewrite = m.proposal?.edits.some((e) => e.op === 'rewrite')
  return (
    <div className={`coach-msg ${m.role === 'user' ? 'me' : 'coach'}`}>
      <div className="coach-text">{m.text}</div>
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
    </div>
  )
}
