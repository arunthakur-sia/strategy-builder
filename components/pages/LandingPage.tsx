'use client'
import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/store/useStore'
import { projectsApi, storeProjectToken } from '@/lib/api'
import { Plus, Lock, ArrowRight, Building2, Loader2, Trash2, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react'

const ENTITY_TYPES = [
  { value: 'government', label: 'Government Ministry / Authority' },
  { value: 'holding', label: 'Holding Company' },
  { value: 'corporate', label: 'Corporate / Private Sector' },
  { value: 'ngo', label: 'NGO / Non-Profit' },
  { value: 'other', label: 'Other' },
]

export default function LandingPage() {
  const router = useRouter()
  const { setProject, setAuthenticated, isAuthenticated, project } = useStore()

  // Navigate only after React has committed the auth state — prevents the
  // concurrent-mode race where ProtectedRoute sees stale state and fires
  // redirect, stranding the user on the landing page.
  useEffect(() => {
    if (isAuthenticated && project) {
      router.replace('/dashboard')
    }
  }, [isAuthenticated, project])

  const [projects, setProjects] = useState<any[]>([])
  const [mode, setMode] = useState<'list' | 'create' | 'unlock'>('list')
  const [selectedProject, setSelectedProject] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: '', entityName: '', entityType: 'government', consultantName: '', password: '', confirmPassword: ''
  })
  const [unlockPassword, setUnlockPassword] = useState('')
  // Subsidiary entities added during project creation
  const [subsidiaries, setSubsidiaries] = useState<{ name: string; type: string }[]>([])
  const [showSubsidiaries, setShowSubsidiaries] = useState(false)

  // Delete project state
  const [deletingProject, setDeletingProject] = useState<any>(null)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  useEffect(() => { loadProjects() }, [])

  async function loadProjects() {
    try {
      const res = await projectsApi.list()
      setProjects(res.data)
    } catch (e) {}
  }

  function addSubsidiary() {
    setSubsidiaries(s => [...s, { name: '', type: 'corporate' }])
    setShowSubsidiaries(true)
  }

  function removeSubsidiary(index: number) {
    setSubsidiaries(s => s.filter((_, i) => i !== index))
  }

  function updateSubsidiary(index: number, field: 'name' | 'type', value: string) {
    setSubsidiaries(s => s.map((item, i) => i === index ? { ...item, [field]: value } : item))
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (form.password !== form.confirmPassword) { setError('Passwords do not match'); return }
    if (form.password.length < 6) { setError('Password must be at least 6 characters'); return }
    const validSubs = subsidiaries.filter(s => s.name.trim())
    setLoading(true); setError('')
    try {
      const res = await projectsApi.create({ ...form, entities: validSubs })
      if (res.data.token) storeProjectToken(res.data.project.id, res.data.token)
      if (res.data.warnings?.length) useStore.getState().setPendingWarnings(res.data.warnings)
      setProject(res.data.project)
      setAuthenticated(true)
      // navigation is handled by the useEffect above
    } catch (e: any) {
      setError(e.response?.data?.error || 'Failed to create project')
    } finally { setLoading(false) }
  }

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const res = await projectsApi.unlock(selectedProject.id, unlockPassword)
      if (res.data.token) storeProjectToken(selectedProject.id, res.data.token)
      setProject(res.data.project)
      setAuthenticated(true)
      // navigation is handled by the useEffect above
    } catch (e: any) {
      setError(e.response?.data?.error || 'Invalid password')
    } finally { setLoading(false) }
  }

  async function handleDeleteConfirm(e: React.FormEvent) {
    e.preventDefault()
    if (!deletingProject) return
    setDeleteLoading(true); setDeleteError('')
    try {
      const unlockRes = await projectsApi.unlock(deletingProject.id, deletePassword)
      if (unlockRes.data.token) storeProjectToken(deletingProject.id, unlockRes.data.token)
      await projectsApi.delete(deletingProject.id)
      setDeletingProject(null)
      setDeletePassword('')
      await loadProjects()
    } catch (e: any) {
      setDeleteError(e.response?.data?.error || 'Failed to delete project. Check your password.')
    } finally { setDeleteLoading(false) }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--sia-cool-black)', display: 'flex', flexDirection: 'column' }}>
      <header style={{ padding: '24px 40px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <img src="/sia-logo.png" alt="SIA" style={{ height: '36px', width: 'auto', display: 'block', mixBlendMode: 'screen' }} />
        <span style={{ fontSize: '13px', color: 'var(--sia-medium-gray)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>Strategy Assessment Agent</span>
      </header>

      <div style={{ flex: 1, display: 'flex' }}>
        <div style={{ flex: 1, padding: '80px 60px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ maxWidth: '480px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'rgba(0,222,204,0.1)', border: '1px solid rgba(0,222,204,0.2)', borderRadius: '999px', padding: '6px 16px', marginBottom: '32px' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--sia-teal)' }} />
              <span style={{ fontSize: '12px', color: 'var(--sia-teal)', fontWeight: 500, letterSpacing: '0.5px', textTransform: 'uppercase' }}>AI-Powered Assessment Platform</span>
            </div>

            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '52px', fontWeight: 800, color: 'white', lineHeight: 1.1, marginBottom: '24px' }}>
              Strategy <span style={{ color: 'var(--sia-teal)' }}>Builder</span>
            </h1>

            <p style={{ fontSize: '16px', color: 'var(--sia-medium-gray)', lineHeight: 1.7, marginBottom: '48px' }}>
              Automate the full lifecycle of a strategy engagement — from document ingestion and 8-pillar assessment through to strategy formulation, KPIs, and initiative planning.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {[
                ['8-Pillar Assessment Framework', 'AI-scored with evidence from your documents'],
                ['Multi-Entity Parallel Assessment', 'Assess all holding company subsidiaries simultaneously'],
                ['Export-Ready Deliverables', 'Reports in easily exportable format'],
              ].map(([title, desc]) => (
                <div key={title} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'var(--sia-teal)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '2px' }}>
                    <span style={{ color: 'var(--sia-cool-black)', fontSize: '11px', fontWeight: 700 }}>✓</span>
                  </div>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: 'white', marginBottom: '2px' }}>{title}</div>
                    <div style={{ fontSize: '13px', color: 'var(--sia-medium-gray)' }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ width: '520px', background: 'rgba(255,255,255,0.03)', borderLeft: '1px solid rgba(255,255,255,0.06)', padding: '48px 40px', display: 'flex', flexDirection: 'column', gap: '24px', overflowY: 'auto' }}>

          {mode === 'list' && (
            <>
              <div>
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 700, color: 'white', marginBottom: '6px' }}>Your Projects</h2>
                <p style={{ fontSize: '13px', color: 'var(--sia-medium-gray)' }}>Select an existing project or start a new assessment</p>
              </div>

              <button className="btn btn-primary btn-lg" data-testid="button-new-project" style={{ justifyContent: 'center', gap: '10px' }} onClick={() => { setMode('create'); setError(''); setSubsidiaries([]); setShowSubsidiaries(false) }}>
                <Plus size={18} />
                New Assessment Project
              </button>

              {projects.length > 0 && (
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--sia-medium-gray)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px', fontWeight: 600 }}>Recent Projects</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {projects.map((p: any) => (
                      <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button data-testid={`button-project-${p.id}`} onClick={() => { setSelectedProject(p); setMode('unlock'); setError('') }}
                          style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--radius-lg)', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,222,204,0.08)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,222,204,0.3)' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)' }}
                        >
                          <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(0,222,204,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <Building2 size={16} color="var(--sia-teal)" />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '14px', fontWeight: 600, color: 'white', marginBottom: '2px' }}>{p.entityName}</div>
                            <div style={{ fontSize: '12px', color: 'var(--sia-medium-gray)' }}>{p.name}</div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                            <Lock size={13} color="var(--sia-medium-gray)" />
                            <span style={{ fontSize: '11px', color: 'var(--sia-medium-gray)' }}>{new Date(p.updatedAt).toLocaleDateString()}</span>
                          </div>
                        </button>
                        <button
                          data-testid={`button-delete-project-${p.id}`}
                          title="Delete project"
                          onClick={() => { setDeletingProject(p); setDeletePassword(''); setDeleteError('') }}
                          style={{ flexShrink: 0, width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius-lg)', cursor: 'pointer', transition: 'all 0.15s' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.25)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(239,68,68,0.5)' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.1)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(239,68,68,0.25)' }}
                        >
                          <Trash2 size={15} color="#EF4444" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {projects.length === 0 && (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px', color: 'var(--sia-medium-gray)', padding: '40px 0' }}>
                  <Building2 size={40} color="rgba(135,150,169,0.3)" />
                  <p style={{ fontSize: '14px', textAlign: 'center' }}>No projects yet.<br />Create your first assessment above.</p>
                </div>
              )}
            </>
          )}

          {mode === 'create' && (
            <>
              <div>
                <button onClick={() => { setMode('list'); setError('') }} style={{ background: 'none', border: 'none', color: 'var(--sia-medium-gray)', cursor: 'pointer', fontSize: '13px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  ← Back
                </button>
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 700, color: 'white', marginBottom: '6px' }}>New Project</h2>
                <p style={{ fontSize: '13px', color: 'var(--sia-medium-gray)' }}>Set up your assessment engagement — add one entity or an entire holding structure</p>
              </div>

              <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="form-group">
                  <label className="form-label" style={{ color: 'var(--sia-medium-gray)' }}>Project Name</label>
                  <input className="form-input" data-testid="input-project-name" placeholder="e.g. MOCI Strategy Assessment 2025" value={form.name}
                    onChange={e => setForm(f => ({...f, name: e.target.value}))} required
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', color: 'white' }} />
                </div>

                {/* Primary entity — holding company or single entity */}
                <div style={{ padding: '16px', background: 'rgba(0,222,204,0.06)', border: '1px solid rgba(0,222,204,0.2)', borderRadius: 'var(--radius-lg)' }}>
                  <div style={{ fontSize: '11px', color: 'var(--sia-teal)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px' }}>
                    Primary Entity {subsidiaries.length > 0 ? '(Holding Company)' : ''}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label" style={{ color: 'var(--sia-medium-gray)' }}>Entity Name</label>
                      <input className="form-input" data-testid="input-entity-name" placeholder="e.g. Ministry of Commerce and Industry" value={form.entityName}
                        onChange={e => setForm(f => ({...f, entityName: e.target.value}))} required
                        style={{ background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', color: 'white' }} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label" style={{ color: 'var(--sia-medium-gray)' }}>Entity Type</label>
                      <select className="form-input form-select" data-testid="select-entity-type" value={form.entityType}
                        onChange={e => setForm(f => ({...f, entityType: e.target.value}))}
                        style={{ background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', color: 'white' }}>
                        {ENTITY_TYPES.map(t => <option key={t.value} value={t.value} style={{ background: '#173044' }}>{t.label}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Subsidiaries / additional entities */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: subsidiaries.length > 0 ? '10px' : '0' }}>
                    <button type="button" onClick={() => setShowSubsidiaries(v => !v)} style={{ background: 'none', border: 'none', color: 'var(--sia-teal)', cursor: 'pointer', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', padding: 0 }}>
                      {showSubsidiaries ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      Subsidiaries / Additional Entities
                      {subsidiaries.length > 0 && <span style={{ background: 'rgba(0,222,204,0.2)', color: 'var(--sia-teal)', padding: '1px 8px', borderRadius: '999px', fontSize: '11px' }}>{subsidiaries.length}</span>}
                    </button>
                    <button type="button" onClick={addSubsidiary} style={{ background: 'rgba(0,222,204,0.1)', border: '1px solid rgba(0,222,204,0.3)', color: 'var(--sia-teal)', borderRadius: 'var(--radius)', padding: '4px 10px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Plus size={12} /> Add Entity
                    </button>
                  </div>

                  {showSubsidiaries && subsidiaries.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {subsidiaries.map((sub, idx) => (
                        <div key={idx} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--radius)' }}>
                          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <input className="form-input" placeholder={`Subsidiary ${idx + 1} name`} value={sub.name}
                              onChange={e => updateSubsidiary(idx, 'name', e.target.value)}
                              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'white', fontSize: '13px', padding: '6px 10px' }} />
                            <select className="form-input form-select" value={sub.type}
                              onChange={e => updateSubsidiary(idx, 'type', e.target.value)}
                              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'white', fontSize: '12px', padding: '5px 10px' }}>
                              {ENTITY_TYPES.map(t => <option key={t.value} value={t.value} style={{ background: '#173044' }}>{t.label}</option>)}
                            </select>
                          </div>
                          <button type="button" onClick={() => removeSubsidiary(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444', padding: '4px', flexShrink: 0 }}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {showSubsidiaries && subsidiaries.length === 0 && (
                    <div style={{ padding: '20px', textAlign: 'center', color: 'var(--sia-medium-gray)', fontSize: '13px', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 'var(--radius)' }}>
                      Click "Add Entity" to add subsidiaries for parallel assessment
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ color: 'var(--sia-medium-gray)' }}>Lead Consultant</label>
                  <input className="form-input" data-testid="input-consultant" placeholder="Your name" value={form.consultantName}
                    onChange={e => setForm(f => ({...f, consultantName: e.target.value}))}
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', color: 'white' }} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="form-group">
                    <label className="form-label" style={{ color: 'var(--sia-medium-gray)' }}>Password</label>
                    <input className="form-input" data-testid="input-password" type="password" placeholder="Min 6 chars" value={form.password}
                      onChange={e => setForm(f => ({...f, password: e.target.value}))} required
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', color: 'white' }} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" style={{ color: 'var(--sia-medium-gray)' }}>Confirm</label>
                    <input className="form-input" data-testid="input-confirm-password" type="password" placeholder="Repeat" value={form.confirmPassword}
                      onChange={e => setForm(f => ({...f, confirmPassword: e.target.value}))} required
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', color: 'white' }} />
                  </div>
                </div>

                {error && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 'var(--radius)', padding: '10px 14px', fontSize: '13px', color: 'var(--sia-red)' }}>{error}</div>}

                <button className="btn btn-primary btn-lg" data-testid="button-create-project" type="submit" disabled={loading} style={{ justifyContent: 'center', marginTop: '8px' }}>
                  {loading
                    ? <><Loader2 size={16} className="spinner" /> Creating{subsidiaries.filter(s => s.name.trim()).length > 0 ? ` ${subsidiaries.filter(s => s.name.trim()).length + 1} entities` : ''}...</>
                    : <>Create Project <ArrowRight size={16} /></>
                  }
                </button>
              </form>
            </>
          )}

          {mode === 'unlock' && selectedProject && (
            <>
              <div>
                <button onClick={() => { setMode('list'); setError('') }} style={{ background: 'none', border: 'none', color: 'var(--sia-medium-gray)', cursor: 'pointer', fontSize: '13px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  ← Back
                </button>
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 700, color: 'white', marginBottom: '6px' }}>Unlock Project</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px', background: 'rgba(0,222,204,0.08)', border: '1px solid rgba(0,222,204,0.2)', borderRadius: 'var(--radius-lg)', marginTop: '16px' }}>
                  <Building2 size={18} color="var(--sia-teal)" />
                  <div>
                    <div style={{ fontSize: '15px', fontWeight: 600, color: 'white' }}>{selectedProject.entityName}</div>
                    <div style={{ fontSize: '12px', color: 'var(--sia-medium-gray)' }}>{selectedProject.name}</div>
                  </div>
                </div>
              </div>

              <form onSubmit={handleUnlock} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="form-group">
                  <label className="form-label" style={{ color: 'var(--sia-medium-gray)' }}>Project Password</label>
                  <input className="form-input" data-testid="input-unlock-password" type="password" placeholder="Enter project password" value={unlockPassword}
                    onChange={e => setUnlockPassword(e.target.value)} required autoFocus
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', color: 'white', fontSize: '16px' }} />
                </div>

                {error && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 'var(--radius)', padding: '10px 14px', fontSize: '13px', color: 'var(--sia-red)' }}>{error}</div>}

                <button className="btn btn-primary btn-lg" data-testid="button-unlock" type="submit" disabled={loading} style={{ justifyContent: 'center' }}>
                  {loading ? <><Loader2 size={16} className="spinner" /> Unlocking...</> : <>Unlock <Lock size={16} /></>}
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      {/* Delete project confirmation modal */}
      {deletingProject && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={e => { if (e.target === e.currentTarget) { setDeletingProject(null); setDeletePassword(''); setDeleteError('') } }}>
          <div style={{ background: 'var(--sia-dark)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius-xl)', padding: '32px', width: '420px', maxWidth: '90vw' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'rgba(239,68,68,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <AlertTriangle size={20} color="#EF4444" />
              </div>
              <div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: 'white' }}>Delete Project</div>
                <div style={{ fontSize: '12px', color: 'var(--sia-medium-gray)', marginTop: '2px' }}>This action cannot be undone</div>
              </div>
            </div>

            <div style={{ padding: '12px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--radius)', marginBottom: '20px' }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'white' }}>{deletingProject.entityName}</div>
              <div style={{ fontSize: '12px', color: 'var(--sia-medium-gray)', marginTop: '2px' }}>{deletingProject.name}</div>
            </div>

            <p style={{ fontSize: '13px', color: 'var(--sia-medium-gray)', marginBottom: '20px', lineHeight: 1.6 }}>
              This will permanently delete the project, all associated documents, assessments, and SiaGPT collections. Enter the project password to confirm.
            </p>

            <form onSubmit={handleDeleteConfirm} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" style={{ color: 'var(--sia-medium-gray)' }}>Project Password</label>
                <input className="form-input" type="password" placeholder="Enter project password to confirm" value={deletePassword}
                  onChange={e => setDeletePassword(e.target.value)} required autoFocus
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', color: 'white' }} />
              </div>

              {deleteError && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 'var(--radius)', padding: '10px 14px', fontSize: '13px', color: 'var(--sia-red)' }}>{deleteError}</div>
              )}

              <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                <button type="button" onClick={() => { setDeletingProject(null); setDeletePassword(''); setDeleteError('') }}
                  style={{ flex: 1, padding: '10px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 'var(--radius)', color: 'var(--sia-medium-gray)', cursor: 'pointer', fontSize: '14px', fontWeight: 600 }}>
                  Cancel
                </button>
                <button type="submit" disabled={deleteLoading || !deletePassword}
                  style={{ flex: 1, padding: '10px', background: deleteLoading || !deletePassword ? 'rgba(239,68,68,0.3)' : '#EF4444', border: 'none', borderRadius: 'var(--radius)', color: 'white', cursor: deleteLoading || !deletePassword ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  {deleteLoading ? <><Loader2 size={15} className="spinner" /> Deleting...</> : <><Trash2 size={15} /> Delete Project</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
