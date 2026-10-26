// POST /api/ai/:projectId/:entityId/options-choice — record whether the reviewer wants the optional
// "Strategic Options" step of Wave 2 (Options Design + Options Evaluation & Selection). true keeps both
// agents in the chain; false skips them so SWOT Part B and the Shift Agenda run straight off Strategic
// Direction, V/M/V and SWOT Part A. See setWave2OptionsEnabled for the gating this flips.
// With step: 'swotB' the same switch is applied to the optional SWOT Part B step instead.
import { NextRequest, NextResponse } from 'next/server'
import { loadProject, saveProject } from '@/lib/server/helpers'
import { requireProjectAuth } from '@/lib/server/auth'
import { resolveWave1Entity } from '@/lib/server/wave1Engine'
import { setWave2OptionsEnabled, setWave2SwotBEnabled } from '@/lib/server/wave2Engine'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; entityId: string }> }
) {
  const { projectId, entityId } = await params
  if (!await requireProjectAuth(request, projectId)) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  try {
    const { enabled, step } = await request.json()
    if (typeof enabled !== 'boolean') return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 })

    const project = await loadProject(projectId)
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    const entity = resolveWave1Entity(project, entityId)
    if (!entity) return NextResponse.json({ error: 'Entity not found' }, { status: 404 })

    if (step === 'swotB') setWave2SwotBEnabled(entity, enabled)
    else setWave2OptionsEnabled(entity, enabled)
    await saveProject(project)

    return NextResponse.json({ success: true, entityId, enabled })
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 400 }) }
}
