import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { isDemoSession } from '../demo'
import { setDemoMode, isDemoMode } from '../store'

// Anmäler ett demobesök till adminportalens logg: en gång per flik och session. Ingen IP-adress sparas,
// besökaren räknas med ett slumpat id i webbläsaren, så samma person räknas som en besökare vid flera besök.
function logDemoVisit() {
  try {
    if (sessionStorage.getItem('kb_demo_logged')) return
    sessionStorage.setItem('kb_demo_logged', '1')
    let vid = localStorage.getItem('kb_demo_vid')
    if (!vid) { vid = (crypto.randomUUID?.() || String(Math.random()).slice(2) + Date.now()); localStorage.setItem('kb_demo_vid', vid) }
    const w = window.innerWidth
    let referrer = ''
    try { referrer = document.referrer ? new URL(document.referrer).hostname : '' } catch { /* ignore */ }
    supabase.rpc('log_demo_visit', {
      p_visitor: vid,
      p_source: sessionStorage.getItem('kb_demo_src') || (new URLSearchParams(window.location.search).get('demo') === '1' ? 'hemsidan' : 'okand'),
      p_lang: (document.documentElement.lang || navigator.language || '').slice(0, 5),
      p_device: w < 700 ? 'mobil' : w < 1100 ? 'surfplatta' : 'dator',
      p_ua: navigator.userAgent,
      p_referrer: referrer,
    }).then(() => {}, () => {})
  } catch { /* loggningen får aldrig störa demon */ }
}

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
  // Sant först när användarens föreningar hämtats. Utan detta ser appen en inloggad användare utan förening
  // en kort stund och visar "skapa förening" innan listan hunnit komma.
  const [orgsLoaded, setOrgsLoaded] = useState(false)

  function setOrgId(id) {
    const membership = orgs.find(o => o.orgId === id)
    setOrgIdState(id)
    setRole(membership?.role || null)
    if (session?.user?.id) saveOrgId(session.user.id, id)
  }

  async function loadOrgs(userId, demo = false) {
    try {
      await fetchOrgs(userId, demo)
    } finally {
      setOrgsLoaded(true)
    }
  }

  async function fetchOrgs(userId, demo) {
    const { data } = await supabase
      .from('organization_members')
      .select('org_id, role, can_submit_expenses')
      .eq('user_id', userId)

    // Demokontot är läsare i databasen men visas som ägare och får skriva i minnet (se store.js)
    const list = (data || []).map(r => ({ orgId: r.org_id, role: demo ? 'owner' : r.role, canExpenses: !!r.can_submit_expenses }))
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

  const [recoveryMode, setRecoveryMode] = useState(false)

  useEffect(() => {
    // Slå på/av demoläget först när det ändras (inte vid förnyade tokens, som skulle nollställa demodatan)
    const syncDemo = session => {
      const demo = isDemoSession(session)
      if (demo !== isDemoMode()) setDemoMode(demo)
      if (demo && session) logDemoVisit()
      return demo
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      const demo = syncDemo(session)
      setSession(session)
      if (session) loadOrgs(session.user.id, demo)
      else setSession(null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setSession(session)
        setRecoveryMode(true)
        return
      }
      const demo = syncDemo(session)
      setSession(session)
      if (session) loadOrgs(session.user.id, demo)
      else {
        setSession(null); setOrgs([]); setOrgIdState(null); setRole(null); setOrgsLoaded(false)
        try { sessionStorage.removeItem('orgPicked') } catch {}
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  return (
    <AuthContext.Provider value={{ session, orgs, orgId, setOrgId, addOrg, role, setRole, loading: session === undefined || (!!session && !orgsLoaded), recoveryMode, setRecoveryMode }}>
      {children}
    </AuthContext.Provider>
  )
}
