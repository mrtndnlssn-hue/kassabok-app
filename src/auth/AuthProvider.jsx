import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../supabase'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

function getSavedOrgId(userId) {
  try { return localStorage.getItem(`activeOrg_${userId}`) } catch { return null }
}
function saveOrgId(userId, orgId) {
  try { localStorage.setItem(`activeOrg_${userId}`, orgId) } catch {}
}

export default function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = still loading
  const [orgs, setOrgs]       = useState([])        // [{orgId, role}]
  const [orgId, setOrgIdState] = useState(null)
  const [role, setRole]        = useState(null)

  function setOrgId(id) {
    const membership = orgs.find(o => o.orgId === id)
    setOrgIdState(id)
    setRole(membership?.role || null)
    if (session?.user?.id) saveOrgId(session.user.id, id)
  }

  async function loadOrgs(userId) {
    const { data } = await supabase
      .from('organization_members')
      .select('org_id, role')
      .eq('user_id', userId)

    const list = (data || []).map(r => ({ orgId: r.org_id, role: r.role }))
    setOrgs(list)

    if (list.length === 0) {
      setOrgIdState(null)
      setRole(null)
      return
    }

    const saved = getSavedOrgId(userId)
    const active = list.find(o => o.orgId === saved) || list[0]
    setOrgIdState(active.orgId)
    setRole(active.role)
    saveOrgId(userId, active.orgId)
  }

  // Called after joining a new org via invite – adds it to list and switches to it
  function addOrg(newOrgId, newRole) {
    setOrgs(prev => {
      if (prev.find(o => o.orgId === newOrgId)) return prev
      return [...prev, { orgId: newOrgId, role: newRole }]
    })
    setOrgIdState(newOrgId)
    setRole(newRole)
    if (session?.user?.id) saveOrgId(session.user.id, newOrgId)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) loadOrgs(session.user.id)
      else setSession(null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setSession(session)
      if (session) loadOrgs(session.user.id)
      else { setSession(null); setOrgs([]); setOrgIdState(null); setRole(null) }
    })
    return () => subscription.unsubscribe()
  }, [])

  return (
    <AuthContext.Provider value={{ session, orgs, orgId, setOrgId, addOrg, role, setRole, loading: session === undefined }}>
      {children}
    </AuthContext.Provider>
  )
}
