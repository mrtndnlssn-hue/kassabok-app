import { useState } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../auth/AuthProvider'
import { Trash2, AlertTriangle, X } from 'lucide-react'

export default function TaBortForening({ orgId, orgName }) {
  const { session, orgs } = useAuth()
  const [step, setStep]       = useState(0) // 0=knapp, 1=varning, 2=bekräfta, 3=raderar
  const [confirmName, setConfirmName] = useState('')
  const [error, setError]     = useState('')

  async function handleDelete() {
    setStep(3)
    setError('')
    try {
      // Radera i rätt ordning (foreign keys)
      const tables = [
        { table: 'transactions',          col: 'org_id' },
        { table: 'budget_lines',          col: 'org_id' },
        { table: 'categories',            col: 'org_id' },
        { table: 'fiscal_periods',        col: 'org_id' },
        { table: 'org_settings',          col: 'org_id' },
        { table: 'org_invites',           col: 'org_id' },
        { table: 'organization_members',  col: 'org_id' },
        { table: 'organizations',         col: 'id'     },
      ]
      for (const { table, col } of tables) {
        const { error } = await supabase.from(table).delete().eq(col, orgId)
        if (error) throw error
      }
      // Rensa localStorage och sessionStorage, ladda om
      try { localStorage.removeItem(`activeOrg_${session.user.id}`) } catch {}
      try { sessionStorage.removeItem('orgPicked') } catch {}
      window.location.reload()
    } catch (e) {
      setError(e.message)
      setStep(2)
    }
  }

  if (step === 0) return (
    <div style={{ marginTop: 40, paddingTop: 24, borderTop: '1px solid var(--border)' }}>
      <button
        onClick={() => setStep(1)}
        style={{ display:'inline-flex', alignItems:'center', gap:8, background:'none', border:'1px solid var(--red)', borderRadius:'var(--r)', color:'var(--red)', fontSize:'0.85rem', padding:'8px 16px', cursor:'pointer' }}
      >
        <Trash2 size={14}/> Ta bort förening…
      </button>
    </div>
  )

  if (step === 1) return (
    <div style={{ marginTop:40, paddingTop:24, borderTop:'1px solid var(--border)' }}>
      <div style={{ background:'var(--red-soft)', border:'1px solid var(--red)', borderRadius:'var(--r-lg)', padding:24, maxWidth:500 }}>
        <div style={{ display:'flex', alignItems:'flex-start', gap:12, marginBottom:16 }}>
          <AlertTriangle size={28} style={{ color:'var(--red)', flexShrink:0, marginTop:2 }}/>
          <div>
            <div style={{ fontWeight:700, fontSize:'1.05rem', color:'var(--red)', marginBottom:6 }}>Detta går inte att ångra</div>
            <p style={{ fontSize:'0.85rem', color:'var(--ink)', margin:0, lineHeight:1.6 }}>
              Du håller på att permanent radera <strong>{orgName}</strong> och <em>all</em> data som hör till föreningen:
            </p>
          </div>
        </div>
        <ul style={{ fontSize:'0.83rem', color:'var(--ink)', margin:'0 0 20px 40px', lineHeight:2 }}>
          <li>Alla verifikat och transaktioner</li>
          <li>Alla kategorier och budgetrader</li>
          <li>Alla räkenskapsperioder</li>
          <li>Alla medlemmar och inbjudningslänkar</li>
          <li>Föreningens konto och inställningar</li>
        </ul>
        <p style={{ fontSize:'0.83rem', color:'var(--ink-muted)', margin:'0 0 20px 0' }}>
          Ditt användarkonto raderas <strong>inte</strong> – bara denna förening.
        </p>
        <div style={{ display:'flex', gap:10 }}>
          <button
            onClick={() => setStep(2)}
            style={{ background:'var(--red)', border:'none', borderRadius:'var(--r)', color:'#fff', fontSize:'0.9rem', padding:'10px 20px', cursor:'pointer', fontWeight:600 }}
          >
            Jag förstår, fortsätt
          </button>
          <button onClick={() => setStep(0)} className="btn btn-secondary">
            <X size={14}/> Avbryt
          </button>
        </div>
      </div>
    </div>
  )

  if (step === 2) return (
    <div style={{ marginTop:40, paddingTop:24, borderTop:'1px solid var(--border)' }}>
      <div style={{ background:'var(--paper-2)', border:'1px solid var(--red)', borderRadius:'var(--r-lg)', padding:24, maxWidth:500 }}>
        <div style={{ fontWeight:700, fontSize:'1rem', color:'var(--ink)', marginBottom:8 }}>Bekräfta borttagning</div>
        <p style={{ fontSize:'0.85rem', color:'var(--ink-muted)', marginBottom:16 }}>
          Skriv <strong>{orgName}</strong> exakt för att bekräfta.
        </p>
        {error && (
          <div className="notice" style={{ background:'var(--red-soft)', borderColor:'var(--red)', color:'var(--red)', marginBottom:12 }}>{error}</div>
        )}
        <input
          type="text"
          value={confirmName}
          onChange={e => setConfirmName(e.target.value)}
          placeholder={orgName}
          autoFocus
          style={{ width:'100%', marginBottom:16, boxSizing:'border-box' }}
        />
        <div style={{ display:'flex', gap:10 }}>
          <button
            onClick={handleDelete}
            disabled={confirmName !== orgName}
            style={{ background: confirmName === orgName ? 'var(--red)' : 'var(--border)', border:'none', borderRadius:'var(--r)', color: confirmName === orgName ? '#fff' : 'var(--ink-muted)', fontSize:'0.9rem', padding:'10px 20px', cursor: confirmName === orgName ? 'pointer' : 'default', fontWeight:600, transition:'background 0.15s' }}
          >
            <Trash2 size={14} style={{ marginRight:6, verticalAlign:'middle' }}/>
            Radera {orgName}
          </button>
          <button onClick={() => { setStep(0); setConfirmName('') }} className="btn btn-secondary">
            Avbryt
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ marginTop:40, paddingTop:24, borderTop:'1px solid var(--border)', color:'var(--ink-muted)', fontSize:'0.9rem' }}>
      Raderar förening…
    </div>
  )
}
