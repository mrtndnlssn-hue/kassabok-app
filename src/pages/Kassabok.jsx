import { useState, useMemo, useEffect } from 'react';
import { Plus, Pencil, Trash2, Check, Search, Paperclip, Ban, Lock, X } from 'lucide-react';
import AttachmentPanel from './AttachmentPanel';
import { fmt, txsForPeriod, txLines, isTxLocked, graceMinutesLeft } from '../store';
import VoucherModal from '../components/VoucherModal';
import { useAuth } from '../auth/AuthProvider';
import { useI18n } from '../i18n';
import useIsMobile from '../hooks/useIsMobile';
import { useProjects, cap, lower } from '../ProjectsContext';


export default function Kassabok({ orgId, transactions, categories, onAdd, onUpdate, onDelete, voidedTxs = [], onUpdateLocked, onVoid, onSubmitExpense, canSubmitExpense, activePeriod, addRequest, onAddHandled }) {
  const { t } = useI18n()
  const isMobile = useIsMobile()
  const { role } = useAuth()
  const canWrite = role !== 'viewer'
  const { enabled: projOn, labels, projects } = useProjects()
  const projMap = useMemo(() => Object.fromEntries(projects.map(p => [p.id, p])), [projects])
  const showProjects = projOn && projects.length > 0
  const period = activePeriod;
  const [modal, setModal] = useState(null);   // { initial, editId, restricted } när rutan är öppen
  const [voidTx, setVoidTx] = useState(null);   // verifikat som ska makuleras
  const [voidReason, setVoidReason] = useState('');
  const [replaceFor, setReplaceFor] = useState(null);   // { tx, reason }: ersättande verifikat läggs in
  const [voidBusy, setVoidBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [attachTx, setAttachTx]       = useState(null); // {tx, verNum}
  const [filterCat, setFilterCat]     = useState('all');
  const [filterProject, setFilterProject] = useState('all');   // 'all' | 'none' | projekt-id
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' });
  const toggleSort = key => setSort(s => s.key === key
    ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: key === 'category' || key === 'type' ? 'asc' : (key === 'ver' ? 'asc' : 'desc') });
  const sortTh = (key, label, extra = {}) => (
    <th className={extra.className} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', ...extra.style }}
      onClick={() => toggleSort(key)} aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      {label}{sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );

  // "+" i mobilens flikmeny ber om ett nytt verifikat
  useEffect(() => {
    if (!addRequest) return
    if (!activePeriod?.locked) openAdd()
    onAddHandled?.()
  }, [addRequest])

  // Makulerade verifikat visas i kassaboken (och behåller sitt nummer) men räknas inte i summorna
  const yearTxs = useMemo(() => txsForPeriod([...transactions, ...voidedTxs], period), [transactions, voidedTxs, period]);
  const catMap   = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c])), [categories]);

  // De rader av ett verifikat som matchar filtren (så att summorna stämmer när man filtrerar på ett konto)
  const shownLines = tx => txLines(tx).filter(l =>
    (filterCat === 'all' || l.categoryId === filterCat) &&
    (filterType === 'all' || catMap[l.categoryId]?.type === filterType) &&
    matchesProject(l));
  const sumType = (lines, type) => lines.filter(l => catMap[l.categoryId]?.type === type).reduce((s, l) => s + Number(l.amount), 0);

  // Verifikatnumret följer grundordningen (datum, nyast först) och ändras inte av filter eller sortering
  const baseOrder = useMemo(() => [...yearTxs].sort((a, b) => b.date?.localeCompare(a.date)), [yearTxs]);
  const verMap = useMemo(() => Object.fromEntries(baseOrder.map((x, i) => [x.id, i + 1])), [baseOrder]);

  const filtered = useMemo(() => {
    let txs = [...baseOrder];
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
    if (sort.key !== 'date' || sort.dir !== 'desc') {
      const firstCat = x => { const l = txLines(x)[0]; return String(l?.categoryId ?? ''); };
      const isInc = x => (catMap[txLines(x)[0]?.categoryId]?.type === 'income' ? 0 : 1);
      const sum = (x, type) => sumType(shownLines(x), type);
      const val = {
        ver: x => verMap[x.id],
        date: x => x.date || '',
        category: firstCat,
        type: isInc,
        income: x => sum(x, 'income'),
        expense: x => sum(x, 'expense'),
      }[sort.key];
      const m = sort.dir === 'asc' ? 1 : -1;
      txs.sort((a, b) => {
        const va = val(a), vb = val(b);
        const c = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'sv', { numeric: true });
        return c * m || verMap[a.id] - verMap[b.id];
      });
    }
    return txs;
  }, [baseOrder, verMap, sort, search, filterType, filterCat, filterProject, catMap]);

  function matchesProject(l) {
    return filterProject === 'all' || (filterProject === 'none' ? !l.projectId : l.projectId === filterProject);
  }


  const active = filtered.filter(x => !x.voidedAt);
  const totalIncome  = active.reduce((s, x) => s + sumType(shownLines(x), 'income'), 0);
  const totalExpense = active.reduce((s, x) => s + sumType(shownLines(x), 'expense'), 0);

  const projectChip = l => projOn && l.projectId && projMap[l.projectId]
    ? <span className="badge badge-project" title={cap(labels.one)} style={{ marginLeft: 6 }}>{projMap[l.projectId].name}</span>
    : null;

  const txForm = tx => ({ date: tx.date, description: tx.description || '', comment: tx.comment || '',
    lines: txLines(tx).map(l => ({ id: l.id, categoryId: l.categoryId, amount: String(l.amount), projectId: l.projectId || '' })) });
  function openAdd() { setModal({ initial: null, editId: null }); }
  // Efter 1 timme är verifikatet låst: bara kommentar och projektmärkning kan ändras
  function openEdit(tx) { setModal({ editId: tx.id, initial: txForm(tx), restricted: isTxLocked(tx) }); }
  async function handleDelete(id) {
    if (deleteConfirm !== id) { setDeleteConfirm(id); return; }
    setDeleteConfirm(null);
    setActionError('');
    try { await onDelete(id); } catch (e) { setActionError(t(e.message)); }
  }
  async function doVoid(replacement) {
    setVoidBusy(true); setActionError('');
    try {
      await onVoid((replaceFor?.tx || voidTx).id, replaceFor?.reason ?? voidReason, replacement);
      setVoidTx(null); setReplaceFor(null); setVoidReason('');
    } catch (e) {
      setActionError(t(e.message)); setReplaceFor(null);
    } finally { setVoidBusy(false); }
  }

  const periodLocked = !!activePeriod?.locked;
  const lockBadge = tx => isTxLocked(tx)
    ? <Lock size={10} style={{ marginLeft: 4, verticalAlign: 'middle' }} aria-label={t('Låst')} />
    : null;
  const voidBadge = tx => tx.voidedAt ? (
    <div style={{ fontSize: '0.75rem', color: 'var(--red)', marginTop: 2 }}>
      <strong>{t('Makulerat')}</strong>: {tx.voidReason}
    </div>
  ) : null;
  const actionButtons = (tx, mobile) => {
    if (!canWrite || tx.voidedAt) return null;
    const sz = mobile ? 15 : 12, cls = mobile ? 'btn' : 'btn btn-sm', locked = isTxLocked(tx);
    return (
      <>
        <button className={`${cls} btn-secondary`} onClick={() => openEdit(tx)} disabled={periodLocked}
          title={locked ? t('Komplettera med kommentar eller projekt') : `${t('Redigera')} (${t('{n} min kvar att ändra', { n: graceMinutesLeft(tx) })})`}
          aria-label={t('Redigera')}><Pencil size={sz} /></button>
        {locked ? (
          <button className={`${cls} btn-secondary`} onClick={() => { setVoidReason(''); setVoidTx(tx); }} disabled={periodLocked}
            title={t('Makulera verifikatet')} aria-label={t('Makulera')}><Ban size={sz} /></button>
        ) : (
          <button className={`${cls} ${deleteConfirm === tx.id ? 'btn-danger' : 'btn-secondary'}`} onClick={() => handleDelete(tx.id)} disabled={periodLocked}
            title={deleteConfirm === tx.id ? t('Bekräfta radering') : t('Radera')} aria-label={deleteConfirm === tx.id ? t('Bekräfta radering') : t('Radera')}>
            {deleteConfirm === tx.id ? <Check size={sz} /> : <Trash2 size={sz} />}
          </button>
        )}
      </>
    );
  };


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
        {isMobile && (
          <select value={`${sort.key}:${sort.dir}`} aria-label={t('Sortera')} style={{ width: '100%' }}
            onChange={e => { const [key, dir] = e.target.value.split(':'); setSort({ key, dir }); }}>
            {[['date', t('Datum')], ['ver', t('Verifikat')], ['category', t('Kategori')], ['type', t('Typ')], ['income', t('Inkomst')], ['expense', t('Utgift')]].flatMap(([k, l]) => [
              <option key={k + 'a'} value={`${k}:asc`}>{t('Sortera')}: {l} ▲</option>,
              <option key={k + 'd'} value={`${k}:desc`}>{t('Sortera')}: {l} ▼</option>,
            ])}
          </select>
        )}
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

      {actionError && (
        <div className="notice" style={{ background: 'var(--red-soft)', borderColor: '#f5c6cb', color: 'var(--red)', marginBottom: 16 }}>
          {actionError} <button onClick={() => setActionError('')} style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>×</button>
        </div>
      )}

      {/* Tabell (dator) / kortlista (telefon) */}
      {isMobile ? (
        <div>
          <div className="m-summary">
            <span>{t('Totalt ({n} verifikat)', { n: active.length })}</span>
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
              <div className="m-card" key={tx.id} style={tx.voidedAt ? { opacity: 0.6 } : undefined}>
                <div className="m-card-top">
                  <span className="m-date">{tx.date} · {String(verMap[tx.id]).padStart(3, '0')}{lockBadge(tx)}</span>
                  <span className={`m-amount ${incAmt ? 'positive' : 'negative'}`}>{incAmt ? `+${fmt(incAmt)}` : `−${fmt(expAmt)}`}</span>
                </div>
                <div className="m-card-desc" style={tx.voidedAt ? { textDecoration: 'line-through' } : undefined}>{tx.description || '–'}</div>
                {voidBadge(tx)}
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
                  <button className="btn btn-secondary" onClick={() => setAttachTx({ tx, verNum: verMap[tx.id] })} aria-label={t('Bilagor')}><Paperclip size={15} /> {t('Bilagor')}</button>
                  {actionButtons(tx, true)}
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
              {sortTh('ver', '#')}
              {sortTh('date', t('Datum'))}
              <th>{t('Beskrivning')}</th>
              {sortTh('category', t('Kategori'))}
              {sortTh('type', t('Typ'))}
              {sortTh('income', t('Inkomst'), { className: 'text-right' })}
              {sortTh('expense', t('Utgift'), { className: 'text-right' })}
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
                <tr key={tx.id} style={tx.voidedAt ? { opacity: 0.55 } : undefined}>
                  <td className="mono" style={{ color: 'var(--ink-muted)' }}>{String(verMap[tx.id]).padStart(3, '0')}{lockBadge(tx)}</td>
                  <td className="mono">{tx.date}</td>
                  <td>
                    <span style={tx.voidedAt ? { textDecoration: 'line-through' } : undefined}>{tx.description || <em style={{ color: 'var(--ink-muted)' }}>–</em>}</span>
                    {voidBadge(tx)}
                  </td>
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
                      onClick={() => setAttachTx({ tx, verNum: verMap[tx.id] })}
                      style={{ padding:'4px 8px' }}
                    >
                      <Paperclip size={12}/>
                    </button>
                  </td>
                  <td>
                    {canWrite && !tx.voidedAt && <div className="gap-row" style={{ gap: 4 }}>{actionButtons(tx, false)}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={5} style={{ fontFamily: 'var(--font-body)', fontWeight: 600 }}>{t('Totalt ({n} verifikat)', { n: active.length })}</td>
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
          restricted={!!modal.restricted}
          expense={modal.editId ? 'off' : canSubmitExpense ? 'optional' : 'off'}
          onSubmit={async (payload, files, isExpense) => {
            if (modal.restricted) await onUpdateLocked(modal.editId, { comment: payload.comment, lineProjects: payload.lines.map(l => ({ lineId: l.id, projectId: l.projectId })) });
            else if (modal.editId) await onUpdate(modal.editId, payload);
            else if (isExpense) await onSubmitExpense(payload, files);
            else await onAdd(payload, files);
          }}
          onClose={() => setModal(null)}
        />
      )}

      {voidTx && !replaceFor && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !voidBusy && setVoidTx(null)}>
          <div className="modal" style={{ maxWidth: 500 }}>
            <div className="modal-header">
              <div className="modal-title">{t('Makulera verifikat')}</div>
              <button className="modal-close" onClick={() => setVoidTx(null)} disabled={voidBusy}><X size={18} /></button>
            </div>
            <div className="notice notice-warn" style={{ marginBottom: 14, fontSize: '0.85rem' }}>
              {t('Enligt bokföringslagen får ett verifikat inte ändras eller raderas. Ett makulerat verifikat ligger kvar i kassaboken, märkt som makulerat med din orsak, men räknas inte i summorna.')}
            </div>
            <p style={{ fontSize: '0.88rem', marginBottom: 12 }}>
              {voidTx.date} · {voidTx.description || '–'} · <strong className="mono">{fmt(txLines(voidTx).reduce((a, l) => a + Number(l.amount), 0))}</strong>
            </p>
            <label>{t('Orsak till makuleringen')} *</label>
            <textarea value={voidReason} onChange={e => setVoidReason(e.target.value)} rows={3} maxLength={300} autoFocus style={{ width: '100%' }}
              placeholder={t('t.ex. Fel belopp, dubbelregistrerat')} />
            <div className="btn-row" style={{ marginTop: 16, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button className="btn btn-secondary" onClick={() => setVoidTx(null)} disabled={voidBusy}>{t('Avbryt')}</button>
              <button className="btn btn-danger" disabled={voidBusy || !voidReason.trim()} onClick={() => doVoid(null)}>
                <Ban size={14} /> {voidBusy ? t('Makulerar…') : t('Makulera utan ersättning')}
              </button>
              <button className="btn btn-primary" disabled={voidBusy || !voidReason.trim()} onClick={() => setReplaceFor({ tx: voidTx, reason: voidReason.trim() })}>
                {t('Makulera och ersätt…')}
              </button>
            </div>
          </div>
        </div>
      )}

      {replaceFor && (
        <VoucherModal
          orgId={orgId}
          categories={categories}
          initial={txForm(replaceFor.tx)}
          editing
          title={t('Ersättande verifikat')}
          submitLabel={t('Makulera och spara ersättningen')}
          onSubmit={payload => doVoid(payload)}
          onClose={() => setReplaceFor(null)}
        />
      )}
    </div>
  );
}
