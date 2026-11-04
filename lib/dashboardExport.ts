// Client-side exports for the Wave 3 dashboard (the slide's "Export center": Excel / JSON from the shared data
// model). Slides / PDF packs and BI-tool publishing belong to Wave 4.
import type { DashboardData } from './wave3Dashboard'

function fileBase(name: string): string {
  return (name || 'strategy').replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'strategy'
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadDashboardJson(data: DashboardData, entityName: string) {
  save(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${fileBase(entityName)}-strategy-dashboard.json`)
}

/** One workbook, one sheet per table of the data model, with ids kept so sheets join back to each other. */
export async function downloadDashboardExcel(data: DashboardData, entityName: string) {
  const XLSX = await import('xlsx')
  const themeName = (id: string) => data.themes.find(t => t.id === id)?.name || id
  const perspectiveName = (id: string) => data.perspectives.find(p => p.id === id)?.name || id
  const objectiveTitle = (id: string) => data.objectives.find(o => o.id === id)?.title || id
  const period = (i: number | null) => (i == null ? '' : data.roadmapPeriods[i] ?? '')

  const sheets: [string, Record<string, any>[]][] = [
    ['Vision Mission Values', [
      { Item: 'Vision', Text: data.vmv.vision },
      { Item: 'Mission', Text: data.vmv.mission },
      ...data.vmv.values.map(v => ({ Item: 'Value', Text: v })),
    ]],
    ['Objectives', data.objectives.map(o => ({
      ID: o.id, Objective: o.title, Description: o.description, Theme: themeName(o.themeId), Perspective: perspectiveName(o.perspectiveId),
      'Supports (objective IDs)': o.supports.join(', '),
    }))],
    ['KPIs', data.kpis.map(k => ({
      ID: k.id, KPI: k.name, Description: k.description, 'Objective IDs': k.objectiveIds.join(', '),
      Objectives: k.objectiveIds.map(objectiveTitle).join('; '), Unit: k.unit, Baseline: k.baseline, 'Baseline value': k.baselineValue,
      'Baseline source': k.baselineSource, Target: k.target, 'Target value': k.targetValue, 'Target date': k.targetDate,
      Direction: k.direction, Frequency: k.frequency, Owner: k.owner, 'Data source': k.dataSource,
    }))],
    ['Initiatives', [...data.initiatives].sort((a, b) => (a.priorityRank ?? 99) - (b.priorityRank ?? 99)).map(i => ({
      ID: i.id, Rank: i.priorityRank, Initiative: i.name, Description: i.description, Tier: i.tier, 'Priority score': i.priorityScore,
      Rationale: i.rationale, Owner: i.owner, Start: period(i.startPeriod), End: period(i.endPeriod), Milestone: period(i.milestonePeriod),
      'Objective IDs': i.objectiveIds.join(', '), 'KPI IDs': i.kpiIds.join(', '), 'Depends on': i.dependencies.join(', '),
    }))],
    ['Roadmap', data.initiatives.map(i => ({
      Initiative: i.name,
      ...Object.fromEntries(data.roadmapPeriods.map((p, idx) => [p, idx === i.milestonePeriod ? '◆' : idx >= i.startPeriod && idx <= i.endPeriod ? '■' : ''])),
    }))],
    ['Assumptions', data.assumptions.map(a => ({ Assumption: a }))],
  ]
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{}]), name)
  }
  XLSX.writeFile(wb, `${fileBase(entityName)}-strategy-dashboard.xlsx`)
}
