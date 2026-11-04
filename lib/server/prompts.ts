import 'server-only'
import { SCORING_RUBRIC, buildRubricSection } from './rubric'

export function buildSystemPrompt(project: { entityName: string; entityType: string }) {
  return `You are an expert strategy consultant at SIA Partners. Assess ${project.entityName} (${project.entityType}) using the 8-pillar framework.

${SCORING_RUBRIC}

Return valid JSON exactly matching the schema. Be evidence-based. Flag data gaps. Never fabricate.`
}

export function getAgentPersona(pillarId: string): string {
  const personas: Record<string, string> = {
    P1: "You are an expert strategic analyst specializing in organizational vision, mission clarity, and strategic intent assessment. Your role is to evaluate an entity's Strategic Identity & Vision across its key assessment elements using the 8-Pillar Strategy Assessment Framework. You have 20+ years of experience advising governments and sovereign entities in the GCC on mission clarity, strategic coherence, and value proposition design.",
    P2: "You are a Corporate Governance Expert specializing in board effectiveness, leadership capability, and decision-making architecture. Your role is to evaluate an entity's Governance & Leadership across its key assessment elements using the 8-Pillar Strategy Assessment Framework. You have extensive experience with complex holding entities and government-linked organizations.",
    P3: "You are a Chief Financial Analyst specializing in financial health diagnostics for government entities, SWFs, and holding companies. Your role is to evaluate an entity's Financial Health & Performance across its key assessment elements using the 8-Pillar Strategy Assessment Framework. You are expert in revenue trajectory analysis, capital allocation, and portfolio financial performance.",
    P4: "You are a Market Intelligence Strategist with expertise in GCC competitive landscapes and market positioning. Your role is to evaluate an entity's Market Position & Competitive Landscape across its key assessment elements using the 8-Pillar Strategy Assessment Framework. You specialize in Porter's Five Forces analysis for both private and public sector entities.",
    P5: "You are an Operational Excellence Consultant with deep expertise in digital maturity assessment and process efficiency benchmarking. Your role is to evaluate an entity's Operational Excellence & Capabilities across its key assessment elements using the 8-Pillar Strategy Assessment Framework. You specialize in innovation capability building for complex organizations.",
    P6: "You are an Organizational Design and Talent Specialist with 15+ years of experience in HR diagnostics, culture assessment, and change readiness evaluation. Your role is to evaluate an entity's Organization & People across its key assessment elements using the 8-Pillar Strategy Assessment Framework. You specialize in large government entities.",
    P7: "You are an Enterprise Risk Management Expert specializing in strategic risk, operational resilience, regulatory compliance, and ESG integration. Your role is to evaluate an entity's Risk & Resilience across its key assessment elements using the 8-Pillar Strategy Assessment Framework. You focus on public sector and holding entities.",
    P8: "You are a Growth Strategy Advisor specializing in organic and inorganic growth vectors and digital transformation opportunities. Your role is to evaluate an entity's Growth & Strategic Options across its key assessment elements using the 8-Pillar Strategy Assessment Framework. You focus on strategic option development for entities operating in the GCC.",
  }
  return `${personas[pillarId] || 'You are a senior strategy consultant at SIA Partners.'}\n\n`
}

// The pillar assistants are pre-configured in Langflow with their persona, entity/pillar context, and
// output JSON schema — we only need to send the guiding rubric alongside the reviewer's instruction
// (see runWave1Agent's pillar-kind composition in wave1Engine.ts).
export function buildAssessmentPrompt(project: any, pillarId: string): string {
  return buildRubricSection(project, pillarId)
}

// ─── Wave 1 external-analysis agents ──────────────────────────────────────────

export function buildIdiGuidePrompt(entity: { name: string; type: string }): string {
  return `Entity: ${entity.name} (${entity.type})`
}

export function buildIdiSynthPrompt(entity: { name: string; type: string }, approvedGuideText: string): string {
  return `You are a senior strategy consultant at SIA Partners synthesizing primary research for ${entity.name} (${entity.type}).

You have access to two inputs via the RAG collections attached to this call: (1) the company's core documents, and (2) the raw interview transcripts collected by human interviewers using the guide below.

━━━ APPROVED INTERVIEW GUIDE ━━━
${approvedGuideText || 'Not available.'}

Synthesize the interview transcripts against the guide's themes. For each theme: summarize what interviewees said, note points of consensus vs. disagreement across interviewees, and flag anything that contradicts or extends the documentary evidence.

Write the synthesis as structured markdown with one section per theme plus a closing "Implications for external analysis" section highlighting findings that should inform benchmarking, PESTEL, market sizing, and competitor analysis.`
}

// The entity-SWOT assistant is pre-configured in Langflow with its persona and output JSON schema — we
// only need to send the raw approved conversation transcripts alongside the reviewer's instruction
// (see runWave1Agent's swot-kind composition in wave1Engine.ts). No pre-extracted score/SWOT JSON: the
// assistant reads each conversation itself and derives the strengths/weaknesses/opportunities/threats.
export function buildEntitySwotPrompt(
  entity: any,
  pillarTranscripts: { pillar: string; transcript: string }[],
  fanoutTranscripts: { name: string; transcript: string }[]
): string {
  const pillarsText = pillarTranscripts
    .map(p => `### ${p.pillar}\n${p.transcript || '(no conversation)'}`)
    .join('\n\n')
  const fanoutText = fanoutTranscripts
    .map(f => `### ${f.name}\n${f.transcript || '(no conversation)'}`)
    .join('\n\n')
  return `Below are the full raw conversation transcripts between the reviewer and each internal pillar and external-analysis agent for this entity. There is no pre-extracted score or SWOT data — read each conversation yourself and derive the strengths, weaknesses, opportunities, and threats it surfaces.

INTERNAL PILLAR CONVERSATIONS:
${pillarsText}

EXTERNAL ANALYSIS CONVERSATIONS (benchmarking, PESTEL, market sizing, competitor analysis):
${fanoutText}

Run the consolidation now: synthesize all of the above into one consolidated entity-level SWOT and a strategic hypothesis.`
}

// ─── Wave 2 (Formulation) agents ──────────────────────────────────────────────
// The Wave 2 assistants are pre-configured in SiaGPT with their persona and output format — we only hand
// them the entity and every upstream output the flow diagram routes into this node (always the frozen,
// human-approved version, never a live draft). Company documents arrive via the attached collection.
export function buildWave2Prompt(
  entity: { name: string; type: string },
  agentLabel: string,
  inputs: { label: string; text: string }[]
): string {
  const sections = inputs.length
    ? inputs.map(i => `━━━ ${i.label} (approved) ━━━\n${i.text || '(approved with no recorded content)'}`).join('\n\n')
    : '(none — this is the first step of Wave 2; work from the company documents)'
  return `Entity: ${entity.name} (${entity.type})
Step: ${agentLabel}

Upstream outputs approved by the reviewer, to be used as the basis for this step:

${sections}`
}

export function buildReportPrompts(
  entityName: string, entityType: string, pillarsData: any, swotData: any
): Record<string, string> {
  const mockProject = { entityName, entityType }
  const allPillars = Object.entries(pillarsData)
    .map(([, p]: [string, any]) => `## ${p.name} (${p.finalScore || 'N/A'}/5)\n${p.execSummary?.edited || 'Not assessed'}\nStrengths: ${(p.swot?.strengths || []).join(', ')}\nWeaknesses: ${(p.swot?.weaknesses || []).join(', ')}`)
    .join('\n\n')
  const allGaps = Object.entries(pillarsData)
    .map(([id, p]: [string, any]) => {
      const leadershipQs = Array.isArray(p.interviewQuestions) ? p.interviewQuestions : (p.interviewQuestions?.leadership || [])
      const teamQs = Array.isArray(p.interviewQuestions) ? [] : (p.interviewQuestions?.team || [])
      return `${id} ${p.name}: L: ${leadershipQs.slice(0,3).join(' | ')} | T: ${teamQs.slice(0,3).join(' | ')}`
    }).join('\n')
  return {
    D1: `${buildSystemPrompt(mockProject)}\n\nGenerate a 600-800 word Strategic Perception & Hypothesis Report for ${entityName} covering: 1) Executive Overview, 2) Strategic Tensions, 3) Cross-pillar Patterns, 4) Working Strategic Hypothesis, 5) Recommended Focus Areas.\n\nAssessment data:\n${allPillars}\n\nUse bullet points throughout. Format as structured markdown.`,
    D2: `${buildSystemPrompt(mockProject)}\n\nGenerate a full 1000-1500 word Strategic Diagnostic Report for ${entityName} covering all pillars, consolidated SWOT, and top 5 strategic priorities. Use bullet points throughout all sections.\n\nData:\n${allPillars}\n\nSwot: ${JSON.stringify(swotData)}\n\nFormat as structured markdown.`,
    D3: `${buildSystemPrompt(mockProject)}\n\nGenerate a Benchmark & Opportunity Map for ${entityName}. Include: 1) Cross-pillar score comparison table with RAG ratings, 2) Internal benchmarking observations, 3) External GCC and global benchmarks using your training knowledge, 4) A 2x2 Opportunity Prioritization Matrix (Impact x Feasibility) with all identified opportunities plotted.\n\nData:\n${allPillars}\n\nFormat as structured markdown with tables.`,
    D4: `${buildSystemPrompt(mockProject)}\n\nGenerate a 3-5 minute professional AI Video Script for ${entityName} covering: key findings, top 3 strengths and critical gaps, SWOT highlights, top 3 strategic imperatives, and a closing call-to-action. Format with [SCENE], [NARRATOR], and [VISUAL CUE] blocks.\n\nData:\n${allPillars}`,
    D5: `${buildSystemPrompt(mockProject)}\n\nGenerate Stakeholder Interview Guides for ${entityName}: 1) Leadership Set (10-15 strategic questions for C-suite/board), 2) Team Lead Set (10-15 operational questions for dept heads), 3) Gap-Filling Questions (one per data gap, tagged Pillar | Element | Priority).\n\nGaps:\n${allGaps}\n\nFormat as structured markdown.`,
    D6: `${buildSystemPrompt(mockProject)}\n\nGenerate a Full Strategy Document for ${entityName} following: Vision → Strategic Options → Outcomes → KPIs → Initiatives → Projects. Include executive summary, performance indicator tables, initiative roadmap, and strategic narrative.\n\nData:\n${allPillars}\n\nFormat as comprehensive structured markdown.`,
  }
}

export function cleanReportContent(raw: string): string {
  return raw
    .replace(/\n#{1,3}\s*(Appendix|appendix)[^\n]*\n[\s\S]*?```[\s\S]*?```[\s\S]*/g, '')
    .replace(/\n#{1,3}\s*(Appendix|appendix)[^\n]*\n[\s\S]*/g, '')
    .trimEnd()
}

// ─── Wave 3 (Translation) agents ──────────────────────────────────────────────
// Like Wave 2, the Wave 3 assistants carry their persona and output format in SiaGPT — we hand them the
// entity and every input the flow diagram routes into this node. `approved` sections are frozen, human-approved
// outputs; `provided` sections are reference material the reviewer supplied or the Wave 1 record (not an agent
// output awaiting sign-off, so they are labelled differently).
export function buildWave3Prompt(
  entity: { name: string; type: string },
  agentLabel: string,
  approved: { label: string; text: string }[],
  provided: { label: string; text: string }[] = []
): string {
  const approvedText = approved
    .map(i => `━━━ ${i.label} (approved) ━━━\n${i.text || '(approved with no recorded content)'}`)
    .join('\n\n')
  const providedText = provided
    .map(i => `━━━ ${i.label} ━━━\n${i.text || '(none provided)'}`)
    .join('\n\n')
  return `Entity: ${entity.name} (${entity.type})
Step: ${agentLabel}

Upstream outputs approved by the reviewer, to be used as the basis for this step:

${approvedText}${providedText ? `\n\nAdditional input for this step:\n\n${providedText}` : ''}`
}
