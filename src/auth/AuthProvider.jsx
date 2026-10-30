import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../supabase'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

export default function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = still loading
  const [orgId, setOrgId]     = useState(null)
  const [role, setRole]       = useState(null)

  async function loadOrg(userId) {
    const { data } = await supabase
      .from('organization_members')
      .select('org_id, role')
      .eq('user_id', userId)
      .maybeSingle()
    setOrgId(data?.org_id || null)
    setRole(data?.role || null)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) loadOrg(session.user.id)
      else setSession(null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setSession(session)
      if (session) loadOrg(session.user.id)
      else { setSession(null); setOrgId(null); setRole(null) }
    })
    return () => subscription.unsubscribe()
  }, [])

  return (
    <AuthContext.Provider value={{ session, orgId, setOrgId, role, setRole, loading: session === undefined }}>
      {children}
    </AuthContext.Provider>
  )
}
