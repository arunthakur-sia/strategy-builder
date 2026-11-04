'use client'
// Shared client-side helpers for the Wave 1 (Diagnostic) pipeline — used by both DashboardPage (the entity
// portfolio) and AssessmentPage (a single entity's wave workspace) so entity/agent shape logic lives in one place.

import { extractWave1Tokens } from './remarkWave1Citations'
import { isWave2AgentId, WAVE2_LABELS } from './wave2Shared'
import { isWave3AgentId, downstreamStarted, WAVE3_LABELS } from './wave3Shared'

export const ENTITY_TYPES = [
  { value: 'government', label: 'Government Ministry / Authority' },
  { value: 'holding', label: 'Holding Company' },
  { value: 'corporate', label: 'Corporate / Private Sector' },
  { value: 'ngo', label: 'NGO / Non-Profit' },
  { value: 'other', label: 'Other' },
]

export const PILLAR_ORDER = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']
export const FANOUT_ORDER = ['bench', 'pestel', 'marketSizing', 'competitor']
export const FANOUT_LABELS: Record<string, string> = {
  bench: 'Benchmarking', pestel: 'PESTEL', marketSizing: 'Market sizing', competitor: 'Competitor analysis',
}

/** Undecided (null) behaves like `true` — the interview-guide path is the historical default, so
 *  existing entities (and a fresh entity before the reviewer answers) keep running it unchanged. */
export function idiPathEnabled(entity: any): boolean {
  return entity.assessment.idiDocumentsAvailable !== false
}

/** The IDI Guide/Synth steps only exist in the Wave 1 sequence when the reviewer has documents to seed
 *  an interview guide from; when they don't, external analysis runs straight off company documents. */
export function wave1Sequence(entity: any): string[] {
  const idi = idiPathEnabled(entity) ? ['idiGuide', 'idiSynth'] : []
  return [...PILLAR_ORDER, ...idi, ...FANOUT_ORDER, 'swot']
}

export function wave1Total(entity: any): number {
  return PILLAR_ORDER.length + (idiPathEnabled(entity) ? 2 : 0) + FANOUT_ORDER.length + 1 /* swot */
}

/** Client-side mirror of the server's resolveWave1Entity('main', ...) adapter — the project's own primary/
 *  holding entity (project.entityName/entityType/assessment/documents), rebuilt fresh from `project` on
 *  every render so it always reflects the latest fetch. Read-only here; mutations happen via the API. */
export function mainEntityAdapter(project: any): any {
  return {
    id: 'main',
    name: project.entityName,
    type: project.entityType,
    assessment: project.assessment,
    documents: project.documents || [],
    siagptCollectionId: project.siagptCollectionId,
    interviewCollectionId: project.interviewCollectionId,
  }
}

export function getAgentObj(entity: any, id: string): any {
  if (isWave3AgentId(id)) return entity.assessment.wave3.agents[id]
  if (isWave2AgentId(id)) return entity.assessment.wave2.agents[id]
  if (id === 'swot') return entity.assessment.swotAgent
  if (entity.assessment.pillars[id]) return entity.assessment.pillars[id]
  return entity.assessment.externalAgents[id]
}

export function agentLabel(entity: any, id: string): string {
  if (isWave3AgentId(id)) return WAVE3_LABELS[id]
  if (isWave2AgentId(id)) return WAVE2_LABELS[id]
  if (id === 'swot') return 'SWOT — analysis & focus areas'
  if (id === 'idiGuide') return 'IDI Guide'
  if (id === 'idiSynth') return 'IDI Synth — interview synthesis'
  if (FANOUT_LABELS[id]) return FANOUT_LABELS[id]
  return entity.assessment.pillars[id]?.name || id
}

export function isApproved(entity: any, id: string): boolean {
  return getAgentObj(entity, id).approvedVersion !== null
}

/** Mirrors the server's unlockWave1Agent gate: an approved agent can be unlocked for more conversation
 *  right up until the SWOT agent has actually run off its approved output — the SWOT agent itself has
 *  no such downstream in Wave 1, so it stays unlockable until a Wave 2 agent has started on it. */
export function canUnlock(entity: any, id: string): boolean {
  // SWOT Part A also feeds Wave 2, Wave 2 agents feed each other and Wave 3, and Wave 3 agents feed each other
  // and the dashboard — same rule as the server's guards.
  if (id === 'swot' || isWave2AgentId(id) || isWave3AgentId(id)) return !downstreamStarted(entity.assessment, id)
  return !hasVersion(getAgentObj(entity, 'swot'))
}

export function hasVersion(agent: any): boolean {
  return (agent.versionHistory?.length || 0) > 0
}

export function wave1ApprovedCount(entity: any): number {
  return wave1Sequence(entity).filter(id => isApproved(entity, id)).length
}

export function statusMeta(agent: any): { label: string; color: string } {
  if (agent.approvedVersion !== null) return { label: 'Approved', color: 'var(--sia-green)' }
  if (agent.status === 'skipped') return { label: 'Skipped', color: 'var(--sia-medium-gray)' }
  if (agent.status === 'locked') return { label: 'Locked', color: 'var(--sia-medium-gray)' }
  if (agent.status === 'in_progress') return { label: 'Running…', color: 'var(--sia-medium-teal)' }
  if (agent.status === 'complete') return { label: 'Awaiting review', color: 'var(--sia-amber)' }
  return { label: 'Not started', color: 'var(--sia-medium-gray)' }
}

// The message sent when the reviewer clicks "Run" instead of typing their own kickoff instruction —
// still goes through the normal chat endpoint (with the entity's collection id attached server-side),
// it's just a sensible default first turn rather than an autonomous trigger.
export function defaultKickoffMessage(agentId: string, entity: any): string {
  if (PILLAR_ORDER.includes(agentId)) return 'Run the full pillar assessment against the uploaded documents — score every element and flag data gaps.'
  if (agentId === 'idiGuide') return 'Generate the interview guide from the uploaded documents.'
  if (agentId === 'idiSynth') return 'Synthesize the uploaded interview transcripts together with the approved interview guide.'
  // bench/pestel/marketSizing/competitor assistants carry their own rubric, persona, and output-format
  // instructions configured directly in the assistant — no need to restate them here, just trigger the run.
  if (FANOUT_ORDER.includes(agentId)) return 'Run.'
  // Wave 2 assistants carry their own persona and output format; the engine supplies the approved upstream
  // outputs and company docs, so the kickoff is just a trigger.
  if (isWave2AgentId(agentId) || isWave3AgentId(agentId)) return 'Run.'
  if (agentId === 'swot') return 'Consolidate the approved pillar and external-analysis outputs into the entity-level SWOT.'
  return 'Run the assessment.'
}

/** Conversation-wide citation numbering, shared by the drawer's sources panel and the report export so both
 *  use the same numbers. Each unique raw token ("1-47" / uuid) gets a sequential display number in order of
 *  first appearance in the agent's replies; sources fetched but never cited are appended after. `remappedSources`
 *  is keyed by display number. */
export function buildCitationMaps(chatHistory: any[]): { tokenToNum: Record<string, number>; remappedSources: Record<string, any> } {
  const conversationSources: Record<string, any> = {}
  for (const m of chatHistory || []) if (m.newSources) Object.assign(conversationSources, m.newSources)
  const isUuid = (t: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)
  // A "<docIndex>-<sourceKey>" token's source is keyed by the part after the dash; uuids are used whole.
  const sourceKeyOf = (token: string) => {
    if (isUuid(token)) return token
    const dash = token.lastIndexOf('-')
    return dash === -1 ? token : token.slice(dash + 1)
  }
  // Wave 2 cites by uuid; the server may key a source by that uuid or only carry it in the entry's `id`.
  const byId: Record<string, any> = {}
  for (const src of Object.values(conversationSources)) if (src?.id) byId[String(src.id).toLowerCase()] = src
  const map: Record<string, number> = {}
  const usedSourceKeys = new Set<string>()
  let next = 1
  for (const m of chatHistory || []) {
    if (m.role !== 'agent' || !m.content) continue
    for (const token of extractWave1Tokens(m.content)) {
      if (!(token in map)) { map[token] = next++; usedSourceKeys.add(sourceKeyOf(token)) }
    }
  }
  for (const key of Object.keys(conversationSources)) {
    if (usedSourceKeys.has(key) || key in map) continue
    const sid = conversationSources[key]?.id
    if (sid && String(sid).toLowerCase() in map) continue // already covered by a cited uuid
    map[key] = next++
    usedSourceKeys.add(key)
  }
  const remappedSources: Record<string, any> = {}
  for (const [token, num] of Object.entries(map)) {
    const src = conversationSources[token] ?? conversationSources[sourceKeyOf(token)] ?? byId[token]
    if (src) remappedSources[String(num)] = src
  }
  return { tokenToNum: map, remappedSources }
}
