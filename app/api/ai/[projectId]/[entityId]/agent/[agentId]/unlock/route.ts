// POST /api/ai/:projectId/:entityId/agent/:agentId/unlock — reverse an agent's approval so a human can
// keep talking to it and approve a revised version later. Blocked once the SWOT agent has already run
// off this agent's approved output (see unlockWave1Agent) — the SWOT agent itself has no such downstream.
import { NextRequest, NextResponse } from 'next/server'
import { loadProject, saveProject } from '@/lib/server/helpers'
import { requireProjectAuth } from '@/lib/server/auth'
import { resolveWave1Entity } from '@/lib/server/wave1Engine'
import { ALL_AGENT_IDS, recomputeAllLocks, unlockAgent } from '@/lib/server/agentEngine'

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

    unlockAgent(entity, agentId)
    // Unlocking SWOT Part A re-locks any Wave 2 agent that hasn't started on top of it.
    recomputeAllLocks(entity)
    await saveProject(project)

    return NextResponse.json({ success: true, entityId, agentId })
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 400 }) }
}
