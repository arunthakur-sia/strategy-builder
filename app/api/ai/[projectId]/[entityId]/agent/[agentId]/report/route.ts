// POST /api/ai/:projectId/:entityId/agent/:agentId/report — turn an APPROVED agent's full conversation into a
// corporate-grade markdown report via the LiteLLM gateway (see reportEngine). Markdown only: PDF/DOCX are
// rendered client-side from it so the (slow) LLM call happens once. The result is cached on the agent,
// keyed to the approval, so re-exporting is instant; { force: true } regenerates.
// Body: { title, tokenToNum: Record<token, number>, sources: ReportSource[], force?: boolean } — the citation map
// the sources panel already shows, so report citation numbers match what the reviewer saw.
import { NextRequest, NextResponse } from 'next/server'
import { loadProject, saveProject, PILLAR_IDS } from '@/lib/server/helpers'
import { requireProjectAuth } from '@/lib/server/auth'
import { resolveWave1Entity } from '@/lib/server/wave1Engine'
import { ALL_AGENT_IDS, getAnyAgent } from '@/lib/server/agentEngine'
import { buildReportMessages, buildReferencesMarkdown, callReportLlm } from '@/lib/server/reportEngine'

export const runtime = 'nodejs'
export const maxDuration = 800 // Vercel Pro (fluid compute) ceiling

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; entityId: string; agentId: string }> }
) {
  const { projectId, entityId, agentId } = await params
  if (!await requireProjectAuth(request, projectId)) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!ALL_AGENT_IDS.includes(agentId)) return NextResponse.json({ error: 'Unknown agent' }, { status: 400 })

  try {
    const body = await request.json().catch(() => ({}))
    const tokenToNum: Record<string, number> = body?.tokenToNum && typeof body.tokenToNum === 'object' ? body.tokenToNum : {}
    const sources = Array.isArray(body?.sources) ? body.sources : []

    const project = await loadProject(projectId)
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    const entity = resolveWave1Entity(project, entityId)
    if (!entity) return NextResponse.json({ error: 'Entity not found' }, { status: 404 })

    const agent = getAnyAgent(entity, agentId)
    if (agent.approvedVersion === null || agent.approvedVersion === undefined) {
      return NextResponse.json({ error: 'Approve this agent before exporting its report.' }, { status: 400 })
    }
    if (!agent.chatHistory?.length) return NextResponse.json({ error: 'There is no conversation to export.' }, { status: 400 })

    const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 200) : agentId
    const cached = agent.report
    if (!body?.force && cached?.markdown && cached.approvedAt === agent.approvedAt) {
      return NextResponse.json({ success: true, cached: true, title, entityName: entity.name, ...cached })
    }

    const isPillar = (PILLAR_IDS as string[]).includes(agentId)
    const messages = buildReportMessages({
      entityName: entity.name || project.entityName, agentLabel: title,
      scores: isPillar ? { ai: agent.aiScore, reviewer: agent.manualScore, final: agent.finalScore } : undefined,
      chatHistory: agent.chatHistory, tokenToNum,
    })
    const markdown = (await callReportLlm(messages)) + buildReferencesMarkdown(sources)

    // The LLM call can take minutes — reload the project before writing so we persist the report onto the
    // CURRENT state (not the stale copy loaded above) and don't clobber changes made in the meantime.
    const fresh = await loadProject(projectId)
    const freshEntity = fresh && resolveWave1Entity(fresh, entityId)
    const freshAgent = freshEntity && getAnyAgent(freshEntity, agentId)
    const report = { markdown, approvedAt: agent.approvedAt, generatedAt: new Date().toISOString() }
    if (freshAgent && freshAgent.approvedAt === agent.approvedAt) {
      freshAgent.report = report
      await saveProject(fresh)
    }
    return NextResponse.json({ success: true, cached: false, title, entityName: entity.name, ...report })
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }) }
}
