import { useState } from 'react'
import { supabase } from '../supabase'

export default function LoginPage() {
  const [mode, setMode]       = useState('login')
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
    } else {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) setError(error.message)
      else setSuccess('Konto skapat! Kontrollera din e-post för att verifiera kontot.')
    }
    setLoading(false)
  }

  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', fontFamily:'var(--font-body)', background:'var(--paper)' }}>
      <div style={{ width:380, background:'var(--paper-2)', borderRadius:'var(--r-lg)', border:'1px solid var(--border)', padding:32, boxShadow:'0 4px 24px rgba(0,0,0,0.08)' }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontStyle:'italic', fontSize:'1.8rem', marginBottom:4, color:'var(--ink)' }}>Kassabok</h1>
        <p style={{ color:'var(--ink-muted)', fontSize:'0.85rem', marginBottom:24 }}>Bokföring för ideell förening</p>

        <div style={{ display:'flex', gap:8, marginBottom:24 }}>
          <button className={`btn ${mode==='login'?'btn-primary':'btn-secondary'}`} style={{ flex:1 }} onClick={() => { setMode('login'); setError(''); setSuccess(''); }}>Logga in</button>
          <button className={`btn ${mode==='register'?'btn-primary':'btn-secondary'}`} style={{ flex:1 }} onClick={() => { setMode('register'); setError(''); setSuccess(''); }}>Registrera</button>
        </div>

        {success ? (
          <div className="notice notice-success">{success}</div>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && (
              <div className="notice" style={{ background:'var(--red-soft)', borderColor:'#f5c6cb', color:'var(--red)', marginBottom:16 }}>
                {error}
              </div>
            )}
            <div className="form-row">
              <div>
                <label>E-postadress</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus placeholder="din@epost.se" />
              </div>
            </div>
            <div className="form-row">
              <div>
                <label>Lösenord</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} placeholder="Minst 6 tecken" />
              </div>
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading} style={{ width:'100%', marginTop:8 }}>
              {loading ? 'Väntar…' : mode === 'login' ? 'Logga in' : 'Skapa konto'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
