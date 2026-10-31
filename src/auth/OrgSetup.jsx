import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { useAuth } from './AuthProvider'
import { useI18n, LANGUAGES } from '../i18n'
import LanguageSwitch from '../components/LanguageSwitch'

export default function OrgSetup() {
  const { t, lang, setLang } = useI18n()
  const { session, setOrgId, addOrg } = useAuth()
  const [name, setName]       = useState('')
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
      // Allt skapas atomärt i databasen: förening, huvudägare, standardkategorier och innevarande år
      const { data: orgId, error: createErr } = await supabase.rpc('create_organization', { p_name: name.trim(), p_lang: lang })
      if (createErr) throw createErr

      addOrg(orgId, 'main_owner')
    } catch (e) {
      setError(e.message)
      setLoading(false)
    }
  }

  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', fontFamily:'var(--font-body)', background:'var(--paper)', position:'relative' }}>
      <LanguageSwitch style={{ position:'absolute', top:16, right:16 }} />
      <div style={{ width:400, background:'var(--paper-2)', borderRadius:'var(--r-lg)', border:'1px solid var(--border)', padding:32, boxShadow:'0 4px 24px rgba(0,0,0,0.08)' }}>

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

        <div style={{ marginTop:16, textAlign:'right' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => supabase.auth.signOut()}>
            {t('Logga ut')}
          </button>
        </div>
      </div>
    </div>
  )
}
