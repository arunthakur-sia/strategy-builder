// POST /api/ai/:projectId/:entityId/agent/:agentId/reset — restart the discussion with a Wave 1 agent:
// clears its chat history and every draft it has produced, back to a fresh not_started/locked state.
import { NextRequest, NextResponse } from 'next/server'
import { loadProject, saveProject } from '@/lib/server/helpers'
import { requireProjectAuth } from '@/lib/server/auth'
import { resolveWave1Entity } from '@/lib/server/wave1Engine'
import { ALL_AGENT_IDS, recomputeAllLocks, resetAgent } from '@/lib/server/agentEngine'

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
    const project = await loadProject(projectId)
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    const entity = resolveWave1Entity(project, entityId)
    if (!entity) return NextResponse.json({ error: 'Entity not found' }, { status: 404 })

    resetAgent(entity, agentId)
    recomputeAllLocks(entity)
    await saveProject(project)

    return NextResponse.json({ success: true, entityId, agentId })
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 400 }) }
}
