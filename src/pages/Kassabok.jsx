import { useState, useMemo, useRef, useEffect } from 'react';
import { Plus, Pencil, Trash2, X, Check, Search, Paperclip, Upload, FileText, Sparkles, Camera } from 'lucide-react';
import { getReceiptUsage, readReceipt, canReadWithAi } from '../receiptAi';
import AttachmentPanel from './AttachmentPanel';
import { fmt, txsForPeriod, todayStr, isValidIsoDate, txLines } from '../store';
import DateInput from '../components/DateInput';
import { useAuth } from '../auth/AuthProvider';
import { useI18n } from '../i18n';
import useIsMobile from '../hooks/useIsMobile';

const emptyForm = () => ({
  date: todayStr(),
  description: '',
  lines: [{ categoryId: '', amount: '' }],   // ett verifikat kan bokföras på flera konton
  comment: '',
});

export default function Kassabok({ orgId, transactions, categories, onAdd, onUpdate, onDelete, activePeriod, addRequest, onAddHandled }) {
  const { t } = useI18n()
  const isMobile = useIsMobile()
  const { role } = useAuth()
  const canWrite = role !== 'viewer'
  const period = activePeriod;
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [attachTx, setAttachTx]       = useState(null); // {tx, verNum}
  const [filterCat, setFilterCat]     = useState('all');
  const [newFiles, setNewFiles]       = useState([]); // [{file, url}]
  const [previewIdx, setPreviewIdx]   = useState(0);
  const [saving, setSaving]           = useState(false);
  const [saveError, setSaveError]     = useState('');
  const [dragOver, setDragOver]       = useState(false);
  const [aiUsage, setAiUsage]       = useState(null); // {enabled, used, limit}
  const [aiBusy, setAiBusy]         = useState(false);
  const [aiMsg, setAiMsg]           = useState(null); // {type: 'ok'|'error', text}
  const fileRef = useRef();
  const cameraRef = useRef();

  // "+" i mobilens flikmeny ber om ett nytt verifikat
  useEffect(() => {
    if (!addRequest) return
    if (!activePeriod?.locked) openAdd()
    onAddHandled?.()
  }, [addRequest])

  const yearTxs = useMemo(() => txsForPeriod(transactions, period), [transactions, period]);
  const catMap   = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c])), [categories]);

  const filtered = useMemo(() => {
    let txs = [...yearTxs].sort((a, b) => b.date?.localeCompare(a.date));
    if (search) {
      const q = search.toLowerCase();
      txs = txs.filter(x =>
        x.description?.toLowerCase().includes(q) ||
        txLines(x).some(l => l.categoryId?.toLowerCase().includes(q) || catMap[l.categoryId]?.name.toLowerCase().includes(q))
      );
    }
    if (filterType !== 'all') {
      txs = txs.filter(x => txLines(x).some(l => catMap[l.categoryId]?.type === filterType));
    }
    if (filterCat !== 'all') {
      txs = txs.filter(x => txLines(x).some(l => l.categoryId === filterCat));
    }
    return txs;
  }, [yearTxs, search, filterType, filterCat, catMap]);

  // De rader av ett verifikat som matchar filtren (så att summorna stämmer när man filtrerar på ett konto)
  const shownLines = tx => txLines(tx).filter(l =>
    (filterCat === 'all' || l.categoryId === filterCat) &&
    (filterType === 'all' || catMap[l.categoryId]?.type === filterType));
  const sumType = (lines, type) => lines.filter(l => catMap[l.categoryId]?.type === type).reduce((s, l) => s + Number(l.amount), 0);

  const totalIncome  = filtered.reduce((s, x) => s + sumType(shownLines(x), 'income'), 0);
  const totalExpense = filtered.reduce((s, x) => s + sumType(shownLines(x), 'expense'), 0);

  // ── Konton på verifikatet (ett eller flera) ──
  const isSplit      = form.lines.length > 1;
  const linesTotal   = form.lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const lineTypes    = new Set(form.lines.filter(l => l.categoryId).map(l => catMap[l.categoryId]?.type));
  const mixedTypes   = lineTypes.size > 1;
  const setLine      = (i, patch) => setForm(f => ({ ...f, lines: f.lines.map((l, j) => j === i ? { ...l, ...patch } : l) }));
  const addLine      = () => setForm(f => ({ ...f, lines: [...f.lines, { categoryId: '', amount: '' }] }));
  const removeLine   = i => setForm(f => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }));

  function openAdd() {
    setForm(emptyForm());
    setEditId(null);
    setNewFiles([]);
    setSaveError('');
    setAiMsg(null);
    getReceiptUsage(orgId).then(setAiUsage).catch(() => setAiUsage(null));
    setShowModal(true);
  }
  async function handleAiRead() {
    if (!preview) return;
    setAiBusy(true); setAiMsg(null);
    try {
      const r = await readReceipt(orgId, preview.file, categories.filter(c => !c.hidden));
      setForm(f => ({
        ...f,
        date:        r.date || f.date,
        description: r.description || f.description,
        // AI-förslaget är ett enda konto: ersätter en eventuell uppdelning
        lines: [{
          categoryId: r.category_id || f.lines[0]?.categoryId || '',
          amount:     r.amount != null ? String(r.amount) : (f.lines.length === 1 ? f.lines[0].amount : ''),
        }],
      }));
      setAiUsage(u => u && { ...u, used: r.used, limit: r.limit });
      setAiMsg({ type: 'ok', text: r.confidence === 'high'
        ? t('Förslag ifyllt. Kontrollera uppgifterna innan du sparar.')
        : t('Förslag ifyllt, men avläsningen är osäker. Kontrollera datum och belopp noga.') });
    } catch (e) {
      setAiMsg({ type: 'error', text: t(e.message) });
    } finally {
      setAiBusy(false);
    }
  }
  function openEdit(tx) {
    setForm({ date: tx.date, description: tx.description || '', comment: tx.comment || '',
      lines: txLines(tx).map(l => ({ categoryId: l.categoryId, amount: String(l.amount) })) });
    setEditId(tx.id);
    setNewFiles([]);
    setSaveError('');
    setShowModal(true);
  }
  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValidIsoDate(form.date)) { setSaveError(t('Ange ett giltigt datum på formatet YYYY-MM-DD.')); return; }
    if (form.lines.some(l => !l.categoryId || !(parseFloat(l.amount) > 0))) { setSaveError(t('Välj konto och ange belopp för varje rad.')); return; }
    if (mixedTypes) { setSaveError(t('Alla konton på ett verifikat måste vara av samma typ (alla intäkter eller alla kostnader).')); return; }
    const lines = form.lines.map(l => ({ categoryId: l.categoryId, amount: parseFloat(l.amount) }));
    const payload = { date: form.date, description: form.description, comment: form.comment, lines };
    setSaving(true);
    setSaveError('');
    try {
      if (editId) await onUpdate(editId, payload);
      else await onAdd(payload, newFiles.map(f => f.file));
      setShowModal(false);
    } catch (err) {
      setSaveError(t('Kunde inte spara: {fel}', { fel: err.message || t('okänt fel') }));
    } finally {
      setSaving(false);
    }
  }
  function addFiles(fileList) {
    const added = Array.from(fileList || []).map(file => ({
      file,
      url: /^(image\/|application\/pdf$)/.test(file.type) ? URL.createObjectURL(file) : null,
    }));
    setNewFiles(prev => [...prev, ...added]);
    setPreviewIdx(newFiles.length);
    if (fileRef.current) fileRef.current.value = '';
  }
  function removeFile(i) {
    setNewFiles(prev => {
      if (prev[i]?.url) URL.revokeObjectURL(prev[i].url);
      return prev.filter((_, j) => j !== i);
    });
    setPreviewIdx(0);
  }
  function closeModal() {
    newFiles.forEach(f => f.url && URL.revokeObjectURL(f.url));
    setNewFiles([]);
    setShowModal(false);
  }
  const preview = newFiles[previewIdx] || newFiles[0];
  function handleDelete(id) {
    if (deleteConfirm === id) { onDelete(id); setDeleteConfirm(null); }
    else setDeleteConfirm(id);
  }

  const visibleCats = categories.filter(c => !c.hidden);
  const incCats  = visibleCats.filter(c => c.type === 'income');
  const expCats  = visibleCats.filter(c => c.type === 'expense');
  const categoryOptions = (
    <>
      <option value="">{t('– Välj kategori –')}</option>
      <optgroup label={t('Intäkter')}>
        {incCats.map(c => <option key={c.id} value={c.id}>{c.id} – {c.name}</option>)}
      </optgroup>
      <optgroup label={t('Kostnader')}>
        {expCats.map(c => <option key={c.id} value={c.id}>{c.id} – {c.name}</option>)}
      </optgroup>
    </>
  );

  return (
    <div>
      {/* Toolbar */}
      <div className="gap-row" style={{ marginBottom: 20 }}>
        <div style={{ position: 'relative', flex: isMobile ? '1 1 100%' : 1, maxWidth: isMobile ? 'none' : 300 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-muted)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('Sök verifikat…')}
            style={{ paddingLeft: 32 }}
          />
        </div>
        <select value={filterType} onChange={e => { setFilterType(e.target.value); setFilterCat('all'); }} style={{ width: isMobile ? 'calc(50% - 4px)' : 'auto' }}>
          <option value="all">{t('Alla typer')}</option>
          <option value="income">{t('Intäkter')}</option>
          <option value="expense">{t('Kostnader')}</option>
        </select>
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={{ width: isMobile ? 'calc(50% - 4px)' : 'auto', maxWidth: isMobile ? 'none' : 220 }}>
          <option value="all">{t('Alla konton')}</option>
          {categories
            .filter(c => filterType === 'all' || c.type === filterType)
            .sort((a, b) => String(a.id).localeCompare(String(b.id), 'sv', { numeric: true }))
            .map(c => <option key={c.id} value={c.id}>{c.id} – {c.name}</option>)}
        </select>
        <div className="ml-auto">
          {canWrite && !isMobile && (
            <button className="btn btn-primary" onClick={openAdd} disabled={!!activePeriod?.locked} style={{ opacity: activePeriod?.locked ? 0.4 : 1, cursor: activePeriod?.locked ? "not-allowed" : "pointer" }}>
              <Plus size={15} /> {t('Lägg till verifikat')}
            </button>
          )}
        </div>
      </div>

      {/* Locked period warning */}
      {activePeriod?.locked && (
        <div className="notice" style={{ background:'var(--paper-2)', borderColor:'var(--border)', color:'var(--ink-soft)', marginBottom:16, display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:'1rem' }}>🔒</span>
          <span>{t('Perioden')} <strong>{activePeriod.label}</strong> {t('är låst och kan inte redigeras. Lås upp den under Räkenskapsperioder om du behöver göra ändringar.')}</span>
        </div>
      )}

      {/* Tabell (dator) / kortlista (telefon) */}
      {isMobile ? (
        <div>
          <div className="m-summary">
            <span>{t('Totalt ({n} verifikat)', { n: filtered.length })}</span>
            <span className="mono" style={{ color: 'var(--accent)' }}>{fmt(totalIncome)}</span>
            <span className="mono" style={{ color: 'var(--red)' }}>{fmt(totalExpense)}</span>
          </div>
          {filtered.length === 0 && (
            <div className="empty-state"><p>{t('Inga verifikat att visa.')}</p></div>
          )}
          {filtered.map((tx, i) => {
            const lines = txLines(tx);
            const shown = shownLines(tx);
            const incAmt = sumType(shown, 'income');
            const expAmt = sumType(shown, 'expense');
            return (
              <div className="m-card" key={tx.id}>
                <div className="m-card-top">
                  <span className="m-date">{tx.date} · {String(i + 1).padStart(3, '0')}</span>
                  <span className={`m-amount ${incAmt ? 'positive' : 'negative'}`}>{incAmt ? `+${fmt(incAmt)}` : `−${fmt(expAmt)}`}</span>
                </div>
                <div className="m-card-desc">{tx.description || '–'}</div>
                {lines.map((l, k) => {
                  const c = catMap[l.categoryId];
                  return (
                    <div className="m-card-cat" key={k}>
                      <span className={`badge ${c?.type === 'income' ? 'badge-income' : 'badge-expense'}`}>{c?.id || l.categoryId}</span>
                      <span>{c?.name}</span>
                      {lines.length > 1 && <span className="mono" style={{ color: 'var(--ink-muted)' }}>{fmt(l.amount)}</span>}
                    </div>
                  );
                })}
                {tx.comment && <div className="m-card-comment">{tx.comment}</div>}
                <div className="m-card-actions">
                  <button className="btn btn-secondary" onClick={() => setAttachTx({ tx, verNum: i + 1 })} aria-label={t('Bilagor')}><Paperclip size={15} /> {t('Bilagor')}</button>
                  {canWrite && (
                    <>
                      <button className="btn btn-secondary" onClick={() => openEdit(tx)} disabled={!!activePeriod?.locked} aria-label={t('Redigera')}><Pencil size={15} /></button>
                      <button className={`btn ${deleteConfirm === tx.id ? 'btn-danger' : 'btn-secondary'}`} onClick={() => handleDelete(tx.id)} disabled={!!activePeriod?.locked}
                        aria-label={deleteConfirm === tx.id ? t('Bekräfta radering') : t('Radera')}>
                        {deleteConfirm === tx.id ? <Check size={15} /> : <Trash2 size={15} />}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
      <div className="table-wrap" style={{ marginBottom: 16 }}>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>{t('Datum')}</th>
              <th>{t('Beskrivning')}</th>
              <th>{t('Kategori')}</th>
              <th>{t('Typ')}</th>
              <th className="text-right">{t('Inkomst')}</th>
              <th className="text-right">{t('Utgift')}</th>
              <th>{t('Kommentar')}</th>
              <th style={{textAlign:'center'}}>{t('Bilagor')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: '40px', color: 'var(--ink-muted)' }}>
                {t('Inga verifikat att visa.')}
              </td></tr>
            )}
            {filtered.map((tx, i) => {
              const lines = txLines(tx);
              const isInc = catMap[lines[0].categoryId]?.type === 'income';
              const shown = shownLines(tx);
              const incAmt = sumType(shown, 'income');
              const expAmt = sumType(shown, 'expense');
              return (
                <tr key={tx.id}>
                  <td className="mono" style={{ color: 'var(--ink-muted)' }}>{String(i + 1).padStart(3, '0')}</td>
                  <td className="mono">{tx.date}</td>
                  <td>{tx.description || <em style={{ color: 'var(--ink-muted)' }}>–</em>}</td>
                  <td>
                    {lines.map((l, k) => {
                      const c = catMap[l.categoryId];
                      return (
                        <div key={k} style={{ whiteSpace: 'nowrap' }}>
                          <span className={`badge ${c?.type === 'income' ? 'badge-income' : 'badge-expense'}`}>{c?.id || l.categoryId}</span>
                          {' '}<span style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>{c?.name}</span>
                          {lines.length > 1 && <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', marginLeft: 6 }}>{fmt(l.amount)}</span>}
                        </div>
                      );
                    })}
                  </td>
                  <td>
                    <span style={{ fontSize: '0.78rem', color: isInc ? 'var(--accent)' : 'var(--red)', fontWeight: 600 }}>
                      {isInc ? t('Intäkt') : t('Kostnad')}
                    </span>
                  </td>
                  <td className="positive text-right">{incAmt ? fmt(incAmt) : ''}</td>
                  <td className="negative text-right">{expAmt ? fmt(expAmt) : ''}</td>
                  <td style={{ color: 'var(--ink-muted)', fontSize: '0.8rem', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {tx.comment || ''}
                  </td>
                  <td style={{textAlign:'center'}}>
                    <button
                      className="btn btn-sm btn-secondary"
                      title={t('Bilagor')}
                      onClick={() => setAttachTx({ tx, verNum: i + 1 })}
                      style={{ padding:'4px 8px' }}
                    >
                      <Paperclip size={12}/>
                    </button>
                  </td>
                  <td>
                    {canWrite && (
                      <div className="gap-row" style={{ gap: 4 }}>
                        <button className="btn btn-sm btn-secondary" onClick={() => openEdit(tx)} title={t('Redigera')} disabled={!!activePeriod?.locked}>
                          <Pencil size={12} />
                        </button>
                        <button
                          className={`btn btn-sm ${deleteConfirm === tx.id ? 'btn-danger' : 'btn-secondary'}`}
                          onClick={() => handleDelete(tx.id)}
                          disabled={!!activePeriod?.locked}
                          title={deleteConfirm === tx.id ? t('Bekräfta radering') : t('Radera')}
                        >
                          {deleteConfirm === tx.id ? <Check size={12} /> : <Trash2 size={12} />}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={5} style={{ fontFamily: 'var(--font-body)', fontWeight: 600 }}>{t('Totalt ({n} verifikat)', { n: filtered.length })}</td>
                <td className="text-right" style={{ color: 'var(--accent)' }}>{fmt(totalIncome)}</td>
                <td className="text-right" style={{ color: 'var(--red)' }}>{fmt(totalExpense)}</td>
                <td colSpan={2} style={{ fontFamily: 'var(--font-body)', fontWeight: 600, color: (totalIncome - totalExpense) >= 0 ? 'var(--accent)' : 'var(--red)' }}>
                  {t('Netto')}: {fmt(totalIncome - totalExpense)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      )}

      {/* Modal */}
      {attachTx && (
        <AttachmentPanel
          tx={attachTx.tx}
          verNum={attachTx.verNum}
          onClose={() => setAttachTx(null)}
        />
      )}

      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
          <div className="modal" style={!editId && preview ? { maxWidth: 640 } : undefined}>
            <div className="modal-header">
              <div className="modal-title">{editId ? t('Redigera verifikat') : t('Nytt verifikat')}</div>
              <button className="modal-close" onClick={closeModal}><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-row form-row-cols">
                <div>
                  <label>{t('Datum')} *</label>
                  <DateInput value={form.date} onChange={date => setForm(f => ({ ...f, date }))} required />
                </div>
                <div>
                  <label>{isSplit ? t('Summa (kr)') : `${t('Belopp (kr)')} *`}</label>
                  {isSplit
                    ? <div className="mono" style={{ padding: '9px 0', fontWeight: 600 }}>{fmt(linesTotal)}</div>
                    : <input type="number" step="0.01" min="0" placeholder="0.00" value={form.lines[0].amount}
                        onChange={e => setLine(0, { amount: e.target.value })} required />}
                </div>
              </div>
              {!isSplit ? (
                <div className="form-row">
                  <div>
                    <label>{t('Kategori')} *</label>
                    <select value={form.lines[0].categoryId} onChange={e => setLine(0, { categoryId: e.target.value })} required>
                      {categoryOptions}
                    </select>
                    <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={addLine}>
                      <Plus size={12} /> {t('Dela upp på flera konton')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="form-row">
                  <div>
                    <label>{t('Konton')} *</label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {form.lines.map((l, i) => (
                        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <select value={l.categoryId} onChange={e => setLine(i, { categoryId: e.target.value })} required style={{ flex: 1, minWidth: 0 }}>
                            {categoryOptions}
                          </select>
                          <input type="number" step="0.01" min="0" placeholder="0.00" value={l.amount} required
                            onChange={e => setLine(i, { amount: e.target.value })} style={{ width: 110, textAlign: 'right' }} />
                          <button type="button" title={t('Ta bort rad')} onClick={() => removeLine(i)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)', display: 'flex', padding: 4 }}>
                            <X size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={addLine}><Plus size={12} /> {t('Lägg till konto')}</button>
                      <span style={{ fontSize: '0.85rem' }}>{t('Summa')}: <strong className="mono">{fmt(linesTotal)}</strong></span>
                    </div>
                    {mixedTypes && (
                      <div style={{ fontSize: '0.78rem', color: 'var(--red)', marginTop: 6 }}>
                        {t('Alla konton på ett verifikat måste vara av samma typ (alla intäkter eller alla kostnader).')}
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="form-row">
                <div>
                  <label>{t('Beskrivning')}</label>
                  <input type="text" placeholder={t('Vad avser transaktionen?')} value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
                </div>
              </div>
              <div className="form-row">
                <div>
                  <label>{t('Kommentar')}</label>
                  <input type="text" placeholder={t('Valfri notering')} value={form.comment}
                    onChange={e => setForm(f => ({ ...f, comment: e.target.value }))} />
                </div>
              </div>
              {!editId && (
                <div className="form-row">
                  <div>
                    <label>{t('Bilagor (kvitto/faktura)')}</label>
                    {isMobile ? (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" className="btn btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => cameraRef.current?.click()}>
                          <Camera size={16} /> {t('Ta foto av kvittot')}
                        </button>
                        <button type="button" className="btn btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => fileRef.current?.click()}>
                          <Upload size={16} /> {t('Välj fil')}
                        </button>
                        <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => addFiles(e.target.files)} />
                      </div>
                    ) : (
                    <div
                      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
                      onClick={() => fileRef.current?.click()}
                      style={{
                        border: `2px dashed ${dragOver ? 'var(--accent-2)' : 'var(--border)'}`,
                        borderRadius: 'var(--r-lg)', background: dragOver ? 'var(--accent-3)' : 'var(--paper)',
                        padding: '14px 16px', textAlign: 'center', cursor: 'pointer', color: 'var(--ink-muted)',
                        fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      }}
                    >
                      <Upload size={16} style={{ opacity: 0.6 }} />
                      {t('Dra och släpp filer här, eller klicka för att välja')}
                    </div>
                    )}
                    <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={e => addFiles(e.target.files)} />
                    {newFiles.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                        {newFiles.map((f, i) => (
                          <div key={i} onClick={() => setPreviewIdx(i)}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 'var(--r)', cursor: 'pointer',
                              background: preview === f ? 'var(--accent-3)' : 'var(--paper-2)', border: '1px solid var(--border)', fontSize: '0.85rem' }}>
                            <FileText size={14} style={{ flexShrink: 0, color: 'var(--ink-soft)' }} />
                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file.name}</span>
                            <button type="button" title={t('Ta bort')} onClick={e => { e.stopPropagation(); removeFile(i); }}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)', display: 'flex', padding: 2 }}>
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {preview && (
                      <div style={{ marginTop: 10, border: '1px solid var(--border)', borderRadius: 'var(--r)', background: 'var(--paper-2)', height: 320, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {preview.url && preview.file.type === 'application/pdf'
                          ? <iframe src={preview.url} title={t('Förhandsvisning')} style={{ width: '100%', height: '100%', border: 'none' }} />
                          : preview.url
                            ? <img src={preview.url} alt={preview.file.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                            : <span style={{ fontSize: '0.82rem', color: 'var(--ink-muted)' }}>{t('Ingen förhandsvisning för den här filtypen.')}</span>}
                      </div>
                    )}
                    {preview && aiUsage?.enabled && canReadWithAi(preview.file) && (
                      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={handleAiRead}
                          disabled={aiBusy || aiUsage.used >= aiUsage.limit}>
                          <Sparkles size={13} /> {aiBusy ? t('Läser av…') : t('Fyll i med AI')}
                        </button>
                        <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
                          {t('{used}/{limit} avläsningar använda denna månad', { used: aiUsage.used, limit: aiUsage.limit })}
                        </span>
                      </div>
                    )}
                    {aiMsg && (
                      <div className="notice" style={{ marginTop: 8, fontSize: '0.82rem', ...(aiMsg.type === 'error' ? { background: 'var(--red-soft)', borderColor: 'var(--red)', color: 'var(--red)' } : {}) }}>
                        {aiMsg.text}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {saveError && (
                <div className="notice" style={{ background: 'var(--red-soft)', borderColor: 'var(--red)', color: 'var(--red)', marginTop: 12 }}>{saveError}</div>
              )}
              <div className="btn-row" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={closeModal}>{t('Avbryt')}</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  <Check size={14} /> {saving ? t('Sparar…') : editId ? t('Spara ändringar') : t('Lägg till')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
