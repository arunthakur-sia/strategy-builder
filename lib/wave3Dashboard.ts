// Structured shape of the Wave 3 "Strategy Visualisation / BI Dashboard" (step 5), shared by the server
// (validates the LLM's JSON) and the client (renders it). One data model feeds the strategy map, the KPI
// scorecard, the roadmap and the export centre — same as the "Strategy Visualisation Agent" slide.

import { z } from 'zod'

// LLMs sometimes emit numbers for string fields (or null for empty ones) — accept both rather than fail a run.
const text = z.preprocess(v => v == null ? '' : typeof v === 'number' ? String(v) : v, z.string().trim())
const id = text.pipe(z.string().min(1, 'id must not be empty'))
const idList = z.preprocess(v => v == null ? [] : v, z.array(text))
const num = z.preprocess(v => v === '' || v == null ? null : typeof v === 'string' && !isNaN(Number(v)) ? Number(v) : v, z.number().nullable())
const int = z.preprocess(v => typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : v, z.number().int())

export const KPI_DIRECTIONS = ['increase', 'decrease', 'maintain'] as const
export const INITIATIVE_TIERS = ['Now', 'Next', 'Later'] as const

const objectiveSchema = z.object({
  id,
  title: text.pipe(z.string().min(1)),
  description: text.default(''),
  themeId: text.default(''),
  perspectiveId: text.default(''),
  /** Objectives this one feeds into (the upward arrows of the strategy map, e.g. People → Processes → Customer → Financial). */
  supports: idList.default([]),
})

const kpiSchema = z.object({
  id,
  name: text.pipe(z.string().min(1)),
  description: text.default(''),
  objectiveIds: idList.default([]),
  unit: text.default(''),
  baseline: text.default(''),
  baselineValue: num.default(null),
  baselineSource: text.default(''),
  target: text.default(''),
  targetValue: num.default(null),
  targetDate: text.default(''),
  direction: z.preprocess(v => typeof v === 'string' ? v.toLowerCase().trim() : v, z.enum(KPI_DIRECTIONS)).catch('increase'),
  frequency: text.default(''),
  owner: text.default(''),
  dataSource: text.default(''),
})

const initiativeSchema = z.object({
  id,
  name: text.pipe(z.string().min(1)),
  description: text.default(''),
  objectiveIds: idList.default([]),
  kpiIds: idList.default([]),
  owner: text.default(''),
  /** Zero-based indexes into roadmapPeriods. */
  startPeriod: int,
  endPeriod: int,
  milestonePeriod: z.preprocess(v => v === '' ? null : v, int.nullable()).default(null),
  priorityRank: z.preprocess(v => v === '' ? null : v, int.nullable()).default(null),
  priorityScore: num.default(null),
  tier: z.preprocess(v => typeof v === 'string' ? v.trim().charAt(0).toUpperCase() + v.trim().slice(1).toLowerCase() : v, z.enum(INITIATIVE_TIERS)).catch('Next'),
  rationale: text.default(''),
  dependencies: idList.default([]),
})

export const dashboardSchema = z.object({
  title: text.default(''),
  summary: text.default(''),
  vmv: z.object({
    vision: text.default(''),
    mission: text.default(''),
    values: idList.default([]),
  }).default({}),
  perspectives: z.array(z.object({ id, name: text.pipe(z.string().min(1)) })).min(1, 'at least one perspective is required'),
  themes: z.array(z.object({ id, name: text.pipe(z.string().min(1)), description: text.default('') })).min(1, 'at least one theme is required'),
  objectives: z.array(objectiveSchema).min(1, 'at least one objective is required'),
  kpis: z.array(kpiSchema).min(1, 'at least one KPI is required'),
  initiatives: z.array(initiativeSchema).min(1, 'at least one initiative is required'),
  roadmapPeriods: z.array(text.pipe(z.string().min(1))).min(1, 'roadmapPeriods must list at least one period label'),
  assumptions: idList.default([]),
})

export type DashboardData = z.infer<typeof dashboardSchema>
export type DashboardObjective = DashboardData['objectives'][number]
export type DashboardKpi = DashboardData['kpis'][number]
export type DashboardInitiative = DashboardData['initiatives'][number]

function dupes(ids: string[]): string[] {
  const seen = new Set<string>(), out = new Set<string>()
  for (const i of ids) { if (seen.has(i)) out.add(i); seen.add(i) }
  return [...out]
}

/**
 * Parses and cleans the LLM's JSON. Returns the problems as human-readable lines (fed back to the model on a
 * repair attempt) instead of throwing. Structural gaps that can be fixed deterministically are repaired
 * silently: dangling cross-references are dropped, unknown theme/perspective ids fall back to the first one,
 * and roadmap indexes are clamped into range.
 */
export function validateDashboard(raw: unknown): { ok: true; data: DashboardData } | { ok: false; errors: string[] } {
  const parsed = dashboardSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.slice(0, 20).map(i => `${i.path.join('.') || '(root)'}: ${i.message}`) }
  }
  const d = parsed.data
  const errors: string[] = []
  for (const [name, list] of [
    ['perspectives', d.perspectives], ['themes', d.themes], ['objectives', d.objectives], ['kpis', d.kpis], ['initiatives', d.initiatives],
  ] as const) {
    const dup = dupes(list.map(x => x.id))
    if (dup.length) errors.push(`${name}: duplicate ids ${dup.join(', ')}`)
  }
  if (errors.length) return { ok: false, errors }

  const perspectiveIds = new Set(d.perspectives.map(p => p.id))
  const themeIds = new Set(d.themes.map(t => t.id))
  const objectiveIds = new Set(d.objectives.map(o => o.id))
  const kpiIds = new Set(d.kpis.map(k => k.id))
  const initiativeIds = new Set(d.initiatives.map(i => i.id))
  const last = d.roadmapPeriods.length - 1
  const clamp = (n: number) => Math.min(Math.max(n, 0), last)

  d.objectives = d.objectives.map(o => ({
    ...o,
    themeId: themeIds.has(o.themeId) ? o.themeId : d.themes[0].id,
    perspectiveId: perspectiveIds.has(o.perspectiveId) ? o.perspectiveId : d.perspectives[0].id,
    supports: o.supports.filter(s => objectiveIds.has(s) && s !== o.id),
  }))
  d.kpis = d.kpis.map(k => ({ ...k, objectiveIds: k.objectiveIds.filter(o => objectiveIds.has(o)) }))
  d.initiatives = d.initiatives.map((i, idx) => {
    const start = clamp(i.startPeriod)
    const end = Math.max(start, clamp(i.endPeriod))
    return {
      ...i,
      startPeriod: start, endPeriod: end,
      milestonePeriod: i.milestonePeriod == null ? null : Math.min(Math.max(clamp(i.milestonePeriod), start), end),
      priorityRank: i.priorityRank ?? idx + 1,
      objectiveIds: i.objectiveIds.filter(o => objectiveIds.has(o)),
      kpiIds: i.kpiIds.filter(k => kpiIds.has(k)),
      dependencies: i.dependencies.filter(x => initiativeIds.has(x) && x !== i.id),
    }
  })
  return { ok: true, data: d }
}

/** 0..1 — how far the baseline already is toward the target (the thin bar on each scorecard tile). Null when
 *  either end isn't numeric. Actuals arrive in Wave 4; until then this shows where the KPI starts. */
export function kpiProgress(k: DashboardKpi): number | null {
  const { baselineValue: b, targetValue: t } = k
  if (b == null || t == null || t === 0) return null
  if (k.direction === 'decrease') return b <= 0 ? null : Math.min(Math.max(t / b, 0), 1)
  return Math.min(Math.max(b / t, 0), 1)
}
