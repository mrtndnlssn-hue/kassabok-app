import { useState } from 'react'
import { supabase } from '../supabase'
import { useAuth } from './AuthProvider'
import { useI18n } from '../i18n'
import LanguageSwitch from '../components/LanguageSwitch'

export default function SetNewPassword() {
  const { t } = useI18n()
  const { setRecoveryMode } = useAuth()
  const [password, setPassword]   = useState('')
  const [password2, setPassword2] = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [done, setDone]           = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (password !== password2) { setError(t('Lösenorden matchar inte.')); return }
    setLoading(true); setError('')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    setDone(true)
    setTimeout(() => setRecoveryMode(false), 2000)
  }

  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', fontFamily:'var(--font-body)', background:'var(--paper)', position:'relative' }}>
      <LanguageSwitch style={{ position:'absolute', top:16, right:16 }} />
      <div style={{ width:380, background:'var(--paper-2)', borderRadius:'var(--r-lg)', border:'1px solid var(--border)', padding:32, boxShadow:'0 4px 24px rgba(0,0,0,0.08)' }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontStyle:'italic', fontSize:'1.8rem', marginBottom:4, color:'var(--ink)', display:'flex', alignItems:'center', gap:10 }}><a href="https://foreningsbalans.se" title={t('Till startsidan')} style={{ display:'flex', alignItems:'center', gap:10, color:'inherit', textDecoration:'none' }}><img src="/favicon.svg" alt="" width="34" height="34" />Föreningsbalans</a></h1>
        <p style={{ color:'var(--ink-muted)', fontSize:'0.85rem', marginBottom:24 }}>{t('Välj ett nytt lösenord')}</p>

        {done ? (
          <div className="notice notice-success">{t('Lösenordet har uppdaterats! Du loggas in…')}</div>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && (
              <div className="notice" style={{ background:'var(--red-soft)', borderColor:'#f5c6cb', color:'var(--red)', marginBottom:16 }}>{error}</div>
            )}
            <div className="form-row">
              <div>
                <label>{t('Nytt lösenord')}</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} placeholder={t('Minst 6 tecken')} autoFocus />
              </div>
            </div>
            <div className="form-row">
              <div>
                <label>{t('Upprepa lösenord')}</label>
                <input type="password" value={password2} onChange={e => setPassword2(e.target.value)} required minLength={6} placeholder={t('Samma lösenord igen')} />
              </div>
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading} style={{ width:'100%', marginTop:8 }}>
              {loading ? t('Sparar…') : t('Spara nytt lösenord')}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
