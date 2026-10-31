import { useState, useMemo, useRef } from 'react';
import { Plus, Pencil, Trash2, X, Check, Search, Paperclip, Upload, FileText, Sparkles } from 'lucide-react';
import { getReceiptUsage, readReceipt, canReadWithAi } from '../receiptAi';
import AttachmentPanel from './AttachmentPanel';
import { fmt, txsForPeriod, todayStr, isValidIsoDate } from '../store';
import DateInput from '../components/DateInput';
import { useAuth } from '../auth/AuthProvider';

const emptyForm = () => ({
  date: todayStr(),
  description: '',
  categoryId: '',
  amount: '',
  comment: '',
});

export default function Kassabok({ orgId, transactions, categories, onAdd, onUpdate, onDelete, activePeriod }) {
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

  const yearTxs = useMemo(() => txsForPeriod(transactions, period), [transactions, period]);
  const catMap   = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c])), [categories]);

  const filtered = useMemo(() => {
    let txs = [...yearTxs].sort((a, b) => b.date?.localeCompare(a.date));
    if (search) {
      const q = search.toLowerCase();
      txs = txs.filter(t =>
        t.description?.toLowerCase().includes(q) ||
        t.categoryId?.toLowerCase().includes(q) ||
        catMap[t.categoryId]?.name.toLowerCase().includes(q)
      );
    }
    if (filterType !== 'all') {
      txs = txs.filter(t => catMap[t.categoryId]?.type === filterType);
    }
    if (filterCat !== 'all') {
      txs = txs.filter(t => t.categoryId === filterCat);
    }
    return txs;
  }, [yearTxs, search, filterType, filterCat, catMap]);

  const totalIncome  = filtered.filter(t => catMap[t.categoryId]?.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  const totalExpense = filtered.filter(t => catMap[t.categoryId]?.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);

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
        amount:      r.amount != null ? String(r.amount) : f.amount,
        description: r.description || f.description,
        categoryId:  r.category_id || f.categoryId,
      }));
      setAiUsage(u => u && { ...u, used: r.used, limit: r.limit });
      setAiMsg({ type: 'ok', text: r.confidence === 'high'
        ? 'Förslag ifyllt. Kontrollera uppgifterna innan du sparar.'
        : 'Förslag ifyllt, men avläsningen är osäker. Kontrollera datum och belopp noga.' });
    } catch (e) {
      setAiMsg({ type: 'error', text: e.message });
    } finally {
      setAiBusy(false);
    }
  }
  function openEdit(tx) {
    setForm({ date: tx.date, description: tx.description || '', categoryId: tx.categoryId, amount: String(tx.amount), comment: tx.comment || '' });
    setEditId(tx.id);
    setNewFiles([]);
    setSaveError('');
    setShowModal(true);
  }
  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValidIsoDate(form.date)) { setSaveError('Ange ett giltigt datum på formatet YYYY-MM-DD.'); return; }
    const payload = { ...form, amount: parseFloat(form.amount) || 0 };
    setSaving(true);
    setSaveError('');
    try {
      if (editId) await onUpdate(editId, payload);
      else await onAdd(payload, newFiles.map(f => f.file));
      setShowModal(false);
    } catch (err) {
      setSaveError(`Kunde inte spara: ${err.message || 'okänt fel'}`);
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

  return (
    <div>
      {/* Toolbar */}
      <div className="gap-row" style={{ marginBottom: 20 }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-muted)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Sök verifikat…"
            style={{ paddingLeft: 32 }}
          />
        </div>
        <select value={filterType} onChange={e => { setFilterType(e.target.value); setFilterCat('all'); }} style={{ width: 'auto' }}>
          <option value="all">Alla typer</option>
          <option value="income">Intäkter</option>
          <option value="expense">Kostnader</option>
        </select>
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={{ width: 'auto', maxWidth: 220 }}>
          <option value="all">Alla konton</option>
          {categories
            .filter(c => filterType === 'all' || c.type === filterType)
            .sort((a, b) => String(a.id).localeCompare(String(b.id), 'sv', { numeric: true }))
            .map(c => <option key={c.id} value={c.id}>{c.id} – {c.name}</option>)}
        </select>
        <div className="ml-auto">
          {canWrite && (
            <button className="btn btn-primary" onClick={openAdd} disabled={!!activePeriod?.locked} style={{ opacity: activePeriod?.locked ? 0.4 : 1, cursor: activePeriod?.locked ? "not-allowed" : "pointer" }}>
              <Plus size={15} /> Lägg till verifikat
            </button>
          )}
        </div>
      </div>

      {/* Locked period warning */}
      {activePeriod?.locked && (
        <div className="notice" style={{ background:'var(--paper-2)', borderColor:'var(--border)', color:'var(--ink-soft)', marginBottom:16, display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:'1rem' }}>🔒</span>
          <span>Perioden <strong>{activePeriod.label}</strong> är låst och kan inte redigeras. Lås upp den under Räkenskapsperioder om du behöver göra ändringar.</span>
        </div>
      )}

      {/* Table */}
      <div className="table-wrap" style={{ marginBottom: 16 }}>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Datum</th>
              <th>Beskrivning</th>
              <th>Kategori</th>
              <th>Typ</th>
              <th className="text-right">Inkomst</th>
              <th className="text-right">Utgift</th>
              <th>Kommentar</th>
              <th style={{textAlign:'center'}}>Bilagor</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: '40px', color: 'var(--ink-muted)' }}>
                Inga verifikat att visa.
              </td></tr>
            )}
            {filtered.map((tx, i) => {
              const cat = catMap[tx.categoryId];
              const isInc = cat?.type === 'income';
              return (
                <tr key={tx.id}>
                  <td className="mono" style={{ color: 'var(--ink-muted)' }}>{String(i + 1).padStart(3, '0')}</td>
                  <td className="mono">{tx.date}</td>
                  <td>{tx.description || <em style={{ color: 'var(--ink-muted)' }}>–</em>}</td>
                  <td>
                    <span className={`badge ${isInc ? 'badge-income' : 'badge-expense'}`}>{cat?.id}</span>
                    {' '}<span style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>{cat?.name}</span>
                  </td>
                  <td>
                    <span style={{ fontSize: '0.78rem', color: isInc ? 'var(--accent)' : 'var(--red)', fontWeight: 600 }}>
                      {isInc ? 'Intäkt' : 'Kostnad'}
                    </span>
                  </td>
                  <td className="positive text-right">{isInc ? fmt(tx.amount) : ''}</td>
                  <td className="negative text-right">{!isInc ? fmt(tx.amount) : ''}</td>
                  <td style={{ color: 'var(--ink-muted)', fontSize: '0.8rem', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {tx.comment || ''}
                  </td>
                  <td style={{textAlign:'center'}}>
                    <button
                      className="btn btn-sm btn-secondary"
                      title="Bilagor"
                      onClick={() => setAttachTx({ tx, verNum: i + 1 })}
                      style={{ padding:'4px 8px' }}
                    >
                      <Paperclip size={12}/>
                    </button>
                  </td>
                  <td>
                    {canWrite && (
                      <div className="gap-row" style={{ gap: 4 }}>
                        <button className="btn btn-sm btn-secondary" onClick={() => openEdit(tx)} title="Redigera" disabled={!!activePeriod?.locked}>
                          <Pencil size={12} />
                        </button>
                        <button
                          className={`btn btn-sm ${deleteConfirm === tx.id ? 'btn-danger' : 'btn-secondary'}`}
                          onClick={() => handleDelete(tx.id)}
                          disabled={!!activePeriod?.locked}
                          title={deleteConfirm === tx.id ? 'Bekräfta radering' : 'Radera'}
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
                <td colSpan={5} style={{ fontFamily: 'var(--font-body)', fontWeight: 600 }}>Totalt ({filtered.length} verifikat)</td>
                <td className="text-right" style={{ color: 'var(--accent)' }}>{fmt(totalIncome)}</td>
                <td className="text-right" style={{ color: 'var(--red)' }}>{fmt(totalExpense)}</td>
                <td colSpan={2} style={{ fontFamily: 'var(--font-body)', fontWeight: 600, color: (totalIncome - totalExpense) >= 0 ? 'var(--accent)' : 'var(--red)' }}>
                  Netto: {fmt(totalIncome - totalExpense)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

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
              <div className="modal-title">{editId ? 'Redigera verifikat' : 'Nytt verifikat'}</div>
              <button className="modal-close" onClick={closeModal}><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-row form-row-cols">
                <div>
                  <label>Datum *</label>
                  <DateInput value={form.date} onChange={date => setForm(f => ({ ...f, date }))} required />
                </div>
                <div>
                  <label>Belopp (kr) *</label>
                  <input type="number" step="0.01" min="0" placeholder="0.00" value={form.amount}
                    onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} required />
                </div>
              </div>
              <div className="form-row">
                <div>
                  <label>Kategori *</label>
                  <select value={form.categoryId} onChange={e => setForm(f => ({ ...f, categoryId: e.target.value }))} required>
                    <option value="">– Välj kategori –</option>
                    <optgroup label="Intäkter">
                      {incCats.map(c => <option key={c.id} value={c.id}>{c.id} – {c.name}</option>)}
                    </optgroup>
                    <optgroup label="Kostnader">
                      {expCats.map(c => <option key={c.id} value={c.id}>{c.id} – {c.name}</option>)}
                    </optgroup>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div>
                  <label>Beskrivning</label>
                  <input type="text" placeholder="Vad avser transaktionen?" value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
                </div>
              </div>
              <div className="form-row">
                <div>
                  <label>Kommentar</label>
                  <input type="text" placeholder="Valfri notering" value={form.comment}
                    onChange={e => setForm(f => ({ ...f, comment: e.target.value }))} />
                </div>
              </div>
              {!editId && (
                <div className="form-row">
                  <div>
                    <label>Bilagor (kvitto/faktura)</label>
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
                      Dra och släpp filer här, eller klicka för att välja
                    </div>
                    <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={e => addFiles(e.target.files)} />
                    {newFiles.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                        {newFiles.map((f, i) => (
                          <div key={i} onClick={() => setPreviewIdx(i)}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 'var(--r)', cursor: 'pointer',
                              background: preview === f ? 'var(--accent-3)' : 'var(--paper-2)', border: '1px solid var(--border)', fontSize: '0.85rem' }}>
                            <FileText size={14} style={{ flexShrink: 0, color: 'var(--ink-soft)' }} />
                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file.name}</span>
                            <button type="button" title="Ta bort" onClick={e => { e.stopPropagation(); removeFile(i); }}
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
                          ? <iframe src={preview.url} title="Förhandsvisning" style={{ width: '100%', height: '100%', border: 'none' }} />
                          : preview.url
                            ? <img src={preview.url} alt={preview.file.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                            : <span style={{ fontSize: '0.82rem', color: 'var(--ink-muted)' }}>Ingen förhandsvisning för den här filtypen.</span>}
                      </div>
                    )}
                    {preview && aiUsage?.enabled && canReadWithAi(preview.file) && (
                      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={handleAiRead}
                          disabled={aiBusy || aiUsage.used >= aiUsage.limit}>
                          <Sparkles size={13} /> {aiBusy ? 'Läser av…' : 'Fyll i med AI'}
                        </button>
                        <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
                          {aiUsage.used}/{aiUsage.limit} avläsningar använda denna månad
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
                <button type="button" className="btn btn-secondary" onClick={closeModal}>Avbryt</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  <Check size={14} /> {saving ? 'Sparar…' : editId ? 'Spara ändringar' : 'Lägg till'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
