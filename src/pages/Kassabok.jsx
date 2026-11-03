import { useState, useMemo, useEffect } from 'react';
import { Plus, Pencil, Trash2, Check, Search, Paperclip } from 'lucide-react';
import AttachmentPanel from './AttachmentPanel';
import { fmt, txsForPeriod, txLines } from '../store';
import VoucherModal from '../components/VoucherModal';
import { useAuth } from '../auth/AuthProvider';
import { useI18n } from '../i18n';
import useIsMobile from '../hooks/useIsMobile';
import { useProjects, cap, lower } from '../ProjectsContext';


export default function Kassabok({ orgId, transactions, categories, onAdd, onUpdate, onDelete, onSubmitExpense, canSubmitExpense, activePeriod, addRequest, onAddHandled }) {
  const { t } = useI18n()
  const isMobile = useIsMobile()
  const { role } = useAuth()
  const canWrite = role !== 'viewer'
  const { enabled: projOn, labels, projects } = useProjects()
  const projMap = useMemo(() => Object.fromEntries(projects.map(p => [p.id, p])), [projects])
  const showProjects = projOn && projects.length > 0
  const period = activePeriod;
  const [modal, setModal] = useState(null);   // { initial, editId } när rutan är öppen
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [attachTx, setAttachTx]       = useState(null); // {tx, verNum}
  const [filterCat, setFilterCat]     = useState('all');
  const [filterProject, setFilterProject] = useState('all');   // 'all' | 'none' | projekt-id

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
    if (filterProject !== 'all') {
      txs = txs.filter(x => txLines(x).some(l => matchesProject(l)));
    }
    return txs;
  }, [yearTxs, search, filterType, filterCat, filterProject, catMap]);

  function matchesProject(l) {
    return filterProject === 'all' || (filterProject === 'none' ? !l.projectId : l.projectId === filterProject);
  }

  // De rader av ett verifikat som matchar filtren (så att summorna stämmer när man filtrerar på ett konto)
  const shownLines = tx => txLines(tx).filter(l =>
    (filterCat === 'all' || l.categoryId === filterCat) &&
    (filterType === 'all' || catMap[l.categoryId]?.type === filterType) &&
    matchesProject(l));
  const sumType = (lines, type) => lines.filter(l => catMap[l.categoryId]?.type === type).reduce((s, l) => s + Number(l.amount), 0);

  const totalIncome  = filtered.reduce((s, x) => s + sumType(shownLines(x), 'income'), 0);
  const totalExpense = filtered.reduce((s, x) => s + sumType(shownLines(x), 'expense'), 0);

  const projectChip = l => projOn && l.projectId && projMap[l.projectId]
    ? <span className="badge badge-project" title={cap(labels.one)} style={{ marginLeft: 6 }}>{projMap[l.projectId].name}</span>
    : null;

  function openAdd() { setModal({ initial: null, editId: null }); }
  function openEdit(tx) {
    setModal({
      editId: tx.id,
      initial: { date: tx.date, description: tx.description || '', comment: tx.comment || '',
        lines: txLines(tx).map(l => ({ categoryId: l.categoryId, amount: String(l.amount), projectId: l.projectId || '' })) },
    });
  }
  function handleDelete(id) {
    if (deleteConfirm === id) { onDelete(id); setDeleteConfirm(null); }
    else setDeleteConfirm(id);
  }


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
        {showProjects && (
          <select value={filterProject} onChange={e => setFilterProject(e.target.value)} style={{ width: isMobile ? '100%' : 'auto', maxWidth: isMobile ? 'none' : 220 }}>
            <option value="all">{t('Alla {namn}', { namn: lower(labels.many) })}</option>
            <option value="none">{t('Utan {namn}', { namn: lower(labels.one) })}</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}{p.closed ? ` (${t('stängd')})` : ''}</option>)}
          </select>
        )}
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
                      {projectChip(l)}
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
                          {projectChip(l)}
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

      {modal && (
        <VoucherModal
          orgId={orgId}
          categories={categories}
          initial={modal.initial}
          editing={!!modal.editId}
          expense={modal.editId ? 'off' : canSubmitExpense ? 'optional' : 'off'}
          onSubmit={async (payload, files, isExpense) => {
            if (modal.editId) await onUpdate(modal.editId, payload);
            else if (isExpense) await onSubmitExpense(payload, files);
            else await onAdd(payload, files);
          }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
