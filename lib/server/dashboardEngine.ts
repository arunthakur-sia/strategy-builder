import 'server-only'
import { callReportLlm } from './reportEngine'
import { buildTranscriptText } from './wave1Engine'
import { getWave2Agent } from './wave2Engine'
import { getWave3Agent, inputLabel } from './wave3Engine'
import { parseJsonFromText } from './helpers'
import { replaceWave1Citations } from '../remarkWave1Citations'
import { validateDashboard, KPI_DIRECTIONS, INITIATIVE_TIERS, type DashboardData } from '../wave3Dashboard'
import { WAVE3_DASHBOARD_INPUTS, isWave3AgentId } from '../wave3Shared'

// Step 5 of the Wave 3 flow diagram: "Strategy Visualisation / BI Dashboard". Not a SiaGPT agent — the full
// conversations of V/M/V and the four Translation agents go to the report LLM, which returns ONE structured
// JSON document (the shared data model behind the strategy map, KPI scorecard, roadmap and export centre).

const SYSTEM_PROMPT = `You are a senior strategy consultant at SIA Partners. You turn the working conversations between a reviewer and a set of AI analyst agents into the data model behind a strategy dashboard (strategy map, KPI scorecard, initiative roadmap).

Rules:
1. Use ONLY what the conversations contain. Never invent objectives, KPIs, baselines, targets, owners, dates or initiatives. If a value is missing, leave the field as an empty string / null and add a line to "assumptions" saying what is missing. Never round or alter figures.
2. Each conversation is a back-and-forth. The reviewer's corrections and the agent's latest agreed version supersede earlier drafts — report the final agreed position.
3. Keep every objective, KPI and initiative the conversations settle on. Do not merge, drop or rename them; keep the wording concise (titles <= 8 words).
4. Cross-references must be consistent: every kpi.objectiveIds / initiative.objectiveIds / initiative.kpiIds / objective.supports entry must be the id of an element you also emit. Use short stable ids ("O1", "K1", "I1", "T1", "P1").
5. Strategy map: "themes" are the columns (strategic themes / pillars), "perspectives" are the rows ordered top to bottom (typically Financial, Customer, Processes, People — use the perspectives the conversation used). Each objective sits in exactly one theme and one perspective. "supports" lists the objectives it feeds (cause-and-effect arrows, normally pointing from a lower perspective to a higher one).
6. KPIs: "baseline" and "target" are display strings including the unit (e.g. "8.2%", "41", "AED 120M"); "baselineValue" / "targetValue" are the same figures as plain numbers (null when not numeric). direction is one of ${KPI_DIRECTIONS.join(' | ')}.
7. Roadmap: "roadmapPeriods" is an ordered list of period labels spanning all initiatives (use the calendar the conversations use, e.g. "FY26 Q1" ... "FY27 Q4"; if they give none, use "Q1 Y1" ... style labels and say so in assumptions). Each initiative's startPeriod / endPeriod / milestonePeriod are zero-based indexes into that list. priorityRank is 1 for the most important initiative; priorityScore and tier (${INITIATIVE_TIERS.join(' | ')}) come from the prioritisation conversation.
8. Output ONLY one JSON object, no prose, no markdown fences.

JSON shape:
{
  "title": string, "summary": string (3-4 sentences, plain executive summary of the strategy),
  "vmv": { "vision": string, "mission": string, "values": string[] },
  "perspectives": [{ "id": string, "name": string }],
  "themes": [{ "id": string, "name": string, "description": string }],
  "objectives": [{ "id": string, "title": string, "description": string, "themeId": string, "perspectiveId": string, "supports": string[] }],
  "kpis": [{ "id": string, "name": string, "description": string, "objectiveIds": string[], "unit": string, "baseline": string, "baselineValue": number | null, "baselineSource": string, "target": string, "targetValue": number | null, "targetDate": string, "direction": string, "frequency": string, "owner": string, "dataSource": string }],
  "initiatives": [{ "id": string, "name": string, "description": string, "objectiveIds": string[], "kpiIds": string[], "owner": string, "startPeriod": number, "endPeriod": number, "milestonePeriod": number | null, "priorityRank": number, "priorityScore": number | null, "tier": string, "rationale": string, "dependencies": string[] }],
  "roadmapPeriods": string[],
  "assumptions": string[]
}`

export interface DashboardRunInput {
  entityName: string
  entityType: string
  sources: { label: string; transcript: string }[]
  /** Present when revising: the dashboard as it currently stands. */
  current: DashboardData | null
  instruction: string
}

/** Snapshot of everything one dashboard run needs, taken inside the short "start" phase of the route so the long
 *  LLM call works off a frozen copy. Wave 3's four agents and V/M/V are all approved by the time this runs. */
export function prepareDashboardInput(entity: any, instruction: string): DashboardRunInput {
  const sources = WAVE3_DASHBOARD_INPUTS.map(id => {
    const agent = isWave3AgentId(id) ? getWave3Agent(entity, id) : getWave2Agent(entity, id)
    // Citation markers point into per-agent source panels that mean nothing here — drop them.
    return { label: inputLabel(id), transcript: replaceWave1Citations(buildTranscriptText(agent.chatHistory), {}) }
  })
  const dash = entity.assessment.wave3.dashboard
  return {
    entityName: entity.name, entityType: entity.type, sources,
    current: dash.data ? structuredClone(dash.data) : null,
    instruction,
  }
}

function buildMessages(input: DashboardRunInput) {
  const conversations = input.sources
    .map(s => `<conversation agent="${s.label}">\n${s.transcript || '(no conversation)'}\n</conversation>`)
    .join('\n\n')
  const revise = input.current
    ? `\n\nThe dashboard currently looks like this:\n<current_dashboard>\n${JSON.stringify(input.current)}\n</current_dashboard>\n\n${
        input.instruction
          ? `The reviewer asks for this revision — apply it, keep everything else, and return the COMPLETE updated JSON:\n<reviewer_instruction>\n${input.instruction}\n</reviewer_instruction>`
          : 'Regenerate it from the conversations, keeping the same ids where an element is unchanged. Return the COMPLETE JSON.'
      }`
    : input.instruction
    ? `\n\nAdditional instruction from the reviewer:\n<reviewer_instruction>\n${input.instruction}\n</reviewer_instruction>`
    : ''
  const user = `Entity: ${input.entityName} (${input.entityType})

Full conversations follow (V/M/V first, then the four Translation agents in order).

${conversations}${revise}

Produce the dashboard JSON now.`
  return [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: user }]
}

/** Calls the report LLM and returns validated dashboard data. One repair round: if the JSON doesn't parse or
 *  fails validation, the model is shown the exact problems and asked for a corrected complete document. */
export async function generateDashboardData(input: DashboardRunInput): Promise<DashboardData> {
  const messages = buildMessages(input)
  let text = await callReportLlm(messages)
  let problems: string[] = []
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = validateDashboard(parseJsonFromText(text))
      if (result.ok) {
        const data = result.data
        if (!data.title) data.title = `${input.entityName} — strategy dashboard`
        return data
      }
      problems = result.errors
    } catch (e: any) {
      problems = [`The response was not a single valid JSON object (${e?.message || 'parse error'}).`]
    }
    if (attempt === 0) {
      text = await callReportLlm([
        ...messages,
        { role: 'assistant', content: text },
        { role: 'user', content: `That JSON was rejected:\n- ${problems.join('\n- ')}\n\nReturn the corrected COMPLETE JSON object only.` },
      ])
    }
  }
  throw new Error(`The model could not produce a valid dashboard (${problems.slice(0, 3).join('; ')}). Try generating again.`)
}
