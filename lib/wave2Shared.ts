// Wave 2 (Formulation) data-flow definition, shared by the server engine and the client UI.
// Deliberately free of 'server-only' / 'use client' so both sides import the exact same rules.
//
// Source of truth: the "Wave 2 Functional Flow Diagram (with optional step)". Every arrow in that diagram
// is an entry in WAVE2_INPUTS below (the producing agent -> the consuming agent). 'swot' is Wave 1's
// SWOT Part A (entity.assessment.swotAgent); every other id is a Wave 2 agent under assessment.wave2.agents.
//
//   0. Gate: Wave 1's SWOT Part A must be approved before anything in Wave 2 can run — its approved
//      conversation is what gets handed to the Wave 2 agents.
//   1. Strategic Direction (direction)   <- SWOT Part A, company docs
//   2. V/M/V                  (vmv)       <- SWOT Part A, Strategic Direction
//   3. Strategic Options (optional step, one on/off switch for both agents):
//        Options Design        (optionsDesign) <- company docs, SWOT Part A, Direction, V/M/V
//        Options Evaluation    (optionsEval)   <- company docs, SWOT Part A, Direction, V/M/V, Options Design
//   4. SWOT Part B            (swotB)     <- company docs, SWOT Part A, Direction, V/M/V, Options Evaluation
//   5. Shift Agenda           (shiftAgenda) <- V/M/V, Options Evaluation, SWOT Part B

export const WAVE2_ORDER = ['direction', 'vmv', 'optionsDesign', 'optionsEval', 'swotB', 'shiftAgenda'] as const
export type Wave2AgentId = typeof WAVE2_ORDER[number]

/** The two agents inside the diagram's "3. Strategic Options (Optional)" group. */
export const WAVE2_OPTIONAL: string[] = ['optionsDesign', 'optionsEval']

/** SWOT Part B is also optional (its own on/off switch); skipping it drops it from Shift Agenda's inputs. */
export const WAVE2_SWOTB_OPTIONAL: string[] = ['swotB']

export const WAVE2_LABELS: Record<string, string> = {
  direction: '1. Strategic Direction',
  vmv: '2. V/M/V — vision, mission & values',
  optionsDesign: 'Strategic Options Design',
  optionsEval: 'Strategic Options Evaluation & Selection',
  swotB: '4. SWOT Part B',
  shiftAgenda: '5. Shift Agenda',
}

/** Which agents get the entity's "Collection of company docs" attached (arrows from the docs bar). */
export const WAVE2_USES_DOCS: Record<string, boolean> = {
  direction: true,
  vmv: false,
  optionsDesign: true,
  optionsEval: true,
  swotB: true,
  shiftAgenda: false,
}

/** Every upstream output each agent consumes (diagram arrows). All of these must be approved before it runs. */
export const WAVE2_INPUTS: Record<string, string[]> = {
  direction: ['swot'],
  vmv: ['swot', 'direction'],
  optionsDesign: ['swot', 'direction', 'vmv'],
  optionsEval: ['swot', 'direction', 'vmv', 'optionsDesign'],
  swotB: ['swot', 'direction', 'vmv', 'optionsEval'],
  shiftAgenda: ['vmv', 'optionsEval', 'swotB'],
}

export function isWave2AgentId(id: string): boolean {
  return (WAVE2_ORDER as readonly string[]).includes(id)
}

/** Undecided (null) behaves like true — the options step is the diagram's default path. */
export function wave2OptionsEnabled(assessment: any): boolean {
  return assessment?.wave2?.optionsEnabled !== false
}

/** Undecided (null) behaves like true — SWOT Part B is on the diagram's default path. */
export function wave2SwotBEnabled(assessment: any): boolean {
  return assessment?.wave2?.swotBEnabled !== false
}

/** Agent ids that are switched off given the two optional-step choices. */
export function wave2SkippedIds(optionsEnabled: boolean, swotBEnabled: boolean): string[] {
  return [...(optionsEnabled ? [] : WAVE2_OPTIONAL), ...(swotBEnabled ? [] : WAVE2_SWOTB_OPTIONAL)]
}

/** Dependencies for one agent given which optional steps are in play. Skipping a step drops its agents
 *  from every consumer's inputs (the bypass lines in the diagram). */
export function wave2DepIds(agentId: string, optionsEnabled: boolean, swotBEnabled = true): string[] {
  const skipped = wave2SkippedIds(optionsEnabled, swotBEnabled)
  return (WAVE2_INPUTS[agentId] || []).filter(id => !skipped.includes(id))
}

/** The agents that actually participate, in diagram order. */
export function wave2Sequence(assessment: any): string[] {
  const skipped = wave2SkippedIds(wave2OptionsEnabled(assessment), wave2SwotBEnabled(assessment))
  return WAVE2_ORDER.filter(id => !skipped.includes(id))
}

function agentOf(assessment: any, id: string): any {
  return id === 'swot' ? assessment.swotAgent : assessment.wave2?.agents?.[id]
}

function approvedIn(assessment: any, id: string): boolean {
  const a = agentOf(assessment, id)
  return !!a && a.approvedVersion !== null && a.approvedVersion !== undefined
}

/** True once any Wave 2 agent that consumes `id` (SWOT Part A included) has started — at that point `id`'s
 *  approved output has already flowed downstream, so it can no longer be unlocked/changed underneath. */
export function wave2DownstreamStarted(assessment: any, id: string): boolean {
  const agents = assessment?.wave2?.agents
  if (!agents) return false
  return Object.keys(agents).some(otherId => {
    if (otherId === id) return false
    const a = agents[otherId]
    return (a.depIds || []).includes(id) && (a.chatHistory?.length || a.versionHistory?.length)
  })
}

/**
 * Moves untouched Wave 2 agents between 'locked' and 'not_started' as their dependencies are approved
 * (or un-approved — unlocking SWOT Part A re-locks anything that hasn't started on top of it), and marks the
 * optional agents (options, SWOT Part B) 'skipped' while switched off. Never touches an agent that has
 * started, and never auto-runs anything — a human still has to send the first message.
 */
export function recomputeWave2Locks(assessment: any) {
  const wave2 = assessment?.wave2
  if (!wave2?.agents) return
  const skipped = wave2SkippedIds(wave2OptionsEnabled(assessment), wave2SwotBEnabled(assessment))
  for (const id of WAVE2_ORDER) {
    const agent = wave2.agents[id]
    if (!agent) continue
    const untouched = !agent.chatHistory?.length && agent.approvedVersion === null
    if (skipped.includes(id)) {
      if (untouched) agent.status = 'skipped'
      continue
    }
    if (agent.status === 'skipped') agent.status = 'locked'
    if (agent.status === 'in_progress') continue
    const depsDone = (agent.depIds || []).every((d: string) => approvedIn(assessment, d))
    if (agent.status === 'locked' && depsDone) agent.status = 'not_started'
    else if (agent.status === 'not_started' && untouched && !depsDone) agent.status = 'locked'
  }
}
