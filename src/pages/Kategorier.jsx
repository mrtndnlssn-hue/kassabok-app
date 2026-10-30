import { useState } from 'react';
import { Plus, Trash2, Check, AlertCircle, X, ArrowRight } from 'lucide-react';

// ── Definierad UTANFÖR för att undvika remount-buggar ────────
function CatTable({ items, allCats, transactions, onUpdate, onRemove }) {
  return (
    <div className="table-wrap" style={{ marginBottom: 24 }}>
      <table>
        <thead>
          <tr>
            <th style={{ width: 90 }}>Kod</th>
            <th>Kategorinamn</th>
            <th style={{ width: 60 }}></th>
          </tr>
        </thead>
        <tbody>
          {items.map(cat => {
            const txCount = (transactions || []).filter(tx => tx.categoryId === cat.id).length;
            return (
              <tr key={cat.id}>
                <td>
                  <span className={`badge ${cat.type === 'income' ? 'badge-income' : 'badge-expense'}`}>
                    {cat.id}
                  </span>
                </td>
                <td>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <input
                      value={cat.name}
                      onChange={e => onUpdate(cat.id, e.target.value)}
                      style={{ border:'1px solid transparent', background:'transparent', padding:'4px 0', flex:1 }}
                      onFocus={e => e.target.style.borderColor = 'var(--border)'}
                      onBlur={e  => e.target.style.borderColor = 'transparent'}
                    />
                    {txCount > 0 && (
                      <span
                        title={`${txCount} verifikat`}
                        style={{ fontSize:'0.7rem', color:'var(--ink-muted)', whiteSpace:'nowrap', background:'var(--paper-2)', padding:'1px 6px', borderRadius:99, border:'1px solid var(--border)' }}
                      >
                        {txCount} ver.
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  <button className="btn btn-sm btn-danger" onClick={() => onRemove(cat)} title="Ta bort">
                    <Trash2 size={12}/>
                  </button>
                </td>
              </tr>
            );
          })}
          {items.length === 0 && (
            <tr><td colSpan={3} style={{ color:'var(--ink-muted)', textAlign:'center', padding:20 }}>
              Inga kategorier definierade.
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Popup: varnar om transaktioner finns ─────────────────────
function DeleteWarningModal({ cat, affectedTxs, allCategories, onConfirm, onCancel }) {
  const [reassign, setReassign] = useState(
    Object.fromEntries(affectedTxs.map(tx => [tx.id, '']))
  );

  const compatible = allCategories.filter(c => c.id !== cat.id && c.type === cat.type);
  const allMapped  = affectedTxs.every(tx => reassign[tx.id]);

  function handleConfirm() {
    const moves = affectedTxs.map(tx => ({ txId: tx.id, newCategoryId: reassign[tx.id] }));
    onConfirm(moves);
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 640 }}>
        <div className="modal-header">
          <div className="modal-title" style={{ color:'var(--red)' }}>
            ⚠️ Ta bort kategori?
          </div>
          <button className="modal-close" onClick={onCancel}><X size={18}/></button>
        </div>

        <div className="notice" style={{ background:'var(--red-soft)', borderColor:'#f5c6cb', color:'var(--red)', marginBottom:20 }}>
          <strong>{cat.id} – {cat.name}</strong> används av {affectedTxs.length} verifikat.
          Välj ny kategori för varje verifikat innan du tar bort, eller avbryt.
        </div>

        {affectedTxs.length > 1 && compatible.length > 0 && (
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16, padding:'10px 14px', background:'var(--paper-2)', borderRadius:'var(--r)', border:'1px solid var(--border)' }}>
            <span style={{ fontSize:'0.82rem', color:'var(--ink-soft)', whiteSpace:'nowrap' }}>Flytta alla till:</span>
            <select
              defaultValue=""
              onChange={e => {
                if (!e.target.value) return;
                setReassign(Object.fromEntries(affectedTxs.map(tx => [tx.id, e.target.value])));
              }}
              style={{ flex:1 }}
            >
              <option value="">– Välj kategori –</option>
              {compatible.map(c => <option key={c.id} value={c.id}>{c.id} – {c.name}</option>)}
            </select>
          </div>
        )}

        <div className="table-wrap" style={{ marginBottom:20, maxHeight:340, overflowY:'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Datum</th>
                <th>Beskrivning</th>
                <th style={{ textAlign:'right' }}>Belopp</th>
                <th><ArrowRight size={12} style={{ display:'inline' }}/> Ny kategori</th>
              </tr>
            </thead>
            <tbody>
              {affectedTxs.map(tx => (
                <tr key={tx.id}>
                  <td className="mono">{tx.date}</td>
                  <td style={{ maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {tx.description || <em style={{ color:'var(--ink-muted)' }}>–</em>}
                  </td>
                  <td className="mono text-right">{Number(tx.amount).toLocaleString('sv-SE')} kr</td>
                  <td>
                    <select
                      value={reassign[tx.id]}
                      onChange={e => setReassign(prev => ({ ...prev, [tx.id]: e.target.value }))}
                      style={{ width:'100%', fontSize:'0.82rem', borderColor: reassign[tx.id] ? 'var(--accent-2)' : '#f5c6cb' }}
                    >
                      <option value="">– Välj –</option>
                      {compatible.map(c => <option key={c.id} value={c.id}>{c.id} – {c.name}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!allMapped && (
          <div className="notice" style={{ background:'var(--amber-soft)', borderColor:'#fcd34d', color:'var(--amber)', marginBottom:16 }}>
            Alla verifikat måste tilldelas en ny kategori innan du kan ta bort.
          </div>
        )}

        <div className="btn-row" style={{ justifyContent:'flex-end' }}>
          <button className="btn btn-secondary" onClick={onCancel}>Avbryt</button>
          <button
            className="btn btn-danger"
            onClick={handleConfirm}
            disabled={!allMapped}
            style={{ opacity: allMapped ? 1 : 0.45, cursor: allMapped ? 'pointer' : 'not-allowed' }}
          >
            <Trash2 size={14}/> Ta bort & flytta verifikat
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Huvudkomponent ───────────────────────────────────────────
export default function Kategorier({ categories, transactions, onSave, onReasignAndDelete }) {
  const [cats, setCats]               = useState(categories);
  const [dirty, setDirty]             = useState(false);
  const [newForm, setNewForm]         = useState({ id: '', name: '', type: 'income' });
  const [error, setError]             = useState('');
  const [deleteModal, setDeleteModal] = useState(null);

  // Uppdatera namn via cat.id (inte indexOf) för att undvika indexbugg
  function update(catId, newName) {
    setCats(prev => prev.map(c => c.id === catId ? { ...c, name: newName } : c));
    setDirty(true);
  }

  function addCategory() {
    setError('');
    const id   = newForm.id.trim().toUpperCase();
    const name = newForm.name.trim();
    if (!id || !name) { setError('Ange både kod och namn.'); return; }
    if (cats.find(c => c.id === id)) { setError(`Koden ${id} finns redan.`); return; }
    if (!/^[IU]\d+$/.test(id)) { setError('Koden måste börja med I (intäkt) eller U (kostnad) följt av siffror, t.ex. I08 eller U11.'); return; }
    setCats(prev => [...prev, { id, name, type: newForm.type }]);
    setNewForm({ id: '', name: '', type: 'income' });
    setDirty(true);
  }

  function requestRemove(cat) {
    const affected = (transactions || []).filter(tx => tx.categoryId === cat.id);
    if (affected.length > 0) {
      setDeleteModal({ cat, affectedTxs: affected });
    } else {
      setCats(prev => prev.filter(c => c.id !== cat.id));
      setDirty(true);
    }
  }

  async function handleModalConfirm(moves) {
    await onReasignAndDelete(deleteModal.cat.id, moves);
    setCats(prev => prev.filter(c => c.id !== deleteModal.cat.id));
    setDeleteModal(null);
    setDirty(true);
  }

  function save() {
    onSave(cats);
    setDirty(false);
  }

  const incCats = cats.filter(c => c.type === 'income');
  const expCats = cats.filter(c => c.type === 'expense');

  return (
    <div>
      <div className="notice notice-info">
        Redigera kategorinamn direkt i tabellen. Om du tar bort en kategori med verifikat visas en guide för att flytta dem.
      </div>

      {dirty && (
        <div className="notice notice-warn" style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span><AlertCircle size={14} style={{ display:'inline', marginRight:6 }}/>Du har osparade ändringar.</span>
          <button className="btn btn-primary btn-sm" onClick={save}>
            <Check size={13}/> Spara nu
          </button>
        </div>
      )}

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="section-title">Lägg till ny kategori</div>
        {error && <div className="notice" style={{ background:'var(--red-soft)', borderColor:'#f5c6cb', color:'var(--red)', marginBottom:12 }}>{error}</div>}
        <div className="form-row form-row-cols" style={{ alignItems:'flex-end' }}>
          <div>
            <label>Typ</label>
            <select value={newForm.type} onChange={e => {
              const type   = e.target.value;
              const prefix = type === 'income' ? 'I' : 'U';
              const next   = cats.filter(c => c.type === type).length + 1;
              setNewForm(f => ({ ...f, type, id: `${prefix}${String(next).padStart(2,'0')}` }));
            }}>
              <option value="income">Intäkt</option>
              <option value="expense">Kostnad</option>
            </select>
          </div>
          <div>
            <label>Kod (t.ex. I08)</label>
            <input
              value={newForm.id}
              onChange={e => setNewForm(f => ({ ...f, id: e.target.value.toUpperCase() }))}
              placeholder="I08"
              style={{ fontFamily:'var(--font-mono)' }}
            />
          </div>
          <div>
            <label>Kategorinamn</label>
            <input
              value={newForm.name}
              onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))}
              placeholder="T.ex. Lotteri/tombola"
              onKeyDown={e => e.key === 'Enter' && addCategory()}
            />
          </div>
          <div>
            <button className="btn btn-primary" onClick={addCategory} style={{ marginTop:2 }}>
              <Plus size={14}/> Lägg till
            </button>
          </div>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:24 }}>
        <div>
          <div className="section-title" style={{ color:'var(--accent)' }}>Intäktskategorier</div>
          <CatTable
            items={incCats}
            allCats={cats}
            transactions={transactions}
            onUpdate={update}
            onRemove={requestRemove}
          />
        </div>
        <div>
          <div className="section-title" style={{ color:'var(--red)' }}>Kostnadskategorier</div>
          <CatTable
            items={expCats}
            allCats={cats}
            transactions={transactions}
            onUpdate={update}
            onRemove={requestRemove}
          />
        </div>
      </div>

      {dirty && (
        <div style={{ textAlign:'right', marginTop:8 }}>
          <button className="btn btn-primary" onClick={save}>
            <Check size={14}/> Spara alla ändringar
          </button>
        </div>
      )}

      {deleteModal && (
        <DeleteWarningModal
          cat={deleteModal.cat}
          affectedTxs={deleteModal.affectedTxs}
          allCategories={cats}
          onConfirm={handleModalConfirm}
          onCancel={() => setDeleteModal(null)}
        />
      )}
    </div>
  );
}
