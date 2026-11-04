// POST /api/ai/:projectId/:entityId/agent/:agentId/approve — approve a Wave 1 or Wave 2 agent's output as it stands
// right now. A human can approve as soon as the agent has replied at all — it doesn't have to have reached
// a finalized, structured result first; approving mid-conversation freezes that conversation itself as this
// agent's assessment (see ensureApprovableVersion). This snapshot is what getApprovedSummaryText() hands to
// dependent agents; recomputes which other agents on this entity just became eligible to run (never auto-runs them).
//
// For pillar agents (P1-P8) approval also requires the reviewer to confirm two scores in the request body:
// aiScore (the score the agent itself produced — editable here in case it was misread) and manualScore (the
// reviewer's own assessment). Both are stamped onto the pillar and finalScore is set to their average (see
// computePillarFinalScore), which is what every other score display in the app reads — aiScore then stays
// locked until the discussion is unlocked and restarted, at which point the next approval asks for fresh scores again.
import { NextRequest, NextResponse } from 'next/server'
import { loadProject, saveProject, computePillarFinalScore, PILLAR_IDS } from '@/lib/server/helpers'
import { requireProjectAuth } from '@/lib/server/auth'
import { ensureApprovableVersion, resolveWave1Entity } from '@/lib/server/wave1Engine'
import { ALL_AGENT_IDS, getAnyAgent, recomputeAllLocks } from '@/lib/server/agentEngine'

function isValidScore(n: any): n is number {
  return typeof n === 'number' && !isNaN(n) && n >= 1 && n <= 5
}

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

    const agent = getAnyAgent(entity, agentId)
    if (!agent.chatHistory?.length) {
      return NextResponse.json({ error: 'This agent has not said anything yet.' }, { status: 400 })
    }

    if ((PILLAR_IDS as string[]).includes(agentId)) {
      const body = await request.json().catch(() => ({}))
      const { aiScore, manualScore } = body || {}
      if (!isValidScore(aiScore) || !isValidScore(manualScore)) {
        return NextResponse.json({ error: 'AI score and reviewer score (both 1-5) are required to approve a pillar.' }, { status: 400 })
      }
      agent.aiScore = aiScore
      agent.manualScore = manualScore
      agent.finalScore = computePillarFinalScore(aiScore, manualScore)
    }

    agent.approvedVersion = ensureApprovableVersion(agent)
    agent.approvedAt = new Date().toISOString()
    agent.approvedBy = project.consultantName || 'Reviewer'
    agent.status = 'complete'

    recomputeAllLocks(entity)
    await saveProject(project)

    return NextResponse.json({ success: true, entityId, agentId, approvedVersion: agent.approvedVersion })
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }) }
}
