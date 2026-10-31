import { useState, useMemo } from 'react';
import { fmt, txsForPeriod, sumByCategory } from '../store';
import { useAuth } from '../auth/AuthProvider';

function CatRow({ cat, budgetValue, actual, onBudgetChange, canWrite }) {
  const [localVal, setLocalVal] = useState(budgetValue > 0 ? String(budgetValue) : '');
  const act = actual || 0;
  const bud = budgetValue || 0;
  const dev = act - bud;
  const pct = bud > 0 ? Math.min((act / bud) * 100, 150) : 0;
  const barClass = pct > 100 ? 'over' : pct > 80 ? 'warn' : 'ok';

  function handleBlur() {
    const parsed = parseFloat(localVal.replace(',', '.')) || 0;
    setLocalVal(parsed > 0 ? String(parsed) : '');
    onBudgetChange(cat.id, parsed);
  }

  return (
    <tr>
      <td><span className={`badge ${cat.type==='income'?'badge-income':'badge-expense'}`}>{cat.id}</span></td>
      <td>{cat.name}</td>
      <td style={{ width:160 }}>
        <input
          type="number" step="100" min="0"
          value={localVal} placeholder="0"
          onChange={e => canWrite && setLocalVal(e.target.value)}
          onBlur={canWrite ? handleBlur : undefined}
          onKeyDown={e => canWrite && e.key==='Enter' && e.target.blur()}
          readOnly={!canWrite}
          style={{ width:'100%', textAlign:'right', fontFamily:'var(--font-mono)', fontSize:'0.85rem', background:'var(--paper)', border:'1px solid var(--border)', borderRadius:'var(--r)', padding:'5px 8px', color:'var(--blue)', cursor: canWrite ? 'text' : 'default' }}
        />
      </td>
      <td className={`text-right mono ${act>0?(cat.type==='income'?'positive':'negative'):''}`}>
        {act!==0 ? fmt(act) : <span style={{color:'var(--ink-muted)'}}>–</span>}
      </td>
      <td className={`text-right mono ${dev>0?'positive':dev<0?'negative':''}`}>
        {bud>0||act!==0 ? (dev>0?'+':'')+fmt(dev) : <span style={{color:'var(--ink-muted)'}}>–</span>}
      </td>
      <td style={{ width:120 }}>
        {bud>0 && (
          <>
            <div style={{ fontSize:'0.72rem', color:'var(--ink-muted)', textAlign:'right', marginBottom:2 }}>{Math.round((act/bud)*100)}%</div>
            <div className="progress-bar"><div className={`progress-fill ${barClass}`} style={{ width:`${Math.min(pct,100)}%` }}/></div>
          </>
        )}
      </td>
    </tr>
  );
}

function SectionTotal({ label, budgetTotal, actualTotal }) {
  const dev = actualTotal - budgetTotal;
  return (
    <tr style={{ background:'var(--paper-2)', fontWeight:600 }}>
      <td colSpan={2} style={{ fontFamily:'var(--font-body)', fontWeight:700, paddingLeft:14 }}>{label}</td>
      <td className="text-right mono">{fmt(budgetTotal)}</td>
      <td className="text-right mono">{fmt(actualTotal)}</td>
      <td className={`text-right mono ${dev>=0?'positive':'negative'}`}>{(dev>0?'+':'')+fmt(dev)}</td>
      <td/>
    </tr>
  );
}

export default function BudgetResultat({ transactions, categories, budget, onBudgetChange, activePeriod }) {
  const { role } = useAuth()
  const canWrite = role !== 'viewer'
  const periodTxs    = useMemo(() => txsForPeriod(transactions, activePeriod), [transactions, activePeriod]);
  const actuals      = useMemo(() => sumByCategory(periodTxs, categories), [periodTxs, categories]);
  const periodBudget = budget[activePeriod?.id] || {};

  const incCats = categories.filter(c => c.type === 'income' && !c.hidden);
  const expCats = categories.filter(c => c.type === 'expense' && !c.hidden);
  const totalBudgetInc = incCats.reduce((s,c) => s+(periodBudget[c.id]||0), 0);
  const totalBudgetExp = expCats.reduce((s,c) => s+(periodBudget[c.id]||0), 0);
  const totalActualInc = incCats.reduce((s,c) => s+(actuals[c.id]||0), 0);
  const totalActualExp = expCats.reduce((s,c) => s+(actuals[c.id]||0), 0);
  const netBudget = totalBudgetInc - totalBudgetExp;
  const netActual = totalActualInc - totalActualExp;

  const label = activePeriod?.label || '–';
  const span  = activePeriod ? `${activePeriod.start} – ${activePeriod.end}` : '';

  if (!activePeriod) return <div className="notice notice-warn">Ingen period vald.</div>;

  return (
    <div>
      <div className="notice notice-info" style={{ marginBottom:20 }}>
        Budget för perioden <strong>{label}</strong> ({span}). Ange belopp och tryck Tab eller Enter.
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16, marginBottom:24 }}>
        {[
          { label:'Budgeterat netto', value:netBudget, muted:true },
          { label:'Faktiskt netto', value:netActual },
          { label:'Avvikelse', value:netActual-netBudget },
        ].map((item,i) => (
          <div key={i} className="stat-card">
            <div className="stat-label">{item.label}</div>
            <div className={`stat-value ${item.muted?'':item.value>=0?'positive':'negative'}`} style={item.muted?{color:'var(--ink-muted)'}:{}}>
              {fmt(item.value)}
            </div>
          </div>
        ))}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Kod</th><th>Kategori</th>
              <th className="text-right">Budget {label} (kr)</th>
              <th className="text-right">Utfall (kr)</th>
              <th className="text-right">Avvikelse (kr)</th>
              <th>Nyttjandegrad</th>
            </tr>
          </thead>
          <tbody>
            <tr><td colSpan={6} style={{ background:'var(--accent)', color:'#fff', fontWeight:700, fontSize:'0.75rem', letterSpacing:'0.08em', textTransform:'uppercase', padding:'7px 14px' }}>Intäkter</td></tr>
            {incCats.map(cat => (
              <CatRow key={cat.id} cat={cat}
                budgetValue={periodBudget[cat.id]||0}
                actual={actuals[cat.id]||0}
                canWrite={canWrite}
                onBudgetChange={(catId, amount) => onBudgetChange(activePeriod.id, catId, amount)}
              />
            ))}
            <SectionTotal label="Summa intäkter" budgetTotal={totalBudgetInc} actualTotal={totalActualInc}/>

            <tr><td colSpan={6} style={{ background:'var(--red)', color:'#fff', fontWeight:700, fontSize:'0.75rem', letterSpacing:'0.08em', textTransform:'uppercase', padding:'7px 14px' }}>Kostnader</td></tr>
            {expCats.map(cat => (
              <CatRow key={cat.id} cat={cat}
                budgetValue={periodBudget[cat.id]||0}
                actual={actuals[cat.id]||0}
                canWrite={canWrite}
                onBudgetChange={(catId, amount) => onBudgetChange(activePeriod.id, catId, amount)}
              />
            ))}
            <SectionTotal label="Summa kostnader" budgetTotal={totalBudgetExp} actualTotal={totalActualExp}/>
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} style={{ fontFamily:'var(--font-body)' }}>NETTORESULTAT</td>
              <td className="text-right">{fmt(netBudget)}</td>
              <td className={`text-right ${netActual>=0?'positive':'negative'}`}>{fmt(netActual)}</td>
              <td className={`text-right ${(netActual-netBudget)>=0?'positive':'negative'}`}>{((netActual-netBudget)>0?'+':'')+fmt(netActual-netBudget)}</td>
              <td/>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
