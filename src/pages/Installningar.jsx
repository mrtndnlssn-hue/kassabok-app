import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../auth/AuthProvider'
import { Check, Trash2, AlertTriangle, X } from 'lucide-react'
import { store, attachments } from '../store'
import Funktioner from './Funktioner'
import { useI18n } from '../i18n'

const fmtMb = b => `${((b || 0) / 1048576).toFixed(b >= 10485760 ? 0 : 1)} MB`

export default function Installningar({ orgId, orgName, features = [], categories = [], onFeaturesChange, onOrgNameChange, onProjectSettingsChange }) {
  const { t } = useI18n()
  const { session, role } = useAuth()
  const [tab, setTab] = useState(() => {
    // Kom igång-sidan kan öppna fliken Funktioner direkt
    try { if (sessionStorage.getItem('kb_settings_tab') === 'funktioner') { sessionStorage.removeItem('kb_settings_tab'); return 'funktioner' } } catch { /* ignore */ }
    return window.location.hash.includes('funktioner') ? 'funktioner' : 'allmant'
  })   // 'allmant' | 'funktioner'

  // --- Byta namn ---
  const [nameInput, setNameInput]   = useState(orgName)
  const [nameSaving, setNameSaving] = useState(false)
  const [nameDone, setNameDone]     = useState(false)
  const [nameError, setNameError]   = useState('')

  async function handleSaveName(e) {
    e.preventDefault()
    if (nameInput.trim() === orgName) return
    setNameSaving(true); setNameError(''); setNameDone(false)
    try {
      await store.setOrgName(orgId, nameInput.trim())
      onOrgNameChange(nameInput.trim())
      setNameDone(true)
      setTimeout(() => setNameDone(false), 3000)
    } catch (err) {
      setNameError(err.message)
    } finally {
      setNameSaving(false)
    }
  }

  // --- Plan och förbrukning ---
  const [plan, setPlan] = useState(null)
  useEffect(() => {
    supabase.rpc('get_org_plan', { p_org: orgId }).then(({ data }) => setPlan(data))
  }, [orgId])

  // --- Ta bort förening ---
  const [deleteStep, setDeleteStep]       = useState(0) // 0 | 1 | 2 | 3
  const [confirmName, setConfirmName]     = useState('')
  const [deleteError, setDeleteError]     = useState('')

  async function handleDelete() {
    setDeleteStep(3); setDeleteError('')
    try {
      // Bilagorna först (filer i Storage), sedan raderar databasfunktionen allt annat och själva föreningen
      await attachments.removeAllForOrg(orgId)
      const { error } = await supabase.rpc('delete_organization', { p_org_id: orgId })
      if (error) throw error
      try { localStorage.removeItem(`activeOrg_${session.user.id}`) } catch {}
      try { sessionStorage.removeItem('orgPicked') } catch {}
      window.location.reload()
    } catch (e) {
      setDeleteError(t(e.message))
      setDeleteStep(2)
    }
  }

  const tabBtn = (id, label) => (
    <button key={id} type="button" className={`btn btn-sm ${tab === id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(id)}>{label}</button>
  )

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {tabBtn('allmant', t('Allmänt'))}
        {tabBtn('funktioner', t('Funktioner'))}
      </div>

      {tab === 'funktioner' && (
        <Funktioner orgId={orgId} features={features} categories={categories} onFeaturesChange={onFeaturesChange} onProjectSettingsChange={onProjectSettingsChange} />
      )}

      {tab === 'allmant' && (<>

      {/* Plan */}
      {plan && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="section-title">{t('Plan')}</div>
          <div style={{ display:'flex', alignItems:'baseline', gap:10, marginBottom:10 }}>
            <strong style={{ fontSize:'1.1rem' }}>{t(plan.plan_name)}</strong>
            {plan.plan_code !== 'prova' && plan.valid_until && (
              <span style={{ fontSize:'0.8rem', color:'var(--ink-muted)' }}>{t('Giltig till {date}', { date: plan.valid_until })}</span>
            )}
          </div>
          <div style={{ fontSize:'0.85rem', color:'var(--ink-soft)', display:'grid', gap:4 }}>
            <div>{t('Verifikat i nuvarande räkenskapsår:')} <strong style={{ fontFamily:'var(--font-mono)' }}>{plan.vouchers_used} / {plan.voucher_limit}</strong></div>
            <div>{t('AI-avläsningar per månad:')} <strong style={{ fontFamily:'var(--font-mono)' }}>{plan.ai_limit}</strong></div>
            <div>{t('Lagring av bilagor:')} <strong style={{ fontFamily:'var(--font-mono)' }}>{fmtMb(plan.storage_used_bytes)} / {fmtMb(plan.storage_limit_bytes)}</strong></div>
          </div>
          {plan.plan_code === 'prova' && (
            <p style={{ fontSize:'0.82rem', color:'var(--ink-muted)', marginTop:12 }}>
              {t('Behöver ni fler verifikat? Se planerna och beställ på')} <a href="https://foreningsbalans.se/#priser">foreningsbalans.se</a>.
            </p>
          )}
        </div>
      )}

      {/* Byta namn */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="section-title">{t('Föreningsnamn')}</div>
        <p style={{ fontSize: '0.85rem', color: 'var(--ink-muted)', marginBottom: 16 }}>
          {t('Ändra vad föreningen heter i appen.')}
        </p>
        {nameError && (
          <div className="notice" style={{ background:'var(--red-soft)', borderColor:'#f5c6cb', color:'var(--red)', marginBottom:12 }}>{nameError}</div>
        )}
        {nameDone && (
          <div className="notice notice-success" style={{ marginBottom:12 }}>{t('Namnet har sparats.')}</div>
        )}
        <form onSubmit={handleSaveName} style={{ display:'flex', gap:10, alignItems:'flex-end' }}>
          <div style={{ flex:1 }}>
            <label>{t('Namn')}</label>
            <input
              type="text"
              value={nameInput}
              onChange={e => { setNameInput(e.target.value); setNameDone(false) }}
              required
            />
          </div>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={nameSaving || !nameInput.trim() || nameInput.trim() === orgName}
            style={{ marginBottom: 1 }}
          >
            {nameSaving ? t('Sparar…') : <><Check size={14}/> {t('Spara')}</>}
          </button>
        </form>
      </div>

      {/* Ta bort förening */}
      <div className="card" style={{ border: '1px solid var(--red)' }}>
        <div className="section-title" style={{ color: 'var(--red)' }}>{t('Farlig zon')}</div>

        {deleteStep === 0 && (
          <>
            <p style={{ fontSize: '0.85rem', color: 'var(--ink-muted)', marginBottom: 16 }}>
              {t('Att ta bort föreningen raderar permanent all data – verifikat, kategorier, perioder och alla medlemmar.')}
            </p>
            <button
              onClick={() => setDeleteStep(1)}
              style={{ display:'inline-flex', alignItems:'center', gap:8, background:'none', border:'1px solid var(--red)', borderRadius:'var(--r)', color:'var(--red)', fontSize:'0.85rem', padding:'8px 16px', cursor:'pointer' }}
            >
              <Trash2 size={14}/> {t('Ta bort förening…')}
            </button>
          </>
        )}

        {deleteStep === 1 && (
          <div style={{ background:'var(--red-soft)', borderRadius:'var(--r)', padding:20 }}>
            <div style={{ display:'flex', alignItems:'flex-start', gap:12, marginBottom:16 }}>
              <AlertTriangle size={26} style={{ color:'var(--red)', flexShrink:0, marginTop:2 }}/>
              <div>
                <div style={{ fontWeight:700, fontSize:'1rem', color:'var(--red)', marginBottom:6 }}>{t('Detta går inte att ångra')}</div>
                <p style={{ fontSize:'0.85rem', color:'var(--ink)', margin:0, lineHeight:1.6 }}>
                  {t('Du håller på att permanent radera')} <strong>{orgName}</strong> {t('och all data:')}
                </p>
              </div>
            </div>
            <ul style={{ fontSize:'0.83rem', color:'var(--ink)', margin:'0 0 16px 38px', lineHeight:2 }}>
              <li>{t('Alla verifikat och transaktioner')}</li>
              <li>{t('Alla kategorier och budgetrader')}</li>
              <li>{t('Alla räkenskapsperioder')}</li>
              <li>{t('Alla medlemmar och inbjudningslänkar')}</li>
            </ul>
            <p style={{ fontSize:'0.83rem', color:'var(--ink-muted)', margin:'0 0 16px' }}>
              {t('Ditt användarkonto raderas')} <strong>{t('inte')}</strong> – {t('bara denna förening.')}
            </p>
            <div style={{ display:'flex', gap:10 }}>
              <button
                onClick={() => setDeleteStep(2)}
                style={{ background:'var(--red)', border:'none', borderRadius:'var(--r)', color:'#fff', fontSize:'0.9rem', padding:'10px 20px', cursor:'pointer', fontWeight:600 }}
              >
                {t('Jag förstår, fortsätt')}
              </button>
              <button onClick={() => setDeleteStep(0)} className="btn btn-secondary">
                <X size={14}/> {t('Avbryt')}
              </button>
            </div>
          </div>
        )}

        {deleteStep === 2 && (
          <div>
            <p style={{ fontSize:'0.85rem', color:'var(--ink-muted)', marginBottom:12 }}>
              {t('Skriv')} <strong>{orgName}</strong> {t('exakt för att bekräfta.')}
            </p>
            {deleteError && (
              <div className="notice" style={{ background:'var(--red-soft)', borderColor:'var(--red)', color:'var(--red)', marginBottom:12 }}>{deleteError}</div>
            )}
            <input
              type="text"
              value={confirmName}
              onChange={e => setConfirmName(e.target.value)}
              placeholder={orgName}
              autoFocus
              style={{ marginBottom:16 }}
            />
            <div style={{ display:'flex', gap:10 }}>
              <button
                onClick={handleDelete}
                disabled={confirmName !== orgName}
                style={{
                  display:'inline-flex', alignItems:'center', gap:8,
                  background: confirmName === orgName ? 'var(--red)' : 'var(--border)',
                  border:'none', borderRadius:'var(--r)',
                  color: confirmName === orgName ? '#fff' : 'var(--ink-muted)',
                  fontSize:'0.9rem', padding:'10px 20px',
                  cursor: confirmName === orgName ? 'pointer' : 'default',
                  fontWeight:600, transition:'background 0.15s',
                }}
              >
                <Trash2 size={14}/> {t('Radera {namn}', { namn: orgName })}
              </button>
              <button onClick={() => { setDeleteStep(0); setConfirmName('') }} className="btn btn-secondary">
                {t('Avbryt')}
              </button>
            </div>
          </div>
        )}

        {deleteStep === 3 && (
          <p style={{ color:'var(--ink-muted)', fontSize:'0.9rem' }}>{t('Raderar förening…')}</p>
        )}
      </div>
      </>)}
    </div>
  )
}
