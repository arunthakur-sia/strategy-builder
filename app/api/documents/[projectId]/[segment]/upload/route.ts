// POST /api/documents/:projectId/:entityId/upload — upload docs for a subsidiary entity, or for the
// project's own primary/holding entity via the 'main' sentinel id (see resolveWave1Entity).
import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { del, get } from '@vercel/blob'
import { loadProject, saveProject, extractText } from '@/lib/server/helpers'
import { getSiaGptToken, uploadDocToSiaGPTCollection, createSiaGPTCollection } from '@/lib/server/siagpt'
import { requireProjectAuth } from '@/lib/server/auth'
import { config } from '@/lib/server/config'
import { log } from '@/lib/server/logger'
import { recomputeWave1Locks, resolveWave1Entity } from '@/lib/server/wave1Engine'
import { WAVE3_COLLECTION_FIELDS } from '@/lib/wave3Shared'

export const runtime = 'nodejs'
export const maxDuration = 120

const allowedTypes = ['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/msword','application/vnd.ms-excel','image/png','image/jpeg','image/jpg']

interface UploadedBlob { url: string; name: string; type: string; size: number }

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; segment: string }> }
) {
  const { projectId, segment: entityId } = await params
  if (!await requireProjectAuth(request, projectId)) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  try {
    const project = await loadProject(projectId)
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    const entity = resolveWave1Entity(project, entityId)
    if (!entity) return NextResponse.json({ error: 'Entity not found' }, { status: 404 })

    const { files, docType, docLabel, targetCollection } = await request.json() as {
      files: UploadedBlob[]
      docType?: string
      docLabel?: string
      /** 'interview' routes the upload into the entity's separate interview-transcript collection
       *  (created lazily here) and marks IDI Synth's uploadDep satisfied, instead of the main collection.
       *  'finance' / 'functional' do the same for Wave 3's optional collections (see wave3Shared). */
      targetCollection?: 'main' | 'interview' | 'finance' | 'functional'
    }
    if (!files?.length) return NextResponse.json({ error: 'No files uploaded' }, { status: 400 })

    for (const file of files) {
      if (!allowedTypes.includes(file.type)) {
        return NextResponse.json({ error: `File type ${file.type} not supported` }, { status: 400 })
      }
    }

    const isInterview = targetCollection === 'interview'
    // Wave 3's two optional collections (finance -> KPIs, functional & operations -> Initiatives/Prioritisation)
    // live on assessment.wave3 and are created lazily here, like the interview collection.
    const wave3Kind = targetCollection === 'finance' || targetCollection === 'functional' ? targetCollection : null
    const wave3Field = wave3Kind ? WAVE3_COLLECTION_FIELDS[wave3Kind] : null
    const wave3 = entity.assessment?.wave3

    if (wave3Field) {
      if (!wave3) return NextResponse.json({ error: 'Wave 3 is not initialised for this entity' }, { status: 400 })
      if (!wave3[wave3Field]) {
        if (!config.siagptMediaFolderId) return NextResponse.json({ error: 'SiaGPT media folder is not configured — cannot create a collection' }, { status: 500 })
        await getSiaGptToken().catch(() => {})
        const collId = await createSiaGPTCollection(
          `${entity.name} — ${wave3Kind === 'finance' ? 'finance documents' : 'functional & operations documents'}`,
          `SIA Partners ${wave3Kind === 'finance' ? 'finance' : 'functional & operations'} input for ${entity.name} (Wave 3)`,
        )
        if (!collId) return NextResponse.json({ error: 'Could not create the SiaGPT collection' }, { status: 502 })
        wave3[wave3Field] = collId
      }
    } else if (isInterview) {
      // Lazily create the interview-transcript collection the first time it's needed.
      if (!entity.interviewCollectionId && config.siagptMediaFolderId) {
        await getSiaGptToken().catch(() => {})
        const collId = await createSiaGPTCollection(
          `${entity.name} — interview transcripts`,
          `SIA Partners primary-research interview transcripts for ${entity.name}`,
        )
        entity.interviewCollectionId = collId ?? ''
      }
    } else if (entity.siagptCollectionId && config.siagptBaseUrl) {
      // Verify entity collection access — recreate if inaccessible
      const preToken = await getSiaGptToken().catch(() => null)
      if (preToken) {
        const verifyResp = await fetch(
          `${config.siagptBaseUrl}/medias/collections/${entity.siagptCollectionId}`,
          { headers: { Authorization: `Bearer ${preToken}`, 'app-origin': 'AI Platform' } }
        ).catch(() => null)
        if (verifyResp && (verifyResp.status === 403 || verifyResp.status === 404)) {
          log.warn(`Entity collection ${entity.siagptCollectionId} inaccessible — recreating for "${entity.name}"`)
          const newCollId = await createSiaGPTCollection(entity.name, `SIA Partners strategy assessment collection for ${entity.name}`)
          entity.siagptCollectionId = newCollId ?? ''
        }
      }
    } else if (entity.siagptCollectionId) {
      await getSiaGptToken().catch(() => {})
    }

    const uploadCollectionId = wave3Field ? wave3[wave3Field] : isInterview ? entity.interviewCollectionId : entity.siagptCollectionId

    const results = []
    for (const file of files) {
      const blobResult = await get(file.url, { access: 'private' })
      if (!blobResult) throw new Error(`Blob not found: ${file.name}`)
      const buffer = Buffer.from(await new Response(blobResult.stream).arrayBuffer())
      const extractedText = await extractText(buffer, file.type, file.name)
      const doc: any = {
        id: uuidv4(), name: file.name, type: docType || (isInterview ? 'interview_transcript' : wave3Kind ? `wave3_${wave3Kind}` : 'general'), label: docLabel || file.name,
        mimetype: file.type, size: file.size, extractedText,
        uploadedAt: new Date().toISOString(),
        wordCount: extractedText.split(/\s+/).filter(Boolean).length,
        siagptMediaId: '',
      }
      entity.documents.push(doc)
      if (uploadCollectionId) {
        const mediaId = await uploadDocToSiaGPTCollection(buffer, file.name, file.type, uploadCollectionId)
        if (mediaId) doc.siagptMediaId = mediaId
      }
      results.push({ id: doc.id, name: doc.name, type: doc.type, wordCount: doc.wordCount, preview: extractedText.substring(0, 300), siagptMediaId: doc.siagptMediaId })
      await del(file.url).catch(() => {})
    }

    if (isInterview) {
      const idiSynth = entity.assessment?.externalAgents?.idiSynth
      if (idiSynth?.uploadDep) {
        idiSynth.uploadDep.done = true
        idiSynth.uploadDep.collectionId = entity.interviewCollectionId || null
        recomputeWave1Locks(entity)
      }
    }

    await saveProject(project)
    return NextResponse.json({ success: true, documents: results, interviewCollectionId: isInterview ? entity.interviewCollectionId : undefined, wave3CollectionId: wave3Field ? wave3[wave3Field] : undefined })
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }) }
}
