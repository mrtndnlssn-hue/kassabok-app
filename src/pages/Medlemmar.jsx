import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { useAuth, isAdminRole, isPrimaryRole } from '../auth/AuthProvider'
import { fmtDate, isoDateTime } from '../store'
import { useI18n } from '../i18n'
import { Copy, Check, Trash2, ArrowRightLeft } from 'lucide-react'

// Fyra roller för användarna. 'main_owner' är en administratör som också är huvudansvarig (en per förening).
const ROLE_LABEL = {
  main_owner: 'Administratör (huvudansvarig)',
  owner:      'Administratör',
  member:     'Bokförare',
  viewer:     'Läsare',
  auditor:    'Revisor',
}

// Vad rollen får göra, visas när man bjuder in och som tips vid rollvalet
const ROLE_HELP = {
  owner:   'Allt, även medlemmar och inställningar.',
  member:  'Bokför, hanterar utlägg och fakturor. Ändrar inte medlemmar eller inställningar.',
  viewer:  'Ser allt och kan lämna in egna utlägg och fakturor. Ändrar inget i bokföringen.',
  auditor: 'Ser allt, granskar verifikat och lägger anmärkningar. Ändrar inget i bokföringen.',
}

const ROLE_STYLE = {
  main_owner: { background: 'var(--amber-soft, #fef3c7)', color: 'var(--amber, #b45309)', border: '1px solid #fcd34d' },
  owner:      { background: 'var(--green-soft)', color: 'var(--green)', border: '1px solid var(--border)' },
  member:     { background: 'var(--blue-soft, #e8f0fe)', color: 'var(--blue, #1a73e8)', border: '1px solid var(--border)' },
  viewer:     { background: 'var(--paper-2)', color: 'var(--ink-muted)', border: '1px solid var(--border)' },
  auditor:    { background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--ink-muted)' },
}

function RoleBadge({ role }) {
  const { t } = useI18n()
  return (
    <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:999, fontSize:'0.75rem', fontWeight:600, ...ROLE_STYLE[role] }}>
      {ROLE_LABEL[role] ? t(ROLE_LABEL[role]) : role}
    </span>
  )
}

export default function Medlemmar({ orgId, orgName }) {
  const { t } = useI18n()
  const { session, role: myRole } = useAuth()
  const isMainOwner = isPrimaryRole(myRole)
  const canManage   = isAdminRole(myRole)

  const [members, setMembers] = useState([])
  const [maxMembers, setMaxMembers] = useState(15)
  useEffect(() => {
    supabase.rpc('get_org_plan', { p_org: orgId }).then(({ data }) => {
      if (data?.member_limit) setMaxMembers(data.member_limit)
    })
  }, [orgId])
  const [invites, setInvites] = useState([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied]   = useState(false)
  const [error, setError]     = useState('')
  const [newRole, setNewRole]     = useState('member')
  const [newNickname, setNewNickname] = useState('')
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
          .select('code, invited_role, nickname, expires_at, created_at')
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
        nickname: m.nickname || '',
        isMe:  m.user_id === session.user.id,
      })))
      const fetchedInvites = invitesRes.data || []
      setInvites(fetchedInvites)
      return fetchedInvites
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
      setError(t('Använd "Lämna över" för att byta huvudansvarig.'))
      return
    }
    // Prevent assigning main_owner via dropdown (use transfer instead)
    if (newRole === 'main_owner') {
      setError(t('Använd "Lämna över"-knappen för att utse ny huvudansvarig.'))
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

  async function editNickname(userId) {
    const current = members.find(m => m.userId === userId)?.nickname || ''
    const input = window.prompt(t('Namn i den här föreningen (lämna tomt för att ta bort):'), current)
    if (input === null) return
    const nickname = input.trim()
    const { error } = await supabase
      .from('organization_members')
      .update({ nickname: nickname || null })
      .eq('org_id', orgId)
      .eq('user_id', userId)
    if (error) { setError(error.message); return }
    setMembers(prev => prev.map(m => m.userId === userId ? { ...m, nickname } : m))
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
      setError(t('Huvudansvarig kan inte tas bort. Lämna över rollen först.'))
      return
    }
    if (!window.confirm(t('Ta bort {namn}s åtkomst till föreningen?', { namn: m?.email || t('användaren') }))) return
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
    if (members.length >= maxMembers) {
      setError(t('Föreningen har redan max {max} användare. Ta bort en användare innan du bjuder in fler.', { max: maxMembers }))
      return
    }
    const { error } = await supabase
      .from('org_invites')
      .insert({ org_id: orgId, created_by: session.user.id, invited_role: newRole, nickname: newNickname.trim() || null })
    if (error) { setError(error.message); return }
    setNewNickname('')
    const fetched = await fetchAll()
    if (fetched?.length) setNewestCode(fetched[0].code) // sorted desc, so [0] is newest
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

  if (loading) return <p style={{ color: 'var(--ink-muted)', padding: 8 }}>{t('Laddar…')}</p>

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
          <strong>{t('Lämna över som huvudansvarig?')}</strong><br/>
          <span style={{ fontSize:'0.85rem' }}>
            {members.find(m => m.userId === transferTo)?.email} {t('blir ny huvudansvarig. Du blir vanlig administratör och kan inte längre byta föreningsnamn.')}
          </span>
          <div style={{ display:'flex', gap:8, marginTop:10 }}>
            <button className="btn btn-primary btn-sm" onClick={() => transferMainOwner(transferTo)}>{t('Bekräfta')}</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setTransferTo(null)}>{t('Avbryt')}</button>
          </div>
        </div>
      )}

      {/* Members */}
      <section style={{ marginBottom: 32 }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: '1.1rem', marginBottom: 12, color: 'var(--ink)' }}>
          {t('Medlemmar')} ({members.length}/{maxMembers})
        </h3>
        <table className="data-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>{t('E-post')}</th>
              <th style={{ minWidth: 190 }}>{t('Roll')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {[...members].sort((a, b) => {
              const order = { main_owner: 0, owner: 1, member: 2, viewer: 3, auditor: 4 }
              return (order[a.role] ?? 9) - (order[b.role] ?? 9)
            }).map(m => (
              <tr key={m.userId}>
                <td style={{ fontSize: '0.85rem' }}>
                  {m.nickname && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <strong>{m.nickname}</strong>
                      {m.isMe && <span style={{ fontSize:'0.72rem', color:'var(--ink-muted)', background:'var(--paper-2)', padding:'1px 6px', borderRadius:99, border:'1px solid var(--border)' }}>{t('du')}</span>}
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', ...(m.nickname ? { color: 'var(--ink-muted)', fontSize: '0.78rem' } : {}) }}>
                    <span style={{ overflowWrap: 'anywhere' }}>{m.email}</span>
                    {!m.nickname && m.isMe && <span style={{ fontSize:'0.72rem', color:'var(--ink-muted)', background:'var(--paper-2)', padding:'1px 6px', borderRadius:99, border:'1px solid var(--border)' }}>{t('du')}</span>}
                    {canManage && (
                      <button onClick={() => editNickname(m.userId)} title={t('Ändra namn i föreningen')}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--ink-muted)', fontSize: '0.72rem', textDecoration: 'underline', whiteSpace: 'nowrap' }}>
                        {m.nickname ? t('ändra') : t('lägg till namn')}
                      </button>
                    )}
                  </div>
                </td>
                <td>
                  {m.isMe || m.role === 'main_owner' || !canManage ? (
                    <RoleBadge role={m.role} />
                  ) : (
                    <select
                      value={m.role}
                      onChange={e => changeRole(m.userId, e.target.value)}
                      title={t(ROLE_HELP[m.role] || '')}
                      style={{ fontSize: '0.8rem', padding: '3px 6px', borderRadius: 'var(--r)', border: '1px solid var(--border)', background: 'var(--paper-2)', color: 'var(--ink)', cursor: 'pointer' }}
                    >
                      <option value="owner">{t('Administratör')}</option>
                      <option value="member">{t('Bokförare')}</option>
                      <option value="viewer">{t('Läsare')}</option>
                      <option value="auditor">{t('Revisor')}</option>
                    </select>
                  )}
                </td>
                <td style={{ textAlign: 'right', verticalAlign: 'top' }}>
                  <div style={{ display:'flex', gap:4, justifyContent:'flex-end', whiteSpace: 'nowrap' }}>
                    {isMainOwner && !m.isMe && m.role !== 'main_owner' && (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setTransferTo(m.userId)}
                        title={t('Lämna över huvudansvaret')}
                        style={{ fontSize:'0.72rem', gap:4 }}
                      >
                        <ArrowRightLeft size={12}/> {t('Lämna över')}
                      </button>
                    )}
                    {canManage && !m.isMe && m.role !== 'main_owner' && (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => removeMember(m.userId)}
                        title={t('Ta bort åtkomst')}
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
          <h3 style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: '1.1rem', color: 'var(--ink)', margin: '0 0 10px' }}>
            {t('Inbjudningslänkar')}
          </h3>
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="text" value={newNickname} maxLength={60}
                onChange={e => setNewNickname(e.target.value)}
                placeholder={t('Namn (valfritt)')}
                style={{ fontSize: '0.85rem', padding: '6px 10px', flex: '1 1 160px', minWidth: 0, width: 'auto' }}
              />
              <select
                value={newRole}
                onChange={e => setNewRole(e.target.value)}
                style={{ fontSize: '0.85rem', padding: '6px 10px', borderRadius: 'var(--r)', border: '1px solid var(--border)', background: 'var(--paper-2)', color: 'var(--ink)', cursor: 'pointer', width: 'auto', flex: 'none' }}
              >
                <option value="member">{t('Bokförare')}</option>
                <option value="viewer">{t('Läsare')}</option>
                <option value="auditor">{t('Revisor')}</option>
                <option value="owner">{t('Administratör')}</option>
              </select>
              <button className="btn btn-primary btn-sm" style={{ flex: 'none' }} onClick={createInvite} disabled={members.length >= maxMembers}
                title={members.length >= maxMembers ? t('Max {max} användare per förening', { max: maxMembers }) : undefined}>
                + {t('Ny inbjudan')}
              </button>
            </div>
            <p style={{ margin: '8px 0 0', fontSize: '0.78rem', color: 'var(--ink-muted)' }}>{t(ROLE_HELP[newRole])}</p>
          </div>

          {invites.length === 0 ? (
            <p style={{ color: 'var(--ink-muted)', fontSize: '0.85rem' }}>
              {t('Inga aktiva inbjudningslänkar.')}
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
                    <div style={{ display:'flex', alignItems:'center', gap:6, fontSize: '0.72rem', color: 'var(--ink-muted)', flexWrap: 'wrap' }}>
                      {inv.nickname && <strong style={{ color: 'var(--ink)' }}>{inv.nickname} ·</strong>}
                      {ROLE_LABEL[inv.invited_role] ? t(ROLE_LABEL[inv.invited_role]) : inv.invited_role}
                      · {t('Skapad')} {isoDateTime(new Date(inv.created_at))}
                      · {t('Går ut')} {fmtDate(inv.expires_at)}
                      {inv.code === newestCode && (
                        <span style={{ background:'#16a34a', color:'#fff', fontSize:'0.65rem', fontWeight:700, padding:'2px 7px', borderRadius:99, letterSpacing:'0.03em' }}>{t('NY')}</span>
                      )}
                    </div>
                  </div>
                  <button className="btn btn-secondary btn-sm" onClick={() => copyLink(inv.code)} title={t('Kopiera länk')}>
                    {copied === inv.code ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => deleteInvite(inv.code)} title={t('Radera inbjudan')}
                    style={{ color: 'var(--red)', borderColor: 'var(--red)' }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <p style={{ marginTop: 12, fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
            {t('Namnet följer med när personen skapar konto och syns bara för medlemmarna i den här föreningen. Länken är giltig i 7 dagar. En förening kan ha max {max} användare.', { max: maxMembers })}
          </p>
        </section>
      )}

    </div>
  )
}
