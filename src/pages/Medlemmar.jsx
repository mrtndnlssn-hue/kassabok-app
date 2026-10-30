import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../auth/AuthProvider'
import { Copy, Check, Trash2, ArrowRightLeft } from 'lucide-react'

const ROLE_LABEL = {
  main_owner: 'Huvudägare',
  owner:      'Ägare',
  member:     'Medlem',
  viewer:     'Läsare',
}

const ROLE_STYLE = {
  main_owner: { background: 'var(--amber-soft, #fef3c7)', color: 'var(--amber, #b45309)', border: '1px solid #fcd34d' },
  owner:      { background: 'var(--green-soft)', color: 'var(--green)', border: '1px solid var(--border)' },
  member:     { background: 'var(--blue-soft, #e8f0fe)', color: 'var(--blue, #1a73e8)', border: '1px solid var(--border)' },
  viewer:     { background: 'var(--paper-2)', color: 'var(--ink-muted)', border: '1px solid var(--border)' },
}

function RoleBadge({ role }) {
  return (
    <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:999, fontSize:'0.75rem', fontWeight:600, ...ROLE_STYLE[role] }}>
      {ROLE_LABEL[role] || role}
    </span>
  )
}

export default function Medlemmar({ orgId, orgName }) {
  const { session, role: myRole } = useAuth()
  const isMainOwner = myRole === 'main_owner'
  const canManage   = myRole === 'main_owner' || myRole === 'owner'

  const [members, setMembers] = useState([])
  const [invites, setInvites] = useState([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied]   = useState(false)
  const [error, setError]     = useState('')
  const [newRole, setNewRole]     = useState('member')
  const [transferTo, setTransferTo] = useState(null)
  const [newestCode, setNewestCode] = useState(null) // code of most recently created invite

  async function fetchAll() {
    setLoading(true)
    setError('')
    try {
      const [membersRes, invitesRes] = await Promise.all([
        supabase.rpc('get_org_members_with_email', { p_org_id: orgId }),
        supabase
          .from('org_invites')
          .select('code, invited_role, expires_at, created_at')
          .eq('org_id', orgId)
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false }),
      ])
      if (membersRes.error) throw membersRes.error
      if (invitesRes.error) throw invitesRes.error

      setMembers((membersRes.data || []).map(m => ({
        userId: m.user_id,
        role:   m.role,
        email:  m.email,
        isMe:   m.user_id === session.user.id,
      })))
      setInvites(invitesRes.data || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchAll() }, [orgId])

  async function changeRole(userId, newRole) {
    // Prevent demoting the last main_owner
    if (members.find(m => m.userId === userId)?.role === 'main_owner') {
      setError('Använd "Lämna över" för att byta huvudägare.')
      return
    }
    // Prevent assigning main_owner via dropdown (use transfer instead)
    if (newRole === 'main_owner') {
      setError('Använd "Lämna över"-knappen för att utse ny huvudägare.')
      return
    }
    const { error } = await supabase
      .from('organization_members')
      .update({ role: newRole })
      .eq('org_id', orgId)
      .eq('user_id', userId)
    if (error) { setError(error.message); return }
    setMembers(prev => prev.map(m => m.userId === userId ? { ...m, role: newRole } : m))
  }

  async function transferMainOwner(toUserId) {
    setError('')
    // Step 1: demote current main_owner to owner
    const { error: e1 } = await supabase
      .from('organization_members')
      .update({ role: 'owner' })
      .eq('org_id', orgId)
      .eq('user_id', session.user.id)
    if (e1) { setError(e1.message); return }

    // Step 2: promote target to main_owner
    const { error: e2 } = await supabase
      .from('organization_members')
      .update({ role: 'main_owner' })
      .eq('org_id', orgId)
      .eq('user_id', toUserId)
    if (e2) {
      // Rollback
      await supabase.from('organization_members').update({ role: 'main_owner' }).eq('org_id', orgId).eq('user_id', session.user.id)
      setError(e2.message)
      return
    }
    setTransferTo(null)
    await fetchAll()
  }

  async function removeMember(userId) {
    const m = members.find(m => m.userId === userId)
    if (m?.role === 'main_owner') {
      setError('Huvudägaren kan inte tas bort. Lämna över rollen först.')
      return
    }
    if (!window.confirm(`Ta bort ${m?.email || 'användaren'}s åtkomst till föreningen?`)) return
    const { error } = await supabase
      .from('organization_members')
      .delete()
      .eq('org_id', orgId)
      .eq('user_id', userId)
    if (error) { setError(error.message); return }
    setMembers(prev => prev.filter(m => m.userId !== userId))
  }

  async function createInvite() {
    setError('')
    const { data, error } = await supabase
      .from('org_invites')
      .insert({ org_id: orgId, created_by: session.user.id, invited_role: newRole })
      .select('code')
      .single()
    if (error) { setError(error.message); return }
    if (data?.code) setNewestCode(data.code)
    await fetchAll()
  }

  async function deleteInvite(code) {
    await supabase.from('org_invites').delete().eq('code', code)
    setInvites(prev => prev.filter(i => i.code !== code))
  }

  function inviteUrl(code) {
    return `${window.location.origin}/?invite=${code}`
  }

  async function copyLink(code) {
    await navigator.clipboard.writeText(inviteUrl(code))
    setCopied(code)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) return <p style={{ color: 'var(--ink-muted)', padding: 8 }}>Laddar…</p>

  const otherMembers = members.filter(m => !m.isMe && m.role !== 'main_owner')

  return (
    <div style={{ maxWidth: 640 }}>
      {error && (
        <div className="notice" style={{ background: 'var(--red-soft)', borderColor: '#f5c6cb', color: 'var(--red)', marginBottom: 16 }}>
          {error} <button onClick={() => setError('')} style={{ marginLeft:8, background:'none', border:'none', cursor:'pointer', fontWeight:700 }}>×</button>
        </div>
      )}

      {/* Transfer confirmation */}
      {transferTo && (
        <div className="notice" style={{ background: 'var(--amber-soft, #fef3c7)', borderColor: '#fcd34d', color: 'var(--amber, #b45309)', marginBottom: 16 }}>
          <strong>Lämna över huvudägarrollen?</strong><br/>
          <span style={{ fontSize:'0.85rem' }}>
            {members.find(m => m.userId === transferTo)?.email} blir ny huvudägare. Du blir vanlig ägare och kan inte längre byta föreningsnamn.
          </span>
          <div style={{ display:'flex', gap:8, marginTop:10 }}>
            <button className="btn btn-primary btn-sm" onClick={() => transferMainOwner(transferTo)}>Bekräfta</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setTransferTo(null)}>Avbryt</button>
          </div>
        </div>
      )}

      {/* Members */}
      <section style={{ marginBottom: 32 }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: '1.1rem', marginBottom: 12, color: 'var(--ink)' }}>
          Medlemmar ({members.length})
        </h3>
        <table className="data-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>E-post</th>
              <th>Roll</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {[...members].sort((a, b) => {
              const order = { main_owner: 0, owner: 1, member: 2, viewer: 3 }
              return (order[a.role] ?? 9) - (order[b.role] ?? 9)
            }).map(m => (
              <tr key={m.userId}>
                <td style={{ fontSize: '0.85rem' }}>
                  {m.email}
                  {m.isMe && <span style={{ marginLeft:6, fontSize:'0.72rem', color:'var(--ink-muted)', background:'var(--paper-2)', padding:'1px 6px', borderRadius:99, border:'1px solid var(--border)' }}>du</span>}
                </td>
                <td>
                  {m.isMe || m.role === 'main_owner' || !canManage ? (
                    <RoleBadge role={m.role} />
                  ) : (
                    <select
                      value={m.role}
                      onChange={e => changeRole(m.userId, e.target.value)}
                      style={{ fontSize: '0.8rem', padding: '3px 6px', borderRadius: 'var(--r)', border: '1px solid var(--border)', background: 'var(--paper-2)', color: 'var(--ink)', cursor: 'pointer' }}
                    >
                      <option value="owner">Ägare</option>
                      <option value="member">Medlem</option>
                      <option value="viewer">Läsare</option>
                    </select>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <div style={{ display:'flex', gap:4, justifyContent:'flex-end' }}>
                    {isMainOwner && !m.isMe && m.role !== 'main_owner' && (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setTransferTo(m.userId)}
                        title="Lämna över huvudägarrollen"
                        style={{ fontSize:'0.72rem', gap:4 }}
                      >
                        <ArrowRightLeft size={12}/> Lämna över
                      </button>
                    )}
                    {canManage && !m.isMe && m.role !== 'main_owner' && (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => removeMember(m.userId)}
                        title="Ta bort åtkomst"
                        style={{ color: 'var(--red)', borderColor: 'var(--red)' }}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Invites */}
      {canManage && (
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: '1.1rem', color: 'var(--ink)', margin: 0 }}>
              Inbjudningslänkar
            </h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select
                value={newRole}
                onChange={e => setNewRole(e.target.value)}
                style={{ fontSize: '0.82rem', padding: '4px 8px', borderRadius: 'var(--r)', border: '1px solid var(--border)', background: 'var(--paper-2)', color: 'var(--ink)', cursor: 'pointer' }}
              >
                <option value="member">Medlem</option>
                <option value="viewer">Läsare (skrivskyddad)</option>
                <option value="owner">Ägare</option>
              </select>
              <button className="btn btn-primary btn-sm" onClick={createInvite}>
                + Ny inbjudan
              </button>
            </div>
          </div>

          {invites.length === 0 ? (
            <p style={{ color: 'var(--ink-muted)', fontSize: '0.85rem' }}>
              Inga aktiva inbjudningslänkar.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {invites.map(inv => (
                <div key={inv.code} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: 'var(--paper-2)', border: '1px solid var(--border)',
                  borderRadius: 'var(--r)', padding: '10px 12px',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--ink)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {inviteUrl(inv.code)}
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:6, fontSize: '0.72rem', color: 'var(--ink-muted)' }}>
                      {ROLE_LABEL[inv.invited_role] || inv.invited_role}
                      · Skapad {new Date(inv.created_at).toLocaleString('sv-SE', { dateStyle:'short', timeStyle:'short' })}
                      · Går ut {new Date(inv.expires_at).toLocaleDateString('sv-SE')}
                      {inv.code === newestCode && (
                        <span style={{ background:'var(--green)', color:'#fff', fontSize:'0.65rem', fontWeight:700, padding:'1px 6px', borderRadius:99 }}>Ny</span>
                      )}
                    </div>
                  </div>
                  <button className="btn btn-secondary btn-sm" onClick={() => copyLink(inv.code)} title="Kopiera länk">
                    {copied === inv.code ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => deleteInvite(inv.code)} title="Radera inbjudan"
                    style={{ color: 'var(--red)', borderColor: 'var(--red)' }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <p style={{ marginTop: 12, fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
            Länken är giltig i 7 dagar.
          </p>
        </section>
      )}

    </div>
  )
}
