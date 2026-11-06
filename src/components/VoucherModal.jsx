import { useState, useRef, useEffect } from 'react';
import { Plus, Trash2, X, Check, Upload, FileText, Sparkles, Camera } from 'lucide-react';
import { getReceiptUsage, readReceipt, canReadWithAi, buildHistory } from '../receiptAi';
import { fmt, todayStr, isValidIsoDate, txLines, isDemoMode } from '../store';
import DateInput from './DateInput';
import { useI18n } from '../i18n';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../supabase';
import useIsMobile from '../hooks/useIsMobile';
import { useProjects, cap } from '../ProjectsContext';

export const emptyVoucherForm = () => ({
  date: todayStr(),
  description: '',
  lines: [{ categoryId: '', amount: '', projectId: '' }],   // ett verifikat kan bokföras på flera konton
  comment: '',
});

// Rutan för nytt/ändrat verifikat. Används också för utlägg:
//  expense = 'off'      vanligt verifikat
//  expense = 'optional' kryssrutan "Eget utlägg" finns (kassören kan välja)
//  expense = 'forced'   alltid utlägg (den som bara får registrera utlägg)
//  expense = 'invoice'  en faktura som läggs i inkorgen för betalning (leverantör, förfallodatum, betalningsuppgifter)
//  restricted = true  verifikatet är låst (äldre än 1 timme): bara kommentar och projektmärkning kan ändras
export default function VoucherModal({ orgId, categories, initial, editing = false, expense = 'off', restricted = false, transactions = [], claims = [], selfId = null, title: titleProp, submitLabel: submitLabelProp, onSubmit, onClose }) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const { enabled: projOn, labels, projects } = useProjects();
  const showProjects = projOn && projects.length > 0;

  const [form, setForm] = useState(initial || emptyVoucherForm);
  const { session, role } = useAuth();
  const [members, setMembers] = useState([]);   // föreningens medlemmar: ägare och medlemmar kan registrera utlägg åt andra
  const [forUser, setForUser] = useState('');
  useEffect(() => {
    if (editing || role === 'viewer' || !(expense === 'forced' || expense === 'optional')) return;
    supabase.rpc('get_org_members_with_email', { p_org_id: orgId }).then(({ data }) =>
      setMembers((data || []).map(m => ({ id: m.user_id, name: m.nickname || m.email }))));
  }, [orgId, editing, role, expense]);
  const isInvoice = expense === 'invoice';
  const [isExpense, setIsExpense]   = useState(expense === 'forced' || isInvoice);
  const [inv, setInv] = useState(initial?.invoice || { supplier: '', invoiceNo: '', dueDate: '', paymentRef: '' });
  const setInvField = (k, v) => setInv(x => ({ ...x, [k]: v }));
  const [newFiles, setNewFiles]     = useState([]); // [{file, url}]
  const [previewIdx, setPreviewIdx] = useState(0);
  const [saving, setSaving]         = useState(false);
  const [saveError, setSaveError]   = useState('');
  const [dragOver, setDragOver]     = useState(false);
  const [aiUsage, setAiUsage]       = useState(null); // {enabled, used, limit}
  const [aiBusy, setAiBusy]         = useState(false);
  const [aiMsg, setAiMsg]           = useState(null); // {type: 'ok'|'error', text}
  const fileRef = useRef();
  const cameraRef = useRef();

  useEffect(() => {
    if (!editing) getReceiptUsage(orgId).then(setAiUsage).catch(() => setAiUsage(null));
  }, []);

  const catMap = Object.fromEntries(categories.map(c => [c.id, c]));

  // ── Konton på verifikatet (ett eller flera) ──
  const isSplit      = form.lines.length > 1;
  const linesTotal   = form.lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const lineTypes    = new Set(form.lines.filter(l => l.categoryId).map(l => catMap[l.categoryId]?.type));
  const mixedTypes   = lineTypes.size > 1;

  // Varning om samma sak verkar vara inlagd redan: fakturor mot inkorgen och bokföringen, övriga verifikat och utlägg mot
  // bokföringen och andra utlägg (samma belopp och datum, och samma konto eller liknande beskrivning)
  const dupes = (() => {
    if (restricted) return [];
    const norm = v => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const total = Math.round(linesTotal * 100);
    if (total <= 0) return [];
    const found = [];
    const sumOf = ls => Math.round(ls.reduce((a, l) => a + Number(l.amount), 0) * 100);
    if (isInvoice) {
      const sup = norm(inv.supplier), no = norm(inv.invoiceNo);
      const inboxIds = new Set();
      for (const c of claims) {
        if (c.kind !== 'invoice' || c.id === selfId || c.status === 'rejected') continue;
        const sameNo = no && norm(c.invoiceNo) === no && (!sup || !c.supplier || norm(c.supplier) === sup);
        const sameAll = sup && norm(c.supplier) === sup && Math.round(c.total * 100) === total && c.date === form.date;
        if (sameNo || sameAll) { found.push({ kind: c.status === 'paid' ? 'paid' : 'inbox', c }); if (c.txId) inboxIds.add(c.txId); }
      }
      for (const tx of transactions) {
        if (inboxIds.has(tx.id) || tx.voidedAt || sumOf(txLines(tx)) !== total) continue;
        const d = norm(tx.description);
        if ((sup && d.includes(sup)) || (no && d.includes(no))) found.push({ kind: 'booked', tx });
      }
    } else {
      const desc = norm(form.description);
      const cats = new Set(form.lines.map(l => l.categoryId).filter(Boolean));
      const similar = (d, ls) => {
        const x = norm(d);
        return (desc && x && (x.includes(desc) || desc.includes(x))) || ls.some(l => cats.has(l.categoryId));
      };
      const paidIds = new Set(claims.filter(c => c.txId).map(c => c.txId));
      for (const tx of transactions) {
        if (tx.id === selfId || tx.voidedAt || tx.date !== form.date) continue;
        const ls = txLines(tx);
        if (sumOf(ls) === total && similar(tx.description, ls)) found.push({ kind: 'booked', tx, viaClaim: paidIds.has(tx.id) });
      }
      for (const c of claims) {
        if (c.kind === 'invoice' || c.id === selfId || c.status === 'rejected' || c.status === 'paid' || c.date !== form.date) continue;
        if (Math.round(c.total * 100) === total && similar(c.description, c.lines)) found.push({ kind: 'claim', c });
      }
    }
    return found.slice(0, 3);
  })();
  const setLine      = (i, patch) => setForm(f => ({ ...f, lines: f.lines.map((l, j) => j === i ? { ...l, ...patch } : l) }));
  const addLine      = () => setForm(f => ({ ...f, lines: [...f.lines, { categoryId: '', amount: '', projectId: f.lines[f.lines.length - 1]?.projectId || '' }] }));
  const removeLine   = i => setForm(f => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }));

  // Projekt som kan väljas: pågående, samt ett redan valt (även om det stängts sedan dess)
  const projectSelect = (value, onChange, style) => (
    <select value={value || ''} onChange={e => onChange(e.target.value)} style={style}>
      <option value="">{t('– Inget –')}</option>
      {projects.filter(p => !p.closed || p.id === value).map(p => (
        <option key={p.id} value={p.id}>{p.name}{p.closed ? ` (${t('stängd')})` : ''}</option>
      ))}
    </select>
  );

  // Ett utlägg kan bara bokföras på kostnader
  function toggleExpense(on) {
    setIsExpense(on);
    if (on) setForm(f => ({ ...f, lines: f.lines.map(l => catMap[l.categoryId]?.type === 'income' ? { ...l, categoryId: '' } : l) }));
  }

  async function handleAiRead() {
    if (!preview) return;
    setAiBusy(true); setAiMsg(null);
    try {
      const aiCats = categories.filter(c => !c.hidden && (!isExpense || c.type === 'expense'));
      const r = await readReceipt(orgId, preview.file, aiCats, buildHistory(transactions, aiCats));
      setForm(f => ({
        ...f,
        date:        r.date || f.date,
        description: isInvoice ? f.description : (r.description || f.description),
        // AI-förslaget är ett enda konto: ersätter en eventuell uppdelning
        lines: [{
          categoryId: r.category_id || f.lines[0]?.categoryId || '',
          amount:     r.amount != null ? String(r.amount) : (f.lines.length === 1 ? f.lines[0].amount : ''),
          projectId:  f.lines[0]?.projectId || '',
        }],
      }));
      if (isInvoice) setInv(x => ({ supplier: r.supplier || x.supplier, invoiceNo: r.invoice_no || x.invoiceNo, dueDate: r.due_date || x.dueDate, paymentRef: r.payment_ref || x.paymentRef }));
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

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValidIsoDate(form.date)) { setSaveError(t('Ange ett giltigt datum på formatet YYYY-MM-DD.')); return; }
    if (form.lines.some(l => !l.categoryId || !(parseFloat(l.amount) > 0))) { setSaveError(t('Välj konto och ange belopp för varje rad.')); return; }
    if (mixedTypes) { setSaveError(t('Alla konton på ett verifikat måste vara av samma typ (alla intäkter eller alla kostnader).')); return; }
    const lines = form.lines.map(l => ({ id: l.id, categoryId: l.categoryId, amount: parseFloat(l.amount), projectId: l.projectId || null }));
    if (isInvoice && !inv.supplier.trim()) { setSaveError(t('Ange leverantör.')); return; }
    if (isInvoice && inv.dueDate && !isValidIsoDate(inv.dueDate)) { setSaveError(t('Ange ett giltigt förfallodatum på formatet YYYY-MM-DD.')); return; }
    const payload = { date: form.date, description: form.description, comment: form.comment, lines, ...(isInvoice ? { invoice: { ...inv } } : {}), ...(isExpense && !isInvoice && forUser && forUser !== session?.user?.id ? { forUser } : {}) };
    setSaving(true);
    setSaveError('');
    try {
      await onSubmit(payload, newFiles.map(f => f.file), isExpense);
      closeModal();
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
    onClose();
  }
  const preview = newFiles[previewIdx] || newFiles[0];

  const visibleCats = categories.filter(c => !c.hidden);
  const incCats  = isExpense ? [] : visibleCats.filter(c => c.type === 'income');
  const expCats  = visibleCats.filter(c => c.type === 'expense');
  const categoryOptions = (
    <>
      <option value="">{t('– Välj kategori –')}</option>
      {incCats.length > 0 && (
        <optgroup label={t('Intäkter')}>
          {incCats.map(c => <option key={c.id} value={c.id}>{c.id} – {c.name}</option>)}
        </optgroup>
      )}
      <optgroup label={t('Kostnader')}>
        {expCats.map(c => <option key={c.id} value={c.id}>{c.id} – {c.name}</option>)}
      </optgroup>
    </>
  );

  const title = titleProp || (isInvoice
    ? (editing ? t('Redigera faktura') : t('Ny faktura'))
    : expense === 'forced'
    ? (editing ? t('Redigera utlägg') : t('Nytt utlägg'))
    : restricted ? t('Komplettera verifikat') : (editing ? t('Redigera verifikat') : t('Nytt verifikat')));
  const submitLabel = saving ? t('Sparar…')
    : submitLabelProp ? submitLabelProp
    : isInvoice ? (editing ? t('Spara och lägg upp igen') : t('Lägg i inkorgen'))
    : isExpense ? (editing ? t('Spara och skicka in') : t('Skicka in utlägg'))
    : editing ? t('Spara ändringar') : t('Lägg till');

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
      <div className="modal" style={!editing && preview ? { maxWidth: 640 } : undefined}>
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="modal-close" onClick={closeModal}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          {restricted && (
            <div className="notice notice-warn" style={{ marginBottom: 14, fontSize: '0.85rem' }}>
              {t('Verifikatet är låst eftersom det är äldre än 1 timme. Du kan bara ändra kommentar och projektmärkning. Behöver något annat rättas, makulera verifikatet och lägg in ett ersättande.')}
            </div>
          )}
          {(expense === 'optional' || expense === 'forced') && (
            <div className="form-row">
              <div>
                <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', justifyContent: 'flex-start', fontSize: '0.9rem', fontWeight: 600, textTransform: 'none', letterSpacing: 'normal', color: 'var(--ink)', cursor: expense === 'forced' ? 'default' : 'pointer', background: 'var(--paper-2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '10px 12px' }}>
                  <input type="checkbox" checked={isExpense} disabled={expense === 'forced' || editing}
                    onChange={e => toggleExpense(e.target.checked)} style={{ width: 'auto', flex: 'none', marginTop: 3 }} />
                  <span>
                    {t('Eget utlägg, begär ersättning')}
                    <span style={{ display: 'block', fontWeight: 400, fontSize: '0.78rem', color: 'var(--ink-muted)', marginTop: 2 }}>
                      {t('Utlägget skickas till föreningen för godkännande och bokförs först när utbetalningen är bekräftad.')}
                    </span>
                  </span>
                </label>
              </div>
            </div>
          )}
          {isExpense && !isInvoice && !editing && members.length > 1 && (
            <div className="form-row">
              <div>
                <label>{t('Utlägget avser')}</label>
                <select value={forUser || session?.user?.id || ''} onChange={e => setForUser(e.target.value)}>
                  {members.map(m => <option key={m.id} value={m.id}>{m.id === session?.user?.id ? `${t('Mig själv')} (${m.name})` : m.name}</option>)}
                </select>
                <div style={{ fontSize: '0.78rem', color: 'var(--ink-muted)', marginTop: 4 }}>{t('Välj en annan medlem om du registrerar utlägget åt hen. Pengarna betalas då ut till den personen.')}</div>
              </div>
            </div>
          )}
          {isInvoice && (
            <>
              <div className="form-row form-row-cols">
                <div>
                  <label>{t('Leverantör')} *</label>
                  <input type="text" value={inv.supplier} maxLength={120} required onChange={e => setInvField('supplier', e.target.value)} />
                </div>
                <div>
                  <label>{t('Fakturanummer')}</label>
                  <input type="text" value={inv.invoiceNo} maxLength={60} onChange={e => setInvField('invoiceNo', e.target.value)} />
                </div>
              </div>
              <div className="form-row form-row-cols">
                <div>
                  <label>{t('Förfallodatum')}</label>
                  <DateInput value={inv.dueDate || ''} onChange={v => setInvField('dueDate', v)} />
                </div>
                <div>
                  <label>{t('Bankgiro, plusgiro eller OCR')}</label>
                  <input type="text" value={inv.paymentRef} maxLength={80} placeholder={t('Så att kassören vet vart pengarna ska')} onChange={e => setInvField('paymentRef', e.target.value)} />
                </div>
              </div>
            </>
          )}
          {dupes.length > 0 && (
            <div className="notice" style={{ background: 'var(--amber-soft)', borderColor: 'var(--amber)', color: 'var(--ink)', marginBottom: 12, fontSize: '0.84rem' }}>
              <strong>{isInvoice ? t('Den här fakturan verkar redan finnas') : t('Det här verkar redan vara inlagt')}</strong>
              {dupes.map((d, i) => (
                <div key={i} style={{ marginTop: 4 }}>
                  {d.kind === 'inbox' && t('I inkorgen: {vad}', { vad: `${d.c.supplier}${d.c.invoiceNo ? ` · ${t('nr')} ${d.c.invoiceNo}` : ''} · ${fmt(d.c.total)} · ${d.c.date}` })}
                  {d.kind === 'paid' && t('Redan betald och bokförd: {vad}', { vad: `${d.c.supplier}${d.c.invoiceNo ? ` · ${t('nr')} ${d.c.invoiceNo}` : ''} · ${fmt(d.c.total)} · ${d.c.date}` })}
                  {d.kind === 'booked' && t('Redan bokfört verifikat: {vad}', { vad: `${d.tx.description || '–'} · ${fmt(linesTotal)} · ${d.tx.date}` })}
                  {d.kind === 'claim' && t('Utlägg som väntar på hantering: {vad}', { vad: `${d.c.description || '–'} · ${fmt(d.c.total)} · ${d.c.date}` })}
                </div>
              ))}
              <div style={{ marginTop: 4, color: 'var(--ink-soft)' }}>{(isInvoice ? t('Du kan ändå spara den om det är en ny faktura.') : t('Du kan ändå spara om det är en egen post.'))}</div>
            </div>
          )}
          <div className="form-row form-row-cols">
            <div>
              <label>{isInvoice ? t('Fakturadatum') : t('Datum')} *</label>
              <DateInput value={form.date} onChange={date => setForm(f => ({ ...f, date }))} required disabled={restricted} />
            </div>
            <div>
              <label>{isSplit ? t('Summa (kr)') : `${t('Belopp (kr)')} *`}</label>
              {isSplit
                ? <div className="mono" style={{ padding: '9px 0', fontWeight: 600 }}>{fmt(linesTotal)}</div>
                : <input type="number" step="0.01" min="0" placeholder="0.00" value={form.lines[0].amount}
                    onChange={e => setLine(0, { amount: e.target.value })} required disabled={restricted} />}
            </div>
          </div>
          {!isSplit ? (
            <>
            <div className="form-row">
              <div>
                <label>{t('Kategori')} *</label>
                <select value={form.lines[0].categoryId} onChange={e => setLine(0, { categoryId: e.target.value })} required disabled={restricted}>
                  {categoryOptions}
                </select>
                {!restricted && <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={addLine}>
                  <Plus size={12} /> {t('Dela upp på flera konton')}
                </button>}
              </div>
            </div>
            {showProjects && (
              <div className="form-row">
                <div>
                  <label>{cap(labels.one)}</label>
                  {projectSelect(form.lines[0].projectId, v => setLine(0, { projectId: v }))}
                </div>
              </div>
            )}
            </>
          ) : (
            <div className="form-row">
              <div>
                <label>{t('Konton')} *</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {form.lines.map((l, i) => (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <select value={l.categoryId} onChange={e => setLine(i, { categoryId: e.target.value })} required disabled={restricted} style={{ flex: 1, minWidth: 0 }}>
                          {categoryOptions}
                        </select>
                        <input type="number" step="0.01" min="0" placeholder="0.00" value={l.amount} required
                          onChange={e => setLine(i, { amount: e.target.value })} disabled={restricted} style={{ width: 110, textAlign: 'right' }} />
                        {!restricted && <button type="button" title={t('Ta bort rad')} onClick={() => removeLine(i)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)', display: 'flex', padding: 4 }}>
                          <X size={15} />
                        </button>}
                      </div>
                      {showProjects && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 28 }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', minWidth: 60 }}>{cap(labels.one)}</span>
                          {projectSelect(l.projectId, v => setLine(i, { projectId: v }), { flex: 1, minWidth: 0, fontSize: '0.82rem' })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                  {!restricted ? <button type="button" className="btn btn-secondary btn-sm" onClick={addLine}><Plus size={12} /> {t('Lägg till konto')}</button> : <span />}
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
              <input type="text" placeholder={t('Vad avser transaktionen?')} value={form.description} disabled={restricted}
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
          {!editing && (
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
                      {isDemoMode() ? t('{used}/{limit} avläsning använd i demon (en per besök)', { used: aiUsage.used, limit: aiUsage.limit }) : t('{used}/{limit} avläsningar använda denna månad', { used: aiUsage.used, limit: aiUsage.limit })}
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
              <Check size={14} /> {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
