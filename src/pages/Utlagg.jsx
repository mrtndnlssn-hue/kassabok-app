import { useState, useEffect, useMemo } from 'react';
import { Plus, Pencil, Trash2, Check, X, Paperclip, Loader, Wallet } from 'lucide-react';
import { supabase } from '../supabase';
import { useAuth, isReadOnlyRole, isAdminRole, isPrimaryRole } from '../auth/AuthProvider';
import { useI18n } from '../i18n';
import { fmt, todayStr, isValidIsoDate, expenses, claimFolder, isDemoMode } from '../store';
import DateInput from '../components/DateInput';
import VoucherModal from '../components/VoucherModal';
import AttachmentPanel from './AttachmentPanel';
import Utgaende from './Utgaende';

const STATUS = {
  submitted: { label: 'Väntar på godkännande', bg: 'var(--amber-soft)', color: 'var(--amber)' },
  approved:  { label: 'Godkänt, ej utbetalt',  bg: 'var(--blue-soft)',  color: 'var(--blue)' },
  rejected:  { label: 'Avslaget',              bg: 'var(--red-soft)',   color: 'var(--red)' },
  paid:      { label: 'Utbetalt',              bg: 'var(--accent-3)',   color: 'var(--accent)' },
};
// Fakturor i inkorgen godkänns inte separat: de väntar på betalning
const STATUS_INVOICE = {
  submitted: { label: 'Att betala', bg: 'var(--amber-soft)', color: 'var(--amber)' },
  rejected:  { label: 'Avvisad',    bg: 'var(--red-soft)',   color: 'var(--red)' },
  paid:      { label: 'Betald',     bg: 'var(--accent-3)',   color: 'var(--accent)' },
};

export default function Utlagg({ orgId, orgName, claims, transactions, categories, fiscalPeriods, expensesOn, invoiceInboxOn, invoicingOn, outInvoices = [], invoiceDetails, addRequest, onAddHandled, onReload, onReloadInvoices, onTransactionsChanged, onFlash }) {
  const { t } = useI18n();
  const { session, role } = useAuth();
  const myId = session?.user?.id;
  const isWriter = !isReadOnlyRole(role);
  const isAuditor = role === 'auditor';
  const canSeeAll = isWriter || isAuditor;   // revisorn ser allt men ändrar inget
  const isMain = isPrimaryRole(role);
  const isOwner = isAdminRole(role);
  const catMap = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c])), [categories]);

  const [names, setNames]       = useState({});
  const [view, setView]         = useState('overview');   // 'overview' | 'expense' (utlägg) | 'invoice' (inkommande fakturor) | 'outgoing' (utgående fakturor)
  const [tab, setTab]           = useState(null);
  const [modal, setModal]       = useState(null);     // { claim } (claim saknas vid nytt utlägg)
  const [attach, setAttach]     = useState(null);     // { claim, readOnly }
  const [rejecting, setRejecting] = useState(null);   // claim
  const [reason, setReason]     = useState('');
  const [paying, setPaying]     = useState(null);     // claim
  const [paidDate, setPaidDate] = useState(todayStr());
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState('');

  // "+" i mobilens flikmeny: öppna formuläret för nytt utlägg (eller ny faktura om bara inkorgen är på)
  useEffect(() => {
    if (!addRequest) return
    if (expensesOn || invoiceInboxOn) { setView(expensesOn ? 'expense' : 'invoice'); setTab(null); setModal({}) }
    onAddHandled?.()
  }, [addRequest])

  useEffect(() => {
    supabase.rpc('get_org_members_with_email', { p_org_id: orgId }).then(({ data }) => {
      setNames(Object.fromEntries((data || []).map(m => [m.user_id, m.nickname || m.email])));
    });
  }, [orgId]);

  const nameOf = c => names[c.userId] || t('Tidigare medlem');
  const isInv = view === 'invoice';
  const list = claims.filter(c => (c.kind || 'expense') === view);
  const mine = list.filter(c => c.userId === myId || c.registeredBy === myId);
  // Fakturor sorteras på förfallodatum så att den som snart förfaller hamnar överst
  const byDue = (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
  const toHandle = list.filter(c => (isInv ? c.status === 'submitted' : (c.status === 'submitted' || c.status === 'approved'))).sort(isInv ? byDue : () => 0);
  const rejectedList = list.filter(c => c.status === 'rejected');
  const invoicesToPay = canSeeAll && invoiceInboxOn ? claims.filter(c => c.kind === 'invoice' && c.status === 'submitted').length : 0;
  const tabs = canSeeAll
    ? [['handle', isAuditor ? t('Väntande') : (isInv ? t('Att betala') : t('Att hantera')), toHandle.length],
       ...(isWriter ? [['mine', isInv ? t('Mina fakturor') : t('Mina utlägg'), null]] : []),
       ['rejected', isInv ? t('Avvisade') : t('Avslagna'), rejectedList.length],
       ['all', isInv ? t('Alla fakturor') : t('Alla utlägg'), null]]
    : [['mine', isInv ? t('Mina fakturor') : t('Mina utlägg'), null]];
  const activeTab = tab || (canSeeAll && toHandle.length ? 'handle' : isWriter ? 'mine' : canSeeAll ? 'all' : 'mine');
  const shown = activeTab === 'handle' ? toHandle : activeTab === 'mine' ? mine : activeTab === 'rejected' ? rejectedList : list;
  const switchView = v => { setView(v); setTab(null); setError(''); };
  const statusOf = c => (c.kind === 'invoice' ? STATUS_INVOICE : STATUS)[c.status];
  const today = todayStr();

  // Den som lagt ut pengarna får inte godkänna sitt eget utlägg (utom huvudägaren). Fakturor betalas till en leverantör, så där gäller det inte.
  const ownBlocked = c => c.kind !== 'invoice' && c.userId === myId && !isMain && !isDemoMode();
  const editable = c => (c.userId === myId || c.registeredBy === myId) && (c.status === 'submitted' || c.status === 'rejected');

  async function run(fn) {
    setBusy(true); setError('');
    try { await fn(); return true; }
    catch (e) { setError(t(e.message || 'okänt fel')); return false; }
    finally { setBusy(false); }
  }

  async function submit(payload, files, claim) {
    const { claim: saved, uploadError } = await expenses.submit(orgId, { ...payload, id: claim?.id }, files);
    expenses.notify(saved.id);
    await onReload();
    if (uploadError) onFlash(t('{vad} är inskickad, men bilagan kunde inte laddas upp: {fel}. Öppna posten och lägg till den igen.', { vad: payload.invoice ? t('Fakturan') : t('Utlägget'), fel: uploadError.message }));
    setTab('mine');
  }

  async function approve(c) {
    await run(async () => { await expenses.decide(orgId, c.id, true); expenses.notify(c.id); await onReload(); });
  }
  async function reject() {
    const c = rejecting;
    const ok = await run(async () => { await expenses.decide(orgId, c.id, false, reason); expenses.notify(c.id); await onReload(); });
    if (ok) { setRejecting(null); setReason(''); }
  }
  async function pay() {
    const c = paying;
    if (!isValidIsoDate(paidDate)) { setError(t('Ange ett giltigt datum på formatet YYYY-MM-DD.')); return; }
    if (fiscalPeriods.some(p => p.locked && paidDate >= p.start && paidDate <= p.end)) {
      setError(t('Räkenskapsperioden för det datumet är låst. Välj ett annat datum eller lås upp perioden.')); return;
    }
    const ok = await run(async () => {
      await expenses.pay(orgId, c.id, paidDate);
      expenses.notify(c.id);
      await onReload();
      await onTransactionsChanged();
    });
    if (ok) setPaying(null);
  }
  async function remove(c) {
    if (deleteConfirm !== c.id) { setDeleteConfirm(c.id); return; }
    setDeleteConfirm(null);
    await run(async () => { await expenses.remove(orgId, c.id); await onReload(); });
  }

  const btnProps = { type: 'button', disabled: busy };
  const overlay = (onClose, children, maxWidth = 460) => (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" style={{ maxWidth }}>{children}</div>
    </div>
  );

  // ── Översikt över allt oredovisat: utlägg, inkommande och utgående fakturor på samma ställe ──
  const sum = arr => arr.reduce((acc, c) => acc + Number(c.total), 0);
  const expToHandle = claims.filter(c => c.kind !== 'invoice' && (canSeeAll ? (c.status === 'submitted' || c.status === 'approved') && !ownBlocked(c) : c.userId === myId && (c.status === 'submitted' || c.status === 'approved')));
  const invToPay = claims.filter(c => c.kind === 'invoice' && c.status === 'submitted');
  const outUnpaid = outInvoices.filter(i => i.status === 'issued');
  const outDrafts = outInvoices.filter(i => i.status === 'draft');
  const overdueIn = invToPay.filter(c => c.dueDate && c.dueDate < today).length;
  const overdueOut = outUnpaid.filter(i => i.dueDate && i.dueDate < today).length;
  const outdated = outUnpaid.length;

  const switcher = (
    <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
      <button className={`btn ${view === 'overview' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => switchView('overview')}>{t('Översikt')}</button>
      {expensesOn && <button className={`btn ${view === 'expense' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => switchView('expense')}>
        {t('Utlägg')}{canSeeAll && expToHandle.length > 0 ? ` (${expToHandle.length})` : ''}
      </button>}
      {invoiceInboxOn && <button className={`btn ${view === 'invoice' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => switchView('invoice')}>
        {t('Inkommande fakturor')}{invoicesToPay > 0 ? ` (${invoicesToPay})` : ''}
      </button>}
      {invoicingOn && <button className={`btn ${view === 'outgoing' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => switchView('outgoing')}>
        {t('Utgående fakturor')}{outdated > 0 ? ` (${outdated})` : ''}
      </button>}
    </div>
  );
  const overviewCard = (title, count, total, lines, target, label) => (
    <div className="card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: '0.8rem', color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: '1.8rem', fontWeight: 600, fontFamily: 'var(--font-display)' }}>{count}</span>
        <span className="mono" style={{ color: 'var(--ink-soft)' }}>{fmt(total)}</span>
      </div>
      {lines.filter(Boolean).map((l, i) => <div key={i} style={{ fontSize: '0.8rem', color: l.red ? 'var(--red)' : 'var(--ink-muted)' }}>{l.text}</div>)}
      <button className="btn btn-sm btn-secondary" style={{ marginTop: 6, alignSelf: 'flex-start' }} onClick={() => switchView(target)}>{label}</button>
    </div>
  );
  if (view === 'overview' || view === 'outgoing') {
    return (
      <div>
        {switcher}
        {view === 'overview' ? (
          <>
            <div className="notice notice-info" style={{ marginBottom: 16 }}>
              {t('Här ser du allt som ännu inte är bokfört: utlägg, fakturor att betala och fakturor som kunder ska betala. Allt bokförs i kassaboken först när det är betalt.')}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
              {expensesOn && overviewCard(isAuditor ? t('Utlägg som väntar') : isWriter ? t('Utlägg att hantera') : t('Dina utlägg som väntar'), expToHandle.length, sum(expToHandle),
                [], 'expense', t('Öppna utlägg'))}
              {invoiceInboxOn && overviewCard(t('Fakturor att betala'), invToPay.length, sum(invToPay),
                [overdueIn > 0 && { text: t('{n} har förfallit', { n: overdueIn }), red: true }], 'invoice', t('Öppna inkorgen'))}
              {invoicingOn && overviewCard(t('Obetalda utgående fakturor'), outUnpaid.length, sum(outUnpaid),
                [overdueOut > 0 && { text: t('{n} har förfallit', { n: overdueOut }), red: true }, outDrafts.length > 0 && { text: t('{n} utkast', { n: outDrafts.length }) }], 'outgoing', t('Öppna fakturor'))}
            </div>
          </>
        ) : (
          <Utgaende orgId={orgId} orgName={orgName} categories={categories} fiscalPeriods={fiscalPeriods} invoices={outInvoices} details={invoiceDetails}
            isOwner={isOwner} onReload={onReloadInvoices} onTransactionsChanged={onTransactionsChanged} onFlash={onFlash} />
        )}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div>
      {switcher}

      <div className="notice notice-info" style={{ marginBottom: 16 }}>
        {isInv
          ? t('Här lägger du upp fakturor som föreningen ska betala. Ladda upp fakturan och fyll i uppgifterna, så hamnar den i inkorgen. Fakturan bokförs inte förrän kassören har betalat den och bekräftat det här.')
          : t('Här registrerar du utlägg, alltså pengar du själv har lagt ut för föreningen. Ladda upp kvittot, välj kategori och skicka in. När någon i föreningen har godkänt utlägget och betalat ut pengarna får du besked, och utlägget bokförs i kassaboken.')}
      </div>

      {error && (
        <div className="notice" style={{ background: 'var(--red-soft)', borderColor: '#f5c6cb', color: 'var(--red)', marginBottom: 16 }}>
          {error} <button onClick={() => setError('')} style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>×</button>
        </div>
      )}

      <div className="gap-row" style={{ marginBottom: 16, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {tabs.map(([id, label, count]) => (
            <button key={id} className={`btn btn-sm ${activeTab === id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(id)}>
              {label}{count ? ` (${count})` : ''}
            </button>
          ))}
        </div>
        {!isAuditor && <button className="btn btn-primary" onClick={() => setModal({})}><Plus size={15} /> {isInv ? t('Lägg upp faktura') : t('Registrera utlägg')}</button>}
      </div>

      {shown.length === 0 ? (
        <div className="empty-state"><p>{activeTab === 'handle' ? (isInv ? t('Inga fakturor väntar på betalning.') : t('Inga utlägg väntar på dig.')) : activeTab === 'rejected' ? (isInv ? t('Inga avvisade fakturor.') : t('Inga avslagna utlägg.')) : (isInv ? t('Inga fakturor att visa.') : t('Inga utlägg att visa.'))}</p></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {shown.map(c => {
            const st = statusOf(c);
            const invoice = c.kind === 'invoice';
            const overdue = invoice && c.status === 'submitted' && c.dueDate && c.dueDate < today;
            const own = c.userId === myId;
            return (
              <div key={c.id} className="card" style={{ padding: '14px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0, flex: '1 1 240px' }}>
                    <div style={{ fontWeight: 600 }}>
                      {invoice
                        ? <>{c.supplier}{c.invoiceNo ? <span style={{ fontWeight: 400, color: 'var(--ink-muted)' }}> · {t('nr')} {c.invoiceNo}</span> : null}</>
                        : (c.description || <em style={{ color: 'var(--ink-muted)' }}>{t('Utan beskrivning')}</em>)}
                    </div>
                    {invoice && c.description && <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>{c.description}</div>}
                    <div style={{ fontSize: '0.8rem', color: 'var(--ink-muted)', marginTop: 2 }}>
                      {invoice ? t('Fakturadatum') : ''} {c.date} · {own ? t('Du') : nameOf(c)}{c.registeredBy && c.registeredBy !== c.userId ? ` · ${t('registrerat av')} ${c.registeredBy === myId ? t('dig') : (names[c.registeredBy] || t('Tidigare medlem'))}` : ''}
                    </div>
                    {invoice && (c.dueDate || c.paymentRef) && (
                      <div style={{ fontSize: '0.82rem', marginTop: 4, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                        {c.dueDate && <span style={{ color: overdue ? 'var(--red)' : 'var(--ink-soft)', fontWeight: overdue ? 600 : 400 }}>
                          {t('Förfaller')} <span className="mono">{c.dueDate}</span>{overdue ? ` (${t('förfallen')})` : ''}
                        </span>}
                        {c.paymentRef && <span style={{ color: 'var(--ink-soft)' }}>{t('Betala till')}: <span className="mono">{c.paymentRef}</span></span>}
                      </div>
                    )}
                    <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {c.lines.map((l, i) => (
                        <span key={i} className="badge badge-expense" title={catMap[l.categoryId]?.name}>
                          {l.categoryId}{catMap[l.categoryId] ? ` ${catMap[l.categoryId].name}` : ''}{c.lines.length > 1 ? ` · ${fmt(l.amount)}` : ''}
                        </span>
                      ))}
                    </div>
                    {c.comment && <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginTop: 6 }}>{c.comment}</div>}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="mono" style={{ fontSize: '1.05rem', fontWeight: 600 }}>{fmt(c.total)}</div>
                    <span className="badge" style={{ background: st.bg, color: st.color, marginTop: 6, letterSpacing: 0 }}>{t(st.label)}</span>
                  </div>
                </div>

                {c.status === 'rejected' && c.rejectReason && (
                  <div className="notice" style={{ background: 'var(--red-soft)', borderColor: '#f5c6cb', color: 'var(--red)', marginTop: 10, fontSize: '0.82rem' }}>
                    <strong>{invoice ? t('Anledning till avvisning') : t('Anledning till avslag')}:</strong> {c.rejectReason}
                  </div>
                )}
                {c.status === 'paid' && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--ink-muted)', marginTop: 8 }}>
                    {invoice ? t('Betald {datum} och bokförd i kassaboken.', { datum: c.paidDate }) : t('Utbetalt {datum} och bokfört i kassaboken.', { datum: c.paidDate })}
                  </div>
                )}

                <div className="btn-row" style={{ marginTop: 12, gap: 6, flexWrap: 'wrap' }}>
                  <button {...btnProps} className="btn btn-sm btn-secondary" onClick={() => setAttach({ claim: c, readOnly: !editable(c) })}>
                    <Paperclip size={12} /> {invoice ? t('Faktura') : t('Kvitton')}
                  </button>
                  {editable(c) && (
                    <button {...btnProps} className="btn btn-sm btn-secondary" onClick={() => setModal({ claim: c })}>
                      <Pencil size={12} /> {c.status === 'rejected' ? (invoice ? t('Ändra och lägg upp igen') : t('Ändra och skicka in igen')) : t('Redigera')}
                    </button>
                  )}
                  {(editable(c) || (isWriter && c.status === 'rejected')) && (
                    <button {...btnProps} className={`btn btn-sm ${deleteConfirm === c.id ? 'btn-danger' : 'btn-secondary'}`} onClick={() => remove(c)}
                      title={deleteConfirm === c.id ? t('Klicka igen för att bekräfta') : t('Ta bort')}>
                      {deleteConfirm === c.id ? <><Check size={12} /> {t('Bekräfta radering')}</> : <Trash2 size={12} />}
                    </button>
                  )}
                  {isWriter && c.status === 'submitted' && invoice && <>
                    <button {...btnProps} className="btn btn-sm btn-primary" onClick={() => { setPaidDate(todayStr()); setPaying(c); }}>
                      <Wallet size={12} /> {t('Betala och bokför')}
                    </button>
                    <button {...btnProps} className="btn btn-sm btn-secondary" onClick={() => { setReason(''); setRejecting(c); }}>
                      <X size={12} /> {t('Avvisa')}
                    </button>
                  </>}
                  {isWriter && c.status === 'submitted' && !invoice && <>
                    <button {...btnProps} className="btn btn-sm btn-primary" disabled={busy || ownBlocked(c)} onClick={() => approve(c)}
                      title={ownBlocked(c) ? t('Någon annan måste godkänna ditt utlägg') : undefined}>
                      <Check size={12} /> {t('Godkänn')}
                    </button>
                    <button {...btnProps} className="btn btn-sm btn-secondary" disabled={busy || ownBlocked(c)} onClick={() => { setReason(''); setRejecting(c); }}
                      title={ownBlocked(c) ? t('Någon annan måste godkänna ditt utlägg') : undefined}>
                      <X size={12} /> {t('Avslå')}
                    </button>
                  </>}
                  {isWriter && c.status === 'approved' && (
                    <button {...btnProps} className="btn btn-sm btn-primary" disabled={busy || ownBlocked(c)} onClick={() => { setPaidDate(todayStr()); setPaying(c); }}
                      title={ownBlocked(c) ? t('Någon annan måste bekräfta utbetalningen av ditt utlägg') : undefined}>
                      <Wallet size={12} /> {t('Bekräfta utbetalning')}
                    </button>
                  )}
                </div>
                {isWriter && ownBlocked(c) && (c.status === 'submitted' || c.status === 'approved') && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', marginTop: 8 }}>
                    {t('Det här är ditt eget utlägg. Någon annan med skrivrätt måste hantera det.')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <VoucherModal
          orgId={orgId}
          categories={categories}
          transactions={transactions}
          claims={claims}
          selfId={modal.claim?.id}
          expense={(modal.claim ? modal.claim.kind === 'invoice' : isInv) ? 'invoice' : 'forced'}
          editing={!!modal.claim}
          initial={modal.claim && {
            date: modal.claim.date, description: modal.claim.description, counterparty: modal.claim.counterparty || '', comment: modal.claim.comment,
            lines: modal.claim.lines.map(l => ({ categoryId: l.categoryId, amount: String(l.amount), projectId: l.projectId || '' })),
            invoice: modal.claim.kind === 'invoice'
              ? { supplier: modal.claim.supplier, invoiceNo: modal.claim.invoiceNo, dueDate: modal.claim.dueDate || '', paymentRef: modal.claim.paymentRef }
              : undefined,
          }}
          onSubmit={(payload, files) => submit(payload, files, modal.claim)}
          onClose={() => setModal(null)}
        />
      )}

      {attach && (
        <AttachmentPanel
          tx={{ id: claimFolder(attach.claim.id), date: attach.claim.date, description: attach.claim.description }}
          label={attach.claim.kind === 'invoice' ? t('Faktura') : t('Utlägg')}
          readOnly={attach.readOnly}
          onClose={() => setAttach(null)}
        />
      )}

      {rejecting && overlay(() => setRejecting(null), <>
        <div className="modal-header">
          <div className="modal-title">{rejecting.kind === 'invoice' ? t('Avvisa faktura') : t('Avslå utlägg')}</div>
          <button className="modal-close" onClick={() => setRejecting(null)} disabled={busy}><X size={18} /></button>
        </div>
        <p style={{ fontSize: '0.88rem', marginBottom: 12 }}>
          {(rejecting.kind === 'invoice' ? rejecting.supplier : rejecting.description) || t('Utan beskrivning')} · <strong className="mono">{fmt(rejecting.total)}</strong> · {nameOf(rejecting)}
        </p>
        <label>{rejecting.kind === 'invoice' ? t('Anledning (visas för den som lagt upp fakturan)') : t('Anledning (visas för den som lagt ut pengarna)')} *</label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={300} autoFocus style={{ width: '100%' }} />
        <div className="btn-row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={() => setRejecting(null)} disabled={busy}>{t('Avbryt')}</button>
          <button className="btn btn-danger" onClick={reject} disabled={busy || !reason.trim()}>
            {busy ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <X size={14} />} {rejecting.kind === 'invoice' ? t('Avvisa fakturan') : t('Avslå utlägget')}
          </button>
        </div>
      </>)}

      {paying && overlay(() => setPaying(null), <>
        <div className="modal-header">
          <div className="modal-title">{paying.kind === 'invoice' ? t('Betala och bokför') : t('Bekräfta utbetalning')}</div>
          <button className="modal-close" onClick={() => setPaying(null)} disabled={busy}><X size={18} /></button>
        </div>
        <p style={{ fontSize: '0.9rem', marginBottom: 12, lineHeight: 1.6 }}>
          {paying.kind === 'invoice'
            ? t('Bekräfta att du har betalat fakturan från {namn} på {belopp}. Den bokförs då som ett verifikat i kassaboken, med fakturan som bilaga.', { namn: paying.supplier, belopp: fmt(paying.total) })
            : t('Bekräfta att du har betalat ut {belopp} till {namn}. Utlägget bokförs då som ett verifikat i kassaboken, med kvittot som bilaga.', { belopp: fmt(paying.total), namn: nameOf(paying) })}
        </p>
        {paying.kind === 'invoice' && paying.paymentRef && (
          <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginBottom: 12 }}>{t('Betala till')}: <span className="mono">{paying.paymentRef}</span></p>
        )}
        <label>{paying.kind === 'invoice' ? t('Betaldatum') : t('Utbetalningsdatum')} *</label>
        <DateInput value={paidDate} onChange={setPaidDate} />
        <div className="btn-row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={() => setPaying(null)} disabled={busy}>{t('Avbryt')}</button>
          <button className="btn btn-primary" onClick={pay} disabled={busy}>
            {busy ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={14} />} {paying.kind === 'invoice' ? t('Ja, fakturan är betald') : t('Ja, pengarna är utbetalda')}
          </button>
        </div>
      </>)}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
