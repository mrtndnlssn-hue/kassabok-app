import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Shield, Rocket, LayoutDashboard, BookOpen, PieChart, Tags, FileText, ChevronLeft, ChevronRight, Loader, CalendarDays, LogOut, Users, ChevronsUpDown, Settings } from 'lucide-react';
import { store, attachments, sortCats, getYear, getOrBuildPeriods, todayStr, isoDateTime } from './store';
import { useAuth } from './auth/AuthProvider';
import { supabase } from './supabase';
import { isDemoSession } from './demo';
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
import Komigang from './pages/Komigang';
import { useI18n } from './i18n';
import LanguageSwitch from './components/LanguageSwitch';
const AdminPortal = lazy(() => import('./admin/AdminPortal'));
import './index.css';

const NAV_GROUPS = [
  { items: [
    { id: 'komigang',  label: 'Kom igång',          icon: Rocket, hideForViewer: true },
    { id: 'dashboard', label: 'Översikt',           icon: LayoutDashboard },
  ] },
  { title: 'Bokföring', items: [
    { id: 'kassabok',  label: 'Kassabok',           icon: BookOpen },
    { id: 'budget',    label: 'Budget & utfall',    icon: PieChart },
  ] },
  { title: 'Rapporter', items: [
    { id: 'arsrapport', label: 'Rapporter & export', icon: FileText },
  ] },
  { title: 'Förening', items: [
    { id: 'kategorier',    label: 'Kategorier',         icon: Tags },
    { id: 'perioder',      label: 'Räkenskapsperioder', icon: CalendarDays },
    { id: 'medlemmar',     label: 'Medlemmar',          icon: Users,    ownerOnly: true },
    { id: 'installningar', label: 'Inställningar',      icon: Settings, ownerOnly: true },
  ] },
];
const NAV = NAV_GROUPS.flatMap(g => g.items);
const NO_PERIOD_PAGES = ['komigang', 'kategorier', 'perioder', 'medlemmar', 'installningar'];

function MainApp({ orgId, role }) {
  const { t } = useI18n();
  const { orgs, setOrgId: switchOrg, session } = useAuth()
  const canWrite = role !== 'viewer'
  const isOwnerRole = role === 'main_owner' || role === 'owner';
  // Sidan ligger i adressen (#kassabok) så att webbläsarens bakåt- och framåtknappar fungerar
  const pageFromUrl = () => {
    const id = window.location.hash.replace('#', '');
    const nav = NAV.find(n => n.id === id);
    return nav && (!nav.ownerOnly || isOwnerRole) && (!nav.hideForViewer || canWrite) ? id : null;
  };
  const [page, setPage]               = useState(() => pageFromUrl() || 'dashboard');
  const routed = useRef(false);

  function navigate(id) {
    if (id === page) return;
    window.history.pushState({ page: id }, '', `#${id}`);
    setPage(id);
  }

  useEffect(() => {
    if (!window.location.hash) window.history.replaceState({ page }, '', `#${page}`);
    const onPop = () => setPage(pageFromUrl() || 'dashboard');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  useEffect(() => {
    if (isDemoSession(session)) return;
    supabase.rpc('is_platform_admin').then(({ data }) => setIsPlatformAdmin(!!data));
  }, [session]);
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

      const today  = todayStr();
      const active =
        periods.find(p => p.id === data.activePeriodId) ||
        periods.find(p => today >= p.start && today <= p.end) ||
        [...periods].sort((a, b) => b.start.localeCompare(a.start))[0];
      setActivePeriodId(active?.id || null);

      // Nya föreningar utan verifikat hamnar på Kom igång första gången
      if (!routed.current) {
        routed.current = true;
        if (canWrite && !(data.transactions || []).length && !pageFromUrl()) {
          window.history.replaceState({ page: 'komigang' }, '', '#komigang');
          setPage('komigang');
        }
      }
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

  async function handleAddTx(tx, files = []) {
    const added = await store.addTransaction(orgId, tx);
    try {
      if (files.length) await attachments.upload(orgId, added.id, files);
    } finally {
      await fetchAll();
    }
  }
  async function handleUpdateTx(id, upd) { await store.updateTransaction(orgId, id, upd);  await fetchAll(); }
  async function handleDeleteTx(id)      { await store.deleteTransaction(orgId, id);        await fetchAll(); }
  async function handleSaveCats(cats, renames = []) {
    if (renames.length) await store.renameCategories(orgId, renames);
    await store.saveCategories(orgId, cats);
    if (renames.length) await fetchAll();   // verifikat och budget har fått nya koder
    else setCats(sortCats(cats));
  }
  async function handleReasignAndDelete(catId, moves) {
    for (const { txId, newCategoryId } of moves) await store.reassignCategory(orgId, txId, catId, newCategoryId);
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
  async function handleBudgetLockChange(periodId, locked) {
    await store.setBudgetLocked(orgId, periodId, locked);
    setFiscalPeriods(prev => prev.map(p => p.id === periodId ? { ...p, budgetLocked: locked } : p));
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
      <p>{t('Laddar Föreningsbalans…')}</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  const pageProps = { transactions, categories, budget, orgName, activePeriod, fiscalPeriods };
  const pageMap   = {
    komigang:   <Komigang {...pageProps} orgId={orgId} role={role} onSavePeriods={handleSavePeriods} onNavigate={navigate} />,
    dashboard:  <Dashboard  {...pageProps} />,
    kassabok:   <Kassabok   {...pageProps} orgId={orgId} onAdd={handleAddTx} onUpdate={handleUpdateTx} onDelete={handleDeleteTx} />,
    budget:     <BudgetResultat {...pageProps} budgetComments={budgetComments} onBudgetChange={handleBudgetChange} onCommentChange={handleBudgetCommentChange} onLockChange={handleBudgetLockChange} />,
    kategorier: <Kategorier {...pageProps} orgId={orgId} onSave={handleSaveCats} onReasignAndDelete={handleReasignAndDelete} />,
    arsrapport: <Arsrapport {...pageProps} budgetComments={budgetComments} orgId={orgId} />,
    perioder:   <Rakenskapsperioder fiscalPeriods={fiscalPeriods} onSave={handleSavePeriods} transactions={transactions} categories={categories} budget={budget} orgName={orgName} orgId={orgId} />,
    medlemmar:     <Medlemmar orgId={orgId} orgName={orgName} />,
    installningar: <Installningar orgId={orgId} orgName={orgName} onOrgNameChange={name => { setOrgName(name); setOrgNames(prev => ({ ...prev, [orgId]: name })); }} />,
  };

  const subtitles = {
    komigang:   t('Gör föreningen redo steg för steg'),
    dashboard:  t('Ekonomisk översikt – {period}', { period: activePeriod?.label || '–' }),
    kassabok:   t('Verifikat – {period}', { period: activePeriod?.label || '–' }),
    budget:     t('Budget vs utfall – {period}', { period: activePeriod?.label || '–' }),
    kategorier: t('Definiera intäkts- och kostnadskategorier'),
    arsrapport: t('Årsrapport, Excel, verifikat och budget som filer'),
    perioder:   t('Hantera räkenskapsperioder och verksamhetsår'),
    medlemmar:     t('Bjud in och hantera föreningens användare'),
    installningar: t('Föreningsnamn och borttagning'),
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <a href="https://foreningsbalans.se" title={t('Till startsidan')} aria-label={t('Till startsidan')}
            style={{ display:'flex', alignItems:'center', gap:9, marginBottom:14, textDecoration:'none' }}>
            <img src="/favicon.svg" alt="" width="26" height="26" />
            <span style={{ fontSize:'0.85rem', fontWeight:600, color:'rgba(255,255,255,0.75)', letterSpacing:'0.01em', textTransform:'none', margin:0 }}>Föreningsbalans</span>
          </a>
          <h1>{orgName || t('Min Förening')}</h1>

          <div style={{ marginTop:10 }}>
            <div style={{ fontSize:'0.65rem', color:'rgba(255,255,255,0.35)', letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:4 }}>{t('Räkenskapsperiod')}</div>
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
          {NAV_GROUPS.map((g, gi) => {
            const items = g.items.filter(n =>
              (!n.ownerOnly || role === 'main_owner' || role === 'owner') && (!n.hideForViewer || canWrite));
            if (!items.length) return null;
            return (
              <div key={gi}>
                {g.title && (
                  <div style={{ fontSize:'0.65rem', color:'rgba(255,255,255,0.35)', letterSpacing:'0.08em', textTransform:'uppercase', margin: gi ? '14px 8px 4px' : '0 8px 4px' }}>{t(g.title)}</div>
                )}
                {items.map(n => {
                  const Icon = n.icon;
                  return (
                    <button key={n.id} className={`nav-btn${page === n.id ? ' active' : ''}`} onClick={() => navigate(n.id)}>
                      <Icon size={16}/> {t(n.label)}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer" style={{ display:'flex', flexDirection:'column', gap:12, textAlign:'left' }}>
          {orgs.length > 1 && (
            <div>
              <div style={{ fontSize:'0.65rem', color:'rgba(255,255,255,0.35)', letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:4 }}>{t('Förening')}</div>
              <div style={{ position:'relative' }}>
                <select
                  value={orgId}
                  onChange={e => { switchOrg(e.target.value); navigate('dashboard'); }}
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

          {/* Konto: vem som är inloggad, adminportal (bara plattformsägaren), logga ut och språk */}
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            <div style={{ fontSize:'0.65rem', color:'rgba(255,255,255,0.35)', letterSpacing:'0.08em', textTransform:'uppercase' }}>{t('Inloggad som')}</div>
            <div title={session?.user?.email} style={{ fontSize:'0.8rem', color:'rgba(255,255,255,0.75)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {isDemoSession(session) ? t('Demo') : session?.user?.email}
            </div>
            {isPlatformAdmin && (
              <a href="#admin" style={{ display:'flex', alignItems:'center', gap:6, color:'rgba(255,255,255,0.75)', fontSize:'0.78rem', textDecoration:'none', padding:'4px 0' }}>
                <Shield size={12}/> Adminportal
              </a>
            )}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <button
                onClick={() => supabase.auth.signOut()}
                style={{ display:'flex', alignItems:'center', gap:6, background:'none', border:'none', cursor:'pointer', color:'rgba(255,255,255,0.6)', fontSize:'0.78rem', padding:'4px 0' }}
              >
                <LogOut size={12}/> {t('Logga ut')}
              </button>
              <LanguageSwitch dark />
            </div>
          </div>

          <div style={{ borderTop:'1px solid rgba(255,255,255,0.08)', paddingTop:8, display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:8, fontSize:'0.65rem', color:'rgba(255,255,255,0.3)' }}>
            <span>Martin Danielsson</span>
            {isPlatformAdmin && (
              <span title={t('Byggtid')} style={{ fontFamily:'var(--font-mono)', color:'rgba(255,255,255,0.22)' }}>{isoDateTime(new Date(__BUILD_TIME__))}</span>
            )}
          </div>
        </div>
      </aside>

      <main className="main">
        {isDemoSession(session) && (
          <div className="notice notice-info" style={{ margin:'0 0 16px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
            <span><strong>{t('Demoläge.')}</strong> {t('Du kan ändra fritt, men ändringarna sparas inte och försvinner när du laddar om sidan eller loggar ut.')}</span>
            <button className="btn btn-secondary btn-sm" onClick={() => window.location.reload()}>{t('Återställ demon')}</button>
          </div>
        )}
        <header className="page-header">
          <div>
            <h2>{t(NAV.find(n => n.id === page)?.label || '')}</h2>
            <div className="page-subtitle">{subtitles[page]}</div>
          </div>
          {activePeriod && !NO_PERIOD_PAGES.includes(page) && (
            <div style={{ display:'flex', alignItems:'center', gap:8, background:'var(--paper-2)', border:'1px solid var(--border)', borderRadius:'var(--r)', padding:'6px 12px' }}>
              <span style={{ fontSize:'0.78rem', color:'var(--ink-muted)', letterSpacing:'0.05em', textTransform:'uppercase' }}>{t('Period')}</span>
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
  const [adminRoute, setAdminRoute] = useState(() => window.location.hash.startsWith('#admin'));
  useEffect(() => {
    const onHash = () => setAdminRoute(window.location.hash.startsWith('#admin'));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
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

  // Efter att en förening skapats eller en inbjudan godkänts: lämna formuläret och gå direkt in i föreningen
  function orgReady() {
    try { sessionStorage.setItem('orgPicked', '1') } catch {}
    setPickerDone(true);
    setShowCreate(false);
  }

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--ink-muted)', fontFamily:'var(--font-body)' }}>
      <Loader size={28} style={{ animation:'spin 1s linear infinite' }}/>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (recoveryMode) return <SetNewPassword />;

  if (!session) return <LoginPage />;

  if (adminRoute && !isDemoSession(session)) {
    return <Suspense fallback={null}><AdminPortal /></Suspense>;
  }

  // Inbjudningslänk – visa OrgSetup oavsett om användaren redan har en förening
  if (new URLSearchParams(window.location.search).has('invite')) return <OrgSetup onDone={orgReady} />;

  // Skapa ny förening (från OrgPicker)
  if (showCreate) return <OrgSetup onDone={orgReady} onCancel={() => setShowCreate(false)} />;

  // Visa väljare efter inloggning om användaren har föreningar och inte redan valt
  if (orgs.length > 0 && !pickerDone && !isDemoSession(session)) {
    return <OrgPicker onCreateNew={() => setShowCreate(true)} onPick={pickOrg} />;
  }

  // Inga föreningar alls – skapa direkt
  if (!orgId) return <OrgSetup onDone={orgReady} />;

  return <MainApp orgId={orgId} role={role} />;
}
