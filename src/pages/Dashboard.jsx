import { useMemo, useRef, useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Scale, Receipt } from 'lucide-react';
import { fmt, txsForPeriod, sumByCategory } from '../store';

function MonthChart({ monthly, categories, periodTxs }) {
  const containerRef = useRef();
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      setWidth(entries[0].contentRect.width);
    });
    ro.observe(containerRef.current);
    setWidth(containerRef.current.clientWidth);
    return () => ro.disconnect();
  }, []);

  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','Maj','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];
  const maxVal = Math.max(...monthly.map(m => Math.max(m.income, m.expense)), 1);
  const multiYear = monthly.some(m => m.year !== monthly[0]?.year);
  const barW = monthly.length > 0 && width > 0 ? Math.max(14, Math.floor((width - 8) / monthly.length) - 4) : 20;

  return (
    <div ref={containerRef} style={{ width:'100%' }}>
      {width > 0 && (
        <>
          <div style={{ display:'flex', alignItems:'flex-end', gap:4, height:120, padding:'0 4px', overflowX: barW < 14 ? 'auto' : 'hidden' }}>
            {monthly.map((m, i) => (
              <div key={i} style={{ flex:'0 0 auto', width:barW, display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
                <div style={{ width:'100%', display:'flex', alignItems:'flex-end', gap:1, height:100 }}>
                  <div style={{ flex:1, background:'var(--accent-3)', borderRadius:'3px 3px 0 0', height:`${(m.income/maxVal)*100}%`, minHeight:m.income>0?3:0, border:'1px solid var(--accent-2)', transition:'height 0.4s' }}
                    title={`${MONTH_NAMES[m.month-1]} ${m.year} – Intäkter: ${fmt(m.income)}`}/>
                  <div style={{ flex:1, background:'var(--red-soft)', borderRadius:'3px 3px 0 0', height:`${(m.expense/maxVal)*100}%`, minHeight:m.expense>0?3:0, border:'1px solid #f5c6cb', transition:'height 0.4s' }}
                    title={`${MONTH_NAMES[m.month-1]} ${m.year} – Kostnader: ${fmt(m.expense)}`}/>
                </div>
                <div style={{ fontSize:'0.58rem', color:'var(--ink-muted)', letterSpacing:'0.01em', textAlign:'center', lineHeight:1.1, whiteSpace:'nowrap', overflow:'hidden', width:'100%' }}>
                  {barW >= 18 ? MONTH_NAMES[m.month-1] : MONTH_NAMES[m.month-1].slice(0,1)}
                  {multiYear && <><br/>{String(m.year).slice(2)}</>}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display:'flex', gap:16, marginTop:10, fontSize:'0.75rem', color:'var(--ink-muted)' }}>
            <span style={{ display:'flex', alignItems:'center', gap:5 }}>
              <span style={{ width:10, height:10, background:'var(--accent-3)', border:'1px solid var(--accent-2)', display:'inline-block', borderRadius:2 }}/>Intäkter
            </span>
            <span style={{ display:'flex', alignItems:'center', gap:5 }}>
              <span style={{ width:10, height:10, background:'var(--red-soft)', border:'1px solid #f5c6cb', display:'inline-block', borderRadius:2 }}/>Kostnader
            </span>
          </div>
        </>
      )}
    </div>
  );
}

export default function Dashboard({ transactions, categories, budget, activePeriod }) {
  const periodTxs = useMemo(() => txsForPeriod(transactions, activePeriod), [transactions, activePeriod]);
  const actuals   = useMemo(() => sumByCategory(periodTxs, categories), [periodTxs, categories]);

  const incCats = categories.filter(c => c.type === 'income');
  const expCats = categories.filter(c => c.type === 'expense');
  const totalIncome  = incCats.reduce((s,c) => s+(actuals[c.id]||0), 0);
  const totalExpense = expCats.reduce((s,c) => s+(actuals[c.id]||0), 0);
  const netResult    = totalIncome - totalExpense;

  const monthly = useMemo(() => {
    if (!activePeriod?.start || !activePeriod?.end) return [];
    const start = new Date(activePeriod.start);
    const end   = new Date(activePeriod.end);
    const cols  = [];
    let cur = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cur <= end) {
      cols.push({ year: cur.getFullYear(), month: cur.getMonth()+1, income:0, expense:0 });
      cur = new Date(cur.getFullYear(), cur.getMonth()+1, 1);
    }
    for (const tx of periodTxs) {
      if (!tx.date) continue;
      const txY = parseInt(tx.date.slice(0,4));
      const txM = parseInt(tx.date.slice(5,7));
      const col = cols.find(c => c.year===txY && c.month===txM);
      if (!col) continue;
      const cat = categories.find(c => c.id===tx.categoryId);
      if (!cat) continue;
      if (cat.type==='income') col.income += Number(tx.amount)||0;
      else col.expense += Number(tx.amount)||0;
    }
    return cols;
  }, [periodTxs, categories, activePeriod]);

  const recent = [...periodTxs].sort((a,b) => b.date?.localeCompare(a.date)).slice(0, 8);
  const catMap = Object.fromEntries(categories.map(c => [c.id,c]));
  const label  = activePeriod?.label || '–';

  return (
    <div>
      <div className="stat-grid">
        {[
          { icon:TrendingUp,   cls:'positive',                              label:`Totala intäkter`,  val:fmt(totalIncome) },
          { icon:TrendingDown, cls:'negative',                              label:`Totala kostnader`, val:fmt(totalExpense) },
          { icon:Scale,        cls:netResult>=0?'positive':'negative',      label:'Nettoresultat',    val:fmt(netResult) },
          { icon:Receipt,      cls:'',                                      label:'Antal verifikat',  val:periodTxs.length },
        ].map(({ icon:Icon, cls, label:lbl, val },i) => (
          <div key={i} className="stat-card">
            <div className="stat-label"><Icon size={12} style={{display:'inline',marginRight:4}}/>{lbl}</div>
            <div className={`stat-value ${cls}`}>{val}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom:20 }}>
        <div className="section-title">Månadsöversikt – {label}</div>
        {monthly.length === 0
          ? <p style={{ color:'var(--ink-muted)', fontSize:'0.85rem' }}>Ingen period vald.</p>
          : <MonthChart monthly={monthly} categories={categories} periodTxs={periodTxs}/>
        }
      </div>

      <div className="card">
        <div className="section-title">Senaste verifikat</div>
        {recent.length === 0 ? (
          <div className="empty-state"><Receipt size={32}/><p>Inga verifikat registrerade ännu.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Datum</th><th>Beskrivning</th><th>Kategori</th><th className="text-right">Belopp</th></tr></thead>
              <tbody>
                {recent.map(tx => {
                  const cat = catMap[tx.categoryId];
                  return (
                    <tr key={tx.id}>
                      <td className="mono">{tx.date}</td>
                      <td>{tx.description || <em style={{color:'var(--ink-muted)'}}>–</em>}</td>
                      <td>
                        {cat && <span className={`badge ${cat.type==='income'?'badge-income':'badge-expense'}`}>{cat.id}</span>}
                        {' '}<span style={{fontSize:'0.82rem'}}>{cat?.name}</span>
                      </td>
                      <td className={cat?.type==='income'?'positive':'negative'}>
                        {cat?.type==='income'?'+':'−'}{fmt(tx.amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
