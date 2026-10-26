'use client'
import axios from 'axios'
import { upload as blobUpload } from '@vercel/blob/client'

// In Next.js the API is always at /api (same origin)
const API_ROOT = '/api'

// ── Token store (Safari ITP workaround) ───────────────────────────────────────
function getStoredTokens(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try { return JSON.parse(localStorage.getItem('sia_project_tokens') || '{}') } catch { return {} }
}

function persistTokens(tokens: Record<string, string>) {
  if (typeof window === 'undefined') return
  localStorage.setItem('sia_project_tokens', JSON.stringify(tokens))
}

export function storeProjectToken(projectId: string, token: string): void {
  const tokens = getStoredTokens()
  tokens[projectId] = token
  persistTokens(tokens)
}

export function getProjectToken(projectId: string): string | null {
  return getStoredTokens()[projectId] || null
}

export function authHeaders(projectId: string): Record<string, string> {
  const token = getProjectToken(projectId)
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// ─────────────────────────────────────────────────────────────────────────────

const api = axios.create({
  baseURL: API_ROOT,
  withCredentials: true,
  timeout: 60000,
})

api.interceptors.request.use(cfg => {
  const match = (cfg.url || '').match(/\/projects\/([0-9a-f-]{36})/)
  if (match) {
    const token = getProjectToken(match[1])
    if (token) cfg.headers.Authorization = `Bearer ${token}`
  }
  return cfg
})

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401 && typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.location.href = '/'
    }
    return Promise.reject(err)
  }
)

export const projectsApi = {
  list: () => api.get('/projects'),
  create: (data: any) => api.post('/projects', data),
  unlock: (id: string, password: string) => api.post(`/projects/${id}/unlock`, { password }),
  get: (id: string) => api.get(`/projects/${id}`),
  save: (id: string, data: any) => api.put(`/projects/${id}`, data),
  updatePillar: (id: string, pillarId: string, data: any) => api.patch(`/projects/${id}/pillar/${pillarId}`, data),
  updateEntityPillar: (id: string, entityId: string, pillarId: string, data: any) => api.patch(`/projects/${id}/entities/${entityId}/pillar/${pillarId}`, data),
  updateStrategy: (id: string, data: any) => api.patch(`/projects/${id}/strategy`, data),
  updateEntityStrategy: (id: string, entityId: string, data: any) => api.patch(`/projects/${id}/entities/${entityId}/strategy`, data),
  saveRubric: (id: string, rubricData: any) => api.patch(`/projects/${id}/rubric`, rubricData),
  delete: (id: string) => api.delete(`/projects/${id}`),
}

// Uploads files directly from the browser to Vercel Blob storage, bypassing the
// platform's 4.5MB serverless function request body limit, then hands the
// resulting blob URLs to the server route for text extraction/processing.
async function uploadFilesViaBlob(projectId: string, files: File[]) {
  const uploaded = []
  for (const file of files) {
    const blob = await blobUpload(`${projectId}/${Date.now()}-${file.name}`, file, {
      access: 'private',
      handleUploadUrl: `/api/documents/${projectId}/upload/blob-token`,
      headers: authHeaders(projectId),
    })
    uploaded.push({ url: blob.url, name: file.name, type: file.type, size: file.size })
  }
  return uploaded
}

export const documentsApi = {
  upload: async (projectId: string, files: File[], docType: string, docLabel: string) => {
    const uploadedFiles = await uploadFilesViaBlob(projectId, files)
    return api.post(`/documents/${projectId}/upload`, {
      files: uploadedFiles,
      docType: docType || 'general',
      docLabel: docLabel || '',
    }, { timeout: 120000 })
  },
  delete: (projectId: string, docId: string) => api.delete(`/documents/${projectId}/${docId}`),
  getText: (projectId: string, docId: string) => api.get(`/documents/${projectId}/${docId}/text`),
  embeddingStatus: (projectId: string) => api.get(`/documents/${projectId}/embedding-status`),
}

export const sourcesApi = {
  batch: (projectId: string, mediaVersionIds: string[]) =>
    api.post(`/ai/${projectId}/sources/batch`, { mediaVersionIds }),
  entitiesBatch: (projectId: string, entityIds: string[]) =>
    api.post(`/ai/${projectId}/sources/entities-batch`, { entityIds }),
}

async function* sseStream(resp: Response) {
  if (!resp.ok) { yield { error: `HTTP ${resp.status}` }; return }
  const reader = resp.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data: ')) continue
      try { yield JSON.parse(trimmed.slice(6)) } catch { /* incomplete chunk */ }
    }
  }
  if (buffer.trim().startsWith('data: ')) {
    try { yield JSON.parse(buffer.trim().slice(6)) } catch { /* ignore */ }
  }
}

export const aiApi = {
  consolidateSwot: (projectId: string) => api.post(`/ai/${projectId}/consolidate-swot`, {}, { timeout: 180000 }),
  generateStrategy: (projectId: string, task: string, context: any) => api.post(`/ai/${projectId}/strategy/generate`, { task, context }),
  benchmarks: (projectId: string, pillarId: string, entityId?: string | null) => api.post(`/ai/${projectId}/benchmarks/${pillarId}`, entityId ? { entityId } : {}),

  generateReport: async function* (projectId: string, reportType: string, entityId?: string) {
    yield* sseStream(await fetch(`${API_ROOT}/ai/${projectId}/generate-report/${reportType}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders(projectId) },
      body: entityId ? JSON.stringify({ entityId }) : undefined,
    }))
  },

  generateReportsBatch: async function* (projectId: string, entityIds: string[], reportTypes: string[]) {
    yield* sseStream(await fetch(`${API_ROOT}/ai/${projectId}/generate-reports-batch`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders(projectId) },
      body: JSON.stringify({ entityIds, reportTypes }),
    }))
  },

  chat: async function* (projectId: string, messages: any[], context: any) {
    yield* sseStream(await fetch(`${API_ROOT}/ai/${projectId}/chat`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders(projectId) },
      body: JSON.stringify({ messages, context }),
    }))
  },

}

export const entitiesApi = {
  add: (projectId: string, data: { name: string; type: string }) => api.post(`/projects/${projectId}/entities`, data),
  remove: (projectId: string, entityId: string) => api.delete(`/projects/${projectId}/entities/${entityId}`),
  update: (projectId: string, entityId: string, data: { name?: string; type?: string }) => api.patch(`/projects/${projectId}/entities/${entityId}`, data),
}

export const entityDocumentsApi = {
  upload: async (
    projectId: string, entityId: string, files: File[], docType: string, docLabel: string,
    targetCollection?: 'main' | 'interview'
  ) => {
    const uploadedFiles = await uploadFilesViaBlob(projectId, files)
    return api.post(`/documents/${projectId}/${entityId}/upload`, {
      files: uploadedFiles,
      docType: docType || 'general',
      docLabel: docLabel || '',
      ...(targetCollection ? { targetCollection } : {}),
    }, { timeout: 120000 })
  },
  delete: (projectId: string, entityId: string, docId: string) => api.delete(`/documents/${projectId}/${entityId}/${docId}`),
  embeddingStatus: (projectId: string, entityId: string) => api.get(`/documents/${projectId}/${entityId}/embedding-status`),
}

// Wave 1 (Diagnostic) multi-agent pipeline — every agent runs only in response to a human chat message
// (no autonomous "run" trigger), then a human explicitly approves the version that's passed downstream.
export const wave1Api = {
  chatWithAgent: async function* (projectId: string, entityId: string, agentId: string, message: string) {
    yield* sseStream(await fetch(`${API_ROOT}/ai/${projectId}/${entityId}/agent/${agentId}/chat`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders(projectId) },
      body: JSON.stringify({ message }),
    }))
  },

  approveAgent: (projectId: string, entityId: string, agentId: string, scores?: { aiScore: number; manualScore: number }) =>
    api.post(`/ai/${projectId}/${entityId}/agent/${agentId}/approve`, scores || {}),

  unlockAgent: (projectId: string, entityId: string, agentId: string) =>
    api.post(`/ai/${projectId}/${entityId}/agent/${agentId}/unlock`, {}),

  stopAgent: (projectId: string, entityId: string, agentId: string) =>
    api.post(`/ai/${projectId}/${entityId}/agent/${agentId}/stop`, {}),

  resetAgent: (projectId: string, entityId: string, agentId: string) =>
    api.post(`/ai/${projectId}/${entityId}/agent/${agentId}/reset`, {}),

  // Reviewer's manual override score for a pillar agent — editable any time, independent of approval.
  setManualScore: (projectId: string, entityId: string, agentId: string, manualScore: number | null) =>
    api.patch(`/ai/${projectId}/${entityId}/agent/${agentId}/score`, { manualScore }),

  // Approved agents only: LLM-written markdown report from the whole conversation (cached server-side).
  generateReport: (projectId: string, entityId: string, agentId: string, payload: {
    title: string; tokenToNum: Record<string, number>; sources: any[]; force?: boolean
  }) =>
    api.post(`/ai/${projectId}/${entityId}/agent/${agentId}/report`, payload, { timeout: 800_000 })
      .then(r => r.data as { markdown: string; title: string; entityName: string; generatedAt: string; cached: boolean }),

  setIdiDocumentsAvailable: (projectId: string, entityId: string, hasDocuments: boolean) =>
    api.post(`/ai/${projectId}/${entityId}/idi-choice`, { hasDocuments }),
}

// Wave 2 (Formulation) agents share wave1Api's chat/approve/unlock/reset endpoints (the server dispatches on
// agentId) — only the optional-step switch is Wave 2 specific.
export const wave2Api = {
  setOptionsEnabled: (projectId: string, entityId: string, enabled: boolean) =>
    api.post(`/ai/${projectId}/${entityId}/options-choice`, { enabled }),
  setSwotBEnabled: (projectId: string, entityId: string, enabled: boolean) =>
    api.post(`/ai/${projectId}/${entityId}/options-choice`, { enabled, step: 'swotB' }),
}
