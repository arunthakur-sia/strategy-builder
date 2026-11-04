// POST /api/ai/:projectId/:entityId/dashboard — step 5 of Wave 3, the Strategy Visualisation / BI Dashboard.
// Body: { action: 'generate' | 'stop' | 'approve' | 'unlock', instruction?: string }
//
// 'generate' hands the full conversations of V/M/V and the four Translation agents to the report LLM and stores
// the structured JSON it returns (see lib/wave3Dashboard.ts) — or, when a dashboard already exists, revises it
// per the reviewer's instruction. Like an agent chat run it is NOT tied to the HTTP response: it is registered
// with after(), persists its own result, and the client polls the project — so a closed tab never loses it.
// Approving the dashboard is the "wave gate before Wave 4".
import { NextRequest, NextResponse, after } from 'next/server'
import { updateProject } from '@/lib/server/helpers'
import { requireProjectAuth } from '@/lib/server/auth'
import { resolveWave1Entity } from '@/lib/server/wave1Engine'
import { recomputeAllLocks } from '@/lib/server/agentEngine'
import { prepareDashboardInput, generateDashboardData } from '@/lib/server/dashboardEngine'

export const runtime = 'nodejs'
export const maxDuration = 800 // Vercel Pro (fluid compute) ceiling; the LLM call itself times out at 780s

// How long an 'in_progress' marker is trusted before a new run may replace it.
const STALE_RUN_MS = 13.5 * 60 * 1000

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; entityId: string }> }
) {
  const { projectId, entityId } = await params
  if (!await requireProjectAuth(request, projectId)) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const action: string = body?.action
  const instruction: string = typeof body?.instruction === 'string' ? body.instruction.trim() : ''

  try {
    if (action === 'generate') {
      const started = await updateProject(projectId, project => {
        const entity = resolveWave1Entity(project, entityId)
        if (!entity) throw new Error('Entity not found')
        recomputeAllLocks(entity)
        const dash = entity.assessment.wave3.dashboard
        if (dash.status === 'locked') throw new Error('The dashboard is locked until V/M/V and all four Translation agents are approved.')
        if (dash.approvedVersion !== null) throw new Error('The dashboard is approved — unlock it first to change it.')
        const since = dash.pendingMessage?.at ? new Date(dash.pendingMessage.at).getTime() : 0
        if (dash.status === 'in_progress' && Date.now() - since < STALE_RUN_MS) throw new Error('The dashboard is already being generated — wait for it to finish.')
        const startedAt = new Date().toISOString()
        dash.status = 'in_progress'
        dash.pendingMessage = { content: instruction, at: startedAt }
        dash.lastError = null
        return { startedAt, input: prepareDashboardInput(entity, instruction) }
      })

      const work = (async () => {
        try {
          const data = await generateDashboardData(started.input)
          await updateProject(projectId, project => {
            const dash = resolveWave1Entity(project, entityId).assessment.wave3.dashboard
            if (dash.pendingMessage?.at !== started.startedAt) return // stopped by the reviewer meanwhile
            dash.data = data
            dash.version = (dash.version || 0) + 1
            dash.generatedAt = new Date().toISOString()
            if (instruction) dash.instructions.push({ content: instruction, at: dash.generatedAt })
            dash.pendingMessage = null
            dash.status = 'complete'
          })
        } catch (err: any) {
          await updateProject(projectId, project => {
            const dash = resolveWave1Entity(project, entityId).assessment.wave3.dashboard
            if (dash.pendingMessage?.at !== started.startedAt) return
            dash.pendingMessage = null
            dash.status = dash.data ? 'complete' : 'not_started'
            dash.lastError = { message: err?.message || 'Unknown error', at: new Date().toISOString() }
          }).catch(() => {})
        }
      })()
      after(() => work)
      return NextResponse.json({ success: true, started: true })
    }

    await updateProject(projectId, project => {
      const entity = resolveWave1Entity(project, entityId)
      if (!entity) throw new Error('Entity not found')
      recomputeAllLocks(entity)
      const dash = entity.assessment.wave3.dashboard

      if (action === 'stop') {
        // The LLM call can't be cancelled; clearing the marker makes the run discard its result when it returns.
        if (dash.status !== 'in_progress') return
        dash.pendingMessage = null
        dash.status = dash.data ? 'complete' : 'not_started'
      } else if (action === 'approve') {
        if (!dash.data) throw new Error('Generate the dashboard before approving it.')
        if (dash.status === 'in_progress') throw new Error('Wait for the dashboard to finish generating.')
        dash.approvedVersion = dash.version
        dash.approvedAt = new Date().toISOString()
        dash.approvedBy = project.consultantName || 'Reviewer'
        dash.status = 'complete'
      } else if (action === 'unlock') {
        if (dash.approvedVersion === null) throw new Error('The dashboard is not approved.')
        dash.approvedVersion = null
        dash.approvedAt = null
        dash.approvedBy = null
        dash.status = 'complete'
      } else {
        throw new Error('Unknown action')
      }
    })
    return NextResponse.json({ success: true })
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 400 }) }
}
