import 'server-only'
import { callSiaGPT } from './siagpt'
import { config, WAVE2_ENV_VARS } from './config'
import { buildWave2Prompt } from './prompts'
import {
  getWave1Agent, getApprovedSummaryText, buildTranscriptText, recomputeWave1Locks, runWave1Agent, unlockWave1Agent, resetWave1Agent,
  WAVE1_AGENT_IDS,
} from './wave1Engine'
import {
  WAVE2_ORDER, WAVE2_LABELS, WAVE2_INPUTS, WAVE2_USES_DOCS, WAVE2_OPTIONAL,
  isWave2AgentId, wave2OptionsEnabled, wave2SwotBEnabled, wave2SkippedIds, wave2DepIds, wave2DownstreamStarted, recomputeWave2Locks,
} from '../wave2Shared'

export const WAVE2_AGENT_IDS: string[] = [...WAVE2_ORDER]
export const ALL_AGENT_IDS: string[] = [...WAVE1_AGENT_IDS, ...WAVE2_AGENT_IDS]

export function getWave2Agent(entity: any, agentId: string): any {
  return entity.assessment.wave2.agents[agentId]
}

/** Any agent in either wave. Wave 2 depends on Wave 1's SWOT Part A, so its dep ids resolve through here. */
export function getAnyAgent(entity: any, agentId: string): any {
  return isWave2AgentId(agentId) ? getWave2Agent(entity, agentId) : getWave1Agent(entity, agentId)
}

/** Recompute both waves' lock state — Wave 1 approvals (SWOT Part A) gate Wave 2, so every route that can
 *  change an approval calls this rather than recomputeWave1Locks alone. */
export function recomputeAllLocks(entity: any) {
  recomputeWave1Locks(entity)
  recomputeWave2Locks(entity.assessment)
}

/** The text a downstream Wave 2 prompt receives for one upstream agent: always its approved version. */
function approvedText(entity: any, agentId: string): string {
  if (agentId === 'swot') {
    // SWOT Part A is handed over as its full reviewer<->agent conversation (frozen at approval — the chat
    // route refuses messages once approved), not just the extracted SWOT, so Wave 2 sees the reasoning,
    // corrections and caveats behind it. Falls back to the approved summary if there's no chat.
    const transcript = buildTranscriptText(getWave1Agent(entity, 'swot').chatHistory)
    return transcript || getApprovedSummaryText(entity, 'swot')
  }
  if (!isWave2AgentId(agentId)) return getApprovedSummaryText(entity, agentId)
  const agent = getWave2Agent(entity, agentId)
  if (agent.approvedVersion === null) return ''
  return agent.versionHistory.find((v: any) => v.v === agent.approvedVersion)?.text || ''
}

function inputLabel(agentId: string): string {
  return agentId === 'swot' ? 'SWOT Part A (Wave 1 conversation with the SWOT agent)' : WAVE2_LABELS[agentId]
}

/**
 * Records whether the reviewer wants the diagram's optional "Strategic Options" step (Design + Evaluation).
 * true/unanswered keeps both agents in the chain; false skips them and re-wires every consumer (SWOT Part B,
 * Shift Agenda) to run straight off the remaining inputs. Blocked once either options agent has started,
 * since switching afterwards would leave work built on the other path's assumptions.
 */
export function setWave2OptionsEnabled(entity: any, value: boolean) {
  const wave2 = entity.assessment.wave2
  if (value === wave2OptionsEnabled(entity.assessment)) { wave2.optionsEnabled = value; recomputeWave2Locks(entity.assessment); return }
  const started = WAVE2_OPTIONAL.some(id => wave2.agents[id].chatHistory?.length || wave2.agents[id].versionHistory?.length)
  if (started) throw new Error('The strategic options step has already started — this choice can no longer be changed.')
  // Downstream agents (SWOT Part B / Shift Agenda) also bake the choice into their inputs — don't flip under them.
  const downstreamStarted = ['swotB', 'shiftAgenda'].some(id => wave2.agents[id].chatHistory?.length)
  if (downstreamStarted) throw new Error('Steps after the strategic options have already started — this choice can no longer be changed.')
  wave2.optionsEnabled = value
  for (const id of WAVE2_ORDER) wave2.agents[id].depIds = wave2DepIds(id, value, wave2SwotBEnabled(entity.assessment))
  recomputeWave2Locks(entity.assessment)
}

/**
 * Records whether the reviewer wants the optional SWOT Part B step. false skips it and the Shift Agenda
 * runs without it; blocked once SWOT Part B or the Shift Agenda has started.
 */
export function setWave2SwotBEnabled(entity: any, value: boolean) {
  const wave2 = entity.assessment.wave2
  if (value === wave2SwotBEnabled(entity.assessment)) { wave2.swotBEnabled = value; recomputeWave2Locks(entity.assessment); return }
  const started = ['swotB', 'shiftAgenda'].some(id => wave2.agents[id].chatHistory?.length || wave2.agents[id].versionHistory?.length)
  if (started) throw new Error('SWOT Part B or the Shift Agenda has already started — this choice can no longer be changed.')
  wave2.swotBEnabled = value
  for (const id of WAVE2_ORDER) wave2.agents[id].depIds = wave2DepIds(id, wave2OptionsEnabled(entity.assessment), value)
  recomputeWave2Locks(entity.assessment)
}

/**
 * Runs (or continues) one Wave 2 agent. Mirrors runWave1Agent's contract: builds the prompt from the
 * approved upstream outputs the diagram routes in, attaches the company-docs collection where the diagram
 * has an arrow from it, calls SiaGPT, appends a new immutable version. Does NOT touch chatHistory or
 * approval state — the chat route owns that. All Wave 2 agents are unscored narrative agents.
 */
export async function runWave2Agent(
  project: any, entity: any, agentId: string, extraInstruction?: string
): Promise<{ version: number | null; preview: string; final: boolean; newSources: Record<string, any> }> {
  const agent = getWave2Agent(entity, agentId)
  const assistantId = config.wave2AssistantIds[agentId]
  if (!assistantId) {
    throw new Error(`The "${WAVE2_LABELS[agentId]}" assistant isn't configured — set ${WAVE2_ENV_VARS[agentId]} in the environment.`)
  }

  const skipped = wave2SkippedIds(wave2OptionsEnabled(entity.assessment), wave2SwotBEnabled(entity.assessment))
  const upstream = WAVE2_INPUTS[agentId].filter(id => !skipped.includes(id))
  const inputs = upstream.map(id => ({ label: inputLabel(id), text: approvedText(entity, id) }))
  let prompt = buildWave2Prompt(entity, WAVE2_LABELS[agentId], inputs)
  const collectionIds = WAVE2_USES_DOCS[agentId] && entity.siagptCollectionId ? [entity.siagptCollectionId] : []

  // Same threading rule as Wave 1: one SiaGPT discussion per agent, opened on its first turn and reused until
  // reset, so follow-ups send only the reviewer's instruction — SiaGPT already holds the prompt and history.
  const isFirstTurn = !agent.discussionId
  if (extraInstruction) {
    prompt = isFirstTurn
      ? `${prompt}\n\nInstruction from the reviewer kicking off this agent — follow it and produce the complete output:\n${extraInstruction}`
      : `Additional instruction from the reviewer — apply it and produce a revised, complete output (not just a description of the change):\n${extraInstruction}`
  }

  const { text: rawText, newSources, discussionId } = await callSiaGPT(prompt, {
    assistantId, collectionIds, discussionId: agent.discussionId,
    // Agents the diagram gives no docs arrow have nothing for the retrieval tools to act on.
    ...(collectionIds.length ? {} : { tools: [] }),
    context: `wave2 ${entity.name} / ${agentId}`,
  })
  if (!agent.discussionId) agent.discussionId = discussionId

  agent.output = { aiDraft: rawText, edited: rawText }
  agent.status = 'complete'
  const v = agent.versionHistory.length + 1
  agent.versionHistory.push({ v, text: rawText, createdAt: new Date().toISOString() })
  return { version: v, preview: rawText, final: true, newSources }
}

/** Single entry point for the chat route — dispatches to the right wave's engine. */
export function runAgent(project: any, entity: any, agentId: string, message: string) {
  return isWave2AgentId(agentId)
    ? runWave2Agent(project, entity, agentId, message)
    : runWave1Agent(project, entity, agentId, message)
}

/**
 * Reverses approval so the reviewer can keep talking to the agent. Blocked once any Wave 2 agent downstream
 * of it has started — its approved output has already flowed on, so changing it underneath would leave
 * that agent stale. Wave 1's SWOT Part A is gated the same way (see unlockWave1Agent).
 */
export function unlockAgent(entity: any, agentId: string) {
  if (!isWave2AgentId(agentId)) { unlockWave1Agent(entity, agentId); return }
  const agent = getWave2Agent(entity, agentId)
  if (agent.approvedVersion === null) throw new Error('This agent is not approved.')
  if (wave2DownstreamStarted(entity.assessment, agentId)) {
    throw new Error('This agent can no longer be unlocked — a later step has already run using its approved output.')
  }
  agent.approvedVersion = null
  agent.approvedAt = null
  agent.approvedBy = null
  agent.status = 'complete'
}

/** Wipes a Wave 2 agent back to a fresh state. Blocked while approved (unlock first), as in Wave 1. */
export function resetAgent(entity: any, agentId: string) {
  if (!isWave2AgentId(agentId)) { resetWave1Agent(entity, agentId); return }
  const agent = getWave2Agent(entity, agentId)
  if (agent.approvedVersion !== null) {
    throw new Error('This agent is approved — unlock it first if you want to restart the discussion.')
  }
  agent.output = { aiDraft: '', edited: '' }
  agent.chatHistory = []
  agent.versionHistory = []
  agent.discussionId = null
  agent.status = 'not_started'
  recomputeWave2Locks(entity.assessment)
}
