import { useState } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../auth/AuthProvider'
import { Check, Trash2, AlertTriangle, X } from 'lucide-react'
import { store } from '../store'

export default function Installningar({ orgId, orgName, onOrgNameChange }) {
  const { session } = useAuth()

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

  // --- Ta bort förening ---
  const [deleteStep, setDeleteStep]       = useState(0) // 0 | 1 | 2 | 3
  const [confirmName, setConfirmName]     = useState('')
  const [deleteError, setDeleteError]     = useState('')

  async function handleDelete() {
    setDeleteStep(3); setDeleteError('')
    try {
      const tables = [
        { table: 'transactions',         col: 'org_id' },
        { table: 'budget',                col: 'org_id' },
        { table: 'categories',           col: 'org_id' },
        { table: 'fiscal_periods',       col: 'org_id' },
        { table: 'org_settings',         col: 'org_id' },
        { table: 'org_invites',          col: 'org_id' },
        { table: 'organization_members', col: 'org_id' },
        { table: 'organizations',        col: 'id'     },
      ]
      for (const { table, col } of tables) {
        const { error } = await supabase.from(table).delete().eq(col, orgId)
        if (error) throw error
      }
      try { localStorage.removeItem(`activeOrg_${session.user.id}`) } catch {}
      try { sessionStorage.removeItem('orgPicked') } catch {}
      window.location.reload()
    } catch (e) {
      setDeleteError(e.message)
      setDeleteStep(2)
    }
  }

  return (
    <div style={{ maxWidth: 560 }}>

      {/* Byta namn */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="section-title">Föreningsnamn</div>
        <p style={{ fontSize: '0.85rem', color: 'var(--ink-muted)', marginBottom: 16 }}>
          Ändra vad föreningen heter i appen.
        </p>
        {nameError && (
          <div className="notice" style={{ background:'var(--red-soft)', borderColor:'#f5c6cb', color:'var(--red)', marginBottom:12 }}>{nameError}</div>
        )}
        {nameDone && (
          <div className="notice notice-success" style={{ marginBottom:12 }}>Namnet har sparats.</div>
        )}
        <form onSubmit={handleSaveName} style={{ display:'flex', gap:10, alignItems:'flex-end' }}>
          <div style={{ flex:1 }}>
            <label>Namn</label>
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
            {nameSaving ? 'Sparar…' : <><Check size={14}/> Spara</>}
          </button>
        </form>
      </div>

      {/* Ta bort förening */}
      <div className="card" style={{ border: '1px solid var(--red)' }}>
        <div className="section-title" style={{ color: 'var(--red)' }}>Farlig zon</div>

        {deleteStep === 0 && (
          <>
            <p style={{ fontSize: '0.85rem', color: 'var(--ink-muted)', marginBottom: 16 }}>
              Att ta bort föreningen raderar permanent all data – verifikat, kategorier, perioder och alla medlemmar.
            </p>
            <button
              onClick={() => setDeleteStep(1)}
              style={{ display:'inline-flex', alignItems:'center', gap:8, background:'none', border:'1px solid var(--red)', borderRadius:'var(--r)', color:'var(--red)', fontSize:'0.85rem', padding:'8px 16px', cursor:'pointer' }}
            >
              <Trash2 size={14}/> Ta bort förening…
            </button>
          </>
        )}

        {deleteStep === 1 && (
          <div style={{ background:'var(--red-soft)', borderRadius:'var(--r)', padding:20 }}>
            <div style={{ display:'flex', alignItems:'flex-start', gap:12, marginBottom:16 }}>
              <AlertTriangle size={26} style={{ color:'var(--red)', flexShrink:0, marginTop:2 }}/>
              <div>
                <div style={{ fontWeight:700, fontSize:'1rem', color:'var(--red)', marginBottom:6 }}>Detta går inte att ångra</div>
                <p style={{ fontSize:'0.85rem', color:'var(--ink)', margin:0, lineHeight:1.6 }}>
                  Du håller på att permanent radera <strong>{orgName}</strong> och all data:
                </p>
              </div>
            </div>
            <ul style={{ fontSize:'0.83rem', color:'var(--ink)', margin:'0 0 16px 38px', lineHeight:2 }}>
              <li>Alla verifikat och transaktioner</li>
              <li>Alla kategorier och budgetrader</li>
              <li>Alla räkenskapsperioder</li>
              <li>Alla medlemmar och inbjudningslänkar</li>
            </ul>
            <p style={{ fontSize:'0.83rem', color:'var(--ink-muted)', margin:'0 0 16px' }}>
              Ditt användarkonto raderas <strong>inte</strong> – bara denna förening.
            </p>
            <div style={{ display:'flex', gap:10 }}>
              <button
                onClick={() => setDeleteStep(2)}
                style={{ background:'var(--red)', border:'none', borderRadius:'var(--r)', color:'#fff', fontSize:'0.9rem', padding:'10px 20px', cursor:'pointer', fontWeight:600 }}
              >
                Jag förstår, fortsätt
              </button>
              <button onClick={() => setDeleteStep(0)} className="btn btn-secondary">
                <X size={14}/> Avbryt
              </button>
            </div>
          </div>
        )}

        {deleteStep === 2 && (
          <div>
            <p style={{ fontSize:'0.85rem', color:'var(--ink-muted)', marginBottom:12 }}>
              Skriv <strong>{orgName}</strong> exakt för att bekräfta.
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
                <Trash2 size={14}/> Radera {orgName}
              </button>
              <button onClick={() => { setDeleteStep(0); setConfirmName('') }} className="btn btn-secondary">
                Avbryt
              </button>
            </div>
          </div>
        )}

        {deleteStep === 3 && (
          <p style={{ color:'var(--ink-muted)', fontSize:'0.9rem' }}>Raderar förening…</p>
        )}
      </div>
    </div>
  )
}
