// POST /api/ai/:projectId/:entityId/agent/:agentId/chat — send a follow-up instruction to one Wave 1 or
// Wave 2 agent. Re-runs the agent with the instruction applied and appends both turns to its chat thread.
import { NextRequest, after } from 'next/server'
import { updateProject, computePillarFinalScore } from '@/lib/server/helpers'
import { requireProjectAuth } from '@/lib/server/auth'
import { createSSEStream } from '@/lib/server/sse'
import { resolveWave1Entity } from '@/lib/server/wave1Engine'
import { ALL_AGENT_IDS, getAnyAgent, recomputeAllLocks, runAgent } from '@/lib/server/agentEngine'

export const runtime = 'nodejs'
export const maxDuration = 720

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; entityId: string; agentId: string }> }
) {
  const { projectId, entityId, agentId } = await params
  if (!await requireProjectAuth(request, projectId)) {
    return createSSEStream(async (send, close) => { send({ error: 'Not authenticated' }); close() })
  }
  if (!ALL_AGENT_IDS.includes(agentId)) {
    return createSSEStream(async (send, close) => { send({ error: 'Unknown agent' }); close() })
  }

  const body = await request.json()
  const message: string = (body?.message || '').trim()

  // The agent run is deliberately NOT tied to the HTTP response. It is registered with after() so the
  // platform keeps the function alive until it finishes, and it persists its own result (chat turns,
  // version, status) — so closing the tab / losing the connection never cancels or loses the answer.
  // The SSE stream below is only a convenience that relays the outcome if the client is still there.
  type Outcome = { error: string } | { stopped: true } | { done: true; entityId: string; agentId: string; version: number | null; preview: string; final: boolean }
  const work: Promise<Outcome> = runAndPersist(projectId, entityId, agentId, message)
  after(() => work)

  return createSSEStream(async (send, close) => {
    const outcome = await work
    send(outcome)
    close()
  })
}

// How long an 'in_progress' marker is trusted before a new run may replace it (functions are capped at 720s).
const STALE_RUN_MS = 13 * 60 * 1000

/** Copies everything one run produced from its private working copy onto the freshly loaded stored agent.
 *  Only this agent's own data is touched, so other agents running or finishing in parallel keep theirs. */
function transplantRun(freshEntity: any, runEntity: any, agentId: string) {
  const freshAgent = getAnyAgent(freshEntity, agentId)
  const runAgentObj = getAnyAgent(runEntity, agentId)
  const keep = { chatHistory: freshAgent.chatHistory, manualScore: freshAgent.manualScore, hadManual: 'manualScore' in freshAgent }
  for (const k of Object.keys(freshAgent)) delete freshAgent[k]
  Object.assign(freshAgent, runAgentObj)
  freshAgent.chatHistory = keep.chatHistory || []
  // The reviewer may have edited their own score while the run was in flight — theirs wins.
  if (keep.hadManual) {
    freshAgent.manualScore = keep.manualScore
    if ('aiScore' in freshAgent) freshAgent.finalScore = computePillarFinalScore(freshAgent.aiScore, keep.manualScore)
  }
  if (agentId === 'swot') {
    freshEntity.assessment.consolidatedSwot = runEntity.assessment.consolidatedSwot
    freshEntity.assessment.strategicHypothesis = runEntity.assessment.strategicHypothesis
  }
  return freshAgent
}

async function runAndPersist(projectId: string, entityId: string, agentId: string, message: string) {
  try {
    if (!message) return { error: 'Message is required' }

    // Phase 1 (short): validate, mark in_progress and persist so a reloaded UI can show the in-flight
    // instruction. Returns a private working copy for the long run — the run must never save the whole
    // project back, or parallel runs (several agents at once) would overwrite each other's results.
    let working: { project: any; entity: any; startedAt: string }
    try {
      working = await updateProject(projectId, project => {
        const entity = resolveWave1Entity(project, entityId)
        if (!entity) throw new Error('Entity not found')
        recomputeAllLocks(entity)
        const agent = getAnyAgent(entity, agentId)
        if (agent.status === 'locked') throw new Error('This agent is locked until its upstream dependencies are approved.')
        if (agent.approvedVersion !== null) throw new Error('This agent has already been approved — its output is locked and can no longer be changed.')
        const startedAt = agent.pendingMessage?.at ? new Date(agent.pendingMessage.at).getTime() : 0
        if (agent.status === 'in_progress' && Date.now() - startedAt < STALE_RUN_MS) {
          throw new Error('This agent is already running — wait for it to finish.')
        }
        agent.status = 'in_progress'
        const runStamp = new Date().toISOString()
        agent.pendingMessage = { content: message, at: runStamp }
        const copy = structuredClone(project)
        return { project: copy, entity: resolveWave1Entity(copy, entityId), startedAt: runStamp }
      })
    } catch (e: any) { return { error: e?.message || 'Unknown error' } }

    let version: number | null, preview: string, final: boolean, newSources: Record<string, any>
    try {
      // Built from chatHistory as it stood BEFORE this turn, so the instruction isn't duplicated in the prompt.
      ({ version, preview, final, newSources } = await runAgent(working.project, working.entity, agentId, message))
    } catch (runErr: any) {
      // Record the failure as a chat turn so it's visible even if the user was away when it happened.
      await updateProject(projectId, project => {
        const agent = getAnyAgent(resolveWave1Entity(project, entityId), agentId)
        if (agent.pendingMessage?.at !== working.startedAt) return // stopped by the reviewer meanwhile
        if (!agent.chatHistory) agent.chatHistory = []
        const at = new Date().toISOString()
        agent.chatHistory.push({ role: 'user', content: message, at })
        agent.chatHistory.push({ role: 'agent', content: `⚠ This run failed: ${runErr?.message || 'Unknown error'}. You can send the instruction again.`, at })
        agent.pendingMessage = null
        agent.status = agent.versionHistory?.length ? 'complete' : 'not_started'
      }).catch(() => {})
      return { error: runErr?.message || 'Unknown error' }
    }

    // Phase 2 (short): merge this run's result into the latest stored project.
    const saved = await updateProject(projectId, project => {
      const entity = resolveWave1Entity(project, entityId)
      // The reviewer pressed Stop (or restarted the agent) while this ran — drop the result.
      if (getAnyAgent(entity, agentId).pendingMessage?.at !== working.startedAt) return false
      const agent = transplantRun(entity, working.entity, agentId)
      const now = new Date().toISOString()
      agent.chatHistory.push({ role: 'user', content: message, at: now })
      // Some assistants run their own internal multi-step gated workflow and reply with plain text (a gate
      // checkpoint, or a refusal when there's no document evidence) instead of the final JSON schema until
      // that resolves. Surface it as a normal chat turn — no version/approval yet — so the human can keep
      // the conversation going (confirm the gate, upload documents, etc.) rather than seeing a hard error.
      agent.chatHistory.push({
        role: 'agent', content: preview, v: final ? version : undefined, at: now,
        newSources: Object.keys(newSources || {}).length ? newSources : undefined,
      })
      agent.pendingMessage = null
      if (!final) agent.status = agent.versionHistory?.length ? 'complete' : 'not_started'
      recomputeAllLocks(entity)
      return true
    })
    if (!saved) return { stopped: true as const }

    return { done: true as const, entityId, agentId, version, preview, final }
  } catch (err: any) {
    return { error: err?.message || 'Unknown error' }
  }
}
