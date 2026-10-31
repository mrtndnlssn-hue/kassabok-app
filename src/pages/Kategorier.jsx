import { useState, useMemo } from 'react';
import { Plus, Trash2, Check, AlertCircle, X, ArrowRight, Lock, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { compareCategoryIds } from '../store';

const dbId = c => c.origId ?? c.id   // koden som kategorin har i databasen just nu

function CatTable({ items, allCats, transactions, lockedCatIds, onUpdate, onUpdateCode, badCodes, onRemove, onToggleHidden, canWrite, showHidden }) {
  const visible = showHidden ? items : items.filter(c => !c.hidden)
  const hiddenCount = items.filter(c => c.hidden).length

  return (
    <div className="table-wrap" style={{ marginBottom: 24 }}>
      <table>
        <thead>
          <tr>
            <th style={{ width: 90 }}>Kod</th>
            <th>Kategorinamn</th>
            <th style={{ width: 80 }}></th>
          </tr>
        </thead>
        <tbody>
          {visible.map(cat => {
            const txCount  = (transactions || []).filter(tx => tx.categoryId === dbId(cat)).length
            const isLocked = lockedCatIds.has(dbId(cat))
            const codeEditable = canWrite && !isLocked
            const codeBad = badCodes.has(cat._k)
            return (
              <tr key={cat._k} style={{ opacity: cat.hidden ? 0.45 : 1 }}>
                <td>
                  {codeEditable ? (
                    <input
                      value={cat.id}
                      onChange={e => onUpdateCode(cat._k, e.target.value.toUpperCase().replace(/\s/g, ''))}
                      aria-label={`Kod för ${cat.name}`}
                      title={codeBad ? 'Ogiltig eller dubblerad kod' : 'Ändra koden'}
                      style={{ width: 84, fontFamily:'var(--font-mono)', fontSize:'0.82rem', padding:'3px 6px', borderColor: codeBad ? 'var(--red)' : undefined }}
                    />
                  ) : (
                    <span className={`badge ${cat.type === 'income' ? 'badge-income' : 'badge-expense'}`}>
                      {cat.id}
                    </span>
                  )}
                </td>
                <td>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    {isLocked && (
                      <Lock size={12} style={{ color:'var(--ink-muted)', flexShrink:0 }} title="Används i låst räkenskapsår" />
                    )}
                    <input
                      value={cat.name}
                      onChange={e => !isLocked && canWrite && onUpdate(cat._k, e.target.value)}
                      readOnly={!canWrite || isLocked}
                      style={codeEditable
                        ? { flex:1, fontSize:'0.9rem', padding:'3px 8px', cursor:'text' }
                        : { border:'1px solid transparent', background:'transparent', padding:'4px 0', flex:1, cursor:'default' }}
                    />
                    {txCount > 0 && (
                      <span title={`${txCount} verifikat`} style={{ fontSize:'0.7rem', color:'var(--ink-muted)', whiteSpace:'nowrap', background:'var(--paper-2)', padding:'1px 6px', borderRadius:99, border:'1px solid var(--border)' }}>
                        {txCount} ver.
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  <div style={{ display:'flex', gap:4, justifyContent:'flex-end' }}>
                    {canWrite && isLocked && (
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => onToggleHidden(cat._k, !cat.hidden)}
                        title={cat.hidden ? 'Visa kategori' : 'Dölj kategori'}
                      >
                        {cat.hidden ? <Eye size={12}/> : <EyeOff size={12}/>}
                      </button>
                    )}
                    {canWrite && !isLocked && (
                      <button className="btn btn-sm btn-danger" onClick={() => onRemove(cat)} title="Ta bort">
                        <Trash2 size={12}/>
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
          {visible.length === 0 && !hiddenCount && (
            <tr><td colSpan={3} style={{ color:'var(--ink-muted)', textAlign:'center', padding:20 }}>
              Inga kategorier definierade.
            </td></tr>
          )}
          {!showHidden && hiddenCount > 0 && (
            <tr>
              <td colSpan={3} style={{ color:'var(--ink-muted)', fontSize:'0.78rem', padding:'8px 4px', fontStyle:'italic' }}>
                {hiddenCount} dold{hiddenCount > 1 ? 'a' : ''} kategori{hiddenCount > 1 ? 'er' : ''} – visa med knappen ovan
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function DeleteWarningModal({ cat, affectedTxs, allCategories, onConfirm, onCancel }) {
  const [reassign, setReassign] = useState(
    Object.fromEntries(affectedTxs.map(tx => [tx.id, '']))
  )
  const compatible = allCategories.filter(c => c._k !== cat._k && c.type === cat.type)
  const allMapped  = affectedTxs.every(tx => reassign[tx.id])

  function handleConfirm() {
    onConfirm(affectedTxs.map(tx => ({ txId: tx.id, newCategoryId: reassign[tx.id] })))
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 640 }}>
        <div className="modal-header">
          <div className="modal-title" style={{ color:'var(--red)' }}>⚠️ Ta bort kategori?</div>
          <button className="modal-close" onClick={onCancel}><X size={18}/></button>
        </div>
        <div className="notice" style={{ background:'var(--red-soft)', borderColor:'#f5c6cb', color:'var(--red)', marginBottom:20 }}>
          <strong>{cat.id} – {cat.name}</strong> används av {affectedTxs.length} verifikat.
          Välj ny kategori för varje verifikat innan du tar bort, eller avbryt.
        </div>
        {affectedTxs.length > 1 && compatible.length > 0 && (
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16, padding:'10px 14px', background:'var(--paper-2)', borderRadius:'var(--r)', border:'1px solid var(--border)' }}>
            <span style={{ fontSize:'0.82rem', color:'var(--ink-soft)', whiteSpace:'nowrap' }}>Flytta alla till:</span>
            <select defaultValue="" onChange={e => { if (!e.target.value) return; setReassign(Object.fromEntries(affectedTxs.map(tx => [tx.id, e.target.value]))) }} style={{ flex:1 }}>
              <option value="">– Välj kategori –</option>
              {compatible.map(c => <option key={c._k} value={dbId(c)}>{c.id} – {c.name}</option>)}
            </select>
          </div>
        )}
        <div className="table-wrap" style={{ marginBottom:20, maxHeight:340, overflowY:'auto' }}>
          <table>
            <thead><tr><th>Datum</th><th>Beskrivning</th><th style={{ textAlign:'right' }}>Belopp</th><th><ArrowRight size={12} style={{ display:'inline' }}/> Ny kategori</th></tr></thead>
            <tbody>
              {affectedTxs.map(tx => (
                <tr key={tx.id}>
                  <td className="mono">{tx.date}</td>
                  <td style={{ maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{tx.description || <em style={{ color:'var(--ink-muted)' }}>–</em>}</td>
                  <td className="mono text-right">{Number(tx.amount).toLocaleString('sv-SE')} kr</td>
                  <td>
                    <select value={reassign[tx.id]} onChange={e => setReassign(prev => ({ ...prev, [tx.id]: e.target.value }))} style={{ width:'100%', fontSize:'0.82rem', borderColor: reassign[tx.id] ? 'var(--accent-2)' : '#f5c6cb' }}>
                      <option value="">– Välj –</option>
                      {compatible.map(c => <option key={c._k} value={dbId(c)}>{c.id} – {c.name}</option>)}
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
          <button className="btn btn-danger" onClick={handleConfirm} disabled={!allMapped} style={{ opacity: allMapped ? 1 : 0.45, cursor: allMapped ? 'pointer' : 'not-allowed' }}>
            <Trash2 size={14}/> Ta bort & flytta verifikat
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Kategorier({ categories, transactions, fiscalPeriods, onSave, onReasignAndDelete, orgId }) {
  const { role } = useAuth()
  const canWrite = role !== 'viewer'
  // _k: stabil radnyckel, origId: kod i databasen, _sort: radens plats (uppdateras först vid spar)
  const [cats, setCats]               = useState(() => categories.map(c => ({ ...c, _k: c.id, origId: c.id, _sort: c.id })))
  const [dirty, setDirty]             = useState(false)
  const [newForm, setNewForm]         = useState({ id: '', name: '', type: 'income' })
  const [error, setError]             = useState('')
  const [deleteModal, setDeleteModal] = useState(null)
  const [showHidden, setShowHidden]   = useState(false)

  // Kategorier som används i låsta perioder får inte redigeras eller tas bort
  const lockedCatIds = useMemo(() => {
    const locked = (fiscalPeriods || []).filter(p => p.locked)
    if (!locked.length) return new Set()
    const ids = new Set()
    ;(transactions || []).forEach(tx => {
      if (locked.some(p => tx.date >= p.start && tx.date <= p.end)) ids.add(tx.categoryId)
    })
    return ids
  }, [fiscalPeriods, transactions])

  function update(k, newName) {
    setCats(prev => prev.map(c => c._k === k ? { ...c, name: newName } : c))
    setDirty(true)
  }

  function updateCode(k, newId) {
    setError('')
    setCats(prev => prev.map(c => c._k === k ? { ...c, id: newId } : c))
    setDirty(true)
  }

  function toggleHidden(k, hidden) {
    setCats(prev => prev.map(c => c._k === k ? { ...c, hidden } : c))
    setDirty(true)
  }

  // Koden ska börja på I (intäkt) eller U (kostnad) följt av siffror, och vara unik
  const badCodes = useMemo(() => {
    const seen = {}
    cats.forEach(c => { seen[c.id] = (seen[c.id] || 0) + 1 })
    return new Set(cats
      .filter(c => !new RegExp(`^${c.type === 'income' ? 'I' : 'U'}\\d+$`).test(c.id) || seen[c.id] > 1)
      .map(c => c._k))
  }, [cats])

  function addCategory() {
    setError('')
    const id   = newForm.id.trim().toUpperCase()
    const name = newForm.name.trim()
    if (!id || !name) { setError('Ange både kod och namn.'); return }
    if (cats.find(c => c.id === id)) { setError(`Koden ${id} finns redan.`); return }
    if (!/^[IU]\d+$/.test(id)) { setError('Koden måste börja med I (intäkt) eller U (kostnad) följt av siffror, t.ex. I08 eller U11.'); return }
    setCats(prev => [...prev, { id, name, type: newForm.type, hidden: false, _k: `new_${id}_${Date.now()}`, _sort: id }])
    setNewForm({ id: '', name: '', type: 'income' })
    setDirty(true)
  }

  function requestRemove(cat) {
    if (lockedCatIds.has(dbId(cat))) return
    const affected = cat.origId ? (transactions || []).filter(tx => tx.categoryId === cat.origId) : []
    if (affected.length > 0) setDeleteModal({ cat, affectedTxs: affected })
    else { setCats(prev => prev.filter(c => c._k !== cat._k)); setDirty(true) }
  }

  async function handleModalConfirm(moves) {
    await onReasignAndDelete(dbId(deleteModal.cat), moves)
    setCats(prev => prev.filter(c => c._k !== deleteModal.cat._k))
    setDeleteModal(null)
    setDirty(true)
  }

  async function save() {
    setError('')
    if (badCodes.size) {
      setError('Rätta de markerade koderna först. En kod ska börja med I (intäkt) eller U (kostnad) följt av siffror, och varje kod får bara finnas en gång.')
      return
    }
    const renames = cats.filter(c => c.origId && c.origId !== c.id).map(c => ({ from: c.origId, to: c.id }))
    try {
      await onSave(cats.map(({ _k, origId, _sort, ...c }) => c), renames)
      setCats(prev => prev.map(c => ({ ...c, origId: c.id, _sort: c.id })))
      setDirty(false)
    } catch (e) {
      setError(e.message || 'Kunde inte spara kategorierna.')
    }
  }

  const bySort = (a, b) => compareCategoryIds(a._sort, b._sort)
  const incCats = cats.filter(c => c.type === 'income').sort(bySort)
  const expCats = cats.filter(c => c.type === 'expense').sort(bySort)
  const hasHidden = cats.some(c => c.hidden)

  return (
    <div>
      <div className="notice notice-info">
        Redigera koder och namn direkt i tabellen. När du byter en kod flyttas de verifikat och budgetrader som använder den automatiskt. Raderna sorteras efter kod när du sparar. Kategorier med <Lock size={11} style={{ display:'inline', verticalAlign:'middle' }}/> används i ett låst räkenskapsår och kan inte ändras – men kan döljas.
      </div>

      {dirty && (
        <div className="notice notice-warn" style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span><AlertCircle size={14} style={{ display:'inline', marginRight:6 }}/>Du har osparade ändringar.</span>
          <button className="btn btn-primary btn-sm" onClick={save}><Check size={13}/> Spara nu</button>
        </div>
      )}

      {canWrite && <div className="card" style={{ marginBottom: 24 }}>
        <div className="section-title">Lägg till ny kategori</div>
        {error && <div className="notice" style={{ background:'var(--red-soft)', borderColor:'#f5c6cb', color:'var(--red)', marginBottom:12 }}>{error}</div>}
        <div className="form-row form-row-cols" style={{ alignItems:'flex-end' }}>
          <div>
            <label>Typ</label>
            <select value={newForm.type} onChange={e => {
              const type = e.target.value, prefix = type === 'income' ? 'I' : 'U'
              const next = cats.filter(c => c.type === type).length + 1
              setNewForm(f => ({ ...f, type, id: `${prefix}${String(next).padStart(2,'0')}` }))
            }}>
              <option value="income">Intäkt</option>
              <option value="expense">Kostnad</option>
            </select>
          </div>
          <div>
            <label>Kod (t.ex. I08)</label>
            <input value={newForm.id} onChange={e => setNewForm(f => ({ ...f, id: e.target.value.toUpperCase() }))} placeholder="I08" style={{ fontFamily:'var(--font-mono)' }} />
          </div>
          <div>
            <label>Kategorinamn</label>
            <input value={newForm.name} onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))} placeholder="T.ex. Lotteri/tombola" onKeyDown={e => e.key === 'Enter' && addCategory()} />
          </div>
          <div>
            <button className="btn btn-primary" onClick={addCategory} style={{ marginTop:2 }}><Plus size={14}/> Lägg till</button>
          </div>
        </div>
      </div>}

      {hasHidden && (
        <div style={{ marginBottom:12, textAlign:'right' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowHidden(v => !v)}>
            {showHidden ? <><EyeOff size={13}/> Dölj gamla konton</> : <><Eye size={13}/> Visa dolda konton</>}
          </button>
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:24 }}>
        <div>
          <div className="section-title" style={{ color:'var(--accent)' }}>Intäktskategorier</div>
          <CatTable items={incCats} allCats={cats} transactions={transactions} lockedCatIds={lockedCatIds} onUpdate={update} onUpdateCode={updateCode} badCodes={badCodes} onRemove={requestRemove} onToggleHidden={toggleHidden} canWrite={canWrite} showHidden={showHidden} />
        </div>
        <div>
          <div className="section-title" style={{ color:'var(--red)' }}>Kostnadskategorier</div>
          <CatTable items={expCats} allCats={cats} transactions={transactions} lockedCatIds={lockedCatIds} onUpdate={update} onUpdateCode={updateCode} badCodes={badCodes} onRemove={requestRemove} onToggleHidden={toggleHidden} canWrite={canWrite} showHidden={showHidden} />
        </div>
      </div>

      {dirty && canWrite && (
        <div style={{ textAlign:'right', marginTop:8 }}>
          <button className="btn btn-primary" onClick={save}><Check size={14}/> Spara alla ändringar</button>
        </div>
      )}

      {deleteModal && (
        <DeleteWarningModal cat={deleteModal.cat} affectedTxs={deleteModal.affectedTxs} allCategories={cats} onConfirm={handleModalConfirm} onCancel={() => setDeleteModal(null)} />
      )}
    </div>
  )
}
