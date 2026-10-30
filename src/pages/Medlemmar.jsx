import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../auth/AuthProvider'
import { Copy, Check, Trash2 } from 'lucide-react'

export default function Medlemmar({ orgId }) {
  const { session } = useAuth()
  const [members, setMembers]   = useState([])
  const [invites, setInvites]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [copied, setCopied]     = useState(false)
  const [error, setError]       = useState('')
  const [newRole, setNewRole]   = useState('member')

  async function fetchAll() {
    setLoading(true)
    setError('')
    try {
      const [membersRes, invitesRes] = await Promise.all([
        supabase
          .from('organization_members')
          .select('user_id, role')
          .eq('org_id', orgId),
        supabase
          .from('org_invites')
          .select('code, invited_role, expires_at, created_at')
          .eq('org_id', orgId)
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false }),
      ])
      if (membersRes.error) throw membersRes.error
      if (invitesRes.error) throw invitesRes.error

      // Fetch email for each member via RPC or use user_id display
      const memberList = (membersRes.data || []).map(m => ({
        userId: m.user_id,
        role:   m.role,
        isMe:   m.user_id === session.user.id,
      }))
      setMembers(memberList)
      setInvites(invitesRes.data || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchAll() }, [orgId])

  async function createInvite() {
    setError('')
    const { error } = await supabase
      .from('org_invites')
      .insert({ org_id: orgId, created_by: session.user.id, invited_role: newRole })
    if (error) { setError(error.message); return }
    await fetchAll()
  }

  async function deleteInvite(code) {
    await supabase.from('org_invites').delete().eq('code', code)
    setInvites(prev => prev.filter(i => i.code !== code))
  }

  async function changeRole(userId, newRole) {
    const { error } = await supabase
      .from('organization_members')
      .update({ role: newRole })
      .eq('org_id', orgId)
      .eq('user_id', userId)
    if (error) { setError(error.message); return }
    setMembers(prev => prev.map(m => m.userId === userId ? { ...m, role: newRole } : m))
  }

  async function removeMember(userId) {
    if (!window.confirm('Ta bort denna användares åtkomst till föreningen?')) return
    const { error } = await supabase
      .from('organization_members')
      .delete()
      .eq('org_id', orgId)
      .eq('user_id', userId)
    if (error) { setError(error.message); return }
    setMembers(prev => prev.filter(m => m.userId !== userId))
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

  return (
    <div style={{ maxWidth: 600 }}>
      {error && (
        <div className="notice" style={{ background: 'var(--red-soft)', borderColor: '#f5c6cb', color: 'var(--red)', marginBottom: 16 }}>
          {error}
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
              <th>Användar-ID</th>
              <th>Roll</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {members.map(m => (
              <tr key={m.userId}>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
                  {m.userId.slice(0, 8)}…{m.isMe ? ' (du)' : ''}
                </td>
                <td>
                  {m.isMe ? (
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 999,
                      fontSize: '0.75rem', fontWeight: 600, border: '1px solid var(--border)',
                      background: m.role === 'owner' ? 'var(--green-soft)' : m.role === 'viewer' ? 'var(--paper-2)' : 'var(--blue-soft, #e8f0fe)',
                      color: m.role === 'owner' ? 'var(--green)' : m.role === 'viewer' ? 'var(--ink-muted)' : 'var(--blue, #1a73e8)',
                    }}>
                      {m.role === 'owner' ? 'Ägare' : m.role === 'viewer' ? 'Läsare' : 'Medlem'}
                    </span>
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
                  {!m.isMe && (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => removeMember(m.userId)}
                      title="Ta bort åtkomst"
                      style={{ color: 'var(--red)', borderColor: 'var(--red)' }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Invites */}
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
            </select>
            <button className="btn btn-primary btn-sm" onClick={createInvite}>
              + Ny inbjudan
            </button>
          </div>
        </div>

        {invites.length === 0 ? (
          <p style={{ color: 'var(--ink-muted)', fontSize: '0.85rem' }}>
            Inga aktiva inbjudningslänkar. Skapa en för att bjuda in en ny användare.
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
                  <div style={{ fontSize: '0.72rem', color: 'var(--ink-muted)' }}>
                    {inv.invited_role === 'viewer' ? 'Läsare' : 'Medlem'} · Går ut {new Date(inv.expires_at).toLocaleDateString('sv-SE')}
                  </div>
                </div>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => copyLink(inv.code)}
                  title="Kopiera länk"
                >
                  {copied === inv.code ? <Check size={13} /> : <Copy size={13} />}
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => deleteInvite(inv.code)}
                  title="Radera inbjudan"
                  style={{ color: 'var(--red)', borderColor: 'var(--red)' }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        <p style={{ marginTop: 12, fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
          Länken är giltig i 7 dagar. Den som öppnar länken och loggar in kopplas automatiskt till föreningen.
        </p>
      </section>
    </div>
  )
}
