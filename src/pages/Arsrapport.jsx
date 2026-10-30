import { useState } from 'react';
import { FileDown, Loader } from 'lucide-react';
import { fmt, txsForPeriod, sumByCategory } from '../store';
import { exportAnnualReport } from '../pdfExport';

export default function Arsrapport({ transactions, categories, budget, orgName, fiscalPeriods, activePeriod }) {
  const [selectedId, setSelectedId] = useState(activePeriod?.id || '');
  const [loading, setLoading] = useState(false);
  const [done, setDone]       = useState(false);

  const period    = fiscalPeriods.find(p => p.id === selectedId) || fiscalPeriods[0];
  const periodBudget = budget[period?.id] || {};
  const periodTxs = txsForPeriod(transactions, period);
  const actuals   = sumByCategory(periodTxs, categories);
  const incCats   = categories.filter(c => c.type === 'income');
  const expCats   = categories.filter(c => c.type === 'expense');
  const totalInc  = incCats.reduce((s,c) => s+(actuals[c.id]||0), 0);
  const totalExp  = expCats.reduce((s,c) => s+(actuals[c.id]||0), 0);
  const net       = totalInc - totalExp;

  async function handleExport() {
    setLoading(true); setDone(false);
    await new Promise(r => setTimeout(r, 400));
    exportAnnualReport({ orgName, period, transactions: periodTxs, categories, budget: periodBudget });
    setLoading(false); setDone(true);
    setTimeout(() => setDone(false), 4000);
  }

  if (!period) return <div className="notice notice-warn">Inga räkenskapsperioder definierade.</div>;

  return (
    <div>
      <div className="notice notice-info">
        Generera en komplett PDF-årsrapport med resultaträkning och verifikatlista.
      </div>

      <div className="card" style={{ marginBottom:24 }}>
        <div className="section-title">Välj period – {orgName}</div>

        <div style={{ display:'flex', gap:16, alignItems:'flex-end', marginBottom:20, flexWrap:'wrap' }}>
          <div>
            <label>Räkenskapsperiod</label>
            <select value={selectedId} onChange={e => setSelectedId(e.target.value)} style={{ minWidth:200 }}>
              {[...fiscalPeriods].sort((a,b)=>b.start.localeCompare(a.start)).map(p => (
                <option key={p.id} value={p.id}>{p.label} ({p.start} – {p.end})</option>
              ))}
            </select>
          </div>
          {period && (
            <div style={{ fontSize:'0.82rem', color:'var(--ink-muted)', paddingBottom:6 }}>
              {periodTxs.length} verifikat · {period.start} till {period.end}
            </div>
          )}
        </div>

        <div className="stat-grid" style={{ marginBottom:20 }}>
          {[
            { label:'Antal verifikat', val: periodTxs.length, cls:'' },
            { label:'Totala intäkter', val: fmt(totalInc), cls:'positive' },
            { label:'Totala kostnader', val: fmt(totalExp), cls:'negative' },
            { label:'Nettoresultat', val: fmt(net), cls: net>=0?'positive':'negative' },
          ].map((s,i) => (
            <div key={i} className="stat-card">
              <div className="stat-label">{s.label}</div>
              <div className={`stat-value ${s.cls}`}>{s.val}</div>
            </div>
          ))}
        </div>

        {/* Mini preview table */}
        <div className="table-wrap" style={{ marginBottom:20 }}>
          <table>
            <thead><tr><th>Kategori</th><th className="text-right">Budget</th><th className="text-right">Utfall</th><th className="text-right">Avvikelse</th></tr></thead>
            <tbody>
              <tr><td colSpan={4} style={{ background:'var(--accent-3)', color:'var(--accent)', fontWeight:700, fontSize:'0.78rem', textTransform:'uppercase', letterSpacing:'0.06em' }}>Intäkter</td></tr>
              {incCats.filter(c=>(actuals[c.id]||0)!==0||(periodBudget[c.id]||0)!==0).map(c => {
                const act=actuals[c.id]||0, bud=periodBudget[c.id]||0;
                return (<tr key={c.id}>
                  <td><span className="badge badge-income">{c.id}</span> {c.name}</td>
                  <td className="mono text-right">{bud?fmt(bud):'–'}</td>
                  <td className="positive text-right">{fmt(act)}</td>
                  <td className={`mono text-right ${act-bud>=0?'positive':'negative'}`}>{bud?fmt(act-bud):'–'}</td>
                </tr>);
              })}
              <tr style={{ background:'var(--paper-2)', fontWeight:600 }}>
                <td>Summa intäkter</td>
                <td className="mono text-right">{fmt(incCats.reduce((s,c)=>s+(periodBudget[c.id]||0),0))}</td>
                <td className="positive text-right">{fmt(totalInc)}</td>
                <td className={`mono text-right ${totalInc-incCats.reduce((s,c)=>s+(periodBudget[c.id]||0),0)>=0?'positive':'negative'}`}>{fmt(totalInc-incCats.reduce((s,c)=>s+(periodBudget[c.id]||0),0))}</td>
              </tr>
              <tr><td colSpan={4} style={{ background:'var(--red-soft)', color:'var(--red)', fontWeight:700, fontSize:'0.78rem', textTransform:'uppercase', letterSpacing:'0.06em' }}>Kostnader</td></tr>
              {expCats.filter(c=>(actuals[c.id]||0)!==0||(periodBudget[c.id]||0)!==0).map(c => {
                const act=actuals[c.id]||0, bud=periodBudget[c.id]||0;
                return (<tr key={c.id}>
                  <td><span className="badge badge-expense">{c.id}</span> {c.name}</td>
                  <td className="mono text-right">{bud?fmt(bud):'–'}</td>
                  <td className="negative text-right">{fmt(act)}</td>
                  <td className={`mono text-right ${act-bud<=0?'positive':'negative'}`}>{bud?fmt(act-bud):'–'}</td>
                </tr>);
              })}
              <tr style={{ background:'var(--paper-2)', fontWeight:600 }}>
                <td>Summa kostnader</td>
                <td className="mono text-right">{fmt(expCats.reduce((s,c)=>s+(periodBudget[c.id]||0),0))}</td>
                <td className="negative text-right">{fmt(totalExp)}</td>
                <td className="mono text-right">{fmt(totalExp-expCats.reduce((s,c)=>s+(periodBudget[c.id]||0),0))}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td>NETTORESULTAT</td>
                <td className="text-right">{fmt(incCats.reduce((s,c)=>s+(periodBudget[c.id]||0),0)-expCats.reduce((s,c)=>s+(periodBudget[c.id]||0),0))}</td>
                <td className={`text-right ${net>=0?'positive':'negative'}`}>{fmt(net)}</td>
                <td className={`text-right ${net-(incCats.reduce((s,c)=>s+(periodBudget[c.id]||0),0)-expCats.reduce((s,c)=>s+(periodBudget[c.id]||0),0))>=0?'positive':'negative'}`}>{fmt(net-(incCats.reduce((s,c)=>s+(periodBudget[c.id]||0),0)-expCats.reduce((s,c)=>s+(periodBudget[c.id]||0),0)))}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {done && <div className="notice notice-success">PDF genererad och nedladdad!</div>}
        <button className="btn btn-primary" onClick={handleExport} disabled={loading} style={{ fontSize:'1rem', padding:'10px 24px' }}>
          {loading
            ? <><Loader size={16} style={{ animation:'spin 1s linear infinite' }}/> Genererar PDF…</>
            : <><FileDown size={16}/> Ladda ner rapport för {period?.label} (PDF)</>}
        </button>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
