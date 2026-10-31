import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { useAuth } from './AuthProvider'
import { LogOut, Plus, ArrowRight } from 'lucide-react'
import { useI18n } from '../i18n'
import LanguageSwitch from '../components/LanguageSwitch'

const ROLE_LABEL = {
  main_owner: 'Huvudägare',
  owner:      'Ägare',
  member:     'Medlem',
  viewer:     'Läsare',
}

const ROLE_STYLE = {
  main_owner: { background: '#fef3c7', color: '#b45309' },
  owner:      { background: 'var(--green-soft)', color: 'var(--green)' },
  member:     { background: '#e8f0fe', color: '#1a73e8' },
  viewer:     { background: 'var(--paper-2)', color: 'var(--ink-muted)' },
}

export default function OrgPicker({ onCreateNew, onPick }) {
  const { t } = useI18n()
  const { orgs } = useAuth()
  const [orgNames, setOrgNames] = useState({})
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    if (!orgs.length) { setLoading(false); return }
    supabase
      .from('organizations')
      .select('id, name')
      .in('id', orgs.map(o => o.orgId))
      .then(({ data }) => {
        if (data) setOrgNames(Object.fromEntries(data.map(r => [r.id, r.name])))
        setLoading(false)
      })
  }, [orgs])

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', fontFamily:'var(--font-body)', color:'var(--ink-muted)' }}>
      {t('Laddar…')}
    </div>
  )

  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', fontFamily:'var(--font-body)', background:'var(--paper)', padding:24, position:'relative' }}>
      <LanguageSwitch style={{ position:'absolute', top:16, right:16 }} />
      <div style={{ width:'100%', maxWidth:440 }}>
        {/* Header */}
        <div style={{ marginBottom:32, textAlign:'center' }}>
          <h1 style={{ fontFamily:'var(--font-display)', fontStyle:'italic', fontSize:'2rem', color:'var(--ink)', marginBottom:4, display:'flex', alignItems:'center', gap:10 }}><img src="/favicon.svg" alt="" width="38" height="38" />Föreningsbalans</h1>
          <p style={{ color:'var(--ink-muted)', fontSize:'0.9rem' }}>{t('Välj en förening eller skapa ny')}</p>
        </div>

        {/* Org list */}
        <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:16 }}>
          {[...orgs].sort((a, b) => {
            const order = { main_owner:0, owner:1, member:2, viewer:3 }
            return (order[a.role]??9) - (order[b.role]??9)
          }).map(o => (
            <button
              key={o.orgId}
              onClick={() => onPick(o.orgId)}
              style={{
                display:'flex', alignItems:'center', justifyContent:'space-between',
                background:'var(--paper-2)', border:'1px solid var(--border)',
                borderRadius:'var(--r-lg)', padding:'16px 20px',
                cursor:'pointer', textAlign:'left', transition:'box-shadow 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.08)'}
              onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
            >
              <div>
                <div style={{ fontWeight:600, fontSize:'1rem', color:'var(--ink)', marginBottom:4 }}>
                  {orgNames[o.orgId] || '…'}
                </div>
                <span style={{
                  display:'inline-block', padding:'2px 8px', borderRadius:999,
                  fontSize:'0.72rem', fontWeight:600,
                  ...ROLE_STYLE[o.role],
                }}>
                  {ROLE_LABEL[o.role] ? t(ROLE_LABEL[o.role]) : o.role}
                </span>
              </div>
              <ArrowRight size={18} style={{ color:'var(--ink-muted)', flexShrink:0 }}/>
            </button>
          ))}
        </div>

        {/* Create new */}
        <button
          onClick={onCreateNew}
          className="btn btn-secondary"
          style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:8, padding:'12px', fontSize:'0.9rem' }}
        >
          <Plus size={16}/> {t('Skapa ny förening')}
        </button>

        {/* Sign out */}
        <div style={{ marginTop:24, textAlign:'center' }}>
          <button
            onClick={() => supabase.auth.signOut()}
            style={{ background:'none', border:'none', cursor:'pointer', color:'var(--ink-muted)', fontSize:'0.8rem', display:'inline-flex', alignItems:'center', gap:6 }}
          >
            <LogOut size={13}/> {t('Logga ut')}
          </button>
        </div>
      </div>
    </div>
  )
}
