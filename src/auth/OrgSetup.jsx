import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { useAuth } from './AuthProvider'
import { useI18n, LANGUAGES } from '../i18n'
import LanguageSwitch from '../components/LanguageSwitch'
import { ORG_TEMPLATES, templateById, templateCategories } from '../orgTemplates'

export default function OrgSetup({ onDone, onCancel }) {
  const { t, lang, setLang } = useI18n()
  const { session, setOrgId, addOrg } = useAuth()
  const [name, setName]       = useState('')
  const [orgType, setOrgType] = useState('allman')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [inviteOrgName, setInviteOrgName] = useState(null)

  const inviteCode = new URLSearchParams(window.location.search).get('invite')

  useEffect(() => {
    if (!inviteCode) return
    async function checkInvite() {
      const { data, error } = await supabase.rpc('validate_invite', { p_code: inviteCode })
      if (error || data?.error) {
        setError(t(data?.error || 'Inbjudningslänken är ogiltig eller har gått ut.'))
        return
      }
      setInviteOrgName(data.org_name || t('föreningen'))
    }
    checkInvite()
  }, [inviteCode])

  async function handleJoin() {
    setLoading(true)
    setError('')
    try {
      // Atomic: validates + inserts member + deletes invite in one DB transaction
      const { data, error } = await supabase.rpc('claim_invite', { p_code: inviteCode })
      if (error) throw error
      if (data?.error) throw new Error(t(data.error))

      window.history.replaceState({}, '', window.location.pathname)
      addOrg(data.org_id, data.role)
      onDone?.()
    } catch (e) {
      setError(e.message)
      setLoading(false)
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      // Allt skapas atomärt i databasen: förening, huvudägare, kategorier enligt vald föreningstyp och innevarande år
      const { data: orgId, error: createErr } = await supabase.rpc('create_organization', {
        p_name: name.trim(), p_lang: lang, p_type: orgType, p_categories: templateCategories(orgType, lang),
      })
      if (createErr) throw createErr

      addOrg(orgId, 'main_owner')
      onDone?.()
    } catch (e) {
      setError(e.message)
      setLoading(false)
    }
  }

  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', padding:'48px 16px', boxSizing:'border-box', fontFamily:'var(--font-body)', background:'var(--paper)', position:'relative' }}>
      <LanguageSwitch style={{ position:'absolute', top:16, right:16 }} />
      <div style={{ width:'100%', maxWidth:460, background:'var(--paper-2)', borderRadius:'var(--r-lg)', border:'1px solid var(--border)', padding:32, boxShadow:'0 4px 24px rgba(0,0,0,0.08)' }}>

        {inviteCode ? (
          <>
            <h2 style={{ fontFamily:'var(--font-display)', fontStyle:'italic', fontSize:'1.5rem', marginBottom:8, color:'var(--ink)' }}>{t('Du har blivit inbjuden')}</h2>
            {error ? (
              <div className="notice" style={{ background:'var(--red-soft)', borderColor:'#f5c6cb', color:'var(--red)', marginBottom:16 }}>{error}</div>
            ) : inviteOrgName ? (
              <p style={{ color:'var(--ink-muted)', fontSize:'0.85rem', marginBottom:24 }}>
                {t('Klicka nedan för att gå med i')} <strong>{inviteOrgName}</strong>.
              </p>
            ) : (
              <p style={{ color:'var(--ink-muted)', fontSize:'0.85rem', marginBottom:24 }}>{t('Kontrollerar inbjudan…')}</p>
            )}
            {!error && inviteOrgName && (
              <button className="btn btn-primary" onClick={handleJoin} disabled={loading} style={{ width:'100%' }}>
                {loading ? t('Ansluter…') : t('Gå med i {name}', { name: inviteOrgName })}
              </button>
            )}
          </>
        ) : (
          <>
            <h2 style={{ fontFamily:'var(--font-display)', fontStyle:'italic', fontSize:'1.5rem', marginBottom:8, color:'var(--ink)' }}>{t('Skapa förening')}</h2>
            <p style={{ color:'var(--ink-muted)', fontSize:'0.85rem', marginBottom:24 }}>
              {t('Välkommen! Ange din förenings namn för att komma igång. Standardkategorier och innevarande räkenskapsår skapas automatiskt.')}
            </p>
            {error && (
              <div className="notice" style={{ background:'var(--red-soft)', borderColor:'#f5c6cb', color:'var(--red)', marginBottom:16 }}>
                {error}
              </div>
            )}
            <form onSubmit={handleCreate}>
              <div className="form-row">
                <div>
                  <label>{t('Föreningens namn')}</label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder={t('t.ex. Rädda Katten IF')}
                    required
                    autoFocus
                  />
                </div>
              </div>
              <div className="form-row">
                <div>
                  <label>{t('Typ av förening')}</label>
                  <select value={orgType} onChange={e => setOrgType(e.target.value)}>
                    {ORG_TEMPLATES.map(o => <option key={o.id} value={o.id}>{o.label[lang]}</option>)}
                  </select>
                  <div style={{ fontSize:'0.75rem', color:'var(--ink-muted)', marginTop:4 }}>{templateById(orgType).desc[lang]}</div>
                  <details style={{ marginTop:8 }}>
                    <summary style={{ cursor:'pointer', fontSize:'0.8rem', color:'var(--accent)' }}>{t('Visa föreslagna kategorier ({n})', { n: templateById(orgType).categories.length })}</summary>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginTop:8, fontSize:'0.75rem', color:'var(--ink-soft)' }}>
                      {['income', 'expense'].map(type => (
                        <div key={type}>
                          <div style={{ fontWeight:600, marginBottom:4 }}>{type === 'income' ? t('Intäkter') : t('Kostnader')}</div>
                          {templateCategories(orgType, lang).filter(c => c.type === type).map(c => (
                            <div key={c.id}><span className="mono" style={{ color:'var(--ink-muted)' }}>{c.id}</span> {c.name}</div>
                          ))}
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize:'0.72rem', color:'var(--ink-muted)', marginTop:8 }}>{t('Du kan ändra, lägga till och ta bort kategorier när som helst.')}</div>
                  </details>
                </div>
              </div>
              <div className="form-row">
                <div>
                  <label>{t('Språk')}</label>
                  <select value={lang} onChange={e => setLang(e.target.value)}>
                    {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                  </select>
                  <div style={{ fontSize:'0.75rem', color:'var(--ink-muted)', marginTop:4 }}>{t('Styr appens språk och namnen på standardkategorierna. Du kan byta språk senare, och döpa om kategorierna.')}</div>
                </div>
              </div>
              <button className="btn btn-primary" type="submit" disabled={loading || !name.trim()} style={{ width:'100%', marginTop:8 }}>
                {loading ? t('Skapar…') : t('Kom igång')}
              </button>
            </form>
          </>
        )}

        <div style={{ marginTop:16, display:'flex', justifyContent:'flex-end', gap:8 }}>
          {onCancel && <button className="btn btn-secondary btn-sm" onClick={onCancel}>{t('Avbryt')}</button>}
          <button className="btn btn-secondary btn-sm" onClick={() => supabase.auth.signOut()}>
            {t('Logga ut')}
          </button>
        </div>
      </div>
    </div>
  )
}
