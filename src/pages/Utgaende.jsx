import { useState, useEffect, useMemo } from 'react';
import { Plus, Pencil, Trash2, Check, X, Download, Send, Ban, Wallet, Loader, Users, FileText } from 'lucide-react';
import { invoicing, fmt, todayStr, isValidIsoDate } from '../store';
import { useI18n } from '../i18n';
import DateInput from '../components/DateInput';
import { buildOrgInvoicePdf } from '../orgInvoicePdf';

const STATUS = {
  draft:  { label: 'Utkast',    bg: 'var(--paper-2)',    color: 'var(--ink-muted)' },
  issued: { label: 'Obetald',   bg: 'var(--amber-soft)', color: 'var(--amber)' },
  paid:   { label: 'Betald',    bg: 'var(--accent-3)',   color: 'var(--accent)' },
  void:   { label: 'Makulerad', bg: 'var(--red-soft)',   color: 'var(--red)' },
};
const emptyCustomer = () => ({ name: '', orgNumber: '', contactPerson: '', email: '', phone: '', address: '', zip: '', city: '', reference: '', note: '' });
const SYSTEM_ADDRESS = 'faktura@foreningsbalans.se';

// Utgående fakturor och kundregister. Föreningen är avsändare. Bara ägare skapar, utfärdar och skickar; övriga ser dem.
export default function Utgaende({ orgId, orgName, categories, fiscalPeriods, invoices, details, isOwner, onReload, onTransactionsChanged, onFlash }) {
  const { t } = useI18n();
  const incomeCats = useMemo(() => categories.filter(c => c.type === 'income' && !c.hidden), [categories]);
  const seller = useMemo(() => ({ name: orgName, ...(details || {}) }), [orgName, details]);
  const hasPayInfo = !!(details?.bankgiro || details?.plusgiro || details?.bank_account || details?.swish);
  const detailsMissing = !details?.address || !details?.email || !hasPayInfo;

  const [sub, setSub]             = useState('invoices');
  const [customers, setCustomers] = useState([]);
  const [editor, setEditor]       = useState(null);    // { invoice? } faktura-redigering
  const [custModal, setCustModal] = useState(null);    // { customer?, thenSelect? }
  const [issuing, setIssuing]     = useState(null);
  const [sending, setSending]     = useState(null);
  const [paying, setPaying]       = useState(null);
  const [voiding, setVoiding]     = useState(null);
  const [paidDate, setPaidDate]   = useState(todayStr());
  const [reason, setReason]       = useState('');
  const [confirmDel, setConfirmDel] = useState(null);
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState('');

  const loadCustomers = () => invoicing.listCustomers(orgId).then(setCustomers).catch(e => setError(t(e.message)));
  useEffect(() => { loadCustomers(); }, [orgId]);
  const custById = Object.fromEntries(customers.map(c => [c.id, c]));

  async function run(fn) {
    setBusy(true); setError('');
    try { await fn(); return true; }
    catch (e) { setError(t(e.message || 'okänt fel')); return false; }
    finally { setBusy(false); }
  }

  const pdfOf = inv => {
    const doc = buildOrgInvoicePdf({ invoice: inv, seller });
    return { doc, filename: `Faktura_${inv.invoiceNo || 'utkast'}.pdf` };
  };
  const download = inv => { const { doc, filename } = pdfOf(inv); doc.save(filename); };

  const today = todayStr();
  const order = { issued: 0, draft: 1, paid: 2, void: 3 };
  const sorted = [...invoices].sort((a, b) => (order[a.status] - order[b.status]) || ((a.dueDate || a.invoiceDate || '').localeCompare(b.dueDate || b.invoiceDate || '')));

  const overlay = (onClose, children, maxWidth = 480) => (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" style={{ maxWidth }}>{children}</div>
    </div>
  );
  const head = (title, onClose) => (
    <div className="modal-header">
      <div className="modal-title">{title}</div>
      <button className="modal-close" onClick={onClose} disabled={busy}><X size={18} /></button>
    </div>
  );

  return (
    <div>
      {detailsMissing && isOwner && (
        <div className="notice notice-warn" style={{ marginBottom: 16, fontSize: '0.85rem' }}>
          {t('Fyll i föreningens uppgifter (adress, e-post och hur man betalar) så att de kommer med på fakturorna.')}{' '}
          <a href="#installningar" style={{ fontWeight: 600 }}>{t('Öppna Inställningar')}</a>
        </div>
      )}
      {error && (
        <div className="notice" style={{ background: 'var(--red-soft)', borderColor: '#f5c6cb', color: 'var(--red)', marginBottom: 16 }}>
          {error} <button onClick={() => setError('')} style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>×</button>
        </div>
      )}

      <div className="gap-row" style={{ marginBottom: 16, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className={`btn btn-sm ${sub === 'invoices' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSub('invoices')}><FileText size={12} /> {t('Fakturor')}</button>
          <button className={`btn btn-sm ${sub === 'customers' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSub('customers')}><Users size={12} /> {t('Kunder')} ({customers.length})</button>
        </div>
        {isOwner && (sub === 'invoices'
          ? <button className="btn btn-primary" onClick={() => setEditor({})}><Plus size={15} /> {t('Ny faktura')}</button>
          : <button className="btn btn-primary" onClick={() => setCustModal({})}><Plus size={15} /> {t('Ny kund')}</button>)}
      </div>

      {sub === 'invoices' && (sorted.length === 0 ? (
        <div className="empty-state"><p>{t('Inga fakturor ännu.')}{isOwner ? ` ${t('Lägg först till en kund och skapa sedan en faktura.')}` : ''}</p></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sorted.map(inv => {
            const st = STATUS[inv.status];
            const overdue = inv.status === 'issued' && inv.dueDate && inv.dueDate < today;
            return (
              <div key={inv.id} className="card" style={{ padding: '14px 16px', opacity: inv.status === 'void' ? 0.6 : 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0, flex: '1 1 240px' }}>
                    <div style={{ fontWeight: 600 }}>
                      {inv.customer?.name || '–'}
                      <span style={{ fontWeight: 400, color: 'var(--ink-muted)' }}> · {inv.invoiceNo ? `${t('Faktura')} ${inv.invoiceNo}` : t('Utkast')}</span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--ink-muted)', marginTop: 2 }}>
                      {t('Fakturadatum')} {inv.invoiceDate}
                      {inv.dueDate && <> · <span style={{ color: overdue ? 'var(--red)' : undefined, fontWeight: overdue ? 600 : 400 }}>{t('Förfaller')} {inv.dueDate}{overdue ? ` (${t('förfallen')})` : ''}</span></>}
                    </div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--ink-soft)', marginTop: 4 }}>
                      {inv.lines.map(l => l.description).join(', ').slice(0, 120)}
                    </div>
                    {inv.sentAt && <div style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', marginTop: 4 }}>{t('Skickad till {mail}', { mail: inv.sentTo })} ({inv.sentAt.slice(0, 10)})</div>}
                    {inv.status === 'void' && inv.voidReason && <div style={{ fontSize: '0.8rem', color: 'var(--red)', marginTop: 4 }}><strong>{t('Makulerad')}</strong>: {inv.voidReason}</div>}
                    {inv.status === 'paid' && <div style={{ fontSize: '0.8rem', color: 'var(--ink-muted)', marginTop: 4 }}>{t('Betald {datum} och bokförd i kassaboken.', { datum: inv.paidDate })}</div>}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="mono" style={{ fontSize: '1.05rem', fontWeight: 600 }}>{fmt(inv.total)}</div>
                    <span className="badge" style={{ background: st.bg, color: st.color, marginTop: 6, letterSpacing: 0 }}>{t(st.label)}</span>
                  </div>
                </div>
                <div className="btn-row" style={{ marginTop: 12, gap: 6, flexWrap: 'wrap' }}>
                  <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => download(inv)}><Download size={12} /> {t('PDF')}</button>
                  {isOwner && inv.status === 'draft' && <>
                    <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => setEditor({ invoice: inv })}><Pencil size={12} /> {t('Redigera')}</button>
                    <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => setIssuing(inv)}><Check size={12} /> {t('Utfärda')}</button>
                    <button className={`btn btn-sm ${confirmDel === inv.id ? 'btn-danger' : 'btn-secondary'}`} disabled={busy}
                      title={confirmDel === inv.id ? t('Klicka igen för att bekräfta') : t('Ta bort')}
                      onClick={async () => {
                        if (confirmDel !== inv.id) { setConfirmDel(inv.id); return; }
                        setConfirmDel(null);
                        await run(async () => { await invoicing.deleteInvoice(orgId, inv.id); await onReload(); });
                      }}>
                      {confirmDel === inv.id ? <><Check size={12} /> {t('Bekräfta radering')}</> : <Trash2 size={12} />}
                    </button>
                  </>}
                  {isOwner && inv.status === 'issued' && <>
                    <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => setSending(inv)}><Send size={12} /> {inv.sentAt ? t('Skicka igen') : t('Skicka till kund')}</button>
                    <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => { setPaidDate(todayStr()); setPaying(inv); }}><Wallet size={12} /> {t('Markera betald')}</button>
                    <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => { setReason(''); setVoiding(inv); }}><Ban size={12} /> {t('Makulera')}</button>
                  </>}
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {sub === 'customers' && (customers.length === 0 ? (
        <div className="empty-state"><p>{t('Inga kunder ännu.')}</p></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {customers.map(c => (
            <div key={c.id} className="card" style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{c.name}{c.orgNumber && <span style={{ fontWeight: 400, color: 'var(--ink-muted)' }}> · {c.orgNumber}</span>}</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--ink-soft)', marginTop: 2 }}>
                  {[c.contactPerson, c.email, c.phone].filter(Boolean).join(' · ') || <em>{t('Inga kontaktuppgifter')}</em>}
                </div>
                {(c.address || c.city) && <div style={{ fontSize: '0.8rem', color: 'var(--ink-muted)' }}>{[c.address, [c.zip, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</div>}
              </div>
              {isOwner && (
                <div className="gap-row" style={{ gap: 4 }}>
                  <button className="btn btn-sm btn-secondary" onClick={() => setCustModal({ customer: c })}><Pencil size={12} /> {t('Redigera')}</button>
                  <button className={`btn btn-sm ${confirmDel === c.id ? 'btn-danger' : 'btn-secondary'}`} title={t('Ta bort')}
                    onClick={async () => {
                      if (confirmDel !== c.id) { setConfirmDel(c.id); return; }
                      setConfirmDel(null);
                      await run(async () => { await invoicing.deleteCustomer(orgId, c.id); await loadCustomers(); });
                    }}>
                    {confirmDel === c.id ? <><Check size={12} /> {t('Bekräfta radering')}</> : <Trash2 size={12} />}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}

      {editor && (
        <InvoiceEditor
          t={t} orgId={orgId} invoice={editor.invoice} customers={customers} incomeCats={incomeCats} details={details}
          onNewCustomer={cb => setCustModal({ thenSelect: cb })}
          onSaved={async () => { setEditor(null); await onReload(); }}
          onClose={() => setEditor(null)}
        />
      )}

      {custModal && (
        <CustomerModal
          t={t} orgId={orgId} customer={custModal.customer}
          onSaved={async saved => { setCustModal(null); await loadCustomers(); custModal.thenSelect?.(saved.id); }}
          onClose={() => setCustModal(null)}
        />
      )}

      {issuing && overlay(() => setIssuing(null), <>
        {head(t('Utfärda faktura'), () => setIssuing(null))}
        <div className="notice notice-warn" style={{ marginBottom: 14, fontSize: '0.85rem' }}>
          {t('När fakturan utfärdas får den sitt fakturanummer och kan inte längre ändras. Behöver något rättas får du makulera fakturan och skapa en ny.')}
        </div>
        <p style={{ fontSize: '0.9rem', marginBottom: 14 }}>{issuing.customer?.name} · <strong className="mono">{fmt(issuing.total)}</strong></p>
        <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={() => setIssuing(null)} disabled={busy}>{t('Avbryt')}</button>
          <button className="btn btn-primary" disabled={busy} onClick={async () => {
            const inv = issuing;
            if (await run(async () => { await invoicing.issueInvoice(orgId, inv.id); await onReload(); })) setIssuing(null);
          }}>{busy ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={14} />} {t('Utfärda fakturan')}</button>
        </div>
      </>)}

      {sending && overlay(() => setSending(null), <>
        {head(t('Skicka faktura till kund'), () => setSending(null))}
        <div className="notice notice-info" style={{ marginBottom: 14, fontSize: '0.85rem' }}>
          {t('Fakturan skickas som e-post med fakturan som PDF. Avsändare är {namn}. Föreningsbalans är bara det tekniska verktyget.', { namn: orgName })}
        </div>
        <table style={{ width: '100%', fontSize: '0.88rem', marginBottom: 14 }}>
          <tbody>
            <tr><td style={{ color: 'var(--ink-muted)', width: 120 }}>{t('Från')}</td><td><strong>{orgName}</strong> <span style={{ color: 'var(--ink-muted)' }}>({SYSTEM_ADDRESS})</span></td></tr>
            <tr><td style={{ color: 'var(--ink-muted)' }}>{t('Svar går till')}</td><td>{details?.email || <span style={{ color: 'var(--red)' }}>{t('Saknas, fyll i under Inställningar')}</span>}</td></tr>
            <tr><td style={{ color: 'var(--ink-muted)' }}>{t('Till')}</td><td>{sending.customer?.email ? `${sending.customer.name} <${sending.customer.email}>` : <span style={{ color: 'var(--red)' }}>{t('Kunden saknar e-postadress')}</span>}</td></tr>
            <tr><td style={{ color: 'var(--ink-muted)' }}>{t('Kopia')}</td><td>{t('Föreningen får en kopia')}</td></tr>
            <tr><td style={{ color: 'var(--ink-muted)' }}>{t('Faktura')}</td><td>{sending.invoiceNo} · <strong className="mono">{fmt(sending.total)}</strong></td></tr>
          </tbody>
        </table>
        <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={() => setSending(null)} disabled={busy}>{t('Avbryt')}</button>
          <button className="btn btn-primary" disabled={busy || !sending.customer?.email || !details?.email} onClick={async () => {
            const inv = sending;
            const ok = await run(async () => {
              const { doc, filename } = pdfOf(inv);
              const r = await invoicing.sendInvoice(orgId, inv.id, doc.output('blob'), filename);
              onFlash(r?.demo ? t('Demoläge: ingen faktura skickades, men så här hade det gått till.') : t('Fakturan skickades till {mail}.', { mail: r?.to || inv.customer.email }));
              await onReload();
            });
            if (ok) setSending(null);
          }}>{busy ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />} {t('Skicka fakturan från {namn}', { namn: orgName })}</button>
        </div>
      </>, 540)}

      {paying && overlay(() => setPaying(null), <>
        {head(t('Markera faktura som betald'), () => setPaying(null))}
        <p style={{ fontSize: '0.9rem', marginBottom: 12, lineHeight: 1.6 }}>
          {t('Bekräfta att {kund} har betalat {belopp}. Fakturan bokförs då som en intäkt i kassaboken.', { kund: paying.customer?.name, belopp: fmt(paying.total) })}
        </p>
        <label>{t('Betaldatum')} *</label>
        <DateInput value={paidDate} onChange={setPaidDate} />
        <div className="btn-row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={() => setPaying(null)} disabled={busy}>{t('Avbryt')}</button>
          <button className="btn btn-primary" disabled={busy} onClick={async () => {
            const inv = paying;
            if (!isValidIsoDate(paidDate)) { setError(t('Ange ett giltigt datum på formatet YYYY-MM-DD.')); return; }
            if (fiscalPeriods.some(p => p.locked && paidDate >= p.start && paidDate <= p.end)) { setError(t('Räkenskapsperioden för det datumet är låst. Välj ett annat datum eller lås upp perioden.')); return; }
            const ok = await run(async () => { await invoicing.payInvoice(orgId, inv.id, paidDate); await onReload(); await onTransactionsChanged(); });
            if (ok) setPaying(null);
          }}>{busy ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={14} />} {t('Ja, fakturan är betald')}</button>
        </div>
      </>)}

      {voiding && overlay(() => setVoiding(null), <>
        {head(t('Makulera faktura'), () => setVoiding(null))}
        <div className="notice notice-warn" style={{ marginBottom: 14, fontSize: '0.85rem' }}>
          {t('En utfärdad faktura raderas inte. Den ligger kvar i listan som makulerad, med din orsak.')}
        </div>
        <label>{t('Orsak till makuleringen')} *</label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={300} autoFocus style={{ width: '100%' }} />
        <div className="btn-row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={() => setVoiding(null)} disabled={busy}>{t('Avbryt')}</button>
          <button className="btn btn-danger" disabled={busy || !reason.trim()} onClick={async () => {
            const inv = voiding;
            if (await run(async () => { await invoicing.voidInvoice(orgId, inv.id, reason); await onReload(); })) setVoiding(null);
          }}><Ban size={14} /> {t('Makulera fakturan')}</button>
        </div>
      </>)}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Kund ─────────────────────────────────────────────────────
function CustomerModal({ t, orgId, customer, onSaved, onClose }) {
  const [form, setForm] = useState(customer ? { ...customer } : emptyCustomer());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const field = (k, label, props = {}) => (
    <div><label>{label}</label><input type="text" value={form[k]} onChange={e => set(k, e.target.value)} {...props} /></div>
  );
  async function save(e) {
    e.preventDefault();
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) { setError(t('Ange en giltig e-postadress.')); return; }
    setBusy(true); setError('');
    try { onSaved(await invoicing.saveCustomer(orgId, form)); }
    catch (err) { setError(t(err.message || 'okänt fel')); setBusy(false); }
  }
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div className="modal-title">{customer ? t('Redigera kund') : t('Ny kund')}</div>
          <button className="modal-close" onClick={onClose} disabled={busy}><X size={18} /></button>
        </div>
        <form onSubmit={save}>
          {error && <div className="notice" style={{ background: 'var(--red-soft)', borderColor: 'var(--red)', color: 'var(--red)', marginBottom: 12 }}>{error}</div>}
          <div className="form-row">{field('name', `${t('Namn')} *`, { required: true, maxLength: 120, autoFocus: true })}</div>
          <div className="form-row form-row-cols">
            {field('orgNumber', t('Organisationsnummer'), { maxLength: 20, placeholder: '802000-0000' })}
            {field('contactPerson', t('Kontaktperson'), { maxLength: 120 })}
          </div>
          <div className="form-row form-row-cols">
            {field('email', t('E-post'), { type: 'email', maxLength: 200 })}
            {field('phone', t('Telefon'), { maxLength: 40 })}
          </div>
          <div className="form-row">{field('address', t('Adress'), { maxLength: 160 })}</div>
          <div className="form-row form-row-cols">
            {field('zip', t('Postnummer'), { maxLength: 10 })}
            {field('city', t('Ort'), { maxLength: 80 })}
          </div>
          <div className="form-row">{field('reference', t('Kundens referens (visas på fakturan)'), { maxLength: 120 })}</div>
          <div className="form-row">{field('note', t('Anteckning (visas inte på fakturan)'), { maxLength: 500 })}</div>
          <div className="btn-row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>{t('Avbryt')}</button>
            <button type="submit" className="btn btn-primary" disabled={busy}><Check size={14} /> {busy ? t('Sparar…') : t('Spara kund')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Faktura (utkast) ─────────────────────────────────────────
function InvoiceEditor({ t, orgId, invoice, customers, incomeCats, details, onNewCustomer, onSaved, onClose }) {
  const [form, setForm] = useState(() => invoice ? {
    customerId: invoice.customerId || '', invoiceDate: invoice.invoiceDate, paymentDays: String(invoice.paymentDays), reference: invoice.reference, note: invoice.note,
    lines: invoice.lines.map(l => ({ description: l.description, quantity: String(l.quantity), unitPrice: String(l.unitPrice), categoryId: l.categoryId })),
  } : {
    customerId: '', invoiceDate: todayStr(), paymentDays: String(details?.payment_days || 30), reference: '', note: details?.note || '',
    lines: [{ description: '', quantity: '1', unitPrice: '', categoryId: incomeCats[0]?.id || '' }],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setLine = (i, patch) => setForm(f => ({ ...f, lines: f.lines.map((l, j) => j === i ? { ...l, ...patch } : l) }));
  const amountOf = l => Math.round((parseFloat(l.quantity) || 0) * (parseFloat(l.unitPrice) || 0) * 100) / 100;
  const total = form.lines.reduce((s, l) => s + amountOf(l), 0);

  async function save(e) {
    e.preventDefault();
    if (!form.customerId) { setError(t('Välj en kund.')); return; }
    if (!isValidIsoDate(form.invoiceDate)) { setError(t('Ange ett giltigt datum på formatet YYYY-MM-DD.')); return; }
    if (form.lines.some(l => !l.description.trim() || !(parseFloat(l.quantity) > 0) || !(parseFloat(l.unitPrice) >= 0) || !l.categoryId)) {
      setError(t('Fyll i beskrivning, antal, à-pris och intäktskategori på varje rad.')); return;
    }
    if (!(total > 0)) { setError(t('Fakturan måste ha ett belopp över noll.')); return; }
    setBusy(true); setError('');
    try { await invoicing.saveInvoice(orgId, { id: invoice?.id, ...form }); await onSaved(); }
    catch (err) { setError(t(err.message || 'okänt fel')); setBusy(false); }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" style={{ maxWidth: 680 }}>
        <div className="modal-header">
          <div className="modal-title">{invoice ? t('Redigera fakturautkast') : t('Ny faktura')}</div>
          <button className="modal-close" onClick={onClose} disabled={busy}><X size={18} /></button>
        </div>
        <form onSubmit={save}>
          {error && <div className="notice" style={{ background: 'var(--red-soft)', borderColor: 'var(--red)', color: 'var(--red)', marginBottom: 12 }}>{error}</div>}
          <div className="form-row">
            <div>
              <label>{t('Kund')} *</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <select value={form.customerId} onChange={e => set('customerId', e.target.value)} required style={{ flex: 1, minWidth: 0 }}>
                  <option value="">{t('– Välj kund –')}</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => onNewCustomer(id => set('customerId', id))}><Plus size={12} /> {t('Ny kund')}</button>
              </div>
            </div>
          </div>
          <div className="form-row form-row-cols">
            <div><label>{t('Fakturadatum')} *</label><DateInput value={form.invoiceDate} onChange={v => set('invoiceDate', v)} required /></div>
            <div><label>{t('Betalningsvillkor (dagar)')}</label><input type="number" min="0" max="365" value={form.paymentDays} onChange={e => set('paymentDays', e.target.value)} /></div>
          </div>
          <div className="form-row"><div><label>{t('Er referens')}</label><input type="text" maxLength={120} value={form.reference} onChange={e => set('reference', e.target.value)} /></div></div>

          <label>{t('Fakturarader')} *</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
            {form.lines.map((l, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,3fr) 70px 100px', gap: 6, alignItems: 'center' }}>
                <input type="text" placeholder={t('Beskrivning')} maxLength={200} value={l.description} onChange={e => setLine(i, { description: e.target.value })} />
                <input type="number" step="any" min="0" placeholder={t('Antal')} value={l.quantity} onChange={e => setLine(i, { quantity: e.target.value })} style={{ textAlign: 'right' }} />
                <input type="number" step="0.01" min="0" placeholder={t('À-pris')} value={l.unitPrice} onChange={e => setLine(i, { unitPrice: e.target.value })} style={{ textAlign: 'right' }} />
                <div style={{ gridColumn: '1 / 3' }}>
                  <select value={l.categoryId} onChange={e => setLine(i, { categoryId: e.target.value })} style={{ width: '100%', fontSize: '0.85rem' }}>
                    <option value="">{t('– Intäktskategori –')}</option>
                    {incomeCats.map(c => <option key={c.id} value={c.id}>{c.id} – {c.name}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                  <span className="mono" style={{ fontSize: '0.85rem' }}>{fmt(amountOf(l))}</span>
                  {form.lines.length > 1 && (
                    <button type="button" title={t('Ta bort rad')} onClick={() => set('lines', form.lines.filter((_, j) => j !== i))}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)', display: 'flex', padding: 2 }}><X size={14} /></button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => set('lines', [...form.lines, { description: '', quantity: '1', unitPrice: '', categoryId: form.lines[form.lines.length - 1]?.categoryId || '' }])}>
              <Plus size={12} /> {t('Lägg till rad')}
            </button>
            <span style={{ fontSize: '0.9rem' }}>{t('Att betala')}: <strong className="mono">{fmt(total)}</strong> <span style={{ color: 'var(--ink-muted)', fontSize: '0.75rem' }}>({t('ingen moms')})</span></span>
          </div>
          <div className="form-row"><div><label>{t('Meddelande på fakturan')}</label><textarea rows={2} maxLength={1000} value={form.note} onChange={e => set('note', e.target.value)} style={{ width: '100%' }} /></div></div>
          <div className="btn-row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>{t('Avbryt')}</button>
            <button type="submit" className="btn btn-primary" disabled={busy}><Check size={14} /> {busy ? t('Sparar…') : t('Spara utkast')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
