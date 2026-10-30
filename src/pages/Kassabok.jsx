import { useState, useMemo } from 'react';
import { Plus, Pencil, Trash2, X, Check, Search, Paperclip } from 'lucide-react';
import AttachmentPanel from './AttachmentPanel';
import { fmt, txsForPeriod } from '../store';
import { useAuth } from '../auth/AuthProvider';

const EMPTY_FORM = {
  date: new Date().toISOString().slice(0, 10),
  description: '',
  categoryId: '',
  amount: '',
  comment: '',
};

export default function Kassabok({ transactions, categories, onAdd, onUpdate, onDelete, activePeriod }) {
  const { role } = useAuth()
  const canWrite = role !== 'viewer'
  const period = activePeriod;
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [attachTx, setAttachTx]       = useState(null); // {tx, verNum}

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
    return txs;
  }, [yearTxs, search, filterType, catMap]);

  const totalIncome  = filtered.filter(t => catMap[t.categoryId]?.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  const totalExpense = filtered.filter(t => catMap[t.categoryId]?.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);

  function openAdd() {
    setForm(EMPTY_FORM);
    setEditId(null);
    setShowModal(true);
  }
  function openEdit(tx) {
    setForm({ date: tx.date, description: tx.description || '', categoryId: tx.categoryId, amount: String(tx.amount), comment: tx.comment || '' });
    setEditId(tx.id);
    setShowModal(true);
  }
  function handleSubmit(e) {
    e.preventDefault();
    const payload = { ...form, amount: parseFloat(form.amount) || 0 };
    if (editId) onUpdate(editId, payload);
    else onAdd(payload);
    setShowModal(false);
  }
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
        <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ width: 'auto' }}>
          <option value="all">Alla typer</option>
          <option value="income">Intäkter</option>
          <option value="expense">Kostnader</option>
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
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">{editId ? 'Redigera verifikat' : 'Nytt verifikat'}</div>
              <button className="modal-close" onClick={() => setShowModal(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-row form-row-cols">
                <div>
                  <label>Datum *</label>
                  <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} required />
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
              <div className="btn-row" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Avbryt</button>
                <button type="submit" className="btn btn-primary">
                  <Check size={14} /> {editId ? 'Spara ändringar' : 'Lägg till'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
