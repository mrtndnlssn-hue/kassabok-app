import { useState } from 'react';
import { Plus, Trash2, Check, AlertCircle, Pencil, X, Lock, Unlock, Archive, Loader } from 'lucide-react';
import JSZip from 'jszip';
import { getYear, txsForPeriod, attachments } from '../store';
import { exportAnnualReport } from '../pdfExport';
import { useAuth } from '../auth/AuthProvider';


function periodsOverlap(a, b) {
  // Returns true if period a and b overlap
  return a.start <= b.end && a.end >= b.start;
}

function findOverlaps(periods, candidateStart, candidateEnd, excludeId = null) {
  // Returns list of period names that overlap with the candidate range
  const candidate = { start: candidateStart, end: candidateEnd };
  return periods
    .filter(p => p.id !== excludeId)
    .filter(p => periodsOverlap(p, candidate))
    .map(p => p.label);
}
function monthsBetween(start, end) {
  if (!start || !end) return '?';
  const s = new Date(start), e = new Date(end);
  return (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1;
}

// ── Stäng verksamhetsår – modal ──────────────────────────────
function CloseYearModal({ period, transactions, categories, budget, orgName, orgId, onDone, onCancel }) {
  const { orgId: ctxOrgId } = useAuth();
  const resolvedOrgId = orgId || ctxOrgId;
  const [step, setStep]     = useState('confirm');
  const [progress, setProgress] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const periodTxs    = txsForPeriod(transactions, period);
  const periodBudget = budget[period.id] || {};

  async function handleExport() {
    setStep('exporting');
    try {
      // ── Steg 1: Generera PDF ────────────────────────────────
      setProgress('Genererar PDF…');
      const doc = exportAnnualReport({
        orgName, period,
        transactions: periodTxs,
        categories,
        budget: periodBudget,
      });
      const pdfBlob = doc.output('blob');

      // ── Steg 2: Hämta bilagor från Supabase Storage ────────
      setProgress('Hämtar bilagor…');
      const txIds     = periodTxs.map(t => t.id);
      const attachList = await attachments.listForPeriod(resolvedOrgId, txIds);

      // ── Steg 3: Bygg ZIP i webbläsaren med JSZip ───────────
      setProgress(`Skapar ZIP (${attachList.length} bilagor)…`);
      const zip = new JSZip();

      // Lägg till PDF
      const safePeriod = period.label.replace(/[^a-zA-Z0-9_\-]/g, '_');
      zip.file(`arsrapport_${safePeriod}.pdf`, pdfBlob);

      // Mappa txId → verifikatnummer för läsbart mappnamn i ZIP
      const txVerMap = Object.fromEntries(
        periodTxs.map((t, i) => [t.id, `VER${String(i + 1).padStart(3, '0')}_${(t.description || 'verifikat').replace(/\s+/g, '_').slice(0, 30)}`])
      );

      for (let i = 0; i < attachList.length; i++) {
        setProgress(`Paketerar bilaga ${i + 1} av ${attachList.length}…`);
        const { txId, filename, blob } = attachList[i];
        const folder = txVerMap[txId] || txId;
        zip.file(`bilagor/${folder}/${filename}`, blob);
      }

      // ── Steg 4: Generera och ladda ner ZIP ─────────────────
      setProgress('Packar ihop ZIP…');
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      const url     = URL.createObjectURL(zipBlob);
      const a       = document.createElement('a');
      a.href        = url;
      a.download    = `kassabok_${safePeriod}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setStep('done');
    } catch (e) {
      console.error('ZIP-export error:', e);
      setErrorMsg(e.message || 'Okänt fel');
      setStep('error');
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <div className="modal-title" style={{ display:'flex', alignItems:'center', gap:8 }}>
            <Archive size={18} style={{ color:'var(--accent)' }}/>
            Stäng verksamhetsår – {period.label}
          </div>
          <button className="modal-close" onClick={onCancel}><X size={18}/></button>
        </div>

        {step === 'confirm' && (
          <>
            <div className="notice notice-info" style={{ marginBottom:20 }}>
              Skapar en ZIP-fil med årsrapporten (PDF) och alla bilagor för perioden <strong>{period.label}</strong> ({period.start} – {period.end}). Perioden låses sedan mot redigering.
            </div>
            <div style={{ background:'var(--paper-2)', borderRadius:'var(--r)', border:'1px solid var(--border)', padding:'14px 16px', marginBottom:20 }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                {[
                  { label:'Period', val:`${period.start} – ${period.end}` },
                  { label:'Antal verifikat', val:periodTxs.length },
                ].map((r,i) => (
                  <div key={i}>
                    <div style={{ fontSize:'0.72rem', color:'var(--ink-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:3 }}>{r.label}</div>
                    <div style={{ fontFamily:'var(--font-mono)', fontWeight:500 }}>{r.val}</div>
                  </div>
                ))}
              </div>
            </div>
            <p style={{ fontSize:'0.85rem', color:'var(--ink-soft)', marginBottom:20, lineHeight:1.7 }}>
              ZIP-filen innehåller:<br/>
              📄 <strong>arsrapport_{period.label}.pdf</strong> – resultaträkning och verifikatlista<br/>
              📁 <strong>bilagor/</strong> – alla uppladdade kvitton och fakturor
            </p>
            <div className="btn-row" style={{ justifyContent:'flex-end' }}>
              <button className="btn btn-secondary" onClick={onCancel}>Avbryt</button>
              <button className="btn btn-primary" onClick={handleExport}>
                <Archive size={14}/> Skapa ZIP och lås period
              </button>
            </div>
          </>
        )}

        {step === 'exporting' && (
          <div style={{ textAlign:'center', padding:'32px 0', display:'flex', flexDirection:'column', alignItems:'center', gap:16 }}>
            <Loader size={32} style={{ animation:'spin 1s linear infinite', color:'var(--accent)' }}/>
            <p style={{ color:'var(--ink-soft)', fontSize:'0.9rem' }}>{progress}</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {step === 'done' && (
          <>
            <div className="notice notice-success" style={{ marginBottom:20 }}>
              ✅ ZIP-filen har laddats ner och perioden är låst.
            </div>
            <p style={{ fontSize:'0.85rem', color:'var(--ink-soft)', marginBottom:20 }}>
              Förvara ZIP-filen på en säker plats. Du kan alltid se data i appen men inga ändringar kan göras i den låsta perioden.
            </p>
            <div className="btn-row" style={{ justifyContent:'flex-end' }}>
              <button className="btn btn-primary" onClick={onDone}>Stäng</button>
            </div>
          </>
        )}

        {step === 'error' && (
          <>
            <div className="notice" style={{ background:'var(--red-soft)', borderColor:'#f5c6cb', color:'var(--red)', marginBottom:20 }}>
              Något gick fel: {errorMsg}
            </div>
            <div className="btn-row" style={{ justifyContent:'flex-end' }}>
              <button className="btn btn-secondary" onClick={onCancel}>Avbryt</button>
              <button className="btn btn-primary" onClick={() => { setStep('confirm'); setErrorMsg(''); }}>Försök igen</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Huvudkomponent ───────────────────────────────────────────
export default function Rakenskapsperioder({ fiscalPeriods, transactions, categories, budget, orgName, orgId, onSave }) {
  const [periods, setPeriods]   = useState(fiscalPeriods);
  const [dirty, setDirty]       = useState(false);
  const [editIdx, setEditIdx]   = useState(null);
  const [editForm, setEditForm] = useState({});
  const [newForm, setNewForm]   = useState({ label:'', start:'', end:'' });
  const [error, setError]       = useState('');
  const [closeModal, setCloseModal] = useState(null);

  function startEdit(idx)  { setEditIdx(idx); setEditForm({ ...periods[idx] }); setError(''); }
  function cancelEdit()    { setEditIdx(null); setError(''); }

  function saveEdit() {
    setError('');
    if (!editForm.label?.trim())          { setError('Ange ett namn.'); return; }
    if (!editForm.start || !editForm.end) { setError('Ange start- och slutdatum.'); return; }
    if (editForm.start > editForm.end)    { setError('Startdatum måste vara före slutdatum.'); return; }
    const overlapping = findOverlaps(periods, editForm.start, editForm.end, editForm.id);
    if (overlapping.length > 0) {
      setError(`Perioden överlappar med: ${overlapping.join(', ')}. Justera start- eller slutdatum.`);
      return;
    }
    setPeriods(prev => prev.map((p, i) => i === editIdx ? { ...editForm, label: editForm.label.trim() } : p));
    setEditIdx(null); setDirty(true);
  }

  function addPeriod() {
    setError('');
    const label = newForm.label.trim();
    if (!label)                          { setError('Ange ett namn.'); return; }
    if (!newForm.start || !newForm.end)  { setError('Ange start- och slutdatum.'); return; }
    if (newForm.start > newForm.end)     { setError('Startdatum måste vara före slutdatum.'); return; }
    const overlapping = findOverlaps(periods, newForm.start, newForm.end);
    if (overlapping.length > 0) {
      setError(`Perioden överlappar med: ${overlapping.join(', ')}. Justera start- eller slutdatum.`);
      return;
    }
    const baseId = label.replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_\-]/g,'').slice(0,20) || Date.now().toString();
    const id = periods.find(p => p.id === baseId) ? `${baseId}_${Date.now()}` : baseId;
    setPeriods(prev => [...prev, { id, label, start:newForm.start, end:newForm.end }].sort((a,b) => a.start.localeCompare(b.start)));
    setNewForm({ label:'', start:'', end:'' }); setDirty(true);
  }

  function remove(idx) {
    if (periods.length <= 1)      { setError('Det måste finnas minst en period.'); return; }
    if (periods[idx].locked)      { setError('Låsta perioder kan inte tas bort.'); return; }
    setPeriods(prev => prev.filter((_,i) => i !== idx)); setDirty(true);
  }

  function toggleLock(idx) {
    setPeriods(prev => prev.map((p,i) => i === idx ? { ...p, locked: !p.locked } : p));
    setDirty(true);
  }

  function handleCloseYearDone() {
    const idx = periods.findIndex(p => p.id === closeModal.id);
    if (idx >= 0) setPeriods(prev => prev.map((p,i) => i === idx ? { ...p, locked:true } : p));
    setDirty(true);
    setCloseModal(null);
    // Save immediately so lock persists
    onSave(periods.map((p,i) => i === idx ? { ...p, locked:true } : p));
    setDirty(false);
  }

  function save() { onSave(periods); setDirty(false); }

  function handleNewStart(val) {
    setNewForm(f => ({ ...f, start:val, label: f.label || val.slice(0,4), end: f.end || `${val.slice(0,4)}-12-31` }));
  }

  const sorted = [...periods].sort((a,b) => a.start.localeCompare(b.start));

  return (
    <div>
      <div className="notice notice-info">
        Definiera räkenskapsperioder. Använd "Stäng år" för att skapa en ZIP-arkivfil med årsrapport och bilagor, och låsa perioden.
      </div>

      {error && <div className="notice" style={{ background:'var(--red-soft)', borderColor:'#f5c6cb', color:'var(--red)', marginBottom:16 }}>{error}</div>}

      {dirty && (
        <div className="notice notice-warn" style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
          <span><AlertCircle size={14} style={{ display:'inline', marginRight:6 }}/>Osparade ändringar.</span>
          <button className="btn btn-primary btn-sm" onClick={save}><Check size={13}/> Spara nu</button>
        </div>
      )}

      <div className="card" style={{ marginBottom:24 }}>
        <div className="section-title">Räkenskapsperioder</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Namn</th><th>Startdatum</th><th>Slutdatum</th>
                <th style={{textAlign:'center'}}>Längd</th>
                <th style={{textAlign:'center'}}>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => {
                const globalIdx = periods.indexOf(p);
                const txCount   = txsForPeriod(transactions, p).length;
                return editIdx === globalIdx ? (
                  <tr key={p.id} style={{ background:'var(--amber-soft)' }}>
                    <td><input value={editForm.label} onChange={e => setEditForm(f=>({...f,label:e.target.value}))} style={{width:'100%'}} autoFocus/></td>
                    <td><input type="date" value={editForm.start} onChange={e => setEditForm(f=>({...f,start:e.target.value}))} style={{width:'100%'}}/></td>
                    <td><input type="date" value={editForm.end}   onChange={e => setEditForm(f=>({...f,end:e.target.value}))}   style={{width:'100%'}}/></td>
                    <td style={{textAlign:'center',fontFamily:'var(--font-mono)',fontSize:'0.82rem',color:'var(--ink-muted)'}}>{monthsBetween(editForm.start,editForm.end)} mån</td>
                    <td/>
                    <td>
                      <div className="gap-row" style={{gap:4}}>
                        <button className="btn btn-sm btn-primary" onClick={saveEdit}><Check size={12}/></button>
                        <button className="btn btn-sm btn-secondary" onClick={cancelEdit}><X size={12}/></button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={p.id} style={{ opacity: p.locked ? 0.85 : 1 }}>
                    <td style={{fontWeight:500}}>
                      {p.locked && <Lock size={11} style={{color:'var(--ink-muted)',marginRight:5,verticalAlign:'middle'}}/>}
                      {p.label}
                    </td>
                    <td className="mono">{p.start}</td>
                    <td className="mono">{p.end}</td>
                    <td style={{textAlign:'center'}}>
                      <span style={{
                        fontFamily:'var(--font-mono)', fontSize:'0.8rem',
                        background: monthsBetween(p.start,p.end)===12 ? 'var(--accent-3)' : 'var(--amber-soft)',
                        color:      monthsBetween(p.start,p.end)===12 ? 'var(--accent)'   : 'var(--amber)',
                        padding:'2px 8px', borderRadius:99, border:'1px solid',
                        borderColor: monthsBetween(p.start,p.end)===12 ? 'var(--accent-2)' : '#fcd34d',
                      }}>
                        {monthsBetween(p.start,p.end)} mån
                      </span>
                    </td>
                    <td style={{textAlign:'center'}}>
                      {p.locked
                        ? <span className="badge" style={{background:'var(--paper-3)',color:'var(--ink-muted)',gap:4}}><Lock size={10}/> Låst</span>
                        : <span className="badge badge-income">Öppen · {txCount} ver.</span>
                      }
                    </td>
                    <td>
                      <div className="gap-row" style={{gap:4}}>
                        {!p.locked && <>
                          <button className="btn btn-sm btn-secondary" onClick={() => startEdit(globalIdx)} title="Redigera"><Pencil size={12}/></button>
                          <button className="btn btn-sm btn-primary" onClick={() => setCloseModal(p)} title="Stäng verksamhetsår och skapa ZIP">
                            <Archive size={12}/> Stäng år
                          </button>
                          <button className="btn btn-sm btn-danger" onClick={() => remove(globalIdx)} title="Ta bort"><Trash2 size={12}/></button>
                        </>}
                        {p.locked &&
                          <button className="btn btn-sm btn-secondary" onClick={() => toggleLock(globalIdx)} title="Lås upp">
                            <Unlock size={12}/> Lås upp
                          </button>
                        }
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginBottom:24 }}>
        <div className="section-title">Lägg till ny period</div>
        <div className="form-row form-row-cols" style={{ alignItems:'flex-end' }}>
          <div><label>Namn</label><input value={newForm.label} onChange={e=>setNewForm(f=>({...f,label:e.target.value}))} placeholder="t.ex. 2025"/></div>
          <div><label>Startdatum</label><input type="date" value={newForm.start} onChange={e=>handleNewStart(e.target.value)}/></div>
          <div><label>Slutdatum</label><input type="date" value={newForm.end} onChange={e=>setNewForm(f=>({...f,end:e.target.value}))}/></div>
          <div>
            {newForm.start && newForm.end && (
              <div style={{fontSize:'0.78rem',marginBottom:6,color: findOverlaps(periods, newForm.start, newForm.end).length > 0 ? 'var(--red)' : 'var(--ink-muted)'}}>
                {findOverlaps(periods, newForm.start, newForm.end).length > 0
                  ? `⚠ Överlappar ${findOverlaps(periods, newForm.start, newForm.end).join(', ')}`
                  : `= ${monthsBetween(newForm.start,newForm.end)} månader`
                }
              </div>
            )}
            <button className="btn btn-primary" onClick={addPeriod}><Plus size={14}/> Lägg till</button>
          </div>
        </div>
        <div style={{ marginTop:14, display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
          <span style={{fontSize:'0.78rem',color:'var(--ink-muted)'}}>Snabbval:</span>
          {[
            { label:`${getYear()} (kalenderår)`, start:`${getYear()}-01-01`, end:`${getYear()}-12-31`, name:String(getYear()) },
            { label:`${getYear()}/${getYear()+1} (jul–jun)`, start:`${getYear()}-07-01`, end:`${getYear()+1}-06-30`, name:`${getYear()}/${getYear()+1}` },
            { label:`${getYear()}/${getYear()+1} (sep–aug)`, start:`${getYear()}-09-01`, end:`${getYear()+1}-08-31`, name:`${getYear()}/${getYear()+1}` },
          ].map((preset,i) => (
            <button key={i} className="btn btn-secondary btn-sm" onClick={() => setNewForm({label:preset.name,start:preset.start,end:preset.end})}>
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {dirty && <div style={{textAlign:'right'}}><button className="btn btn-primary" onClick={save}><Check size={14}/> Spara alla ändringar</button></div>}

      {closeModal && (
        <CloseYearModal
          period={closeModal}
          transactions={transactions}
          categories={categories}
          budget={budget}
          orgName={orgName}
          orgId={orgId}
          onDone={handleCloseYearDone}
          onCancel={() => setCloseModal(null)}
        />
      )}
    </div>
  );
}
