'use client'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, ChevronLeft, Loader2, Lock, Unlock, Upload, CheckCircle2, Send, Play, Building2, BookOpen, RotateCcw, Copy, Check, Square } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useRouter } from 'next/navigation'
import { useStore } from '@/store/useStore'
import { projectsApi, wave1Api, wave2Api, entityDocumentsApi } from '@/lib/api'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { SourceBadge } from '@/components/CitedText'
import { SourcesPanel } from '@/components/SourcesPanel'
import { ExportReportButton } from '@/components/ExportReportButton'
import { MarkdownTable } from '@/components/MarkdownTable'
import { copyRenderedElement } from '@/lib/copyRichContent'
import { remarkWave1Citations } from '@/lib/remarkWave1Citations'
import {
  PILLAR_ORDER, FANOUT_ORDER, wave1Total, mainEntityAdapter, idiPathEnabled, wave1Sequence,
  getAgentObj, agentLabel, isApproved, buildCitationMaps, hasVersion, canUnlock, wave1ApprovedCount, statusMeta, defaultKickoffMessage,
} from '@/lib/wave1Client'
import { wave2Sequence, wave2OptionsEnabled, wave2SwotBEnabled, isWave2AgentId, WAVE2_OPTIONAL } from '@/lib/wave2Shared'

function fmtScore(n: number | null | undefined): string {
  return n == null ? '—' : n.toFixed(1)
}

const WAVES = [
  { key: 'diagnostic', label: 'Diagnostic', note: 'Internal + external analysis, feeding an entity-level SWOT.', available: true },
  { key: 'formulation', label: 'Formulation', note: 'Strategic direction, V/M/V and (optionally) strategic options, consolidated into SWOT Part B and a shift agenda.', available: true },
  { key: 'translation', label: 'Translation', note: 'Strategy map → KPIs → initiatives.', available: false },
  { key: 'execution', label: 'Execution', note: 'Alignment, operational plans, final plan documents.', available: false },
]

// ─── compact agent row, reused for pillar / narrative / fanout / swot cards ──────────────────────────
function AgentRow({ entity, id, onOpen, depLabels, gate, optional, onQuickRun, running, projectId }: {
  projectId?: string; entity: any; id: string; onOpen: (id: string) => void; depLabels?: string[]; gate?: boolean; optional?: boolean
  onQuickRun?: (id: string) => void; running?: boolean
}) {
  const agent = getAgentObj(entity, id)
  const meta = statusMeta(agent)
  const locked = agent.status === 'locked'
  const skipped = agent.status === 'skipped'
  const needsUpload = agent.uploadDep && !agent.uploadDep.done
  const showRun = onQuickRun && !locked && !skipped && !hasVersion(agent)
  const isPillar = PILLAR_ORDER.includes(id)
  const hasScore = isPillar && (agent.aiScore != null || agent.manualScore != null)

  return (
    <div
      onClick={() => { if (!skipped) onOpen(id) }}
      style={{
        display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px 14px',
        borderRadius: 'var(--radius)', background: locked || skipped ? 'rgba(69,85,105,0.03)' : 'var(--sia-white)',
        border: `1px ${optional ? 'dashed' : 'solid'} ${gate ? 'rgba(139,92,246,0.35)' : 'rgba(23,48,68,0.08)'}`,
        cursor: skipped ? 'default' : 'pointer', opacity: skipped ? 0.6 : 1,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
          {hasScore && (
            <div style={{ display: 'flex', gap: '8px', fontSize: '10px', fontWeight: 600 }} title="AI score / Reviewer score">
              <span style={{ color: 'var(--sia-medium-gray)' }}>AI {fmtScore(agent.aiScore)}</span>
              <span style={{ color: agent.manualScore != null ? 'var(--sia-teal)' : 'var(--sia-medium-gray)' }}>Rev {fmtScore(agent.manualScore)}</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0 }}>
            {locked && <Lock size={12} color="var(--sia-medium-gray)" />}
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--sia-cool-black)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {agentLabel(entity, id)}
            </span>
            {gate && <span style={{ fontSize: '10px', fontWeight: 600, color: '#8B5CF6', background: 'rgba(139,92,246,0.1)', padding: '2px 7px', borderRadius: '999px', flexShrink: 0 }}>GATE</span>}
            {optional && <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--sia-medium-gray)', background: 'rgba(69,85,105,0.08)', padding: '2px 7px', borderRadius: '999px', flexShrink: 0 }}>OPTIONAL</span>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {showRun ? (
            <button
              className="btn btn-ghost btn-sm" style={{ padding: '3px 8px', fontSize: '11px' }}
              disabled={running || agent.status === 'in_progress'}
              onClick={e => { e.stopPropagation(); onQuickRun!(id) }}
            >
              {running || agent.status === 'in_progress' ? <Loader2 size={11} className="spinner" /> : <Play size={11} />} Run
            </button>
          ) : (
            <>
              {projectId && agent.approvedVersion !== null && agent.chatHistory?.length > 0 && (
                <span onClick={e => e.stopPropagation()}>
                  <ExportReportButton compact projectId={projectId} entityId={entity.id} agentId={id} title={agentLabel(entity, id)} chatHistory={agent.chatHistory} />
                </span>
              )}
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: meta.color }} />
              <span style={{ fontSize: '11.5px', color: meta.color, fontWeight: 500 }}>{meta.label}</span>
            </>
          )}
        </div>
      </div>

      {locked && depLabels && depLabels.length > 0 && (
        <div style={{ fontSize: '11px', color: 'var(--sia-medium-gray)' }}>
          Waiting on: {depLabels.join(', ')}
        </div>
      )}
      {needsUpload && (
        <div style={{ fontSize: '11px', color: agent.uploadDep.done ? 'var(--sia-green)' : 'var(--sia-amber)' }}>
          {agent.uploadDep.label}: {agent.uploadDep.done ? `uploaded (${agent.uploadDep.collectionId})` : 'not uploaded yet'}
        </div>
      )}
    </div>
  )
}

// Animated "agent is working" bubble: rotating status phrases, a shimmering progress bar and an elapsed
// timer anchored to the server-side start time, so it stays accurate when the drawer is closed and reopened.
const WORKING_PHRASES = [
  'Reading your documents',
  'Retrieving relevant evidence',
  'Cross-referencing sources',
  'Analysing findings',
  'Drafting the response',
  'Checking citations',
  'Polishing the output',
]
function AgentWorkingIndicator({ startedAt, onStop, stopping }: { startedAt?: string; onStop?: () => void; stopping?: boolean }) {
  const [now, setNow] = useState(() => Date.now())
  const [mountedAt] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const parsed = startedAt ? new Date(startedAt).getTime() : NaN
  const start = Number.isFinite(parsed) ? parsed : mountedAt
  const elapsed = Math.max(0, Math.floor((now - start) / 1000))
  const phrase = WORKING_PHRASES[Math.min(Math.floor(elapsed / 8), WORKING_PHRASES.length - 1)]
  const mm = Math.floor(elapsed / 60), ss = String(elapsed % 60).padStart(2, '0')
  return (
    <div className="fade-in" style={{ maxWidth: '85%', minWidth: '220px', alignSelf: 'flex-start', background: 'var(--sia-light-gray)', borderRadius: '10px', padding: '9px 12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--sia-medium-gray)', marginBottom: '6px' }}>
        <span>Agent</span><span>{mm}:{ss}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px' }}>
        <Loader2 size={13} className="spinner" style={{ color: 'var(--sia-medium-teal)', flexShrink: 0 }} />
        <span key={phrase} className="fade-in">{phrase}…</span>
      </div>
      <div className="working-bar" />
      <div style={{ fontSize: '10.5px', color: 'var(--sia-medium-gray)', marginTop: '6px' }}>
        Runs in the background — you can close this and come back.
      </div>
      {onStop && (
        <button className="btn btn-ghost btn-sm" style={{ marginTop: '8px', padding: '3px 10px', fontSize: '11px' }} disabled={stopping} onClick={onStop}>
          {stopping ? <Loader2 size={11} className="spinner" /> : <Square size={11} />} Stop
        </button>
      )}
    </div>
  )
}

// ─── slide-in drawer: chat thread + send/approve — no run button, agents only act on a human message ──
function AgentDrawer({ project, entity, agentId, onChanged, onApproved, onStopped, quickRunning }: {
  project: any; entity: any; agentId: string; onChanged: () => Promise<void>; onApproved: (agentId: string) => Promise<void>
  onStopped: (agentId: string) => void; quickRunning?: boolean
}) {
  const agent = getAgentObj(entity, agentId)
  const meta = statusMeta(agent)
  const isPillar = PILLAR_ORDER.includes(agentId)
  const [chatInput, setChatInput] = useState('')
  const [pendingMessage, setPendingMessage] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [isUnlocking, setIsUnlocking] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  // A run started earlier (tab closed / reloaded / other device) keeps going on the server and persists its
  // own result. While the agent still reads 'in_progress' and this tab isn't the one streaming it, poll.
  const pending = (agent as any).pendingMessage as { content: string; at: string } | null | undefined
  const runningOnServer = agent.status === 'in_progress' && !isSending && !quickRunning
  const busy = isSending || isApproving || isUnlocking || isResetting || quickRunning || runningOnServer
  // Resync once on open: the store copy may predate a run that was started before the drawer was closed.
  useEffect(() => { onChanged().catch(() => {}) }, [agentId])
  useEffect(() => {
    if (!runningOnServer) return
    const startedAt = pending?.at ? new Date(pending.at).getTime() : Date.now()
    // Server functions are capped at 720s; past that the run is dead, so stop polling.
    if (Date.now() - startedAt > 13 * 60 * 1000) return
    const t = setInterval(() => { onChanged().catch(() => {}) }, 3000)
    return () => clearInterval(t)
  }, [runningOnServer, pending?.at])

  // Reviewer score — editable any time, independent of approval, saved on blur via its own endpoint.
  const [manualScoreInput, setManualScoreInput] = useState(agent.manualScore != null ? String(agent.manualScore) : '')
  const [savingManualScore, setSavingManualScore] = useState(false)
  useEffect(() => {
    setManualScoreInput(agent.manualScore != null ? String(agent.manualScore) : '')
  }, [agent.manualScore, agentId])

  async function saveManualScore() {
    const raw = manualScoreInput.trim()
    const val = raw === '' ? null : Number(raw)
    if (val !== null && (isNaN(val) || val < 1 || val > 5)) {
      alert('Reviewer score must be a number between 1 and 5.')
      setManualScoreInput(agent.manualScore != null ? String(agent.manualScore) : '')
      return
    }
    if (val === agent.manualScore) return
    setSavingManualScore(true)
    try {
      await wave1Api.setManualScore(project.id, entity.id, agentId, val)
      await onChanged()
    } catch (e: any) { alert('Failed to save reviewer score: ' + (e.response?.data?.error || e.message)) }
    setSavingManualScore(false)
  }

  // Approving a pillar requires the reviewer to confirm/enter both scores first — clicking Approve opens
  // this inline form instead of approving immediately; non-pillar agents (narrative/fanout/swot) approve
  // straight away, unaffected by scoring.
  const [showApproveScoreForm, setShowApproveScoreForm] = useState(false)
  const [approveAiScoreInput, setApproveAiScoreInput] = useState('')
  const [approveManualScoreInput, setApproveManualScoreInput] = useState('')
  const [uploading, setUploading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const responseRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const [copiedResponseIdx, setCopiedResponseIdx] = useState<number | null>(null)

  const copyResponse = async (i: number) => {
    const el = responseRefs.current[i]
    if (!el) return
    try {
      await copyRenderedElement(el)
      setCopiedResponseIdx(i)
      setTimeout(() => setCopiedResponseIdx(null), 1500)
    } catch {
      // clipboard access denied — nothing else to do
    }
  }

  // Citations in this drawer are scoped to this one agent's conversation, kept local (not the app-wide
  // globalSourceMeta cache) since a citation number in a different agent's conversation can refer to a
  // completely different source.
  const [sourcesPanelOpen, setSourcesPanelOpen] = useState(false)
  const [activeSourceNum, setActiveSourceNum] = useState<number | null>(null)
  const [localSourceMeta, setLocalSourceMeta] = useState<Record<string, { title: string; url: string | null }>>({})

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [agent.chatHistory?.length, pendingMessage, isSending])

  const locked = agent.status === 'locked'
  const chatHistory: any[] = agent.chatHistory || []
  const hasChatted = chatHistory.length > 0
  const alreadyRun = hasVersion(agent)
  const approved = agent.approvedVersion !== null
  const unlockable = canUnlock(entity, agentId)

  // Citation tokens -> display numbers + resolved sources for the whole conversation (see buildCitationMaps).
  const { tokenToNum, remappedSources } = useMemo(() => buildCitationMaps(chatHistory), [chatHistory])
  const sourceCount = Object.keys(remappedSources).length

  function openSource(num: number) {
    setActiveSourceNum(num)
    setSourcesPanelOpen(true)
  }

  async function send(message?: string) {
    const msg = message ?? chatInput
    if (!msg.trim() || busy) return
    setChatInput('')
    setPendingMessage(msg)
    setIsSending(true)
    try {
      for await (const data of wave1Api.chatWithAgent(project.id, entity.id, agentId, msg)) {
        if (data.error) throw new Error(data.error)
      }
      // Clear the optimistic bubble before refetching — onChanged() replaces the whole project (via the
      // global store) with the server's copy, which already contains this same message in chatHistory.
      // Refetching first (old order) left a render where both the optimistic bubble AND the persisted
      // history showed this message at once, which looked like the query had been sent a second time.
      setPendingMessage(null)
      setIsSending(false)
      await onChanged()
    } catch (e: any) {
      setPendingMessage(null)
      setIsSending(false)
      // A dropped connection doesn't cancel the run — it continues server-side. Resync and let polling pick it up.
      if (e instanceof TypeError || /^HTTP 5\d\d$|network|fetch/i.test(e.message || '')) { await onChanged().catch(() => {}); return }
      alert('Message failed: ' + (e.message || 'Unknown error'))
    }
  }

  function runAssessment() { send(defaultKickoffMessage(agentId, entity)) }

  async function approve() {
    setIsApproving(true)
    try {
      await wave1Api.approveAgent(project.id, entity.id, agentId)
      await onApproved(agentId)
    } catch (e: any) { alert('Approve failed: ' + (e.response?.data?.error || e.message)) }
    setIsApproving(false)
  }

  function startApprove() {
    if (!isPillar) { approve(); return }
    setApproveAiScoreInput(agent.aiScore != null ? String(agent.aiScore) : '')
    setApproveManualScoreInput(agent.manualScore != null ? String(agent.manualScore) : manualScoreInput)
    setShowApproveScoreForm(true)
  }

  async function confirmApproveWithScores() {
    const ai = Number(approveAiScoreInput)
    const rev = Number(approveManualScoreInput)
    if (!approveAiScoreInput.trim() || isNaN(ai) || ai < 1 || ai > 5) { alert('Enter a valid AI score between 1 and 5.'); return }
    if (!approveManualScoreInput.trim() || isNaN(rev) || rev < 1 || rev > 5) { alert('Enter a valid reviewer score between 1 and 5.'); return }
    setIsApproving(true)
    try {
      await wave1Api.approveAgent(project.id, entity.id, agentId, { aiScore: ai, manualScore: rev })
      setShowApproveScoreForm(false)
      await onApproved(agentId)
    } catch (e: any) { alert('Approve failed: ' + (e.response?.data?.error || e.message)) }
    setIsApproving(false)
  }

  async function unlock() {
    setIsUnlocking(true)
    try {
      await wave1Api.unlockAgent(project.id, entity.id, agentId)
      await onChanged()
    } catch (e: any) { alert('Unlock failed: ' + (e.response?.data?.error || e.message)) }
    setIsUnlocking(false)
  }

  // Abandons the run: the server clears the in_progress marker and discards the result if it ever arrives.
  async function stop() {
    setIsStopping(true)
    try {
      await wave1Api.stopAgent(project.id, entity.id, agentId)
      setPendingMessage(null)
      setIsSending(false)
      onStopped(agentId)
      await onChanged()
    } catch (e: any) { alert('Stop failed: ' + (e.response?.data?.error || e.message)) }
    setIsStopping(false)
  }

  async function restart() {
    if (!confirm('Restart this discussion? This clears the conversation and any draft assessment this agent has produced — it cannot be undone.')) return
    setIsResetting(true)
    try {
      await wave1Api.resetAgent(project.id, entity.id, agentId)
      await onChanged()
    } catch (e: any) { alert('Restart failed: ' + (e.response?.data?.error || e.message)) }
    setIsResetting(false)
  }

  async function handleUploadFiles(files: FileList | null) {
    if (!files?.length) return
    setUploading(true)
    try {
      await entityDocumentsApi.upload(project.id, entity.id, Array.from(files), 'interview_transcript', 'Interview transcripts', 'interview')
      await onChanged()
    } catch (e: any) { alert('Upload failed: ' + (e.response?.data?.error || e.message)) }
    setUploading(false)
  }

  return (
    <SheetContent
      side="right" className="w-full sm:max-w-full p-0 gap-0"
      style={{ display: 'flex', flexDirection: 'row', height: '100dvh' }}
    >
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      <SheetHeader style={{ flexShrink: 0, padding: '20px 32px 16px', borderBottom: '1px solid rgba(23,48,68,0.08)' }}>
        <SheetTitle>{agentLabel(entity, agentId)}</SheetTitle>
        <SheetDescription>
          <span style={{ color: meta.color, fontWeight: 600 }}>{meta.label}</span>
          {agent.approvedAt && ` · approved by ${agent.approvedBy || 'reviewer'}`}
        </SheetDescription>
        {approved && chatHistory.length > 0 && (
          <div style={{ marginTop: '8px' }}>
            <ExportReportButton projectId={project.id} entityId={entity.id} agentId={agentId} title={agentLabel(entity, agentId)} chatHistory={chatHistory} />
          </div>
        )}
        {isPillar && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '18px', marginTop: '10px' }}>
            <div style={{ fontSize: '11.5px', color: 'var(--sia-medium-gray)' }}>
              AI score: <strong style={{ color: 'var(--sia-navy)' }}>{fmtScore(agent.aiScore)}</strong>
              {!approved && <span style={{ marginLeft: '4px' }}>(confirmed on approve)</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label htmlFor="reviewer-score-input" style={{ fontSize: '11.5px', color: 'var(--sia-medium-gray)' }}>Reviewer score:</label>
              <input
                id="reviewer-score-input"
                type="number" min={1} max={5} step={0.1}
                placeholder="—"
                value={manualScoreInput}
                onChange={e => setManualScoreInput(e.target.value)}
                onBlur={saveManualScore}
                disabled={savingManualScore}
                style={{ width: '58px', fontSize: '12px', padding: '3px 6px', borderRadius: '4px', border: '1px solid rgba(23,48,68,0.15)' }}
              />
              {savingManualScore && <Loader2 size={12} className="spinner" />}
            </div>
          </div>
        )}
      </SheetHeader>

      {sourceCount > 0 && (
        <button
          onClick={() => setSourcesPanelOpen(v => !v)}
          title={sourcesPanelOpen ? 'Close sources panel' : 'Open sources panel'}
          style={{
            position: 'absolute', top: '18px', right: '32px', zIndex: 5,
            display: 'flex', alignItems: 'center', gap: '6px',
            background: sourcesPanelOpen ? 'var(--sia-navy)' : 'rgba(23,48,68,0.06)',
            color: sourcesPanelOpen ? '#fff' : 'var(--sia-navy)',
            border: 'none', borderRadius: '999px', padding: '6px 12px', cursor: 'pointer',
            fontSize: '11.5px', fontWeight: 600,
          }}
        >
          <BookOpen size={13} /> Sources
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '16px', height: '16px',
            borderRadius: '8px', background: sourcesPanelOpen ? 'var(--sia-teal)' : 'var(--sia-navy)', color: '#fff',
            fontSize: '9px', fontWeight: 700,
          }}>
            {sourceCount}
          </span>
        </button>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ width: '100%', maxWidth: '760px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {locked && (
            <div style={{ fontSize: '12.5px', color: 'var(--sia-medium-gray)', background: 'rgba(69,85,105,0.05)', padding: '10px 12px', borderRadius: 'var(--radius)' }}>
              This agent is locked until its upstream dependencies are approved.
              {agent.depIds?.length > 0 && ` Waiting on: ${agent.depIds.map((id: string) => agentLabel(entity, id)).join(', ')}.`}
            </div>
          )}

          {agent.uploadDep && (
            <div style={{ padding: '12px', borderRadius: 'var(--radius)', background: agent.uploadDep.done ? 'rgba(16,185,129,0.06)' : 'rgba(245,158,11,0.08)', border: `1px solid ${agent.uploadDep.done ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.3)'}` }}>
              <div style={{ fontSize: '12.5px', color: 'var(--sia-cool-black)', marginBottom: '6px' }}>{agent.uploadDep.hint}</div>
              {agent.uploadDep.done ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--sia-green)', fontWeight: 600 }}>
                  <CheckCircle2 size={13} /> {agent.uploadDep.label} uploaded ({agent.uploadDep.collectionId})
                </div>
              ) : (
                <>
                  <input ref={fileInputRef} type="file" multiple hidden onChange={e => handleUploadFiles(e.target.files)} />
                  <button className="btn btn-ghost btn-sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                    {uploading ? <Loader2 size={13} className="spinner" /> : <Upload size={13} />}
                    Upload {agent.uploadDep.label.toLowerCase()} →
                  </button>
                </>
              )}
            </div>
          )}

          {!locked && (
            <>
              <div className="fade-in" style={{ fontSize: '11.5px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--sia-medium-gray)' }}>
                Conversation with this agent
              </div>
              {!hasChatted && !pendingMessage && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {quickRunning ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12.5px', color: 'var(--sia-medium-gray)' }}>
                      <Loader2 size={13} className="spinner" /> Running assessment…
                    </div>
                  ) : (
                    <>
                      <p style={{ fontSize: '12px', color: 'var(--sia-medium-gray)', margin: 0 }}>
                        This agent hasn't run yet — nothing happens automatically. Click Run for a standard first pass (sent as a chat message, along with this entity's document collection), or type your own instruction below.
                      </p>
                      <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={runAssessment}>
                        {isSending ? <Loader2 size={13} className="spinner" /> : <Play size={13} />} Run assessment
                      </button>
                    </>
                  )}
                </div>
              )}
              {chatHistory.map((m: any, i: number) => (
                <div key={i} style={{
                  maxWidth: '85%', alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  background: m.role === 'user' ? 'rgba(0,222,204,0.1)' : 'var(--sia-light-gray)',
                  borderRadius: '10px', padding: '9px 12px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                    <span style={{ fontSize: '10px', color: 'var(--sia-medium-gray)' }}>
                      {m.role === 'user' ? 'You' : 'Agent'}
                    </span>
                    {m.role === 'agent' && (
                      <button
                        type="button"
                        onClick={() => copyResponse(i)}
                        title="Copy response"
                        style={{
                          display: 'flex', alignItems: 'center', gap: '4px',
                          fontSize: '10px', color: copiedResponseIdx === i ? '#077C84' : 'var(--sia-medium-gray)',
                          background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
                        }}
                      >
                        {copiedResponseIdx === i ? <Check size={11} /> : <Copy size={11} />}
                        {copiedResponseIdx === i ? 'Copied' : 'Copy'}
                      </button>
                    )}
                  </div>
                  {m.role === 'agent' ? (
                    <div className="chat-response-body" ref={el => { responseRefs.current[i] = el }}>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkWave1Citations]}
                        components={{
                          table: MarkdownTable,
                          // @ts-expect-error — custom element injected by remarkWave1Citations, not a real HTML tag
                          wave1cite: ({ tokens }: { tokens?: string }) => (
                            <>
                              {(tokens || '').split(',').filter(Boolean).map(token => {
                                const num = tokenToNum[token]
                                if (num == null) return null
                                return (
                                  <SourceBadge
                                    key={token}
                                    num={num}
                                    metaOverride={localSourceMeta[String(num)]}
                                    onClick={() => openSource(num)}
                                  />
                                )
                              })}
                            </>
                          ),
                        }}
                      >
                        {m.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <div style={{ fontSize: '12.5px', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{m.content}</div>
                  )}
                </div>
              ))}
              {!pendingMessage && runningOnServer && pending?.content && (
                <div className="fade-in" style={{ maxWidth: '85%', alignSelf: 'flex-end', background: 'rgba(0,222,204,0.1)', borderRadius: '10px', padding: '9px 12px' }}>
                  <div style={{ fontSize: '10px', color: 'var(--sia-medium-gray)', marginBottom: '3px' }}>You</div>
                  <div style={{ fontSize: '12.5px', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{pending.content}</div>
                </div>
              )}
              {pendingMessage && (
                <div className="fade-in" style={{ maxWidth: '85%', alignSelf: 'flex-end', background: 'rgba(0,222,204,0.1)', borderRadius: '10px', padding: '9px 12px' }}>
                  <div style={{ fontSize: '10px', color: 'var(--sia-medium-gray)', marginBottom: '3px' }}>You</div>
                  <div style={{ fontSize: '12.5px', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{pendingMessage}</div>
                </div>
              )}
              {(isSending || runningOnServer || quickRunning) && <AgentWorkingIndicator startedAt={pending?.at} onStop={stop} stopping={isStopping} />}
              <div ref={chatEndRef} />
            </>
          )}
        </div>
      </div>

      {!locked && (
        <div style={{ flexShrink: 0, borderTop: '1px solid rgba(23,48,68,0.08)', padding: '16px 32px 20px', display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: '100%', maxWidth: '760px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {approved ? (
              <div style={{ fontSize: '12px', color: 'var(--sia-medium-gray)', background: 'rgba(69,85,105,0.05)', padding: '10px 12px', borderRadius: 'var(--radius)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div>
                  This {isPillar ? "pillar's" : "agent's"} conversation is approved and saved as its output — no further messages can be sent to this agent. Move on to the next step.
                  {!unlockable && (isWave2AgentId(agentId) || agentId === 'swot'
                    ? ' A later step has already run off this output, so it can no longer be unlocked.'
                    : ' The SWOT agent has already run off this output, so it can no longer be unlocked.')}
                </div>
                {unlockable && (
                  <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={unlock}>
                    {isUnlocking ? <Loader2 size={13} className="spinner" /> : <Unlock size={13} />} Unlock to continue the conversation
                  </button>
                )}
              </div>
            ) : (
              <>
                <textarea
                  className="form-input" rows={3}
                  placeholder={alreadyRun ? 'e.g. reweight this criterion and rerun' : 'e.g. focus especially on liquidity risk'}
                  value={chatInput} onChange={e => setChatInput(e.target.value)}
                  disabled={busy}
                />
                {/* Below the chat bar, left of Send — reachable the moment a response looks good enough, without
                    requiring the agent to have reached a finalized/scored output first. Approving freezes
                    whatever's been said so far as this agent's assessment. */}
                {showApproveScoreForm ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', borderRadius: 'var(--radius)', background: 'rgba(0,222,204,0.06)', border: '1px solid rgba(0,222,204,0.25)' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--sia-navy)' }}>Confirm scores to approve this pillar</div>
                    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <label htmlFor="approve-ai-score" style={{ fontSize: '12px', color: 'var(--sia-medium-gray)' }}>AI score</label>
                        <input
                          id="approve-ai-score" type="number" min={1} max={5} step={0.1} autoFocus
                          value={approveAiScoreInput} onChange={e => setApproveAiScoreInput(e.target.value)}
                          style={{ width: '64px', fontSize: '12px', padding: '4px 6px', borderRadius: '4px', border: '1px solid rgba(23,48,68,0.15)' }}
                        />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <label htmlFor="approve-reviewer-score" style={{ fontSize: '12px', color: 'var(--sia-medium-gray)' }}>Reviewer score</label>
                        <input
                          id="approve-reviewer-score" type="number" min={1} max={5} step={0.1}
                          value={approveManualScoreInput} onChange={e => setApproveManualScoreInput(e.target.value)}
                          style={{ width: '64px', fontSize: '12px', padding: '4px 6px', borderRadius: '4px', border: '1px solid rgba(23,48,68,0.15)' }}
                        />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="btn btn-primary btn-sm" disabled={busy} onClick={confirmApproveWithScores}>
                        {isApproving ? <Loader2 size={13} className="spinner" /> : <CheckCircle2 size={13} />} Confirm & approve
                      </button>
                      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setShowApproveScoreForm(false)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {hasChatted && (
                          <>
                            <button className="btn btn-primary btn-sm" disabled={busy} onClick={startApprove}>
                              {isApproving ? <Loader2 size={13} className="spinner" /> : <CheckCircle2 size={13} />} Approve & move to the next step
                            </button>
                            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={restart}>
                              {isResetting ? <Loader2 size={13} className="spinner" /> : <RotateCcw size={13} />} Restart discussion
                            </button>
                          </>
                        )}
                      </div>
                      <button className="btn btn-ghost btn-sm" disabled={busy || !chatInput.trim()} onClick={() => send()}>
                        {isSending ? <Loader2 size={13} className="spinner" /> : <Send size={13} />} Send to this agent
                      </button>
                    </div>
                    {hasChatted && (
                      <p style={{ fontSize: '11px', color: 'var(--sia-medium-gray)', margin: 0 }}>
                        {isPillar
                          ? "Approving asks you to confirm the AI's score and your own reviewer score, saves this conversation as this pillar's assessment, unlocks the next pillar, and closes this agent to further messages."
                          : 'Approving saves this conversation as this agent\'s assessment, unlocks the next step, and closes this agent to further messages.'}
                      </p>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
      </div>

      <div style={{
        flexShrink: 0, height: '100%', overflow: 'hidden',
        width: sourcesPanelOpen ? '340px' : '0px', transition: 'width 0.2s',
        borderLeft: sourcesPanelOpen ? '1px solid rgba(23,48,68,0.08)' : 'none',
      }}>
        {sourcesPanelOpen && (
          <div style={{ width: '340px', height: '100%' }}>
            <SourcesPanel
              projectId={project.id}
              citations={[]}
              newSources={remappedSources}
              open={sourcesPanelOpen}
              sidebar
              activeBadgeNum={activeSourceNum}
              onClose={() => setSourcesPanelOpen(false)}
              onResolvedMeta={setLocalSourceMeta}
            />
          </div>
        )}
      </div>
    </SheetContent>
  )
}

// ─── "Do you have documents to generate the IDI guide from?" — gates whether external analysis runs the
// idiGuide → human interview → idiSynth path at all, or skips straight to bench/pestel/marketSizing/
// competitor off the entity's own document collection. Asked once per entity, before either path starts.
function IdiChoicePrompt({ project, entity, onChanged }: { project: any; entity: any; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)

  async function choose(hasDocuments: boolean) {
    setBusy(true)
    try {
      await wave1Api.setIdiDocumentsAvailable(project.id, entity.id, hasDocuments)
      await onChanged()
    } catch (e: any) { alert('Failed to save: ' + (e.response?.data?.error || e.message)) }
    setBusy(false)
  }

  return (
    <div style={{ padding: '14px', borderRadius: 'var(--radius)', background: 'rgba(0,222,204,0.05)', border: '1px solid rgba(0,222,204,0.25)' }}>
      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--sia-navy)', marginBottom: '4px' }}>
        Do you have documents to generate the IDI interview guide?
      </div>
      <div style={{ fontSize: '11.5px', color: 'var(--sia-medium-gray)', marginBottom: '10px' }}>
        Yes runs IDI Guide → human-run interviews → IDI Synth before external analysis, as usual. No skips that
        path — bench, PESTEL, market sizing and competitor analysis run straight off the entity's uploaded
        company documents, feeding SWOT directly.
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => choose(true)}>
          {busy && <Loader2 size={11} className="spinner" />} Yes
        </button>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => choose(false)}>
          {busy && <Loader2 size={11} className="spinner" />} No
        </button>
      </div>
    </div>
  )
}

// Lets the reviewer flip the yes/no answer above, but only up until something on either path has actually
// started (mirrors the server-side guard in setIdiDocumentsAvailable) — after that it's final.
function IdiChoiceToggle({ project, entity, onChanged }: { project: any; entity: any; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const idiEnabled = idiPathEnabled(entity)

  async function toggle() {
    setBusy(true)
    try {
      await wave1Api.setIdiDocumentsAvailable(project.id, entity.id, !idiEnabled)
      await onChanged()
    } catch (e: any) { alert('Failed to change: ' + (e.response?.data?.error || e.message)) }
    setBusy(false)
  }

  return (
    <button
      onClick={toggle} disabled={busy}
      style={{ background: 'none', border: 'none', padding: 0, color: 'var(--sia-teal)', fontSize: '11px', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}
    >
      {busy ? 'saving…' : 'change'}
    </button>
  )
}

// ─── Diagnostic wave content (the only wave with real agents wired up) ────────────────────────────────
function DiagnosticWaveContent({ project, entity, onOpen, onChanged, onQuickRun, runningIds }: {
  project: any; entity: any; onOpen: (id: string) => void; onChanged: () => Promise<void>
  onQuickRun: (id: string) => void; runningIds: Set<string>
}) {
  const [expandInternal, setExpandInternal] = useState(true)
  const [expandExternal, setExpandExternal] = useState(true)

  const pillarDoneCt = PILLAR_ORDER.filter(id => isApproved(entity, id)).length
  const fanoutDoneCt = FANOUT_ORDER.filter(id => isApproved(entity, id)).length
  const idiSynth = entity.assessment.externalAgents.idiSynth
  const idiChoice: boolean | null = entity.assessment.idiDocumentsAvailable
  const idiEnabled = idiPathEnabled(entity)
  const idiChoiceLocked = [
    entity.assessment.externalAgents.idiGuide, entity.assessment.externalAgents.idiSynth,
    ...FANOUT_ORDER.map(id => entity.assessment.externalAgents[id]),
  ].some((a: any) => a.chatHistory?.length)

  return (
    <>
      <div className="card fade-in" style={{ padding: '16px 18px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setExpandInternal(v => !v)}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--sia-navy)' }}>Internal analysis</div>
            <div style={{ fontSize: '11.5px', color: 'var(--sia-medium-gray)' }}>{pillarDoneCt} of 8 pillars approved · run in any order</div>
          </div>
          {expandInternal ? <ChevronDown size={16} color="var(--sia-medium-gray)" /> : <ChevronRight size={16} color="var(--sia-medium-gray)" />}
        </div>
        {expandInternal && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '8px', marginTop: '14px' }}>
            {PILLAR_ORDER.map(id => (
              <AgentRow projectId={project.id}
                key={id} entity={entity} id={id} onOpen={onOpen} onQuickRun={onQuickRun} running={runningIds.has(id)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="card fade-in" style={{ padding: '16px 18px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setExpandExternal(v => !v)}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--sia-navy)' }}>External analysis</div>
            <div style={{ fontSize: '11.5px', color: 'var(--sia-medium-gray)' }}>
              {idiChoice === null
                ? `${fanoutDoneCt} of 4 approved · all unlock once IDI is approved or skipped`
                : idiEnabled
                ? `IDI Guide → human-run interviews → IDI Synth, then ${fanoutDoneCt} of 4 approved · run in any order`
                : `Skipping IDI (no interview documents) — ${fanoutDoneCt} of 4 approved · run in any order`}
            </div>
          </div>
          {expandExternal ? <ChevronDown size={16} color="var(--sia-medium-gray)" /> : <ChevronRight size={16} color="var(--sia-medium-gray)" />}
        </div>
        {expandExternal && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '14px' }}>
            {idiChoice === null ? (
              <IdiChoicePrompt project={project} entity={entity} onChanged={onChanged} />
            ) : (
              <>
                {!idiChoiceLocked && (
                  <div style={{ fontSize: '11px', color: 'var(--sia-medium-gray)' }}>
                    Documents available for an IDI guide: <strong>{idiEnabled ? 'Yes' : 'No'}</strong>
                    {' · '}
                    <IdiChoiceToggle project={project} entity={entity} onChanged={onChanged} />
                  </div>
                )}
                {idiEnabled && (
                  <>
                    <AgentRow projectId={project.id} entity={entity} id="idiGuide" onOpen={onOpen} onQuickRun={onQuickRun} running={runningIds.has('idiGuide')} />
                    <AgentRow projectId={project.id} entity={entity} id="idiSynth" onOpen={onOpen} onQuickRun={onQuickRun} running={runningIds.has('idiSynth')} depLabels={['IDI Guide (approved)', idiSynth.uploadDep?.done ? 'interview transcripts (uploaded)' : 'interview transcripts (not uploaded)']} />
                  </>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px', paddingLeft: idiEnabled ? '18px' : '0' }}>
                  {FANOUT_ORDER.map(id => (
                    <AgentRow projectId={project.id}
                      key={id} entity={entity} id={id} onOpen={onOpen} onQuickRun={onQuickRun} running={runningIds.has(id)}
                      depLabels={idiEnabled ? ['IDI Synth (approved)'] : undefined}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="card fade-in" style={{ padding: '16px 18px' }}>
        <AgentRow projectId={project.id}
          entity={entity} id="swot" onOpen={onOpen} gate onQuickRun={onQuickRun} running={runningIds.has('swot')}
          depLabels={[...PILLAR_ORDER, ...FANOUT_ORDER].filter(id => !isApproved(entity, id)).map(id => agentLabel(entity, id))}
        />
      </div>
    </>
  )
}

// ─── Wave 2 (Formulation) ───────────────────────────────────────────────────────────────────────────────
// Mirrors the Wave 2 functional flow diagram: 1. Strategic Direction → 2. V/M/V → 3. Strategic Options
// (optional: Design → Evaluation & Selection) → 4. SWOT Part B → 5. Shift Agenda. The edges themselves live in
// lib/wave2Shared.ts; the rows here just show which of an agent's upstream inputs are still unapproved.
function wave2WaitingOn(entity: any, id: string): string[] {
  return (getAgentObj(entity, id).depIds || [])
    .filter((d: string) => !isApproved(entity, d))
    .map((d: string) => d === 'swot' ? 'SWOT Part A (Wave 1)' : agentLabel(entity, d))
}

function OptionsChoicePrompt({ project, entity, onChanged, step = 'options' }: { project: any; entity: any; onChanged: () => Promise<void>; step?: 'options' | 'swotB' }) {
  const [busy, setBusy] = useState(false)
  const isSwotB = step === 'swotB'
  const choice: boolean | null = isSwotB ? entity.assessment.wave2.swotBEnabled ?? null : entity.assessment.wave2.optionsEnabled
  const enabled = isSwotB ? wave2SwotBEnabled(entity.assessment) : wave2OptionsEnabled(entity.assessment)
  const agents = entity.assessment.wave2.agents
  // Same lock as the server's setWave2OptionsEnabled / setWave2SwotBEnabled: once the step or anything after it
  // has begun, the choice is final.
  const lockIds = isSwotB ? ['swotB', 'shiftAgenda'] : [...WAVE2_OPTIONAL, 'swotB', 'shiftAgenda']
  const locked = lockIds.some(id => agents[id].chatHistory?.length || agents[id].versionHistory?.length)

  async function choose(value: boolean) {
    setBusy(true)
    try {
      await (isSwotB ? wave2Api.setSwotBEnabled : wave2Api.setOptionsEnabled)(project.id, entity.id, value)
      await onChanged()
    } catch (e: any) { alert('Failed to save: ' + (e.response?.data?.error || e.message)) }
    setBusy(false)
  }

  if (choice === null) {
    return (
      <div style={{ padding: '14px', borderRadius: 'var(--radius)', background: 'rgba(0,222,204,0.05)', border: '1px solid rgba(0,222,204,0.25)' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--sia-navy)', marginBottom: '4px' }}>
          {isSwotB ? 'Do you want to run the optional SWOT Part B step?' : 'Do you want to run the optional strategic options step?'}
        </div>
        <div style={{ fontSize: '11.5px', color: 'var(--sia-medium-gray)', marginBottom: '10px' }}>
          {isSwotB
            ? 'Yes runs SWOT Part B before the Shift Agenda. No skips it — the Shift Agenda runs without it.'
            : 'Yes runs Strategic Options Design → Strategic Options Evaluation & Selection before SWOT Part B. No skips both — SWOT Part B and the Shift Agenda run straight off Strategic Direction, V/M/V and SWOT Part A.'}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => choose(true)}>
            {busy && <Loader2 size={11} className="spinner" />} Yes, include it
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => choose(false)}>
            {busy && <Loader2 size={11} className="spinner" />} No, skip it
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ fontSize: '11px', color: 'var(--sia-medium-gray)' }}>
      {isSwotB ? 'SWOT Part B step' : 'Strategic options step'}: <strong>{enabled ? 'included' : 'skipped'}</strong>
      {!locked && (
        <>
          {' · '}
          <button
            onClick={() => choose(!enabled)} disabled={busy}
            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--sia-teal)', fontSize: '11px', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}
          >
            {busy ? 'saving…' : 'change'}
          </button>
        </>
      )}
    </div>
  )
}

function FormulationWaveContent({ project, entity, onOpen, onChanged, onQuickRun, runningIds }: {
  project: any; entity: any; onOpen: (id: string) => void; onChanged: () => Promise<void>
  onQuickRun: (id: string) => void; runningIds: Set<string>
}) {
  const enabled = wave2OptionsEnabled(entity.assessment)
  const swotBEnabled = wave2SwotBEnabled(entity.assessment)
  const swotBChosen = entity.assessment.wave2.swotBEnabled != null
  const swotApproved = isApproved(entity, 'swot')
  const row = (id: string, extra?: { gate?: boolean; optional?: boolean }) => (
    <AgentRow projectId={project.id}
      key={id} entity={entity} id={id} onOpen={onOpen} onQuickRun={onQuickRun} running={runningIds.has(id)}
      depLabels={wave2WaitingOn(entity, id)} {...extra}
    />
  )

  return (
    <>
      {!swotApproved && (
        <div style={{ fontSize: '12.5px', color: 'var(--sia-cool-black)', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', padding: '10px 12px', borderRadius: 'var(--radius)', marginBottom: '16px' }}>
          Wave 2 starts once SWOT Part A (the Diagnostic wave's entity SWOT) is approved — its conversation is passed to every
          Formulation agent. Approve it in the Diagnostic tab first.
        </div>
      )}

      <div className="card fade-in" style={{ padding: '16px 18px', marginBottom: '16px' }}>
        <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--sia-navy)' }}>Direction</div>
        <div style={{ fontSize: '11.5px', color: 'var(--sia-medium-gray)', marginBottom: '14px' }}>
          Strategic Direction (SWOT Part A + company documents) feeds V/M/V, which also draws on SWOT Part A.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {row('direction')}
          {row('vmv')}
        </div>
      </div>

      <div className="card fade-in" style={{ padding: '16px 18px', marginBottom: '16px' }}>
        <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--sia-navy)' }}>Strategic options <span style={{ fontWeight: 500, color: 'var(--sia-medium-gray)' }}>(optional)</span></div>
        <div style={{ fontSize: '11.5px', color: 'var(--sia-medium-gray)', marginBottom: '14px' }}>
          Options Design proposes the options; Options Evaluation & Selection assesses them against SWOT Part A, Direction, V/M/V and the design.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <OptionsChoicePrompt project={project} entity={entity} onChanged={onChanged} />
          {entity.assessment.wave2.optionsEnabled !== null && (
            <>
              {row('optionsDesign', { optional: true })}
              {row('optionsEval', { optional: true })}
              {!enabled && (
                <div style={{ fontSize: '11px', color: 'var(--sia-medium-gray)' }}>
                  Skipped — SWOT Part B and the Shift Agenda don't wait on these.
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="card fade-in" style={{ padding: '16px 18px' }}>
        <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--sia-navy)' }}>Consolidation</div>
        <div style={{ fontSize: '11.5px', color: 'var(--sia-medium-gray)', marginBottom: '14px' }}>
          SWOT Part B (optional) re-assesses the position given the direction{enabled ? ' and selected options' : ''}; the Shift Agenda closes the wave.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <OptionsChoicePrompt project={project} entity={entity} onChanged={onChanged} step="swotB" />
          {swotBChosen && row('swotB', { optional: true })}
          {swotBChosen && !swotBEnabled && (
            <div style={{ fontSize: '11px', color: 'var(--sia-medium-gray)' }}>
              Skipped — the Shift Agenda doesn't wait on SWOT Part B.
            </div>
          )}
          {row('shiftAgenda', { gate: true })}
        </div>
      </div>
    </>
  )
}

export default function AssessmentPage() {
  const router = useRouter()
  const { project, activeEntityId, setProject } = useStore()
  const [activeWave, setActiveWave] = useState('diagnostic')
  const [openAgentId, setOpenAgentId] = useState<string | null>(null)
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set())

  // Runs live on the server and outlive this page (tab closed, navigated away, several agents at once), so
  // the stored project is the source of truth — not whichever SSE stream this page happens to hold open.
  // Resync on mount, and keep polling while any agent of this entity still reads 'in_progress'.
  const projectIdForSync: string | undefined = project?.id
  const syncEntity = project
    ? (activeEntityId ? ((project.entities || []).find((e: any) => e.id === activeEntityId) ?? mainEntityAdapter(project)) : mainEntityAdapter(project))
    : null
  const runStartTimes: number[] = []
  if (syncEntity) {
    for (const id of [...wave1Sequence(syncEntity), ...wave2Sequence(syncEntity.assessment)]) {
      const a = getAgentObj(syncEntity, id)
      if (a?.status === 'in_progress') runStartTimes.push(a.pendingMessage?.at ? new Date(a.pendingMessage.at).getTime() : Date.now())
    }
  }
  // Server functions are capped at 720s; a run older than that is dead, so don't poll for it forever.
  const anyRunning = runStartTimes.some(t => Date.now() - t < 13 * 60 * 1000)
  useEffect(() => {
    if (!projectIdForSync) return
    projectsApi.get(projectIdForSync).then(r => setProject(r.data)).catch(() => {})
  }, [projectIdForSync])
  useEffect(() => {
    if (!projectIdForSync || !anyRunning) return
    const t = setInterval(() => { projectsApi.get(projectIdForSync).then(r => setProject(r.data)).catch(() => {}) }, 3000)
    return () => clearInterval(t)
  }, [projectIdForSync, anyRunning])

  if (!project) return null

  // Mirrors every other page's convention: activeEntityId null (or stale/unmatched) means the primary entity.
  const projectId: string = project.id
  const entities = project.entities || []
  const entity = activeEntityId ? (entities.find((e: any) => e.id === activeEntityId) ?? mainEntityAdapter(project)) : mainEntityAdapter(project)
  const wave = WAVES.find(w => w.key === activeWave)!

  async function refresh() {
    const updated = await projectsApi.get(projectId)
    setProject(updated.data)
  }

  // After approving an agent, jump to the next one in display order that's unapproved and not locked
  // (agents can be run in any order, so a later one may still be gated). If none qualifies, close the drawer.
  async function advanceAfterApprove(approvedAgentId: string) {
    const updated = await projectsApi.get(projectId)
    setProject(updated.data)
    const freshEntities = updated.data.entities || []
    const freshEntity = activeEntityId
      ? (freshEntities.find((e: any) => e.id === activeEntityId) ?? mainEntityAdapter(updated.data))
      : mainEntityAdapter(updated.data)
    const sequence = isWave2AgentId(approvedAgentId) ? wave2Sequence(freshEntity.assessment) : wave1Sequence(freshEntity)
    const idx = sequence.indexOf(approvedAgentId)
    const next = sequence.slice(idx + 1).find(id => !isApproved(freshEntity, id) && !['locked', 'skipped'].includes(getAgentObj(freshEntity, id).status))
    setOpenAgentId(next ?? null)
  }

  async function quickRun(agentId: string) {
    setRunningIds(prev => new Set(prev).add(agentId))
    try {
      for await (const data of wave1Api.chatWithAgent(projectId, entity.id, agentId, defaultKickoffMessage(agentId, entity))) {
        if (data.error) throw new Error(data.error)
      }
      await refresh()
      // With several agents running at once, don't yank the reviewer out of whatever drawer they have open.
      setOpenAgentId(cur => cur ?? agentId)
    } catch (e: any) {
      // A dropped connection doesn't cancel the run — it carries on server-side and polling picks it up.
      if (e instanceof TypeError || /^HTTP 5\d\d$|network|fetch/i.test(e.message || '')) await refresh().catch(() => {})
      else alert('Run failed: ' + (e.message || 'Unknown error'))
    }
    setRunningIds(prev => { const next = new Set(prev); next.delete(agentId); return next })
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '32px', maxWidth: '1400px' }}>
      <button className="btn btn-ghost btn-sm" style={{ marginBottom: '14px' }} onClick={() => router.push('/dashboard')}>
        <ChevronLeft size={14} /> All entities
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
        <Building2 size={18} color="#8B5CF6" />
        <p style={{ fontSize: '20px', fontWeight: 700, margin: 0, color: 'var(--sia-navy)', fontFamily: 'var(--font-display)' }}>{entity.name}</p>
        <span style={{ fontSize: '11px', color: '#8B5CF6', background: 'rgba(139,92,246,0.1)', padding: '2px 8px', borderRadius: '999px', fontWeight: 600 }}>{entity.type}</span>
      </div>
      <p style={{ fontSize: '13px', color: 'var(--sia-cool-gray)', margin: '0 0 18px' }}>
        Every agent below is conversational — a human sends it a message to produce or revise a draft, then approves the version that gets passed to whatever depends on it.
      </p>

      <div style={{ display: 'flex', border: '1px solid rgba(23,48,68,0.1)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: '10px' }}>
        {WAVES.map(w => (
          <div
            key={w.key}
            onClick={() => setActiveWave(w.key)}
            style={{
              flex: 1, padding: '11px 14px', cursor: 'pointer', borderRight: '1px solid rgba(23,48,68,0.08)',
              background: activeWave === w.key ? 'rgba(0,222,204,0.08)' : 'var(--sia-white)',
            }}
          >
            <div style={{ fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.04em', color: activeWave === w.key ? 'var(--sia-teal)' : 'var(--sia-medium-gray)' }}>
              {w.available ? '' : 'Not yet available · '}{w.label}
            </div>
            <div style={{ fontSize: '13.5px', fontWeight: 600, color: activeWave === w.key ? 'var(--sia-navy)' : 'var(--sia-cool-black)' }}>
              {w.key === 'diagnostic' ? `${wave1ApprovedCount(entity)}/${wave1Total(entity)} approved`
                : w.key === 'formulation' ? `${wave2Sequence(entity.assessment).filter(id => isApproved(entity, id)).length}/${wave2Sequence(entity.assessment).length} approved`
                : '—'}
            </div>
          </div>
        ))}
      </div>
      <p style={{ fontSize: '12.5px', color: 'var(--sia-medium-gray)', margin: '0 0 20px' }}>{wave.note}</p>

      {activeWave === 'diagnostic' ? (
        <DiagnosticWaveContent project={project} entity={entity} onOpen={setOpenAgentId} onChanged={refresh} onQuickRun={quickRun} runningIds={runningIds} />
      ) : activeWave === 'formulation' ? (
        <FormulationWaveContent project={project} entity={entity} onOpen={setOpenAgentId} onChanged={refresh} onQuickRun={quickRun} runningIds={runningIds} />
      ) : (
        <div className="card" style={{ padding: '32px', textAlign: 'center', color: 'var(--sia-medium-gray)' }}>
          <p style={{ fontSize: '13px', margin: 0 }}>
            The {wave.label} wave's agents aren't wired up yet — only the Diagnostic wave runs today.
          </p>
        </div>
      )}

      <Sheet open={!!openAgentId} onOpenChange={(open) => { if (!open) setOpenAgentId(null) }}>
        {openAgentId && (
          <AgentDrawer
            project={project} entity={entity} agentId={openAgentId} onChanged={refresh} onApproved={advanceAfterApprove}
            onStopped={id => setRunningIds(prev => { const next = new Set(prev); next.delete(id); return next })}
            quickRunning={runningIds.has(openAgentId)}
          />
        )}
      </Sheet>
    </div>
  )
}
