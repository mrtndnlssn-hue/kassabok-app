import { useState, useEffect } from 'react';
import { LayoutDashboard, BookOpen, PieChart, Tags, FileText, ChevronLeft, ChevronRight, Loader, CalendarDays, LogOut, Users, ChevronsUpDown, Settings } from 'lucide-react';
import { store, getYear, getOrBuildPeriods } from './store';
import { useAuth } from './auth/AuthProvider';
import { supabase } from './supabase';
import LoginPage from './auth/LoginPage';
import OrgSetup from './auth/OrgSetup';
import OrgPicker from './auth/OrgPicker';
import SetNewPassword from './auth/SetNewPassword';
import Dashboard from './pages/Dashboard';
import Kassabok from './pages/Kassabok';
import BudgetResultat from './pages/BudgetResultat';
import Kategorier from './pages/Kategorier';
import Arsrapport from './pages/Arsrapport';
import Rakenskapsperioder from './pages/Rakenskapsperioder';
import Medlemmar from './pages/Medlemmar';
import Installningar from './pages/Installningar';
import './index.css';

const NAV = [
  { id: 'dashboard',  label: 'Översikt',          icon: LayoutDashboard },
  { id: 'kassabok',   label: 'Kassabok',           icon: BookOpen },
  { id: 'budget',     label: 'Budget & Resultat',  icon: PieChart },
  { id: 'kategorier', label: 'Kategorier',         icon: Tags },
  { id: 'arsrapport', label: 'Årsrapport (PDF)',   icon: FileText },
  { id: 'perioder',   label: 'Räkenskapsperioder', icon: CalendarDays },
  { id: 'medlemmar',    label: 'Medlemmar',    icon: Users,    ownerOnly: true },
  { id: 'installningar', label: 'Inställningar', icon: Settings, ownerOnly: true },
];

function MainApp({ orgId, role }) {
  const { orgs, setOrgId: switchOrg } = useAuth()
  const canWrite = role !== 'viewer'
  const [page, setPage]               = useState('dashboard');
  const [orgNames, setOrgNames]       = useState({});
  const [loading, setLoading]         = useState(true);
  const [transactions, setTxs]        = useState([]);
  const [categories, setCats]         = useState([]);
  const [budget, setBudget]           = useState({});
  const [budgetComments, setBudgetComments] = useState({});
  const [orgName, setOrgName]         = useState('');
  const [fiscalPeriods, setFiscalPeriods] = useState([]);
  const [activePeriodId, setActivePeriodId] = useState(null);

  async function fetchAll() {
    setLoading(true);
    try {
      const data    = await store.getAll(orgId);
      const periods = getOrBuildPeriods(data);
      setTxs(data.transactions || []);
      setCats(data.categories || []);
      setBudget(data.budget || {});
      setBudgetComments(data.budgetComments || {});
      setOrgName(data.orgName || '');
      setOrgNames(prev => ({ ...prev, [orgId]: data.orgName || '' }));
      setFiscalPeriods(periods);

      const today  = new Date().toISOString().slice(0, 10);
      const active =
        periods.find(p => p.id === data.activePeriodId) ||
        periods.find(p => today >= p.start && today <= p.end) ||
        [...periods].sort((a, b) => b.start.localeCompare(a.start))[0];
      setActivePeriodId(active?.id || null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchAll(); }, [orgId]);

  useEffect(() => {
    if (orgs.length <= 1) return
    const otherIds = orgs.map(o => o.orgId).filter(id => !orgNames[id])
    if (!otherIds.length) return
    supabase.from('organizations').select('id, name').in('id', otherIds)
      .then(({ data }) => {
        if (!data) return
        setOrgNames(prev => ({ ...prev, ...Object.fromEntries(data.map(r => [r.id, r.name])) }))
      })
  }, [orgs]);

  const activePeriod  = fiscalPeriods.find(p => p.id === activePeriodId) || null;
  const sortedPeriods = [...fiscalPeriods].sort((a, b) => b.start.localeCompare(a.start));
  const periodIdx     = sortedPeriods.findIndex(p => p.id === activePeriodId);

  async function handleAddTx(tx)         { await store.addTransaction(orgId, tx);          await fetchAll(); }
  async function handleUpdateTx(id, upd) { await store.updateTransaction(orgId, id, upd);  await fetchAll(); }
  async function handleDeleteTx(id)      { await store.deleteTransaction(orgId, id);        await fetchAll(); }
  async function handleSaveCats(cats)    { await store.saveCategories(orgId, cats);         setCats(cats); }
  async function handleReasignAndDelete(catId, moves) {
    for (const { txId, newCategoryId } of moves) await store.updateTransaction(orgId, txId, { categoryId: newCategoryId });
    await fetchAll();
  }
  async function handleBudgetChange(periodId, catId, amount) {
    await store.setBudgetLine(orgId, periodId, catId, amount);
    const data = await store.getAll(orgId);
    setBudget(data.budget || {});
    setBudgetComments(data.budgetComments || {});
  }
  async function handleBudgetCommentChange(periodId, catId, comment) {
    await store.setBudgetComment(orgId, periodId, catId, comment);
    setBudgetComments(prev => ({ ...prev, [periodId]: { ...(prev[periodId] || {}), [catId]: comment } }));
  }
  async function handlePeriodChange(id) {
    await store.setActivePeriodId(orgId, id);
    setActivePeriodId(id);
  }
  async function handleSavePeriods(periods) {
    await store.saveFiscalPeriods(orgId, periods);
    setFiscalPeriods(periods);
    await fetchAll();
    if (!periods.find(p => p.id === activePeriodId)) {
      const latest = [...periods].sort((a, b) => b.start.localeCompare(a.start))[0];
      if (latest) { await store.setActivePeriodId(orgId, latest.id); setActivePeriodId(latest.id); }
    }
  }

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100vh', gap:16, color:'var(--ink-muted)', fontFamily:'var(--font-body)' }}>
      <Loader size={32} style={{ animation:'spin 1s linear infinite' }}/>
      <p>Laddar kassabok…</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  const pageProps = { transactions, categories, budget, orgName, activePeriod, fiscalPeriods };
  const pageMap   = {
    dashboard:  <Dashboard  {...pageProps} />,
    kassabok:   <Kassabok   {...pageProps} orgId={orgId} onAdd={handleAddTx} onUpdate={handleUpdateTx} onDelete={handleDeleteTx} />,
    budget:     <BudgetResultat {...pageProps} budgetComments={budgetComments} onBudgetChange={handleBudgetChange} onCommentChange={handleBudgetCommentChange} />,
    kategorier: <Kategorier {...pageProps} orgId={orgId} onSave={handleSaveCats} onReasignAndDelete={handleReasignAndDelete} />,
    arsrapport: <Arsrapport {...pageProps} budgetComments={budgetComments} orgId={orgId} />,
    perioder:   <Rakenskapsperioder fiscalPeriods={fiscalPeriods} onSave={handleSavePeriods} transactions={transactions} categories={categories} budget={budget} orgName={orgName} orgId={orgId} />,
    medlemmar:     <Medlemmar orgId={orgId} orgName={orgName} />,
    installningar: <Installningar orgId={orgId} orgName={orgName} onOrgNameChange={name => { setOrgName(name); setOrgNames(prev => ({ ...prev, [orgId]: name })); }} />,
  };

  const subtitles = {
    dashboard:  `Ekonomisk översikt – ${activePeriod?.label || '–'}`,
    kassabok:   `Verifikat – ${activePeriod?.label || '–'}`,
    budget:     `Budget vs utfall – ${activePeriod?.label || '–'}`,
    kategorier: 'Definiera intäkts- och kostnadskategorier',
    arsrapport: 'Exportera PDF-årsrapport',
    perioder:   'Hantera räkenskapsperioder och verksamhetsår',
    medlemmar:     'Bjud in och hantera föreningens användare',
    installningar: 'Föreningsnamn och borttagning',
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <h1>{orgName || 'Min Förening'}</h1>

          <div style={{ marginTop:10 }}>
            <div style={{ fontSize:'0.65rem', color:'rgba(255,255,255,0.35)', letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:4 }}>Räkenskapsperiod</div>
            <div style={{ display:'flex', alignItems:'center', gap:4 }}>
              <button
                onClick={() => periodIdx < sortedPeriods.length - 1 && handlePeriodChange(sortedPeriods[periodIdx + 1].id)}
                disabled={periodIdx >= sortedPeriods.length - 1}
                style={{ background:'none', border:'none', cursor: periodIdx >= sortedPeriods.length - 1 ? 'default' : 'pointer', color: periodIdx >= sortedPeriods.length - 1 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.6)', padding:'2px 3px', borderRadius:4 }}
              ><ChevronLeft size={14}/></button>

              <select value={activePeriodId || ''} onChange={e => handlePeriodChange(e.target.value)}
                style={{ flex:1, background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.2)', borderRadius:4, color:'#fff', fontSize:'0.85rem', padding:'3px 6px', cursor:'pointer' }}>
                {sortedPeriods.map(p => (
                  <option key={p.id} value={p.id} style={{ background:'#1a1a2e' }}>{p.label}</option>
                ))}
              </select>

              <button
                onClick={() => periodIdx > 0 && handlePeriodChange(sortedPeriods[periodIdx - 1].id)}
                disabled={periodIdx <= 0}
                style={{ background:'none', border:'none', cursor: periodIdx <= 0 ? 'default' : 'pointer', color: periodIdx <= 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.6)', padding:'2px 3px', borderRadius:4 }}
              ><ChevronRight size={14}/></button>
            </div>
            {activePeriod && (
              <div style={{ fontSize:'0.65rem', color:'rgba(255,255,255,0.3)', marginTop:3, textAlign:'center' }}>
                {activePeriod.start} – {activePeriod.end}
              </div>
            )}
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAV.filter(n => !n.ownerOnly || role === 'main_owner' || role === 'owner').map(n => {
            const Icon  = n.icon;
            const isSep = n.id === 'perioder';
            return (
              <div key={n.id}>
                {isSep && <div style={{ height:1, background:'rgba(255,255,255,0.1)', margin:'8px 4px' }}/>}
                <button className={`nav-btn${page === n.id ? ' active' : ''}`} onClick={() => setPage(n.id)}>
                  <Icon size={16}/> {n.label}
                </button>
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer" style={{ display:'flex', flexDirection:'column', gap:6 }}>
          {orgs.length > 1 && (
            <div>
              <div style={{ fontSize:'0.65rem', color:'rgba(255,255,255,0.35)', letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:4 }}>Förening</div>
              <div style={{ position:'relative' }}>
                <select
                  value={orgId}
                  onChange={e => { switchOrg(e.target.value); setPage('dashboard'); }}
                  style={{ width:'100%', background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.2)', borderRadius:4, color:'#fff', fontSize:'0.8rem', padding:'4px 24px 4px 8px', cursor:'pointer', appearance:'none' }}
                >
                  {orgs.map(o => (
                    <option key={o.orgId} value={o.orgId} style={{ background:'#1a1a2e' }}>
                      {orgNames[o.orgId] || o.orgId.slice(0,8)}
                    </option>
                  ))}
                </select>
                <ChevronsUpDown size={12} style={{ position:'absolute', right:6, top:'50%', transform:'translateY(-50%)', color:'rgba(255,255,255,0.4)', pointerEvents:'none' }}/>
              </div>
            </div>
          )}
          <div style={{ fontSize:'0.7rem', color:'rgba(255,255,255,0.25)' }}>☁ Sparas i Supabase</div>
          <div style={{ fontSize:'0.65rem', color:'rgba(255,255,255,0.18)', fontFamily:'var(--font-mono)' }}>
            {new Date(__BUILD_TIME__).toLocaleString('sv-SE', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })}
          </div>
          <button
            onClick={() => supabase.auth.signOut()}
            style={{ display:'flex', alignItems:'center', gap:6, background:'none', border:'none', cursor:'pointer', color:'rgba(255,255,255,0.4)', fontSize:'0.75rem', padding:'4px 0' }}
          >
            <LogOut size={12}/> Logga ut
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="page-header">
          <div>
            <h2>{NAV.find(n => n.id === page)?.label}</h2>
            <div className="page-subtitle">{subtitles[page]}</div>
          </div>
          {activePeriod && !['kategorier', 'perioder'].includes(page) && (
            <div style={{ display:'flex', alignItems:'center', gap:8, background:'var(--paper-2)', border:'1px solid var(--border)', borderRadius:'var(--r)', padding:'6px 12px' }}>
              <span style={{ fontSize:'0.78rem', color:'var(--ink-muted)', letterSpacing:'0.05em', textTransform:'uppercase' }}>Period</span>
              <span style={{ fontFamily:'var(--font-mono)', fontWeight:600, fontSize:'1rem', color:'var(--ink)' }}>{activePeriod.label}</span>
              <span style={{ fontSize:'0.72rem', color:'var(--ink-muted)' }}>{activePeriod.start} – {activePeriod.end}</span>
            </div>
          )}
        </header>
        <div className="page-body">{pageMap[page]}</div>
      </main>
    </div>
  );
}

function sessionPickedKey(userId) { return `orgPicked_${userId}` }

export default function App() {
  const { session, orgs, orgId, role, loading, setOrgId, recoveryMode } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [pickerDone, setPickerDone] = useState(() => {
    try { return !!sessionStorage.getItem('orgPicked') } catch { return false }
  });

  // Nollställ pickervalet när sessionen avslutas
  useEffect(() => {
    if (!session) setPickerDone(false);
  }, [session]);

  function pickOrg(id) {
    try { sessionStorage.setItem('orgPicked', '1') } catch {}
    setPickerDone(true);
    setOrgId(id);
  }

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--ink-muted)', fontFamily:'var(--font-body)' }}>
      <Loader size={28} style={{ animation:'spin 1s linear infinite' }}/>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (recoveryMode) return <SetNewPassword />;

  if (!session) return <LoginPage />;

  // Inbjudningslänk – visa OrgSetup oavsett om användaren redan har en förening
  if (new URLSearchParams(window.location.search).has('invite')) return <OrgSetup />;

  // Skapa ny förening (från OrgPicker)
  if (showCreate) return <OrgSetup />;

  // Visa väljare efter inloggning om användaren har föreningar och inte redan valt
  if (orgs.length > 0 && !pickerDone) {
    return <OrgPicker onCreateNew={() => setShowCreate(true)} onPick={pickOrg} />;
  }

  // Inga föreningar alls – skapa direkt
  if (!orgId) return <OrgSetup />;

  return <MainApp orgId={orgId} role={role} />;
}
