import { create } from 'zustand'

interface PillarElement {
  id: string
  name: string
  aiAnswer: string
  evidenceQuote: string
  sourceDocument: string
  aiScore: number | null
  manualScore: number | null
  scoreRationale: string
  notes: string
  dataGap: string | null
}

interface Pillar {
  id: string
  name: string
  description: string
  aiScore: number | null
  manualScore: number | null
  interviewScore: number | null
  finalScore: number | null
  execSummary: { aiDraft: string; edited: string; useEdited: boolean }
  elements: PillarElement[]
  swot: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] }
  interviewQuestions: string[]
  chatHistory: any[]
  // P1-P8 have no dependencies (any can run at any time); the external fan-out agents
  // (bench/pestel/marketSizing/competitor) reuse this same Pillar shape and depend only on IDI Synth.
  status: 'locked' | 'not_started' | 'in_progress' | 'complete'
  depIds: string[]
  /** Version number (matches an entry in versionHistory) the human has approved as canonical; null = not yet approved. */
  approvedVersion: number | null
  approvedAt: string | null
  approvedBy: string | null
  /** Every completed run, oldest first — versionHistory[].v matches the chat "vN" tags shown in the UI.
   *  A version can be approved straight from a chat transcript before the agent reached a structured
   *  result (see ensureApprovableVersion server-side) — result is null and text holds the transcript. */
  versionHistory: { v: number; result: any | null; text?: string; createdAt: string }[]
}

/** IDI Guide / IDI Synth — unscored narrative agents in the Wave 1 external-analysis pipeline. */
export interface NarrativeAgent {
  id: string
  status: 'locked' | 'not_started' | 'in_progress' | 'complete' | 'skipped'
  depIds: string[]
  /** Only set on IDI Synth: gates it on a human uploading interview transcripts as their own collection. */
  uploadDep?: { label: string; hint: string; done: boolean; collectionId: string | null }
  output: { aiDraft: string; edited: string }
  versionHistory: { v: number; text: string; createdAt: string }[]
  approvedVersion: number | null
  approvedAt: string | null
  approvedBy: string | null
  chatHistory: any[]
}

/** Gates the entity-level SWOT — the underlying consolidatedSwot/strategicHypothesis fields stay the actual data. */
export interface SwotAgentGate {
  status: 'locked' | 'not_started' | 'in_progress' | 'complete'
  depIds: string[]
  versionHistory: { v: number; result: { consolidatedSwot: any; strategicHypothesis: string }; createdAt: string }[]
  approvedVersion: number | null
  approvedAt: string | null
  approvedBy: string | null
  chatHistory: any[]
}

interface EntityAssessment {
  pillars: Record<string, Pillar>
  consolidatedSwot: { strengths: any[]; weaknesses: any[]; opportunities: any[]; threats: any[] }
  strategicHypothesis: { aiDraft: string; edited: string }
  benchmarkData: Record<string, any>
  externalAgents: {
    idiGuide: NarrativeAgent
    idiSynth: NarrativeAgent
    bench: Pillar
    pestel: Pillar
    marketSizing: Pillar
    competitor: Pillar
  }
  swotAgent: SwotAgentGate
  /** Wave 2 (Formulation) — see lib/wave2Shared.ts for the agent ids and dependency edges. */
  wave2: {
    /** null until the reviewer answers; behaves like true. false skips the optional strategic-options step. */
    optionsEnabled: boolean | null
    /** null until the reviewer answers; behaves like true. false skips the optional SWOT Part B step. */
    swotBEnabled: boolean | null
    agents: Record<string, NarrativeAgent>
  }
}

export interface SubsidiaryEntity {
  id: string
  name: string
  type: string
  siagptCollectionId: string
  /** Set once the human uploads interview transcripts for IDI Synth — a separate collection from siagptCollectionId. */
  interviewCollectionId: string
  documents: any[]
  assessment: EntityAssessment
  outputs: Record<string, { generated: boolean; content: string; fileUrl?: string; fileName?: string; lastGenerated: string | null }>
  strategy?: {
    template: string
    levelNames: string[]
    nodes: StrategyNode[]
  }
}

interface StrategyNode {
  id: string
  parentId: string | null
  level: number
  title: string
  description: string
  aiDraft: string
  linkedPillar: string | null
  kpis: any[]
  initiatives: any[]
  order: number
}

interface Project {
  id: string
  name: string
  entityName: string
  entityType: string
  language: string
  interviewModeEnabled: boolean
  consultantName: string
  sector?: string
  assessmentDateStart?: string
  assessmentDateEnd?: string
  rubric?: Record<string, Record<string, Record<string, string>>>
  createdAt: string
  updatedAt: string
  documents: any[]
  entities: SubsidiaryEntity[]
  assessment: {
    pillars: Record<string, Pillar>
    consolidatedSwot: { strengths: any[]; weaknesses: any[]; opportunities: any[]; threats: any[] }
    strategicHypothesis: { aiDraft: string; edited: string }
    benchmarkData: Record<string, any>
  }
  strategy: {
    template: string
    levelNames: string[]
    nodes: StrategyNode[]
  }
  outputs: Record<string, { generated: boolean; content: string; fileUrl?: string; fileName?: string; lastGenerated: string | null }>
}

interface StoreState {
  currentProjectId: string | null
  isAuthenticated: boolean
  project: Project | null
  loading: boolean
  error: string | null
  activePillar: string
  activeTab: string
  activeEntityId: string | null
  sidebarCollapsed: boolean
  language: string
  demoMode: boolean
  sourcesOpen: boolean
  activeSourceNum: number | null
  /** Resolved source metadata (num → { title, url }) populated by SourcesPanel after batch-fetch */
  globalSourceMeta: Record<string, { title: string; url: string | null }>
  /** Warnings from project creation (e.g. entities whose collection creation failed) shown once on Dashboard */
  pendingWarnings: string[]

  setProject: (project: Project | null) => void
  setPendingWarnings: (warnings: string[]) => void
  setAuthenticated: (val: boolean) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setActivePillar: (pillarId: string) => void
  setActiveTab: (tab: string) => void
  setActiveEntityId: (entityId: string | null) => void
  toggleSidebar: () => void
  setLanguage: (lang: string) => void
  setDemoMode: (val: boolean) => void
  setSourcesOpen: (val: boolean) => void
  setActiveSourceNum: (num: number | null) => void
  setGlobalSourceMeta: (meta: Record<string, { title: string; url: string | null }>) => void
  assessmentRunning: boolean
  assessmentRunningPillars: Record<string, 'running' | 'done' | 'error'>
  setAssessmentRunning: (v: boolean) => void
  setAssessmentRunningPillars: (v: Record<string, 'running' | 'done' | 'error'>) => void
  updateAssessmentRunningPillar: (pillarId: string, status: 'running' | 'done' | 'error') => void
  updatePillar: (pillarId: string, data: Partial<Pillar>) => void
  updateEntityPillar: (entityId: string, pillarId: string, data: Partial<Pillar>) => void
  updateStrategyNode: (nodeId: string, data: Partial<StrategyNode>) => void
  addStrategyNode: (node: StrategyNode) => void
  deleteStrategyNode: (nodeId: string) => void
  updateEntityStrategy: (entityId: string, data: Partial<{ template: string; levelNames: string[]; nodes: StrategyNode[] }>) => void
  updateRubric: (rubricData: Record<string, Record<string, Record<string, string>>>) => void
  getOverallScore: () => string | null
  getCompletionPercent: () => number
  getRag: (score: number | null | undefined) => 'red' | 'amber' | 'green' | 'gray'
  logout: () => void
}

export const useStore = create<StoreState>((set, get) => ({
  currentProjectId: null,
  isAuthenticated: false,
  project: null,
  loading: false,
  error: null,
  activePillar: 'P1',
  activeTab: 'dashboard',
  activeEntityId: null,
  sidebarCollapsed: false,
  language: 'en',
  demoMode: false,
  sourcesOpen: false,
  activeSourceNum: null,
  globalSourceMeta: {},
  assessmentRunning: false,
  assessmentRunningPillars: {},
  pendingWarnings: [],

  setProject: (project) => set({ project: project ? { ...project, entities: project.entities || [] } : null, currentProjectId: project?.id ?? null }),
  setPendingWarnings: (warnings) => set({ pendingWarnings: warnings }),
  setAuthenticated: (val) => set({ isAuthenticated: val }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setActivePillar: (pillarId) => set({ activePillar: pillarId }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setActiveEntityId: (entityId) => set({ activeEntityId: entityId }),
  toggleSidebar: () => set(s => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setLanguage: (lang) => set({ language: lang }),
  setDemoMode: (val) => set({ demoMode: val }),
  setSourcesOpen: (val) => set({ sourcesOpen: val }),
  setActiveSourceNum: (num) => set({ activeSourceNum: num }),
  setGlobalSourceMeta: (meta) => set({ globalSourceMeta: meta }),
  setAssessmentRunning: (v) => set({ assessmentRunning: v }),
  setAssessmentRunningPillars: (v) => set({ assessmentRunningPillars: v }),
  updateAssessmentRunningPillar: (pillarId, status) => set(s => ({ assessmentRunningPillars: { ...s.assessmentRunningPillars, [pillarId]: status } })),

  updatePillar: (pillarId, data) => set(s => ({
    project: s.project ? {
      ...s.project,
      assessment: {
        ...s.project.assessment,
        pillars: {
          ...s.project.assessment.pillars,
          [pillarId]: { ...s.project.assessment.pillars[pillarId], ...data }
        }
      }
    } : null
  })),

  updateEntityPillar: (entityId, pillarId, data) => set(s => {
    if (!s.project) return {}
    const entities = (s.project.entities || []).map(e => {
      if (e.id !== entityId) return e
      return {
        ...e,
        assessment: {
          ...e.assessment,
          pillars: { ...e.assessment.pillars, [pillarId]: { ...e.assessment.pillars[pillarId], ...data } }
        }
      }
    })
    return { project: { ...s.project, entities } }
  }),

  updateStrategyNode: (nodeId, data) => set(s => {
    if (!s.project) return {}
    const nodes = s.project.strategy.nodes.map(n => n.id === nodeId ? { ...n, ...data } : n)
    return { project: { ...s.project, strategy: { ...s.project.strategy, nodes } } }
  }),

  addStrategyNode: (node) => set(s => {
    if (!s.project) return {}
    return { project: { ...s.project, strategy: { ...s.project.strategy, nodes: [...(s.project.strategy.nodes || []), node] } } }
  }),

  deleteStrategyNode: (nodeId) => set(s => {
    if (!s.project) return {}
    const nodes = s.project.strategy.nodes.filter(n => n.id !== nodeId && n.parentId !== nodeId)
    return { project: { ...s.project, strategy: { ...s.project.strategy, nodes } } }
  }),

  updateEntityStrategy: (entityId, data) => set(s => {
    if (!s.project) return {}
    const entities = (s.project.entities || []).map(e => {
      if (e.id !== entityId) return e
      const current = e.strategy || { template: 'government', levelNames: ['Vision', 'Strategic Option', 'Outcome', 'Initiative'], nodes: [] }
      return { ...e, strategy: { ...current, ...data } }
    })
    return { project: { ...s.project, entities } }
  }),

  getOverallScore: () => {
    const { project } = get()
    if (!project) return null
    const pillars = Object.values(project.assessment.pillars)
    const scored = pillars.filter(p => p.finalScore !== null)
    if (scored.length === 0) return null
    return (scored.reduce((sum, p) => sum + (p.finalScore || 0), 0) / scored.length).toFixed(1)
  },

  getCompletionPercent: () => {
    const { project } = get()
    if (!project) return 0
    const pillars = Object.values(project.assessment.pillars)
    const complete = pillars.filter(p => p.status === 'complete').length
    return Math.round((complete / pillars.length) * 100)
  },

  getRag: (score) => {
    if (score === null || score === undefined) return 'gray'
    if (score < 2.5) return 'red'
    if (score < 3.5) return 'amber'
    return 'green'
  },

  updateRubric: (rubricData) => set(s => ({
    project: s.project ? { ...s.project, rubric: rubricData } : null
  })),

  logout: () => set({ project: null, currentProjectId: null, isAuthenticated: false, activeEntityId: null, assessmentRunning: false, assessmentRunningPillars: {}, pendingWarnings: [] }),
}))
