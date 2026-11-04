import 'server-only'
import { callSiaGPT } from './siagpt'
import { config, WAVE3_ENV_VARS } from './config'
import { buildWave3Prompt } from './prompts'
import { buildTranscriptText } from './wave1Engine'
import { approvedText as wave2ApprovedText } from './wave2Engine'
import { PILLAR_IDS } from './helpers'
import { WAVE2_LABELS } from '../wave2Shared'
import {
  WAVE3_ORDER, WAVE3_LABELS, WAVE3_USES_COLLECTION, WAVE3_COLLECTION_FIELDS, WAVE3_USES_INTERNAL_ANALYSIS,
  isWave3AgentId, wave3DepIds, downstreamStarted, recomputeWave3Locks,
} from '../wave3Shared'

export const WAVE3_AGENT_IDS: string[] = [...WAVE3_ORDER]

export function getWave3Agent(entity: any, agentId: string): any {
  return entity.assessment.wave3.agents[agentId]
}

/** The text a downstream prompt receives for one upstream agent: always its approved version. */
export function approvedInputText(entity: any, agentId: string): string {
  if (!isWave3AgentId(agentId)) return wave2ApprovedText(entity, agentId)
  const agent = getWave3Agent(entity, agentId)
  if (agent.approvedVersion === null) return ''
  return agent.versionHistory.find((v: any) => v.v === agent.approvedVersion)?.text || ''
}

export function inputLabel(agentId: string): string {
  return isWave3AgentId(agentId) ? WAVE3_LABELS[agentId] : WAVE2_LABELS[agentId]
}

/** "Baselines · Internal Analysis + finance": the Wave 1 pillar conversations (all frozen at approval — the
 *  SWOT Part A gate cannot be approved otherwise), the same raw transcripts the SWOT agent itself receives. */
function internalAnalysisSections(entity: any): { label: string; text: string }[] {
  return [{
    label: 'Baselines — Wave 1 internal analysis (approved pillar conversations)',
    text: PILLAR_IDS.map(id => {
      const p = entity.assessment.pillars[id]
      return `### ${id}: ${p.name}\n${buildTranscriptText(p.chatHistory) || '(no conversation)'}`
    }).join('\n\n'),
  }]
}

/**
 * Runs (or continues) one Wave 3 agent. Same contract as runWave2Agent: builds the prompt from the approved
 * upstream outputs the diagram routes in (plus the diagram's side inputs), calls SiaGPT, appends a new
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

  const approved = wave3DepIds(agentId, entity.assessment).map(id => ({ label: inputLabel(id), text: approvedInputText(entity, id) }))
  const provided = WAVE3_USES_INTERNAL_ANALYSIS[agentId] ? internalAnalysisSections(entity) : []
  let prompt = buildWave3Prompt(entity, WAVE3_LABELS[agentId], approved, provided)
  // The diagram's optional "(collection)" inputs: finance docs -> KPIs, functional & operations docs -> Initiatives
  // and Prioritisation. Passed on every turn; absent (and retrieval tools off) when the reviewer uploaded none.
  const kind = WAVE3_USES_COLLECTION[agentId]
  const collectionId: string = kind ? entity.assessment.wave3[WAVE3_COLLECTION_FIELDS[kind]] : ''
  const collectionIds = collectionId ? [collectionId] : []

  // One SiaGPT discussion per agent, opened on its first turn and reused until reset (see runWave2Agent).
  const isFirstTurn = !agent.discussionId
  if (extraInstruction) {
    prompt = isFirstTurn
      ? `${prompt}\n\nInstruction from the reviewer kicking off this agent — follow it and produce the complete output:\n${extraInstruction}`
      : `Additional instruction from the reviewer — apply it and produce a revised, complete output (not just a description of the change):\n${extraInstruction}`
  }

  const { text: rawText, newSources, discussionId } = await callSiaGPT(prompt, {
    assistantId, collectionIds, discussionId: agent.discussionId,
    // Agents without a docs collection have nothing for the retrieval tools to act on.
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
