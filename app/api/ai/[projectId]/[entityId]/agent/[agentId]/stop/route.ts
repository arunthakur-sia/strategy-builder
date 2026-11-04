// POST /api/ai/:projectId/:entityId/agent/:agentId/stop — abandon an in-flight (or stuck) run. The upstream
// SiaGPT call can't be cancelled, so this clears the 'in_progress' marker; the chat route notices the marker
// is gone when the call eventually returns and discards that result instead of saving it.
import { NextRequest, NextResponse } from 'next/server'
import { updateProject } from '@/lib/server/helpers'
import { requireProjectAuth } from '@/lib/server/auth'
import { resolveWave1Entity } from '@/lib/server/wave1Engine'
import { ALL_AGENT_IDS, getAnyAgent, recomputeAllLocks } from '@/lib/server/agentEngine'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; entityId: string; agentId: string }> }
) {
  const { projectId, entityId, agentId } = await params
  if (!await requireProjectAuth(request, projectId)) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!ALL_AGENT_IDS.includes(agentId)) return NextResponse.json({ error: 'Unknown agent' }, { status: 400 })

  try {
    await updateProject(projectId, project => {
      const entity = resolveWave1Entity(project, entityId)
      if (!entity) throw new Error('Entity not found')
      const agent = getAnyAgent(entity, agentId)
      if (agent.status !== 'in_progress') return
      agent.pendingMessage = null
      agent.status = agent.versionHistory?.length ? 'complete' : 'not_started'
      recomputeAllLocks(entity)
    })
    return NextResponse.json({ success: true, entityId, agentId })
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 400 }) }
}
