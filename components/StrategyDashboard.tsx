'use client'
// Renders the Wave 3 dashboard (step 5) from its structured data — the "Strategy dashboard" mock-up: strategy map,
// KPI scorecard (baseline → target), initiative roadmap and export centre, all from one data model.
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Download, FileJson, FileSpreadsheet } from 'lucide-react'
import { kpiProgress, type DashboardData, type DashboardKpi, type DashboardInitiative } from '@/lib/wave3Dashboard'
import { downloadDashboardExcel, downloadDashboardJson } from '@/lib/dashboardExport'

const THEME_COLORS = ['#2F5D8A', '#1F8A87', '#5B6B8C', '#7C5CBF', '#C2791A', '#B83A6B']
const TABS = [
  { key: 'map', label: 'Strategy map' },
  { key: 'scorecard', label: 'Scorecard' },
  { key: 'roadmap', label: 'Roadmap' },
  { key: 'export', label: 'Export center' },
] as const
type TabKey = typeof TABS[number]['key']

const card: React.CSSProperties = { background: 'var(--sia-white)', border: '1px solid rgba(23,48,68,0.1)', borderRadius: 'var(--radius)' }
const chip: React.CSSProperties = { fontSize: '10.5px', fontWeight: 600, padding: '2px 8px', borderRadius: '999px', background: 'rgba(23,48,68,0.07)', color: 'var(--sia-navy)', whiteSpace: 'nowrap' }

function useThemeColor(data: DashboardData) {
  return (themeId: string) => {
    const idx = data.themes.findIndex(t => t.id === themeId)
    return THEME_COLORS[(idx < 0 ? 0 : idx) % THEME_COLORS.length]
  }
}

// ── Strategy map ─────────────────────────────────────────────────────────────────────────────────────
function StrategyMap({ data, selectedId, onSelect }: { data: DashboardData; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const themeColor = useThemeColor(data)
  const wrapRef = useRef<HTMLDivElement>(null)
  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const [paths, setPaths] = useState<{ key: string; from: string; to: string; d: string }[]>([])
  const [box, setBox] = useState({ w: 0, h: 0 })

  // Arrows are drawn from the measured positions of the real nodes, so the map stays right whatever the
  // number of themes/perspectives or the width of the container.
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const measure = () => {
      const base = wrap.getBoundingClientRect()
      const next: typeof paths = []
      for (const o of data.objectives) {
        const a = nodeRefs.current[o.id]?.getBoundingClientRect()
        if (!a) continue
        for (const targetId of o.supports) {
          const b = nodeRefs.current[targetId]?.getBoundingClientRect()
          if (!b) continue
          const ax = a.left - base.left + a.width / 2, bx = b.left - base.left + b.width / 2
          const sameRow = Math.abs(a.top - b.top) < 8
          let d: string
          if (sameRow) {
            const goRight = bx > ax
            const x1 = (goRight ? a.right : a.left) - base.left, x2 = (goRight ? b.left : b.right) - base.left
            const y = a.top - base.top + a.height / 2
            d = `M ${x1} ${y} L ${x2} ${y}`
          } else {
            const up = b.top < a.top
            const y1 = (up ? a.top : a.bottom) - base.top, y2 = (up ? b.bottom : b.top) - base.top
            const mid = (y1 + y2) / 2
            d = `M ${ax} ${y1} C ${ax} ${mid}, ${bx} ${mid}, ${bx} ${y2}`
          }
          next.push({ key: `${o.id}>${targetId}`, from: o.id, to: targetId, d })
        }
      }
      setPaths(next)
      setBox({ w: base.width, h: base.height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [data])

  const cols = `120px repeat(${data.themes.length}, minmax(150px, 1fr))`
  const linked = (id: string) => selectedId !== null && (id === selectedId
    || data.objectives.find(o => o.id === selectedId)?.supports.includes(id)
    || data.objectives.find(o => o.id === id)?.supports.includes(selectedId))

  return (
    <div style={{ overflowX: 'auto' }}>
      <div ref={wrapRef} style={{ position: 'relative', minWidth: `${120 + data.themes.length * 170}px`, paddingBottom: '4px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: cols, gap: '10px 14px', alignItems: 'stretch' }}>
          <div />
          {data.themes.map(t => (
            <div key={t.id} title={t.description} style={{ background: themeColor(t.id), color: '#fff', textAlign: 'center', fontWeight: 700, fontSize: '12.5px', padding: '8px 10px', borderRadius: '6px' }}>
              {t.name}
            </div>
          ))}
          {data.perspectives.map(p => (
            <React.Fragment key={p.id}>
              <div style={{ display: 'flex', alignItems: 'center', fontSize: '12.5px', fontWeight: 700, color: 'var(--sia-navy)', paddingBottom: '18px' }}>{p.name}</div>
              {data.themes.map(t => (
                <div key={t.id} style={{ display: 'flex', flexDirection: 'column', gap: '14px', justifyContent: 'center', paddingBottom: '18px', minHeight: '56px' }}>
                  {data.objectives.filter(o => o.perspectiveId === p.id && o.themeId === t.id).map(o => (
                    <div
                      key={o.id}
                      ref={el => { nodeRefs.current[o.id] = el }}
                      onClick={() => onSelect(selectedId === o.id ? null : o.id)}
                      title={o.description || o.title}
                      style={{
                        cursor: 'pointer', textAlign: 'center', fontSize: '12px', fontWeight: 500, color: 'var(--sia-cool-black)', padding: '8px 10px',
                        borderRadius: '10px', background: selectedId === o.id ? 'rgba(0,222,204,0.18)' : 'rgba(0,222,204,0.07)',
                        border: `1.5px solid ${selectedId === o.id || linked(o.id) ? themeColor(t.id) : 'rgba(23,48,68,0.25)'}`,
                        opacity: selectedId !== null && !linked(o.id) ? 0.45 : 1, position: 'relative', zIndex: 1,
                      }}
                    >
                      {o.title}
                    </div>
                  ))}
                </div>
              ))}
            </React.Fragment>
          ))}
        </div>
        <svg width={box.w} height={box.h} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 0 }}>
          <defs>
            <marker id="sd-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L8 4 L0 8 z" fill="#8796A9" />
            </marker>
            <marker id="sd-arrow-hi" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L8 4 L0 8 z" fill="#00A2A3" />
            </marker>
          </defs>
          {paths.map(p => {
            const hi = selectedId !== null && (p.from === selectedId || p.to === selectedId)
            return (
              <path
                key={p.key} d={p.d} fill="none" strokeWidth={hi ? 2 : 1.4} stroke={hi ? '#00A2A3' : '#8796A9'}
                opacity={selectedId !== null && !hi ? 0.2 : 1} markerEnd={`url(#${hi ? 'sd-arrow-hi' : 'sd-arrow'})`}
              />
            )
          })}
        </svg>
      </div>
    </div>
  )
}

/** Objective → KPI → initiative traceability for the selected objective (the "objective → KPI → initiative links"). */
function ObjectiveTrace({ data, objectiveId }: { data: DashboardData; objectiveId: string }) {
  const o = data.objectives.find(x => x.id === objectiveId)
  if (!o) return null
  const kpis = data.kpis.filter(k => k.objectiveIds.includes(o.id))
  const inits = data.initiatives.filter(i => i.objectiveIds.includes(o.id))
  return (
    <div style={{ ...card, padding: '12px 14px', marginTop: '14px', fontSize: '12.5px' }}>
      <div style={{ fontWeight: 700, color: 'var(--sia-navy)' }}>{o.title}</div>
      {o.description && <div style={{ color: 'var(--sia-cool-gray)', margin: '2px 0 8px' }}>{o.description}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--sia-medium-gray)', marginBottom: '4px' }}>KPIs</div>
          {kpis.length ? kpis.map(k => <div key={k.id}>{k.name} <span style={{ color: 'var(--sia-medium-gray)' }}>· {k.baseline || '—'} → {k.target || '—'}</span></div>) : <span style={{ color: 'var(--sia-medium-gray)' }}>None linked</span>}
        </div>
        <div>
          <div style={{ fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--sia-medium-gray)', marginBottom: '4px' }}>Initiatives</div>
          {inits.length ? inits.map(i => <div key={i.id}>{i.name} <span style={{ color: 'var(--sia-medium-gray)' }}>· {i.tier}</span></div>) : <span style={{ color: 'var(--sia-medium-gray)' }}>None linked</span>}
        </div>
      </div>
    </div>
  )
}

// ── Scorecard ────────────────────────────────────────────────────────────────────────────────────────
function KpiTile({ k, data }: { k: DashboardKpi; data: DashboardData }) {
  const progress = kpiProgress(k)
  const objectives = k.objectiveIds.map(id => data.objectives.find(o => o.id === id)?.title).filter(Boolean) as string[]
  return (
    <div style={{ ...card, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--sia-navy)' }}>{k.name}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '22px', fontWeight: 700, color: 'var(--sia-cool-black)', fontFamily: 'var(--font-display)' }}>{k.baseline || '—'}</span>
        <span style={{ color: 'var(--sia-medium-gray)' }}>→</span>
        <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--sia-dark-teal)' }}>{k.target || '—'}</span>
        {k.targetDate && <span style={{ fontSize: '10.5px', color: 'var(--sia-medium-gray)' }}>by {k.targetDate}</span>}
      </div>
      <div style={{ height: '5px', borderRadius: '3px', background: 'rgba(23,48,68,0.08)', overflow: 'hidden' }}>
        <div style={{ width: `${Math.round((progress ?? 0) * 100)}%`, height: '100%', background: 'var(--sia-dark-teal)' }} />
      </div>
      <div style={{ fontSize: '10.5px', fontStyle: 'italic', color: 'var(--sia-medium-gray)' }}>Actual: live in Wave 4</div>
      {objectives.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>{objectives.map(t => <span key={t} style={chip}>{t}</span>)}</div>
      )}
      <div style={{ fontSize: '10.5px', color: 'var(--sia-medium-gray)' }}>
        {[k.frequency, k.owner && `Owner: ${k.owner}`, k.dataSource && `Source: ${k.dataSource}`].filter(Boolean).join(' · ')}
      </div>
    </div>
  )
}

function Scorecard({ data }: { data: DashboardData }) {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '12px' }}>
        {data.kpis.map(k => <KpiTile key={k.id} k={k} data={data} />)}
      </div>
      <div style={{ fontSize: '11px', color: 'var(--sia-medium-gray)', margin: '10px 0 18px' }}>Baseline → target · RAG once actuals flow</div>
      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--sia-navy)', marginBottom: '6px' }}>Traceability — objective → KPI → initiative</div>
      <div style={{ ...card, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{ background: 'var(--sia-light-gray)', textAlign: 'left' }}>
              {['Objective', 'KPIs', 'Initiatives'].map(h => <th key={h} style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--sia-cool-gray)' }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.objectives.map(o => (
              <tr key={o.id} style={{ borderTop: '1px solid rgba(23,48,68,0.08)', verticalAlign: 'top' }}>
                <td style={{ padding: '8px 12px', fontWeight: 600 }}>{o.title}</td>
                <td style={{ padding: '8px 12px' }}>{data.kpis.filter(k => k.objectiveIds.includes(o.id)).map(k => k.name).join('; ') || '—'}</td>
                <td style={{ padding: '8px 12px' }}>{data.initiatives.filter(i => i.objectiveIds.includes(o.id)).map(i => i.name).join('; ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ── Roadmap ──────────────────────────────────────────────────────────────────────────────────────────
function Roadmap({ data }: { data: DashboardData }) {
  const themeColor = useThemeColor(data)
  const initiatives = useMemo(
    () => [...data.initiatives].sort((a, b) => (a.priorityRank ?? 99) - (b.priorityRank ?? 99)),
    [data.initiatives]
  )
  const n = data.roadmapPeriods.length
  const colorOf = (i: DashboardInitiative) => {
    const obj = data.objectives.find(o => i.objectiveIds.includes(o.id))
    return themeColor(obj?.themeId || '')
  }
  const grid = `minmax(190px, 240px) repeat(${n}, minmax(54px, 1fr))`
  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: `${240 + n * 58}px` }}>
          <div style={{ display: 'grid', gridTemplateColumns: grid, gap: '4px', marginBottom: '8px' }}>
            <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--sia-navy)', alignSelf: 'end' }}>Initiative roadmap</div>
            {data.roadmapPeriods.map(p => (
              <div key={p} style={{ textAlign: 'center', fontSize: '10px', padding: '5px 2px', background: 'var(--sia-light-gray)', borderRadius: '3px', color: 'var(--sia-cool-gray)' }}>{p}</div>
            ))}
          </div>
          {initiatives.map(i => (
            <div key={i.id} style={{ display: 'grid', gridTemplateColumns: grid, gap: '4px', alignItems: 'center', padding: '6px 0', borderTop: '1px solid rgba(23,48,68,0.06)' }}>
              <div style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }} title={i.description || i.name}>
                <span style={{ flexShrink: 0, minWidth: '20px', height: '20px', borderRadius: '10px', background: 'var(--sia-navy)', color: '#fff', fontSize: '10.5px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{i.priorityRank}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.name}</span>
              </div>
              <div style={{ gridColumn: '2 / -1', display: 'grid', gridTemplateColumns: `repeat(${n}, 1fr)`, gap: '4px', position: 'relative', height: '18px' }}>
                <div style={{ gridColumn: `${i.startPeriod + 1} / ${i.endPeriod + 2}`, background: colorOf(i), borderRadius: '9px', height: '16px', alignSelf: 'center' }} />
                {i.milestonePeriod != null && (
                  <div style={{
                    position: 'absolute', top: '2px', left: `calc(${((i.milestonePeriod + 0.5) / n) * 100}% - 7px)`, width: '14px', height: '14px',
                    background: '#fff', border: '2px solid var(--sia-cool-black)', transform: 'rotate(45deg)', boxSizing: 'border-box',
                  }} title={`Milestone: ${data.roadmapPeriods[i.milestonePeriod]}`} />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--sia-navy)', margin: '20px 0 6px' }}>Prioritisation</div>
      <div style={{ ...card, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{ background: 'var(--sia-light-gray)', textAlign: 'left' }}>
              {['#', 'Initiative', 'Tier', 'Score', 'Owner', 'Rationale'].map(h => <th key={h} style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--sia-cool-gray)' }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {initiatives.map(i => (
              <tr key={i.id} style={{ borderTop: '1px solid rgba(23,48,68,0.08)', verticalAlign: 'top' }}>
                <td style={{ padding: '8px 12px' }}>{i.priorityRank}</td>
                <td style={{ padding: '8px 12px', fontWeight: 600 }}>{i.name}</td>
                <td style={{ padding: '8px 12px' }}><span style={chip}>{i.tier}</span></td>
                <td style={{ padding: '8px 12px' }}>{i.priorityScore ?? '—'}</td>
                <td style={{ padding: '8px 12px' }}>{i.owner || '—'}</td>
                <td style={{ padding: '8px 12px', color: 'var(--sia-cool-gray)' }}>{i.rationale || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ── Export centre ────────────────────────────────────────────────────────────────────────────────────
function ExportCenter({ data, entityName }: { data: DashboardData; entityName: string }) {
  const [busy, setBusy] = useState(false)
  async function excel() {
    setBusy(true)
    try { await downloadDashboardExcel(data, entityName) } catch (e: any) { alert('Export failed: ' + (e.message || 'Unknown error')) }
    setBusy(false)
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '640px' }}>
      <div style={{ fontSize: '12.5px', color: 'var(--sia-cool-gray)' }}>
        Every view above is generated from one shared data model. Export it as a workbook (objectives, KPIs, initiatives, roadmap) or as raw JSON for a BI tool.
      </div>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={excel}><FileSpreadsheet size={13} /> Excel (.xlsx)</button>
        <button className="btn btn-ghost btn-sm" onClick={() => downloadDashboardJson(data, entityName)}><FileJson size={13} /> JSON</button>
      </div>
      <div style={{ fontSize: '11.5px', color: 'var(--sia-medium-gray)', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <Download size={12} /> Slide / PDF packs, department cascades and live BI publishing arrive with Wave 4.
      </div>
    </div>
  )
}

// ── Dashboard shell ──────────────────────────────────────────────────────────────────────────────────
export function StrategyDashboard({ data, entityName }: { data: DashboardData; entityName: string }) {
  const [tab, setTab] = useState<TabKey>('map')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  return (
    <div style={{ ...card, overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
      <div style={{ background: '#16293C', color: '#fff', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '15px', fontWeight: 700 }}>Strategy dashboard</div>
        <div style={{ fontSize: '12px', opacity: 0.8 }}>{entityName}</div>
        <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto', flexWrap: 'wrap' }}>
          {TABS.map(t => (
            <button
              key={t.key} onClick={() => setTab(t.key)}
              style={{
                border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 600, padding: '6px 14px', borderRadius: '999px',
                background: tab === t.key ? '#1F8A87' : 'rgba(255,255,255,0.1)', color: '#fff',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '18px' }}>
        {tab === 'map' && (
          <>
            <div style={{ background: '#B2F0EE', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', fontSize: '12.5px', color: 'var(--sia-cool-black)' }}>
              <div><div style={{ fontWeight: 700, marginBottom: '2px' }}>Vision</div>{data.vmv.vision || '—'}</div>
              <div><div style={{ fontWeight: 700, marginBottom: '2px' }}>Mission</div>{data.vmv.mission || '—'}</div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: '2px' }}>Values</div>
                {data.vmv.values.length ? data.vmv.values.join(' · ') : '—'}
              </div>
            </div>
            <StrategyMap data={data} selectedId={selectedId} onSelect={setSelectedId} />
            <div style={{ fontSize: '11px', color: 'var(--sia-medium-gray)', marginTop: '6px' }}>Select an objective to trace its links to KPIs and initiatives.</div>
            {selectedId && <ObjectiveTrace data={data} objectiveId={selectedId} />}
            {data.summary && <p style={{ fontSize: '12.5px', color: 'var(--sia-cool-gray)', margin: '16px 0 0' }}>{data.summary}</p>}
          </>
        )}
        {tab === 'scorecard' && <Scorecard data={data} />}
        {tab === 'roadmap' && <Roadmap data={data} />}
        {tab === 'export' && <ExportCenter data={data} entityName={entityName} />}

        {data.assumptions.length > 0 && (
          <details style={{ marginTop: '18px', fontSize: '12px', color: 'var(--sia-cool-gray)' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Assumptions & data gaps ({data.assumptions.length})</summary>
            <ul style={{ margin: '6px 0 0', paddingLeft: '18px' }}>{data.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
          </details>
        )}
      </div>
    </div>
  )
}
