import { useState, useEffect } from 'react';
import { CheckCircle2, Circle, ArrowRight } from 'lucide-react';
import { supabase } from '../supabase';
import { getReceiptUsage } from '../receiptAi';

const flagKey = orgId => `kb_onboarding_${orgId}`;
function loadFlags(orgId) {
  try { return JSON.parse(localStorage.getItem(flagKey(orgId)) || '{}'); } catch { return {}; }
}

export default function Komigang({ orgId, role, transactions, budget, activePeriod, onSavePeriods, fiscalPeriods, onNavigate }) {
  const isOwner = role === 'main_owner' || role === 'owner';
  const [flags, setFlags]       = useState(() => loadFlags(orgId));
  const [memberCount, setMemberCount] = useState(null);
  const [aiEnabled, setAiEnabled]     = useState(null);
  const [balance, setBalance]   = useState(String(activePeriod?.openingBalance ?? 0));
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  useEffect(() => { setFlags(loadFlags(orgId)); }, [orgId]);
  useEffect(() => { setBalance(String(activePeriod?.openingBalance ?? 0)); }, [activePeriod?.id]);
  useEffect(() => {
    if (!isOwner) return;
    supabase.rpc('get_org_members_with_email', { p_org_id: orgId })
      .then(({ data }) => setMemberCount(data?.length ?? null));
    getReceiptUsage(orgId).then(u => setAiEnabled(u.enabled)).catch(() => {});
  }, [orgId, isOwner]);

  function setFlag(key, value = true) {
    const next = { ...flags, [key]: value };
    setFlags(next);
    try { localStorage.setItem(flagKey(orgId), JSON.stringify(next)); } catch { /* ignore */ }
  }

  async function saveBalance(e) {
    e.preventDefault();
    if (!activePeriod) return;
    setSaving(true); setError('');
    try {
      const value = parseFloat(String(balance).replace(',', '.')) || 0;
      await onSavePeriods(fiscalPeriods.map(p => p.id === activePeriod.id ? { ...p, openingBalance: value } : p));
      setFlag('balance');
    } catch (err) {
      setError(err.message || 'Kunde inte spara.');
    } finally {
      setSaving(false);
    }
  }

  const periodBudget = budget[activePeriod?.id] || {};
  const steps = [
    {
      id: 'balance',
      title: 'Ange ingående saldo',
      text: `Hur mycket pengar fanns i kassan när ${activePeriod?.label || 'perioden'} började? Är det en helt ny förening anger du 0.`,
      done: !!flags.balance || Number(activePeriod?.openingBalance) !== 0,
      form: activePeriod && (
        <form onSubmit={saveBalance} style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          <input type="number" step="0.01" value={balance} onChange={e => setBalance(e.target.value)}
            disabled={activePeriod.locked} style={{ width:160, textAlign:'right' }} aria-label="Ingående saldo (kr)" />
          <span style={{ fontSize:'0.85rem', color:'var(--ink-muted)' }}>kr</span>
          <button className="btn btn-primary btn-sm" type="submit" disabled={saving || activePeriod.locked}>{saving ? 'Sparar…' : 'Spara'}</button>
        </form>
      ),
    },
    {
      id: 'categories',
      title: 'Granska kategorierna',
      text: 'Kategorierna är föreningens intäkts- och kostnadsposter. Byt namn, lägg till egna eller dölj sådant ni inte använder.',
      done: !!flags.categories,
      action: { label: 'Öppna Kategorier', page: 'kategorier' },
      manual: true,
    },
    {
      id: 'budget',
      title: 'Lägg en budget',
      text: 'Ange vad ni räknar med att ta in och spendera. Utfallet jämförs sedan mot budgeten under året.',
      done: Object.values(periodBudget).some(v => v > 0),
      action: { label: 'Öppna Budget', page: 'budget' },
    },
    {
      id: 'members',
      title: 'Bjud in styrelsen',
      text: 'Skapa inbjudningslänkar. Ge läsare tillgång om de bara ska kunna titta, och medlemmar om de ska bokföra.',
      done: (memberCount ?? 1) > 1,
      action: { label: 'Öppna Medlemmar', page: 'medlemmar' },
      ownerOnly: true,
    },
    {
      id: 'tx',
      title: 'Bokför första verifikatet',
      text: 'Lägg till ett kvitto eller en faktura. Du kan ladda upp filen direkt i rutan.',
      done: transactions.length > 0,
      action: { label: 'Öppna Kassabok', page: 'kassabok' },
    },
    {
      id: 'report',
      title: 'Se vilka rapporter som finns',
      text: 'Årsrapport som PDF, Excel, alla verifikat som ZIP samt en budgetsammanställning. Bra att veta om inför årsmötet.',
      done: !!flags.report,
      action: { label: 'Öppna Rapporter', page: 'arsrapport' },
      manual: true,
    },
    {
      id: 'ai',
      title: 'Slå på AI-avläsning av kvitton (valfritt)',
      text: 'AI läser av datum, belopp och kategori från en uppladdad PDF eller bild. Filen skickas till Anthropic för avläsning.',
      done: !!aiEnabled,
      optional: true,
      action: { label: 'Öppna Inställningar', page: 'installningar' },
      ownerOnly: true,
    },
  ].filter(s => !s.ownerOnly || isOwner);

  const required = steps.filter(s => !s.optional);
  const doneCount = required.filter(s => s.done).length;
  const pct = Math.round((doneCount / required.length) * 100);

  return (
    <div style={{ maxWidth: 720 }}>
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:8 }}>
          <div className="section-title" style={{ margin:0 }}>
            {doneCount === required.length ? 'Allt är på plats' : 'Några steg för att komma igång'}
          </div>
          <span style={{ fontSize:'0.85rem', color:'var(--ink-muted)' }}>{doneCount} av {required.length} klara</span>
        </div>
        <div className="progress-bar"><div className="progress-fill ok" style={{ width:`${pct}%` }}/></div>
        <p style={{ fontSize:'0.85rem', color:'var(--ink-muted)', margin:'12px 0 0' }}>
          Ta stegen i den ordning som passar. Sidan finns kvar under <strong>Kom igång</strong> om du vill återvända till den.
        </p>
      </div>

      {error && <div className="notice" style={{ background:'var(--red-soft)', borderColor:'var(--red)', color:'var(--red)', marginBottom:12 }}>{error}</div>}

      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {steps.map((s, i) => (
          <div key={s.id} className="card" style={{ display:'flex', gap:14, alignItems:'flex-start', opacity: s.done ? 0.75 : 1 }}>
            <div style={{ flexShrink:0, color: s.done ? 'var(--accent)' : 'var(--ink-muted)', marginTop:2 }}>
              {s.done ? <CheckCircle2 size={22}/> : <Circle size={22}/>}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontWeight:600, marginBottom:4 }}>{i + 1}. {s.title}</div>
              <div style={{ fontSize:'0.85rem', color:'var(--ink-soft)', lineHeight:1.55, marginBottom: (s.form || s.action) ? 10 : 0 }}>{s.text}</div>
              {s.form}
              {s.action && (
                <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
                  <button className={`btn btn-sm ${s.done ? 'btn-secondary' : 'btn-primary'}`}
                    onClick={() => { if (s.manual) setFlag(s.id); onNavigate(s.action.page); }}>
                    {s.action.label} <ArrowRight size={13}/>
                  </button>
                  {s.manual && (
                    <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:'0.8rem', color:'var(--ink-muted)', cursor:'pointer', margin:0 }}>
                      <input type="checkbox" checked={!!flags[s.id]} onChange={e => setFlag(s.id, e.target.checked)} style={{ width:'auto' }}/>
                      Markera som klar
                    </label>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
