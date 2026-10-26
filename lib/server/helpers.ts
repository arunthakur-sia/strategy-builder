import 'server-only'
import { v4 as uuidv4 } from 'uuid'
import { supabase } from './db'
import { WAVE2_ORDER, wave2DepIds, wave2OptionsEnabled, wave2SwotBEnabled, recomputeWave2Locks } from '../wave2Shared'

export function createPillar(id: string, name: string, description: string, elementNames: string[], depIds: string[] = []) {
  return {
    id, name, description,
    aiScore: null, manualScore: null, interviewScore: null, finalScore: null,
    execSummary: { aiDraft: '', edited: '', useEdited: false },
    elements: elementNames.map((eName, i) => ({
      id: `${id}_E${i + 1}`, name: eName,
      aiAnswer: '', evidenceQuote: '', sourceDocument: '',
      aiScore: null, manualScore: null, scoreRationale: '', notes: '', dataGap: null
    })),
    swot: { strengths: [], weaknesses: [], opportunities: [], threats: [] },
    interviewQuestions: [], chatHistory: [], status: depIds.length ? 'locked' : 'not_started',
    depIds,
    approvedVersion: null, approvedAt: null, approvedBy: null, versionHistory: [],
    discussionId: null
  }
}

export function createNarrativeAgent(id: string, depIds: string[] = [], uploadDep?: { label: string; hint: string }) {
  return {
    id, status: depIds.length || uploadDep ? 'locked' : 'not_started', depIds,
    ...(uploadDep ? { uploadDep: { ...uploadDep, done: false, collectionId: null } } : {}),
    output: { aiDraft: '', edited: '' },
    versionHistory: [], approvedVersion: null, approvedAt: null, approvedBy: null,
    chatHistory: [], discussionId: null
  }
}

const FANOUT_ELEMENTS: Record<string, string[]> = {
  bench: ['Peer Set Selection', 'Performance Benchmarks', 'Capability Benchmarks', 'Positioning vs. Peers'],
  pestel: ['Political', 'Economic', 'Social', 'Technological', 'Environmental', 'Legal'],
  marketSizing: ['Total Addressable Market', 'Serviceable Market', 'Growth Rate & Drivers', 'Segment Attractiveness'],
  competitor: ['Competitor Identification', 'Competitive Positioning', 'Pricing & Service Comparison', 'Win/Loss Dynamics'],
}
export const FANOUT_NAMES: Record<string, string> = {
  bench: 'Benchmarking', pestel: 'PESTEL', marketSizing: 'Market sizing', competitor: 'Competitor analysis',
}
export const FANOUT_AGENT_IDS = ['bench', 'pestel', 'marketSizing', 'competitor']
export const PILLAR_IDS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']

export function createExternalAgents() {
  return {
    idiGuide: createNarrativeAgent('idiGuide'),
    idiSynth: createNarrativeAgent('idiSynth', ['idiGuide'], {
      label: 'Interview transcripts',
      hint: 'Upload the raw interview results collected by human interviewers using the approved guide. This creates a collection passed to IDI Synth as input.',
    }),
    // The only gate on external analysis is IDI: all four fan-out agents wait on an approved idiSynth and
    // are otherwise independent of each other. setIdiDocumentsAvailable drops that dependency (to []) when
    // the reviewer has no interview documents and the IDI steps are skipped.
    bench: createPillar('bench', FANOUT_NAMES.bench, 'How does the entity compare against relevant peers?', FANOUT_ELEMENTS.bench, ['idiSynth']),
    pestel: createPillar('pestel', FANOUT_NAMES.pestel, 'What macro-environmental factors affect the entity?', FANOUT_ELEMENTS.pestel, ['idiSynth']),
    marketSizing: createPillar('marketSizing', FANOUT_NAMES.marketSizing, "What is the entity's addressable market opportunity?", FANOUT_ELEMENTS.marketSizing, ['idiSynth']),
    competitor: createPillar('competitor', FANOUT_NAMES.competitor, 'Who competes with the entity and how does it stack up?', FANOUT_ELEMENTS.competitor, ['idiSynth']),
  }
}

/** Wave 2 (Formulation): six unscored narrative agents whose dependency edges come from the functional flow
 *  diagram (see lib/wave2Shared.ts). optionsEnabled is the on/off switch for the diagram's optional
 *  "Strategic Options" step — null until the reviewer answers, which behaves like true. */
export function createWave2State() {
  const agents: Record<string, any> = {}
  for (const id of WAVE2_ORDER) agents[id] = createNarrativeAgent(id, wave2DepIds(id, true))
  return { optionsEnabled: null as boolean | null, swotBEnabled: null as boolean | null, agents }
}

export function createSwotAgentGate(pillarIds: string[]) {
  return {
    status: 'locked' as const,
    depIds: [...pillarIds, 'bench', 'pestel', 'marketSizing', 'competitor'],
    versionHistory: [] as any[], approvedVersion: null, approvedAt: null, approvedBy: null, chatHistory: [],
    discussionId: null,
  }
}

export function createDefaultEntityAssessment() {
  return {
    pillars: {
      // Pillars are independent: a reviewer can run and approve any of them at any time, in any order.
      P1: createPillar('P1','Strategic Identity & Vision',"What is the entity's reason for being and where is it headed?",['Mission & Vision Clarity','Strategic Intent','Value Proposition','Strategic Coherence','Parenting Purpose']),
      P2: createPillar('P2','Governance & Leadership','How is the entity governed and led?',['Board Composition & Effectiveness','Leadership Team Capability','Decision-Making Architecture','Accountability & Performance Management','Parenting Style']),
      P3: createPillar('P3','Financial Health & Performance','How financially sound and performant is the entity?',['Revenue Trajectory','Profitability Analysis','Liquidity & Solvency','Cash Flow Quality','Capital Allocation Efficiency','Working Capital Management','Portfolio Financial Contribution']),
      P4: createPillar('P4','Market Position & Competitive Landscape','Where does the entity stand in its market?',['Market Size & Growth','Market Share & Positioning',"Competitive Dynamics (Porter's 5 Forces)",'Customer Concentration & Satisfaction','Competitive Advantage','Portfolio Synergies']),
      P5: createPillar('P5','Operational Excellence & Capabilities','How well does the entity execute?',['Core Competencies','Operational Efficiency','Technology & Digital Maturity','Supply Chain & Partnerships','Innovation Capability','Shared Services & Synergies']),
      P6: createPillar('P6','Organization & People','Is the organization designed and staffed for success?',['Organizational Structure','Talent & Skills','Culture & Values','Employee Engagement','Change Readiness']),
      P7: createPillar('P7','Risk & Resilience','What could go wrong and how prepared is the entity?',['Strategic Risks','Operational Risks','Financial Risks','Regulatory & Compliance','ESG & Sustainability']),
      P8: createPillar('P8','Growth & Strategic Options','Where are the opportunities for value creation?',['Organic Growth Vectors','Inorganic Growth','Portfolio Optimization','Digital & AI Opportunities','Blue Ocean Opportunities','Parenting Advantage Opportunities']),
    },
    consolidatedSwot: { strengths: [], weaknesses: [], opportunities: [], threats: [] },
    strategicHypothesis: { aiDraft: '', edited: '' },
    benchmarkData: {},
    externalAgents: createExternalAgents(),
    swotAgent: createSwotAgentGate(PILLAR_IDS),
    wave2: createWave2State(),
    // Whether the reviewer has documents to seed an IDI interview guide from — null until they answer the
    // yes/no prompt. null behaves like true (see idiPathEnabled in wave1Client) so existing entities are
    // unaffected. false skips idiGuide/idiSynth entirely; external analysis then runs straight off company
    // documents (see setIdiDocumentsAvailable in wave1Engine).
    idiDocumentsAvailable: null as boolean | null,
  }
}

export function defaultOutputs() {
  return {
    D1: { generated: false, content: '', lastGenerated: null },
    D2: { generated: false, content: '', lastGenerated: null },
    D3: { generated: false, content: '', lastGenerated: null },
    D4: { generated: false, content: '', lastGenerated: null },
    D5: { generated: false, content: '', lastGenerated: null },
    D6: { generated: false, content: '', lastGenerated: null },
  }
}

export function createDefaultEntity(name: string, type: string) {
  return {
    id: uuidv4(), name, type: type || 'corporate',
    siagptCollectionId: '',
    interviewCollectionId: '',
    documents: [],
    assessment: createDefaultEntityAssessment(),
    outputs: defaultOutputs(),
    strategy: { template: 'government', levelNames: ['Vision', 'Strategic Option', 'Outcome', 'Initiative'], nodes: [] }
  }
}

export function createDefaultProject(name: string, entityName: string, entityType: string) {
  return {
    id: uuidv4(), name, entityName,
    entityType: entityType || 'government',
    language: 'en',
    interviewModeEnabled: false,
    consultantName: '',
    passwordHash: '' as string,
    assessmentDateStart: '', assessmentDateEnd: '',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    documents: [],
    siagptCollectionId: '',
    interviewCollectionId: '',
    entities: [] as any[],
    assessment: createDefaultEntityAssessment(),
    strategy: { template: 'government', levelNames: ['Vision','Strategic Option','Outcome','Initiative'], nodes: [] },
    outputs: defaultOutputs()
  }
}

/** The single rule every pillar-shaped agent's finalScore follows: the average of aiScore and manualScore
 *  when both are present (aiScore alone doesn't reflect the reviewer's judgment, and vice versa), otherwise
 *  whichever one is present, otherwise null. Every consumer of finalScore (sidebar, exports, prompts,
 *  overall-score averages) reads this one field, so this is the only place the blend needs to happen. */
export function computePillarFinalScore(aiScore: number | null, manualScore: number | null): number | null {
  if (aiScore != null && manualScore != null) return (aiScore + manualScore) / 2
  return manualScore ?? aiScore ?? null
}

/** Mutates any Pillar-shaped agent (an entity's P1-P8 pillar, or a fan-out agent like bench/pestel) with a
 *  fresh structured result, and appends the raw result to versionHistory as a new immutable version.
 *  Returns the new version number. Downstream prompt-builders must read from versionHistory[approvedVersion],
 *  never from these live fields, since a later unapproved re-run overwrites them immediately. */
export function applyPillarLikeResult(p: any, result: any): number {
  p.aiScore = result.pillarScore
  p.finalScore = computePillarFinalScore(p.aiScore, p.manualScore)
  const summary = result.executiveSummary ?? ''
  p.execSummary.aiDraft = summary
  p.execSummary.edited = summary
  const existingElements: any[] = p.elements || []
  p.elements = (result.elements || []).map((el: any, i: number) => {
    const elName = el.name || ''
    const existing = existingElements.find(
      (e: any) => e.name?.toLowerCase().trim() === elName.toLowerCase().trim()
    ) || existingElements[i]
    return {
      id: existing?.id || `${p.id}_E${i + 1}`,
      name: elName,
      aiAnswer: el.aiAnswer || '',
      evidenceQuote: el.evidenceQuote || '',
      sourceDocument: el.sourceDocument || '',
      aiScore: el.score ?? null,
      manualScore: existing?.manualScore ?? null,
      scoreRationale: el.scoreRationale || '',
      notes: existing?.notes ?? '',
      dataGap: el.dataGap ?? null,
    }
  })
  p.swot = result.swot || { strengths: [], weaknesses: [], opportunities: [], threats: [] }
  const iq = result.interviewQuestions || {}
  p.interviewQuestions = {
    leadership: iq.leadership || [],
    team: iq.team || [],
    gapFilling: iq.gapFilling || [],
  }
  p.missingInfo = result.missingInfo || []
  p.references = result.references || []
  p.status = 'complete'
  if (!p.versionHistory) p.versionHistory = []
  const v = p.versionHistory.length + 1
  p.versionHistory.push({ v, result, createdAt: new Date().toISOString() })
  return v
}

export function applyEntityPillarResult(entity: any, pillarId: string, result: any): number | undefined {
  const p = entity.assessment.pillars[pillarId]
  if (!p) return undefined
  return applyPillarLikeResult(p, result)
}

function backfillPillarApprovalFields(pillar: any) {
  if (pillar.versionHistory !== undefined) return
  pillar.approvedVersion = null
  pillar.approvedAt = null
  pillar.approvedBy = null
  pillar.versionHistory = []
}

/** Pillars used to run as a sequential chain (P2 locked on P1, etc.) and fan-out agents as a chain after
 *  idiSynth. Both are now independent: pillars have no dependencies, and every fan-out agent depends only
 *  on idiSynth (or nothing, when the reviewer skipped the IDI path). Migrate persisted agents onto that
 *  shape. Dependencies are always rewritten, but status only moves for agents that are still untouched
 *  (no chat, not approved) — never re-lock one a reviewer already started, which would erase in-progress
 *  work under someone's feet. A 'locked' agent whose new dependencies are satisfied is released. */
function backfillWave1DepIds(assessment: any) {
  const idiEnabled = assessment.idiDocumentsAvailable !== false
  const externalAgents = assessment.externalAgents
  const retarget = (agent: any, depIds: string[]) => {
    if (!agent) return
    const untouched = !agent.chatHistory?.length && agent.approvedVersion === null
    agent.depIds = depIds
    if (depIds.length === 0) { if (agent.status === 'locked') agent.status = 'not_started'; return }
    const depsDone = depIds.every(id => externalAgents?.[id]?.approvedVersion !== null && externalAgents?.[id] !== undefined)
    if (untouched && !depsDone && agent.status === 'not_started') agent.status = 'locked'
    else if (depsDone && agent.status === 'locked') agent.status = 'not_started'
  }
  PILLAR_IDS.forEach(id => retarget(assessment.pillars?.[id], []))
  FANOUT_AGENT_IDS.forEach(id => retarget(externalAgents?.[id], idiEnabled ? ['idiSynth'] : []))
}

/** Projects created before the Wave 1 approval pipeline shipped won't have externalAgents/swotAgent/
 *  interviewCollectionId, or the approval fields on their pillars, in their persisted JSON. Since this
 *  app has no per-record migration framework (everything is one JSONB blob), backfill on read instead —
 *  loadProject is the single choke-point every route goes through. Idempotent; the backfilled shape is
 *  only persisted once something actually calls saveProject again. */
/** Shared by both the top-level project (the "main"/holding entity) and each subsidiary in project.entities. */
function backfillEntityAssessmentShape(assessment: any) {
  if (assessment.pillars) {
    for (const p of Object.values(assessment.pillars) as any[]) backfillPillarApprovalFields(p)
  }
  if (!assessment.externalAgents) assessment.externalAgents = createExternalAgents()
  if (assessment.idiDocumentsAvailable === undefined) assessment.idiDocumentsAvailable = null
  if (!assessment.swotAgent) assessment.swotAgent = createSwotAgentGate(PILLAR_IDS)
  else if (assessment.swotAgent.versionHistory === undefined) {
    assessment.swotAgent.versionHistory = []
    assessment.swotAgent.approvedVersion = null
  }
  if (assessment.pillars) backfillWave1DepIds(assessment)
  backfillWave2(assessment)
}

/** Entities created before Wave 2 shipped have no assessment.wave2. Add it (and any individual agent that's
 *  missing), re-derive every agent's depIds from the diagram table, and release agents whose upstream
 *  approvals are already satisfied — e.g. an entity whose SWOT Part A was approved long ago. */
function backfillWave2(assessment: any) {
  if (!assessment.wave2) assessment.wave2 = createWave2State()
  const wave2 = assessment.wave2
  if (wave2.optionsEnabled === undefined) wave2.optionsEnabled = null
  if (wave2.swotBEnabled === undefined) wave2.swotBEnabled = null
  if (!wave2.agents) wave2.agents = {}
  const enabled = wave2OptionsEnabled(assessment)
  const swotB = wave2SwotBEnabled(assessment)
  for (const id of WAVE2_ORDER) {
    if (!wave2.agents[id]) wave2.agents[id] = createNarrativeAgent(id, wave2DepIds(id, true))
    wave2.agents[id].depIds = wave2DepIds(id, enabled, swotB)
  }
  recomputeWave2Locks(assessment)
}

function backfillWave1Shape(project: any) {
  if (project.interviewCollectionId === undefined) project.interviewCollectionId = ''
  if (project.assessment) backfillEntityAssessmentShape(project.assessment)
  for (const entity of (project.entities || [])) {
    if (entity.interviewCollectionId === undefined) entity.interviewCollectionId = ''
    if (entity.assessment) backfillEntityAssessmentShape(entity.assessment)
  }
}

export async function loadProject(id: string): Promise<any | null> {
  const { data, error } = await supabase.from('projects').select('data').eq('id', id).single()
  if (error || !data) return null
  backfillWave1Shape(data.data)
  return data.data
}

export async function saveProject(project: any) {
  project.updatedAt = new Date().toISOString()
  const { error } = await supabase.from('projects').upsert({
    id: project.id,
    name: project.name,
    entity_name: project.entityName,
    entity_type: project.entityType,
    password_hash: project.passwordHash,
    data: project,
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
}

// Serializes read-modify-write cycles per project within one server instance. Whole-project saves are
// last-writer-wins, so two cycles interleaving (e.g. two agents finishing at once) would drop one's changes.
const projectLocks = new Map<string, Promise<unknown>>()

/** Loads the CURRENT project, applies `mutate` and saves — all queued behind any other updateProject call
 *  for the same project. Long-running work (agent runs) must not hold the project across the run: do the
 *  run on its own copy, then use this to merge just its result into whatever is stored by then. */
export async function updateProject<T>(id: string, mutate: (project: any) => T | Promise<T>): Promise<T> {
  const prev = projectLocks.get(id) ?? Promise.resolve()
  const run = prev.catch(() => {}).then(async () => {
    const project = await loadProject(id)
    if (!project) throw new Error('Project not found')
    const result = await mutate(project)
    await saveProject(project)
    return result
  })
  const tail = run.catch(() => {})
  projectLocks.set(id, tail)
  try { return await run } finally { if (projectLocks.get(id) === tail) projectLocks.delete(id) }
}

function findJsonBounds(cleaned: string): { start: number; end: number } {
  const start = cleaned.indexOf('{')
  if (start === -1) throw new Error('No JSON object found in SiaGPT response')
  let depth = 0, inString = false, escape = false, end = -1
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i]
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end === -1) throw new Error('Malformed JSON in SiaGPT response')
  return { start, end }
}

export function parseJsonFromText(text: string): any {
  const cleaned = text.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim()
  const { start, end } = findJsonBounds(cleaned)
  return JSON.parse(cleaned.slice(start, end + 1))
}

/**
 * Same JSON extraction as parseJsonFromText, but also returns whatever free-text narrative preceded the
 * JSON block. Some Wave 1 assistants narrate their reasoning as markdown (e.g. "Steps G-H — Missing
 * Information & Interview Questions") before emitting the final structured JSON — that narrative is the
 * assistant's actual conversational reply to whatever the reviewer just asked, unlike the JSON's fixed
 * executiveSummary field, which doesn't change shape based on the conversation.
 */
export function parseJsonWithNarrative(text: string): { result: any; narrative: string } {
  const cleaned = text.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim()
  const { start, end } = findJsonBounds(cleaned)
  return { result: JSON.parse(cleaned.slice(start, end + 1)), narrative: cleaned.slice(0, start).trim() }
}

// pdfjs-dist (used internally by pdf-parse) reaches for the browser's DOMMatrix
// during content-stream parsing even for plain text extraction. It tries to load
// the native `@napi-rs/canvas` package for a real implementation, but that native
// binary is unreliable to trace into Vercel's serverless bundle, so provide a pure-JS
// fallback that covers the 2D matrix ops pdfjs actually touches.
function ensureDOMMatrixPolyfill() {
  if (typeof (globalThis as any).DOMMatrix !== 'undefined') return
  class DOMMatrixPolyfill {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0
    constructor(init?: number[]) {
      if (init && init.length === 6) [this.a, this.b, this.c, this.d, this.e, this.f] = init
    }
    multiplySelf(o: DOMMatrixPolyfill) {
      const { a, b, c, d, e, f } = this
      this.a = a * o.a + c * o.b
      this.b = b * o.a + d * o.b
      this.c = a * o.c + c * o.d
      this.d = b * o.c + d * o.d
      this.e = a * o.e + c * o.f + e
      this.f = b * o.e + d * o.f + f
      return this
    }
    multiply(o: DOMMatrixPolyfill) {
      return new DOMMatrixPolyfill([this.a, this.b, this.c, this.d, this.e, this.f]).multiplySelf(o)
    }
    translateSelf(tx = 0, ty = 0) { return this.multiplySelf(new DOMMatrixPolyfill([1, 0, 0, 1, tx, ty])) }
    translate(tx = 0, ty = 0) { return this.multiply(new DOMMatrixPolyfill([1, 0, 0, 1, tx, ty])) }
    scaleSelf(sx = 1, sy = sx) { return this.multiplySelf(new DOMMatrixPolyfill([sx, 0, 0, sy, 0, 0])) }
    scale(sx = 1, sy = sx) { return this.multiply(new DOMMatrixPolyfill([sx, 0, 0, sy, 0, 0])) }
    invertSelf() {
      const det = this.a * this.d - this.b * this.c
      const { a, b, c, d, e, f } = this
      this.a = d / det; this.b = -b / det; this.c = -c / det; this.d = a / det
      this.e = (c * f - d * e) / det; this.f = (b * e - a * f) / det
      return this
    }
    transformPoint(p: { x: number; y: number } = { x: 0, y: 0 }) {
      return { x: this.a * p.x + this.c * p.y + this.e, y: this.b * p.x + this.d * p.y + this.f, z: 0, w: 1 }
    }
  }
  ;(globalThis as any).DOMMatrix = DOMMatrixPolyfill
}

export async function extractText(buffer: Buffer, mimetype: string, originalName: string): Promise<string> {
  try {
    const ext = originalName.toLowerCase().split('.').pop() || ''
    if (mimetype === 'application/pdf' || ext === 'pdf') {
      ensureDOMMatrixPolyfill()
      const { PDFParse } = await import('pdf-parse')
      const parser = new PDFParse({ data: buffer })
      try {
        const result = await parser.getText()
        return result.text || ''
      } finally {
        await parser.destroy()
      }
    }
    if (mimetype.includes('wordprocessingml') || ext === 'docx' || ext === 'doc') {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ buffer })
      return result.value || ''
    }
    if (mimetype.includes('spreadsheetml') || ext === 'xlsx' || ext === 'xls') {
      const XLSX = await import('xlsx')
      const workbook = XLSX.read(buffer)
      let text = ''
      workbook.SheetNames.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName]
        text += `\n=== Sheet: ${sheetName} ===\n`
        text += XLSX.utils.sheet_to_csv(sheet)
      })
      return text
    }
    if (mimetype.includes('presentationml') || ext === 'pptx') return `[PPTX file: ${originalName}]`
    if (mimetype.includes('image')) return `[Image file: ${originalName}]`
    return ''
  } catch (err: any) {
    console.error('Text extraction error:', err.message)
    return `[Extraction failed: ${err.message}]`
  }
}
