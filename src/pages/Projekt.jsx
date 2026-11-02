import { useState, useEffect, useMemo } from 'react';
import { Plus, ArrowLeft, Pencil, Lock, LockOpen, Trash2, FileDown, FileSpreadsheet, Check, X, Users, Loader } from 'lucide-react';
import { supabase } from '../supabase';
import { fmt, projectRows, projectTotals, isValidIsoDate, fmtDate, store } from '../store';
import { useAuth } from '../auth/AuthProvider';
import { useI18n } from '../i18n';
import { useProjects, cap, lower } from '../ProjectsContext';
import DateInput from '../components/DateInput';
import { exportProjectPdf, exportProjectExcel } from '../projectExport';
import { downloadBlob } from '../excelExport';

const emptyForm = () => ({ id: null, name: '', description: '', start: '', end: '', members: [] });

export default function Projekt({ orgId, orgName, transactions, categories }) {
  const { t } = useI18n();
  const { role, session } = useAuth();
  const isOwner = role === 'main_owner' || role === 'owner';
  const { labels, projects, reload, openProjectId, openProject } = useProjects();
  const one = lower(labels.one), many = lower(labels.many);

  const [filter, setFilter]     = useState('open');      // open | closed | all
  const [form, setForm]         = useState(null);        // projektet som redigeras (eller nytt)
  const [orgMembers, setOrgMembers] = useState([]);      // {userId, name}
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [confirm, setConfirm]   = useState('');          // 'close' | 'delete' i detaljvyn
  const [busy, setBusy]         = useState('');

  const catMap = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c])), [categories]);
  const totalsById = useMemo(
    () => Object.fromEntries(projects.map(p => [p.id, projectTotals(transactions, categories, p.id)])),
    [projects, transactions, categories]);

  // Medlemmar i föreningen (för att koppla personer till projekt). Läsare får bara smeknamn, inte e-post.
  useEffect(() => {
    supabase.rpc('get_org_members_with_email', { p_org_id: orgId }).then(({ data }) => {
      setOrgMembers((data || []).map(m => ({ userId: m.user_id, name: m.nickname || (isOwner ? m.email : '') })));
    });
  }, [orgId, isOwner]);
  const nameOf = userId => orgMembers.find(m => m.userId === userId)?.name || '';

  const selected = projects.find(p => p.id === openProjectId) || null;
  useEffect(() => { setConfirm(''); setError(''); }, [openProjectId]);

  function openForm(project) {
    setError('');
    setForm(project ? { id: project.id, name: project.name, description: project.description, start: project.start, end: project.end, members: project.members.map(m => ({ ...m })) } : emptyForm());
  }
  const memberOf = userId => form.members.find(m => m.userId === userId);
  function toggleMember(userId) {
    setForm(f => ({ ...f, members: memberOf(userId) ? f.members.filter(m => m.userId !== userId) : [...f.members, { userId, isLead: false }] }));
  }
  function toggleLead(userId) {
    setForm(f => ({ ...f, members: f.members.map(m => m.userId === userId ? { ...m, isLead: !m.isLead } : m) }));
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name.trim()) { setError(t('Ange ett namn.')); return; }
    if ((form.start && !isValidIsoDate(form.start)) || (form.end && !isValidIsoDate(form.end))) { setError(t('Ange ett giltigt datum på formatet YYYY-MM-DD.')); return; }
    if (form.start && form.end && form.end < form.start) { setError(t('Slutdatum kan inte vara före startdatum.')); return; }
    setSaving(true); setError('');
    try {
      const id = await store.saveProject(orgId, form);
      await reload();
      setForm(null);
      if (!form.id) openProject(id);
    } catch (err) {
      setError(t(err.message));
    } finally {
      setSaving(false);
    }
  }

  async function run(kind, fn) {
    setBusy(kind); setError('');
    try { await fn(); } catch (err) { setError(t(err.message || 'Något gick fel.')); } finally { setBusy(''); setConfirm(''); }
  }
  const setClosed = (p, closed) => run('close', async () => { await store.setProjectClosed(orgId, p.id, closed); await reload(); });
  const remove    = p => run('delete', async () => { await store.deleteProject(orgId, p.id); openProject(null); await reload(); });
  const reportArgs = p => ({ orgName, project: p, labelOne: cap(labels.one), transactions, categories });
  const pdf   = p => run('pdf', async () => { exportProjectPdf(reportArgs(p)); });
  const excel = p => run('excel', async () => { const r = await exportProjectExcel(reportArgs(p)); downloadBlob(r.blob, r.filename); });

  const span = p => (p.start || p.end) ? `${p.start || '…'} – ${p.end || '…'}` : '';
  const leadNames = p => p.members.filter(m => m.isLead).map(m => nameOf(m.userId)).filter(Boolean).join(', ');
  const statusBadge = p => p.closed
    ? <span className="badge badge-closed"><Lock size={10} /> {t('Stängd')}</span>
    : <span className="badge badge-open">{t('Pågående')}</span>;

  // ── Redigera / lägg till ──
  const modal = form && (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setForm(null)}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">{form.id ? t('Redigera {namn}', { namn: one }) : t('Lägg till {namn}', { namn: one })}</div>
          <button className="modal-close" onClick={() => setForm(null)}><X size={18} /></button>
        </div>
        <form onSubmit={handleSave}>
          <div className="form-row"><div>
            <label>{t('Namn')} *</label>
            <input type="text" value={form.name} maxLength={80} autoFocus required onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div></div>
          <div className="form-row"><div>
            <label>{t('Beskrivning')}</label>
            <textarea value={form.description} maxLength={500} rows={3} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} style={{ resize: 'vertical' }} />
          </div></div>
          <div className="form-row form-row-cols">
            <div><label>{t('Startdatum')}</label><DateInput value={form.start} onChange={start => setForm(f => ({ ...f, start }))} /></div>
            <div><label>{t('Slutdatum')}</label><DateInput value={form.end} onChange={end => setForm(f => ({ ...f, end }))} /></div>
          </div>
          <div className="form-row"><div>
            <label><Users size={12} style={{ display: 'inline', marginRight: 4 }} />{t('Kopplade medlemmar')}</label>
            <p style={{ fontSize: '0.78rem', color: 'var(--ink-muted)', margin: '0 0 8px' }}>
              {t('Kopplade medlemmar ser en sammanställning av {namn} på översikten.', { namn: one })}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {orgMembers.map(m => {
                const sel = memberOf(m.userId);
                return (
                  <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 'var(--r)', background: sel ? 'var(--accent-3)' : 'var(--paper-2)' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, margin: 0, cursor: 'pointer', fontSize: '0.85rem', textTransform: 'none', letterSpacing: 0 }}>
                      <input type="checkbox" checked={!!sel} onChange={() => toggleMember(m.userId)} style={{ width: 'auto' }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name || t('Medlem')}{m.userId === session?.user?.id ? ` (${t('du')})` : ''}</span>
                    </label>
                    {sel && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, cursor: 'pointer', fontSize: '0.78rem', textTransform: 'none', letterSpacing: 0 }}>
                        <input type="checkbox" checked={sel.isLead} onChange={() => toggleLead(m.userId)} style={{ width: 'auto' }} /> {t('Ansvarig')}
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          </div></div>
          {error && <div className="notice" style={{ background: 'var(--red-soft)', borderColor: 'var(--red)', color: 'var(--red)', marginTop: 12 }}>{error}</div>}
          <div className="btn-row" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setForm(null)}>{t('Avbryt')}</button>
            <button type="submit" className="btn btn-primary" disabled={saving}><Check size={14} /> {saving ? t('Sparar…') : t('Spara')}</button>
          </div>
        </form>
      </div>
    </div>
  );

  // ── Detaljvy ──
  if (selected) {
    const p = selected;
    const tot = totalsById[p.id];
    const rows = projectRows(transactions, p.id);
    const cats = Object.keys(tot.byCategory).map(id => catMap[id] || { id, name: '', type: 'expense' })
      .sort((a, b) => String(a.id).localeCompare(String(b.id), 'sv', { numeric: true }));
    return (
      <div>
        <button className="btn btn-secondary btn-sm" onClick={() => openProject(null)} style={{ marginBottom: 16 }}>
          <ArrowLeft size={14} /> {t('Alla {namn}', { namn: many })}
        </button>

        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0 }}>{p.name}</h3>{statusBadge(p)}
              </div>
              {span(p) && <div className="mono" style={{ fontSize: '0.8rem', color: 'var(--ink-muted)', marginTop: 4 }}>{span(p)}</div>}
              {p.closed && p.closedAt && <div style={{ fontSize: '0.78rem', color: 'var(--ink-muted)', marginTop: 2 }}>{t('Stängd {datum}', { datum: fmtDate(p.closedAt) })}</div>}
              {p.description && <p style={{ fontSize: '0.88rem', color: 'var(--ink-soft)', margin: '10px 0 0', whiteSpace: 'pre-wrap' }}>{p.description}</p>}
              {p.members.length > 0 && (
                <div style={{ fontSize: '0.8rem', color: 'var(--ink-muted)', marginTop: 10 }}>
                  <Users size={12} style={{ display: 'inline', marginRight: 4 }} />
                  {t('Kopplade: {n}', { n: p.members.length })}
                  {leadNames(p) && <> · {t('Ansvarig')}: <strong style={{ color: 'var(--ink)' }}>{leadNames(p)}</strong></>}
                </div>
              )}
            </div>
            <div className="gap-row" style={{ gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={() => pdf(p)} disabled={!!busy}>
                {busy === 'pdf' ? <Loader size={14} /> : <FileDown size={14} />} {t('Rapport (PDF)')}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => excel(p)} disabled={!!busy}>
                {busy === 'excel' ? <Loader size={14} /> : <FileSpreadsheet size={14} />} {t('Excel')}
              </button>
            </div>
          </div>

          {isOwner && (
            <div className="gap-row" style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)', gap: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => openForm(p)}><Pencil size={13} /> {t('Redigera')}</button>
              {p.closed
                ? <button className="btn btn-secondary btn-sm" onClick={() => setClosed(p, false)} disabled={!!busy}><LockOpen size={13} /> {t('Öppna igen')}</button>
                : <button className="btn btn-secondary btn-sm" onClick={() => setConfirm('close')} disabled={!!busy}><Lock size={13} /> {t('Stäng {namn}', { namn: one })}</button>}
              {rows.length === 0 && (
                <button className="btn btn-secondary btn-sm" onClick={() => setConfirm('delete')} disabled={!!busy} style={{ color: 'var(--red)' }}><Trash2 size={13} /> {t('Ta bort')}</button>
              )}
            </div>
          )}

          {confirm === 'close' && (
            <div className="notice notice-warn" style={{ marginTop: 14 }}>
              <p style={{ margin: '0 0 10px', fontSize: '0.85rem' }}>
                {t('När {namn} stängs går det inte att märka fler verifikat med det. Redan märkta verifikat och rapporten finns kvar, och du kan öppna igen när du vill.', { namn: one })}
              </p>
              <div className="gap-row" style={{ gap: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={() => setClosed(p, true)} disabled={!!busy}><Lock size={13} /> {t('Ja, stäng')}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setConfirm('')}>{t('Avbryt')}</button>
              </div>
            </div>
          )}
          {confirm === 'delete' && (
            <div className="notice notice-warn" style={{ marginTop: 14 }}>
              <p style={{ margin: '0 0 10px', fontSize: '0.85rem' }}>{t('Inga verifikat är märkta. Vill du ta bort {namn}?', { namn: `"${p.name}"` })}</p>
              <div className="gap-row" style={{ gap: 8 }}>
                <button className="btn btn-danger btn-sm" onClick={() => remove(p)} disabled={!!busy}><Trash2 size={13} /> {t('Ja, ta bort')}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setConfirm('')}>{t('Avbryt')}</button>
              </div>
            </div>
          )}
          {error && <div className="notice" style={{ background: 'var(--red-soft)', borderColor: 'var(--red)', color: 'var(--red)', marginTop: 14 }}>{error}</div>}
        </div>

        <div className="stat-grid">
          {[
            { label: t('Totala intäkter'),  val: fmt(tot.income),  cls: 'positive' },
            { label: t('Totala kostnader'), val: fmt(tot.expense), cls: 'negative' },
            { label: t('Resultat'),         val: fmt(tot.net),     cls: tot.net >= 0 ? 'positive' : 'negative' },
            { label: t('Antal verifikat'),  val: tot.count,        cls: '' },
          ].map((s, i) => (
            <div key={i} className="stat-card"><div className="stat-label">{s.label}</div><div className={`stat-value ${s.cls}`}>{s.val}</div></div>
          ))}
        </div>

        {rows.length === 0 ? (
          <div className="card"><div className="empty-state"><p>{t('Inga verifikat är märkta ännu. Välj {namn} när du lägger till ett verifikat i kassaboken.', { namn: one })}</p></div></div>
        ) : (
          <>
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="section-title">{t('Per kategori')}</div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>{t('Kategori')}</th><th className="text-right">{t('Intäkt')}</th><th className="text-right">{t('Kostnad')}</th></tr></thead>
                  <tbody>
                    {cats.map(c => (
                      <tr key={c.id}>
                        <td><span className={`badge ${c.type === 'income' ? 'badge-income' : 'badge-expense'}`}>{c.id}</span> {c.name}</td>
                        <td className="positive text-right">{c.type === 'income' ? fmt(tot.byCategory[c.id]) : ''}</td>
                        <td className="negative text-right">{c.type === 'income' ? '' : fmt(tot.byCategory[c.id])}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td>{t('Summa')}</td><td className="text-right" style={{ color: 'var(--accent)' }}>{fmt(tot.income)}</td><td className="text-right" style={{ color: 'var(--red)' }}>{fmt(tot.expense)}</td></tr></tfoot>
                </table>
              </div>
            </div>

            <div className="card">
              <div className="section-title">{t('Verifikat ({n})', { n: tot.count })}</div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>{t('Datum')}</th><th>{t('Beskrivning')}</th><th>{t('Kategori')}</th><th className="text-right">{t('Belopp')}</th></tr></thead>
                  <tbody>
                    {rows.map(({ tx, line }, i) => {
                      const c = catMap[line.categoryId];
                      const inc = c?.type === 'income';
                      return (
                        <tr key={`${tx.id}-${i}`}>
                          <td className="mono">{tx.date}</td>
                          <td>{tx.description || <em style={{ color: 'var(--ink-muted)' }}>–</em>}</td>
                          <td><span className={`badge ${inc ? 'badge-income' : 'badge-expense'}`}>{line.categoryId}</span> <span style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>{c?.name}</span></td>
                          <td className={`text-right ${inc ? 'positive' : 'negative'}`}>{inc ? '+' : '−'}{fmt(line.amount)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
        {modal}
      </div>
    );
  }

  // ── Lista ──
  const shown = projects.filter(p => filter === 'all' || (filter === 'closed') === p.closed);
  return (
    <div>
      <div className="gap-row" style={{ marginBottom: 20 }}>
        <select value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 'auto' }}>
          <option value="open">{t('Pågående')}</option>
          <option value="closed">{t('Stängda')}</option>
          <option value="all">{t('Alla')}</option>
        </select>
        <div className="ml-auto">
          {isOwner && <button className="btn btn-primary" onClick={() => openForm(null)}><Plus size={15} /> {t('Lägg till {namn}', { namn: one })}</button>}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="card"><div className="empty-state">
          <p>{projects.length === 0
            ? (isOwner ? t('Inga {namn} ännu. Lägg till det första för att börja märka inkomster och utgifter.', { namn: many }) : t('Inga {namn} ännu.', { namn: many }))
            : t('Inga {namn} i den här vyn.', { namn: many })}</p>
        </div></div>
      ) : (
        <div className="project-grid">
          {shown.map(p => {
            const tot = totalsById[p.id];
            return (
              <div key={p.id} className="project-card clickable" onClick={() => openProject(p.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <h4 style={{ overflowWrap: 'anywhere' }}>{p.name}</h4>{statusBadge(p)}
                </div>
                {span(p) && <div className="mono" style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>{span(p)}</div>}
                {p.description && <div style={{ fontSize: '0.82rem', color: 'var(--ink-soft)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.description}</div>}
                <div className="project-totals">
                  <div>{t('Intäkter')}<strong style={{ color: 'var(--accent)' }}>{fmt(tot.income)}</strong></div>
                  <div>{t('Kostnader')}<strong style={{ color: 'var(--red)' }}>{fmt(tot.expense)}</strong></div>
                  <div>{t('Resultat')}<strong style={{ color: tot.net >= 0 ? 'var(--accent)' : 'var(--red)' }}>{fmt(tot.net)}</strong></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {modal}
    </div>
  );
}
