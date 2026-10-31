import { useState, useMemo } from 'react';
import { fmt, txsForPeriod, sumByCategory } from '../store';
import { useAuth } from '../auth/AuthProvider';
import { Lock, Unlock } from 'lucide-react';
import { useI18n } from '../i18n';

function CatRow({ cat, budgetValue, actual, comment, onBudgetChange, onCommentChange, canWrite }) {
  const { t } = useI18n();
  const [localVal, setLocalVal] = useState(budgetValue > 0 ? String(budgetValue) : '');
  const [localComment, setLocalComment] = useState(comment || '');

  function handleCommentBlur() {
    const text = localComment.trim();
    setLocalComment(text);
    if (text !== (comment || '')) onCommentChange(cat.id, text);
  }
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
      <td style={{ minWidth:180 }}>
        <input
          type="text"
          value={localComment} placeholder={canWrite ? t('Kommentar…') : ''}
          onChange={e => canWrite && setLocalComment(e.target.value)}
          onBlur={canWrite ? handleCommentBlur : undefined}
          onKeyDown={e => canWrite && e.key==='Enter' && e.target.blur()}
          readOnly={!canWrite}
          style={{ width:'100%', fontSize:'0.85rem', background:'var(--paper)', border:'1px solid var(--border)', borderRadius:'var(--r)', padding:'5px 8px', cursor: canWrite ? 'text' : 'default' }}
        />
      </td>
    </tr>
  );
}

function SectionTotal({ label, budgetTotal, actualTotal }) {
  const { t } = useI18n();
  const dev = actualTotal - budgetTotal;
  return (
    <tr style={{ background:'var(--paper-2)', fontWeight:600 }}>
      <td colSpan={2} style={{ fontFamily:'var(--font-body)', fontWeight:700, paddingLeft:14 }}>{t(label)}</td>
      <td className="text-right mono">{fmt(budgetTotal)}</td>
      <td className="text-right mono">{fmt(actualTotal)}</td>
      <td className={`text-right mono ${dev>=0?'positive':'negative'}`}>{(dev>0?'+':'')+fmt(dev)}</td>
      <td/><td/>
    </tr>
  );
}

export default function BudgetResultat({ transactions, categories, budget, budgetComments = {}, onBudgetChange, onCommentChange, onLockChange, activePeriod }) {
  const { t } = useI18n();
  const { role } = useAuth()
  const isMember = role !== 'viewer'
  const budgetLocked = !!activePeriod?.budgetLocked
  const canWrite = isMember && !budgetLocked
  const [lockError, setLockError] = useState('')

  async function toggleBudgetLock() {
    setLockError('')
    try { await onLockChange(activePeriod.id, !budgetLocked) }
    catch (e) { setLockError(e.message || t('Kunde inte ändra låsningen.')) }
  }
  const periodTxs    = useMemo(() => txsForPeriod(transactions, activePeriod), [transactions, activePeriod]);
  const actuals      = useMemo(() => sumByCategory(periodTxs, categories), [periodTxs, categories]);
  const periodBudget = budget[activePeriod?.id] || {};
  const periodComments = budgetComments[activePeriod?.id] || {};

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

  if (!activePeriod) return <div className="notice notice-warn">{t('Ingen period vald.')}</div>;

  return (
    <div>
      <div className="notice notice-info" style={{ marginBottom:20, display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
        <span>
          {budgetLocked
            ? <><Lock size={13} style={{ display:'inline', verticalAlign:'middle', marginRight:6 }}/>{t('Budgeten för')} <strong>{label}</strong> ({span}) {t('är låst och kan inte ändras.')}</>
            : <>{t('Budget för perioden')} <strong>{label}</strong> ({span}). {t('Ange belopp och tryck Tab eller Enter.')}</>}
        </span>
        {isMember && (
          <button className="btn btn-sm btn-secondary" onClick={toggleBudgetLock}>
            {budgetLocked ? <><Unlock size={12}/> {t('Lås upp budget')}</> : <><Lock size={12}/> {t('Lås budget')}</>}
          </button>
        )}
      </div>
      {lockError && <div className="notice" style={{ background:'var(--red-soft)', borderColor:'var(--red)', color:'var(--red)', marginBottom:16 }}>{lockError}</div>}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16, marginBottom:24 }}>
        {[
          { label:t('Budgeterat netto'), value:netBudget, muted:true },
          { label:t('Faktiskt netto'), value:netActual },
          { label:t('Avvikelse'), value:netActual-netBudget },
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
              <th>{t('Kod')}</th><th>{t('Kategori')}</th>
              <th className="text-right">{t('Budget {label} (kr)', { label })}</th>
              <th className="text-right">{t('Utfall (kr)')}</th>
              <th className="text-right">{t('Avvikelse (kr)')}</th>
              <th>{t('Nyttjandegrad')}</th>
              <th>{t('Kommentar')}</th>
            </tr>
          </thead>
          <tbody>
            <tr><td colSpan={7} style={{ background:'var(--accent)', color:'#fff', fontWeight:700, fontSize:'0.75rem', letterSpacing:'0.08em', textTransform:'uppercase', padding:'7px 14px' }}>{t('Intäkter')}</td></tr>
            {incCats.map(cat => (
              <CatRow key={`${activePeriod.id}-${cat.id}`} cat={cat}
                budgetValue={periodBudget[cat.id]||0}
                actual={actuals[cat.id]||0}
                comment={periodComments[cat.id]||''}
                canWrite={canWrite}
                onBudgetChange={(catId, amount) => onBudgetChange(activePeriod.id, catId, amount)}
                onCommentChange={(catId, text) => onCommentChange(activePeriod.id, catId, text)}
              />
            ))}
            <SectionTotal label="Summa intäkter" budgetTotal={totalBudgetInc} actualTotal={totalActualInc}/>

            <tr><td colSpan={7} style={{ background:'var(--red)', color:'#fff', fontWeight:700, fontSize:'0.75rem', letterSpacing:'0.08em', textTransform:'uppercase', padding:'7px 14px' }}>{t('Kostnader')}</td></tr>
            {expCats.map(cat => (
              <CatRow key={`${activePeriod.id}-${cat.id}`} cat={cat}
                budgetValue={periodBudget[cat.id]||0}
                actual={actuals[cat.id]||0}
                comment={periodComments[cat.id]||''}
                canWrite={canWrite}
                onBudgetChange={(catId, amount) => onBudgetChange(activePeriod.id, catId, amount)}
                onCommentChange={(catId, text) => onCommentChange(activePeriod.id, catId, text)}
              />
            ))}
            <SectionTotal label="Summa kostnader" budgetTotal={totalBudgetExp} actualTotal={totalActualExp}/>
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} style={{ fontFamily:'var(--font-body)' }}>{t('NETTORESULTAT')}</td>
              <td className="text-right">{fmt(netBudget)}</td>
              <td className={`text-right ${netActual>=0?'positive':'negative'}`}>{fmt(netActual)}</td>
              <td className={`text-right ${(netActual-netBudget)>=0?'positive':'negative'}`}>{((netActual-netBudget)>0?'+':'')+fmt(netActual-netBudget)}</td>
              <td/><td/>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
