import { useState, useEffect, useMemo } from 'react';
import { Plus, Pencil, Trash2, Check, X, Paperclip, Loader, Wallet } from 'lucide-react';
import { supabase } from '../supabase';
import { useAuth } from '../auth/AuthProvider';
import { useI18n } from '../i18n';
import { fmt, todayStr, isValidIsoDate, expenses, claimFolder, isDemoMode } from '../store';
import DateInput from '../components/DateInput';
import VoucherModal from '../components/VoucherModal';
import AttachmentPanel from './AttachmentPanel';

const STATUS = {
  submitted: { label: 'Väntar på godkännande', bg: 'var(--amber-soft)', color: 'var(--amber)' },
  approved:  { label: 'Godkänt, ej utbetalt',  bg: 'var(--blue-soft)',  color: 'var(--blue)' },
  rejected:  { label: 'Avslaget',              bg: 'var(--red-soft)',   color: 'var(--red)' },
  paid:      { label: 'Utbetalt',              bg: 'var(--accent-3)',   color: 'var(--accent)' },
};

export default function Utlagg({ orgId, claims, categories, fiscalPeriods, onReload, onTransactionsChanged, onFlash }) {
  const { t } = useI18n();
  const { session, role } = useAuth();
  const myId = session?.user?.id;
  const isWriter = role !== 'viewer';
  const isMain = role === 'main_owner';
  const catMap = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c])), [categories]);

  const [names, setNames]       = useState({});
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

  useEffect(() => {
    supabase.rpc('get_org_members_with_email', { p_org_id: orgId }).then(({ data }) => {
      setNames(Object.fromEntries((data || []).map(m => [m.user_id, m.nickname || m.email])));
    });
  }, [orgId]);

  const nameOf = c => names[c.userId] || t('Tidigare medlem');
  const mine = claims.filter(c => c.userId === myId);
  const toHandle = claims.filter(c => c.status === 'submitted' || c.status === 'approved');
  const tabs = isWriter
    ? [['handle', t('Att hantera'), toHandle.length], ['mine', t('Mina utlägg'), null], ['all', t('Alla utlägg'), null]]
    : [['mine', t('Mina utlägg'), null]];
  const activeTab = tab || (isWriter && toHandle.length ? 'handle' : 'mine');
  const shown = activeTab === 'handle' ? toHandle : activeTab === 'mine' ? mine : claims;

  const ownBlocked = c => c.userId === myId && !isMain && !isDemoMode();   // den som lagt ut pengarna får inte godkänna sitt eget (utom huvudägaren)
  const editable = c => c.userId === myId && (c.status === 'submitted' || c.status === 'rejected');

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
    if (uploadError) onFlash(t('Utlägget är inskickat, men bilagan kunde inte laddas upp: {fel}. Öppna utlägget och lägg till den igen.', { fel: uploadError.message }));
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

  return (
    <div>
      <div className="notice notice-info" style={{ marginBottom: 16 }}>
        {t('Här registrerar du utlägg, alltså pengar du själv har lagt ut för föreningen. Ladda upp kvittot, välj kategori och skicka in. När någon i föreningen har godkänt utlägget och betalat ut pengarna får du besked, och utlägget bokförs i kassaboken.')}
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
        <button className="btn btn-primary" onClick={() => setModal({})}><Plus size={15} /> {t('Registrera utlägg')}</button>
      </div>

      {shown.length === 0 ? (
        <div className="empty-state"><p>{activeTab === 'handle' ? t('Inga utlägg väntar på dig.') : t('Inga utlägg att visa.')}</p></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {shown.map(c => {
            const st = STATUS[c.status];
            const own = c.userId === myId;
            return (
              <div key={c.id} className="card" style={{ padding: '14px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0, flex: '1 1 240px' }}>
                    <div style={{ fontWeight: 600 }}>{c.description || <em style={{ color: 'var(--ink-muted)' }}>{t('Utan beskrivning')}</em>}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--ink-muted)', marginTop: 2 }}>
                      {c.date} · {own ? t('Du') : nameOf(c)}
                    </div>
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
                    <strong>{t('Anledning till avslag')}:</strong> {c.rejectReason}
                  </div>
                )}
                {c.status === 'paid' && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--ink-muted)', marginTop: 8 }}>
                    {t('Utbetalt {datum} och bokfört i kassaboken.', { datum: c.paidDate })}
                  </div>
                )}

                <div className="btn-row" style={{ marginTop: 12, gap: 6, flexWrap: 'wrap' }}>
                  <button {...btnProps} className="btn btn-sm btn-secondary" onClick={() => setAttach({ claim: c, readOnly: !editable(c) })}>
                    <Paperclip size={12} /> {t('Kvitton')}
                  </button>
                  {editable(c) && <>
                    <button {...btnProps} className="btn btn-sm btn-secondary" onClick={() => setModal({ claim: c })}>
                      <Pencil size={12} /> {c.status === 'rejected' ? t('Ändra och skicka in igen') : t('Redigera')}
                    </button>
                    <button {...btnProps} className={`btn btn-sm ${deleteConfirm === c.id ? 'btn-danger' : 'btn-secondary'}`} onClick={() => remove(c)}
                      title={deleteConfirm === c.id ? t('Klicka igen för att bekräfta') : t('Ta bort')}>
                      {deleteConfirm === c.id ? <><Check size={12} /> {t('Bekräfta radering')}</> : <Trash2 size={12} />}
                    </button>
                  </>}
                  {isWriter && c.status === 'submitted' && <>
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
          expense="forced"
          editing={!!modal.claim}
          initial={modal.claim && {
            date: modal.claim.date, description: modal.claim.description, comment: modal.claim.comment,
            lines: modal.claim.lines.map(l => ({ categoryId: l.categoryId, amount: String(l.amount), projectId: l.projectId || '' })),
          }}
          onSubmit={(payload, files) => submit(payload, files, modal.claim)}
          onClose={() => setModal(null)}
        />
      )}

      {attach && (
        <AttachmentPanel
          tx={{ id: claimFolder(attach.claim.id), date: attach.claim.date, description: attach.claim.description }}
          label={t('Utlägg')}
          readOnly={attach.readOnly}
          onClose={() => setAttach(null)}
        />
      )}

      {rejecting && overlay(() => setRejecting(null), <>
        <div className="modal-header">
          <div className="modal-title">{t('Avslå utlägg')}</div>
          <button className="modal-close" onClick={() => setRejecting(null)} disabled={busy}><X size={18} /></button>
        </div>
        <p style={{ fontSize: '0.88rem', marginBottom: 12 }}>
          {rejecting.description || t('Utan beskrivning')} · <strong className="mono">{fmt(rejecting.total)}</strong> · {nameOf(rejecting)}
        </p>
        <label>{t('Anledning (visas för den som lagt ut pengarna)')} *</label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={300} autoFocus style={{ width: '100%' }} />
        <div className="btn-row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={() => setRejecting(null)} disabled={busy}>{t('Avbryt')}</button>
          <button className="btn btn-danger" onClick={reject} disabled={busy || !reason.trim()}>
            {busy ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <X size={14} />} {t('Avslå utlägget')}
          </button>
        </div>
      </>)}

      {paying && overlay(() => setPaying(null), <>
        <div className="modal-header">
          <div className="modal-title">{t('Bekräfta utbetalning')}</div>
          <button className="modal-close" onClick={() => setPaying(null)} disabled={busy}><X size={18} /></button>
        </div>
        <p style={{ fontSize: '0.9rem', marginBottom: 12, lineHeight: 1.6 }}>
          {t('Bekräfta att du har betalat ut {belopp} till {namn}. Utlägget bokförs då som ett verifikat i kassaboken, med kvittot som bilaga.', { belopp: fmt(paying.total), namn: nameOf(paying) })}
        </p>
        <label>{t('Utbetalningsdatum')} *</label>
        <DateInput value={paidDate} onChange={setPaidDate} />
        <div className="btn-row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={() => setPaying(null)} disabled={busy}>{t('Avbryt')}</button>
          <button className="btn btn-primary" onClick={pay} disabled={busy}>
            {busy ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={14} />} {t('Ja, pengarna är utbetalda')}
          </button>
        </div>
      </>)}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
