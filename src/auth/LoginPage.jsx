import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { demoCredentials } from '../demo'
import { useI18n } from '../i18n'
import LanguageSwitch from '../components/LanguageSwitch'

export default function LoginPage() {
  const { t } = useI18n()
  const [mode, setMode]         = useState('login') // 'login' | 'register' | 'reset'
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [success, setSuccess]   = useState('')
  const [inviteOrg, setInviteOrg] = useState(null) // org name from invite in URL

  const inviteCode = new URLSearchParams(window.location.search).get('invite')

  useEffect(() => {
    if (!inviteCode) return
    supabase.rpc('validate_invite', { p_code: inviteCode }).then(({ data }) => {
      if (data && !data.error) setInviteOrg(data.org_name)
    })
  }, [inviteCode])

  function switchMode(m) { setMode(m); setError(''); setSuccess('') }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword(demoCredentials(email, password) || { email, password })
      if (error) setError(error.message)
    } else if (mode === 'register') {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) setError(error.message)
      else setSuccess(t('Konto skapat! Kontrollera din e-post för att verifiera kontot.'))
    } else if (mode === 'reset') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      })
      if (error) setError(error.message)
      else setSuccess(t('En återställningslänk har skickats till din e-postadress.'))
    }
    setLoading(false)
  }

  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', fontFamily:'var(--font-body)', background:'var(--paper)', position:'relative' }}>
      <LanguageSwitch style={{ position:'absolute', top:16, right:16 }} />
      <div style={{ width:380, background:'var(--paper-2)', borderRadius:'var(--r-lg)', border:'1px solid var(--border)', padding:32, boxShadow:'0 4px 24px rgba(0,0,0,0.08)' }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontStyle:'italic', fontSize:'1.8rem', marginBottom:4, color:'var(--ink)', display:'flex', alignItems:'center', gap:10 }}><img src="/favicon.svg" alt="" width="34" height="34" />Föreningsbalans</h1>
        <p style={{ color:'var(--ink-muted)', fontSize:'0.85rem', marginBottom: inviteOrg ? 16 : 24 }}>{t('Bokföring för ideell förening')}</p>

        {inviteOrg && (
          <div style={{ background:'var(--green-soft)', border:'1px solid var(--green)', borderRadius:'var(--r)', padding:'10px 14px', marginBottom:20, fontSize:'0.85rem', color:'var(--ink)' }}>
            {t('Du är inbjuden att gå med i')} <strong>{inviteOrg}</strong> – {t('logga in eller registrera dig för att fortsätta.')}
          </div>
        )}

        {mode !== 'reset' && (
          <div style={{ display:'flex', gap:8, marginBottom:24 }}>
            <button className={`btn ${mode==='login'?'btn-primary':'btn-secondary'}`} style={{ flex:1 }} onClick={() => switchMode('login')}>{t('Logga in')}</button>
            <button className={`btn ${mode==='register'?'btn-primary':'btn-secondary'}`} style={{ flex:1 }} onClick={() => switchMode('register')}>{t('Registrera')}</button>
          </div>
        )}

        {mode === 'reset' && (
          <div style={{ marginBottom:20 }}>
            <div style={{ fontWeight:600, fontSize:'1rem', color:'var(--ink)', marginBottom:4 }}>{t('Glömt lösenord')}</div>
            <div style={{ fontSize:'0.83rem', color:'var(--ink-muted)' }}>{t('Ange din e-postadress så skickar vi en återställningslänk.')}</div>
          </div>
        )}

        {success ? (
          <div>
            <div className="notice notice-success">{success}</div>
            <button className="btn btn-secondary" style={{ width:'100%', marginTop:16 }} onClick={() => switchMode('login')}>
              {t('Tillbaka till inloggning')}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && (
              <div className="notice" style={{ background:'var(--red-soft)', borderColor:'#f5c6cb', color:'var(--red)', marginBottom:16 }}>
                {error}
              </div>
            )}
            <div className="form-row">
              <div>
                <label>{t('E-postadress')}</label>
                <input type="text" inputMode="email" autoComplete="username" autoCapitalize="none" value={email} onChange={e => setEmail(e.target.value)} required autoFocus placeholder={t('din@epost.se')} />
              </div>
            </div>
            {mode !== 'reset' && (
              <div className="form-row">
                <div>
                  <label>{t('Lösenord')}</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={mode === 'register' ? 6 : undefined} placeholder={mode === 'register' ? t('Minst 6 tecken') : t('Lösenord')} />
                </div>
              </div>
            )}
            <button className="btn btn-primary" type="submit" disabled={loading} style={{ width:'100%', marginTop:8 }}>
              {loading ? t('Väntar…') : mode === 'login' ? t('Logga in') : mode === 'register' ? t('Skapa konto') : t('Skicka återställningslänk')}
            </button>
            {mode === 'login' && (
              <div style={{ marginTop:20, paddingTop:16, borderTop:'1px solid var(--border)', textAlign:'center' }}>
                <div style={{ fontSize:'0.8rem', color:'var(--ink-muted)', marginBottom:8 }}>
                  {t('Vill du bara titta runt? Användarnamn')} <strong>demo</strong>, {t('lösenord')} <strong>demo</strong>.
                </div>
                <button type="button" className="btn btn-secondary btn-sm" disabled={loading}
                  onClick={() => { setEmail('demo'); setPassword('demo'); setError(''); setLoading(true);
                    supabase.auth.signInWithPassword(demoCredentials('demo', 'demo')).then(({ error }) => { if (error) setError(error.message); setLoading(false) }) }}>
                  {t('Prova demon')}
                </button>
              </div>
            )}
            {mode === 'login' && (
              <div style={{ textAlign:'center', marginTop:12 }}>
                <button type="button" onClick={() => switchMode('reset')} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--ink-muted)', fontSize:'0.8rem', textDecoration:'underline' }}>
                  {t('Glömt lösenordet?')}
                </button>
              </div>
            )}
            {mode === 'reset' && (
              <div style={{ textAlign:'center', marginTop:12 }}>
                <button type="button" onClick={() => switchMode('login')} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--ink-muted)', fontSize:'0.8rem', textDecoration:'underline' }}>
                  {t('Tillbaka till inloggning')}
                </button>
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  )
}
