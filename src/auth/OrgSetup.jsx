import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { useAuth } from './AuthProvider'

const DEFAULT_CATEGORIES = [
  { id:'I01', name:'Medlemsavgifter',           type:'income' },
  { id:'I02', name:'Bidrag och gåvor',           type:'income' },
  { id:'I03', name:'Aktivitetsintäkter',         type:'income' },
  { id:'I04', name:'Försäljningsintäkter',       type:'income' },
  { id:'I05', name:'Sponsring',                  type:'income' },
  { id:'I06', name:'Ränteintäkter',              type:'income' },
  { id:'I07', name:'Övriga intäkter',            type:'income' },
  { id:'U01', name:'Lokalkostnader',             type:'expense' },
  { id:'U02', name:'Aktivitetskostnader',        type:'expense' },
  { id:'U03', name:'Administration',             type:'expense' },
  { id:'U04', name:'Marknadsföring',             type:'expense' },
  { id:'U05', name:'Utrustning och inventarier', type:'expense' },
  { id:'U06', name:'Löner och arvoden',          type:'expense' },
  { id:'U07', name:'Resor och transporter',      type:'expense' },
  { id:'U08', name:'Förbrukningsvaror',          type:'expense' },
  { id:'U09', name:'IT och kommunikation',       type:'expense' },
  { id:'U10', name:'Övriga kostnader',           type:'expense' },
]

export default function OrgSetup() {
  const { session, setOrgId, addOrg } = useAuth()
  const [name, setName]       = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [inviteOrgName, setInviteOrgName] = useState(null)

  const inviteCode = new URLSearchParams(window.location.search).get('invite')

  useEffect(() => {
    if (!inviteCode) return
    async function checkInvite() {
      const { data, error } = await supabase
        .from('org_invites')
        .select('org_id, expires_at, organizations(name)')
        .eq('code', inviteCode)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle()
      if (error || !data) {
        setError('Inbjudningslänken är ogiltig eller har gått ut.')
        return
      }
      setInviteOrgName(data.organizations?.name || 'föreningen')
    }
    checkInvite()
  }, [inviteCode])

  async function handleJoin() {
    setLoading(true)
    setError('')
    try {
      const { data: invite, error: invErr } = await supabase
        .from('org_invites')
        .select('org_id, invited_role')
        .eq('code', inviteCode)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle()
      if (invErr || !invite) throw new Error('Inbjudningslänken är ogiltig eller har gått ut.')

      const { error: memberErr } = await supabase.from('organization_members').insert({
        user_id: session.user.id,
        org_id:  invite.org_id,
        role:    invite.invited_role || 'member',
      })
      if (memberErr) throw memberErr

      // Clean up used invite
      await supabase.from('org_invites').delete().eq('code', inviteCode)

      // Remove invite param from URL without reload
      window.history.replaceState({}, '', window.location.pathname)

      addOrg(invite.org_id, invite.invited_role || 'member')
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
      // Generate ID client-side so we don't need to SELECT back the inserted row
      // (SELECT would fail RLS since the user isn't a member yet)
      const orgId = crypto.randomUUID()

      const { error: orgErr } = await supabase
        .from('organizations')
        .insert({ id: orgId, name: name.trim() })
      if (orgErr) throw orgErr

      const { error: memberErr } = await supabase.from('organization_members').insert({
        user_id: session.user.id,
        org_id:  orgId,
        role:    'main_owner',
      })
      if (memberErr) throw memberErr

      const year = new Date().getFullYear()

      await supabase.from('org_settings').insert({
        org_id:           orgId,
        active_period_id: String(year),
      })

      await supabase.from('categories').insert(
        DEFAULT_CATEGORIES.map(c => ({ ...c, org_id: orgId }))
      )

      await supabase.from('fiscal_periods').insert({
        id:         String(year),
        org_id:     orgId,
        label:      String(year),
        start_date: `${year}-01-01`,
        end_date:   `${year}-12-31`,
        locked:     false,
      })

      addOrg(orgId, 'main_owner')
    } catch (e) {
      setError(e.message)
      setLoading(false)
    }
  }

  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', fontFamily:'var(--font-body)', background:'var(--paper)' }}>
      <div style={{ width:400, background:'var(--paper-2)', borderRadius:'var(--r-lg)', border:'1px solid var(--border)', padding:32, boxShadow:'0 4px 24px rgba(0,0,0,0.08)' }}>

        {inviteCode ? (
          <>
            <h2 style={{ fontFamily:'var(--font-display)', fontStyle:'italic', fontSize:'1.5rem', marginBottom:8, color:'var(--ink)' }}>Du har blivit inbjuden</h2>
            {error ? (
              <div className="notice" style={{ background:'var(--red-soft)', borderColor:'#f5c6cb', color:'var(--red)', marginBottom:16 }}>{error}</div>
            ) : inviteOrgName ? (
              <p style={{ color:'var(--ink-muted)', fontSize:'0.85rem', marginBottom:24 }}>
                Klicka nedan för att gå med i <strong>{inviteOrgName}</strong>.
              </p>
            ) : (
              <p style={{ color:'var(--ink-muted)', fontSize:'0.85rem', marginBottom:24 }}>Kontrollerar inbjudan…</p>
            )}
            {!error && inviteOrgName && (
              <button className="btn btn-primary" onClick={handleJoin} disabled={loading} style={{ width:'100%' }}>
                {loading ? 'Ansluter…' : `Gå med i ${inviteOrgName}`}
              </button>
            )}
          </>
        ) : (
          <>
            <h2 style={{ fontFamily:'var(--font-display)', fontStyle:'italic', fontSize:'1.5rem', marginBottom:8, color:'var(--ink)' }}>Skapa förening</h2>
            <p style={{ color:'var(--ink-muted)', fontSize:'0.85rem', marginBottom:24 }}>
              Välkommen! Ange din förenings namn för att komma igång. Standardkategorier och innevarande räkenskapsår skapas automatiskt.
            </p>
            {error && (
              <div className="notice" style={{ background:'var(--red-soft)', borderColor:'#f5c6cb', color:'var(--red)', marginBottom:16 }}>
                {error}
              </div>
            )}
            <form onSubmit={handleCreate}>
              <div className="form-row">
                <div>
                  <label>Föreningens namn</label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="t.ex. Rädda Katten IF"
                    required
                    autoFocus
                  />
                </div>
              </div>
              <button className="btn btn-primary" type="submit" disabled={loading || !name.trim()} style={{ width:'100%', marginTop:8 }}>
                {loading ? 'Skapar…' : 'Kom igång'}
              </button>
            </form>
          </>
        )}

        <div style={{ marginTop:16, textAlign:'right' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => supabase.auth.signOut()}>
            Logga ut
          </button>
        </div>
      </div>
    </div>
  )
}
