import 'server-only'
import { callSiaGPT } from './siagpt'
import { config, WAVE3_ENV_VARS } from './config'
import { buildWave3Prompt } from './prompts'
import { buildTranscriptText } from './wave1Engine'
import { approvedConversation as wave2ApprovedConversation } from './wave2Engine'
import { PILLAR_IDS } from './helpers'
import { WAVE2_LABELS } from '../wave2Shared'
import {
  WAVE3_ORDER, WAVE3_LABELS, WAVE3_USES_GREEN_LINE, WAVE3_USES_PILLAR_CONVERSATIONS,
  isWave3AgentId, wave3DepIds, downstreamStarted, recomputeWave3Locks,
} from '../wave3Shared'

export const WAVE3_AGENT_IDS: string[] = [...WAVE3_ORDER]

export function getWave3Agent(entity: any, agentId: string): any {
  return entity.assessment.wave3.agents[agentId]
}

/** What a downstream prompt receives for one upstream agent: the full reviewer<->agent conversation of its
 *  approved agent (frozen at approval — chat refuses approved agents). Falls back to the approved version's
 *  text when there is no chat. Unapproved agents yield ''. */
export function approvedInputText(entity: any, agentId: string): string {
  if (!isWave3AgentId(agentId)) return wave2ApprovedConversation(entity, agentId)
  const agent = getWave3Agent(entity, agentId)
  if (agent.approvedVersion === null) return ''
  return buildTranscriptText(agent.chatHistory)
    || agent.versionHistory.find((v: any) => v.v === agent.approvedVersion)?.text || ''
}

export function inputLabel(agentId: string): string {
  return isWave3AgentId(agentId) ? WAVE3_LABELS[agentId] : WAVE2_LABELS[agentId]
}

/** The Wave 1 half of the "green line": the full conversations of the eight pillar agents (all frozen at approval —
 *  Wave 2 cannot start before SWOT Part A is approved, which needs every pillar approved), the same raw transcripts
 *  the SWOT agent itself receives. */
function pillarConversationSections(entity: any): { label: string; text: string }[] {
  return [{
    label: 'Wave 1 — full conversations with the eight pillar agents (approved)',
    text: PILLAR_IDS.map(id => {
      const p = entity.assessment.pillars[id]
      return `### ${id}: ${p.name}\n${buildTranscriptText(p.chatHistory) || '(no conversation)'}`
    }).join('\n\n'),
  }]
}

/**
 * Runs (or continues) one Wave 3 agent. Same contract as runWave2Agent: builds the prompt from the approved
 * upstream conversations the diagram routes in (plus the green-line inputs where it has them), calls SiaGPT, appends a new
 * immutable version. Does NOT touch chatHistory or approval state — the chat route owns that.
 */
export async function runWave3Agent(
  project: any, entity: any, agentId: string, extraInstruction?: string
): Promise<{ version: number | null; preview: string; final: boolean; newSources: Record<string, any> }> {
  const agent = getWave3Agent(entity, agentId)
  const assistantId = config.wave3AssistantIds[agentId]
  if (!assistantId) {
    throw new Error(`The "${WAVE3_LABELS[agentId]}" assistant isn't configured — set ${WAVE3_ENV_VARS[agentId]} in the environment.`)
  }

  const approved = wave3DepIds(agentId, entity.assessment).map(id => ({ label: `${inputLabel(id)} — full conversation with the agent`, text: approvedInputText(entity, id) }))
  // The "green line": the entity's company documents collection (Strategy Map, KPIs, Initiatives — the same one
  // Waves 1 and 2 use), plus the eight pillar conversations for Strategy Map and KPIs only. Prioritisation gets neither.
  const greenLine = !!WAVE3_USES_GREEN_LINE[agentId]
  const provided = WAVE3_USES_PILLAR_CONVERSATIONS[agentId] ? pillarConversationSections(entity) : []
  let prompt = buildWave3Prompt(entity, WAVE3_LABELS[agentId], approved, provided)
  const collectionIds = greenLine && entity.siagptCollectionId ? [entity.siagptCollectionId] : []

  // One SiaGPT discussion per agent, opened on its first turn and reused until reset (see runWave2Agent).
  const isFirstTurn = !agent.discussionId
  if (extraInstruction) {
    prompt = isFirstTurn
      ? `${prompt}\n\nInstruction from the reviewer kicking off this agent — follow it and produce the complete output:\n${extraInstruction}`
      : `Additional instruction from the reviewer — apply it and produce a revised, complete output (not just a description of the change):\n${extraInstruction}`
  }

  const { text: rawText, newSources, discussionId } = await callSiaGPT(prompt, {
    assistantId, collectionIds, discussionId: agent.discussionId,
    // Agents without a docs collection (Prioritisation, or an entity with no documents) have nothing for the retrieval tools to act on.
    ...(collectionIds.length ? {} : { tools: [] }),
    context: `wave3 ${entity.name} / ${agentId}`,
  })
  if (!agent.discussionId) agent.discussionId = discussionId

  agent.output = { aiDraft: rawText, edited: rawText }
  agent.status = 'complete'
  const v = agent.versionHistory.length + 1
  agent.versionHistory.push({ v, text: rawText, createdAt: new Date().toISOString() })
  return { version: v, preview: rawText, final: true, newSources }
}

/** Reverses approval so the reviewer can keep talking to the agent. Blocked once anything built on its approved
 *  output has started — a later Wave 3 agent, or the dashboard (which snapshots every conversation). */
export function unlockWave3Agent(entity: any, agentId: string) {
  const agent = getWave3Agent(entity, agentId)
  if (agent.approvedVersion === null) throw new Error('This agent is not approved.')
  if (downstreamStarted(entity.assessment, agentId)) {
    throw new Error('This agent can no longer be unlocked — a later step has already run using its approved output.')
  }
  agent.approvedVersion = null
  agent.approvedAt = null
  agent.approvedBy = null
  agent.status = 'complete'
}

/** Wipes a Wave 3 agent back to a fresh state. Blocked while approved (unlock first), as in Waves 1 and 2. */
export function resetWave3Agent(entity: any, agentId: string) {
  const agent = getWave3Agent(entity, agentId)
  if (agent.approvedVersion !== null) {
    throw new Error('This agent is approved — unlock it first if you want to restart the discussion.')
  }
  agent.output = { aiDraft: '', edited: '' }
  agent.chatHistory = []
  agent.versionHistory = []
  agent.discussionId = null
  agent.status = 'not_started'
  recomputeWave3Locks(entity.assessment)
}
