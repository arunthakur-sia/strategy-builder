import 'server-only'
import { getWave1Agent, recomputeWave1Locks, runWave1Agent, unlockWave1Agent, resetWave1Agent, WAVE1_AGENT_IDS } from './wave1Engine'
import { getWave2Agent, runWave2Agent, unlockWave2Agent, resetWave2Agent, WAVE2_AGENT_IDS } from './wave2Engine'
import { getWave3Agent, runWave3Agent, unlockWave3Agent, resetWave3Agent, WAVE3_AGENT_IDS } from './wave3Engine'
import { isWave2AgentId, recomputeWave2Locks } from '../wave2Shared'
import { isWave3AgentId, recomputeWave3Locks } from '../wave3Shared'

// Single entry point the agent routes (chat / approve / unlock / reset / stop / report) use, so none of them
// needs to know which wave an agent belongs to. Waves chain: Wave 2 gates on Wave 1's SWOT Part A, Wave 3 on
// Wave 2's Shift Agenda / Options / V/M/V.

export const ALL_AGENT_IDS: string[] = [...WAVE1_AGENT_IDS, ...WAVE2_AGENT_IDS, ...WAVE3_AGENT_IDS]

/** Any agent in any wave. */
export function getAnyAgent(entity: any, agentId: string): any {
  if (isWave3AgentId(agentId)) return getWave3Agent(entity, agentId)
  return isWave2AgentId(agentId) ? getWave2Agent(entity, agentId) : getWave1Agent(entity, agentId)
}

/** Recompute every wave's lock state — approvals cascade across waves, so every route that can change an
 *  approval calls this rather than one wave's recompute alone. Order matters: earliest wave first. */
export function recomputeAllLocks(entity: any) {
  recomputeWave1Locks(entity)
  recomputeWave2Locks(entity.assessment)
  recomputeWave3Locks(entity.assessment)
}

export function runAgent(project: any, entity: any, agentId: string, message: string) {
  if (isWave3AgentId(agentId)) return runWave3Agent(project, entity, agentId, message)
  return isWave2AgentId(agentId) ? runWave2Agent(project, entity, agentId, message) : runWave1Agent(project, entity, agentId, message)
}

export function unlockAgent(entity: any, agentId: string) {
  if (isWave3AgentId(agentId)) unlockWave3Agent(entity, agentId)
  else if (isWave2AgentId(agentId)) unlockWave2Agent(entity, agentId)
  else unlockWave1Agent(entity, agentId)
}

export function resetAgent(entity: any, agentId: string) {
  if (isWave3AgentId(agentId)) resetWave3Agent(entity, agentId)
  else if (isWave2AgentId(agentId)) resetWave2Agent(entity, agentId)
  else resetWave1Agent(entity, agentId)
}
