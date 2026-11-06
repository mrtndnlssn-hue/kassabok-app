import { useState, useEffect } from 'react';
import { X, Check, ClipboardCheck, MessageSquare } from 'lucide-react';
import { supabase } from '../supabase';
import { useAuth } from '../auth/AuthProvider';
import { useI18n } from '../i18n';
import { fmt, isDemoMode } from '../store';

const when = iso => (iso ? new Date(iso).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }) : '');

// Granskning av ett verifikat: revisorn markerar det som granskat och lägger anmärkningar, och de som skriver i
// bokföringen kan svara och markera anmärkningar som åtgärdade. Verifikatet i sig ändras inte.
export default function Granskning({ orgId, tx, verNum, review, remarks, canReview, canRemark, onReview, onAddRemark, onResolveRemark, onClose }) {
  const { t } = useI18n();
  const { session } = useAuth();
  const [names, setNames] = useState({});
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isDemoMode()) return;
    supabase.rpc('get_org_members_with_email', { p_org_id: orgId }).then(({ data }) => {
      setNames(Object.fromEntries((data || []).map(m => [m.user_id, m.nickname || m.email])));
    });
  }, [orgId]);
  const nameOf = id => (id === session?.user?.id ? t('Du') : names[id] || t('Tidigare medlem'));

  async function run(fn) {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(t(e.message || 'okänt fel')); } finally { setBusy(false); }
  }
  async function addRemark(e) {
    e.preventDefault();
    if (!text.trim()) return;
    await run(async () => { await onAddRemark(tx.id, text); setText(''); });
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ClipboardCheck size={18} style={{ color: 'var(--accent)' }} />
            {t('Granskning')} – {t('verifikat')} {String(verNum).padStart(3, '0')}
          </div>
          <button className="modal-close" onClick={onClose} aria-label={t('Stäng')}><X size={18} /></button>
        </div>

        <div style={{ background: 'var(--paper-2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '10px 14px', marginBottom: 16, fontSize: '0.88rem' }}>
          <div style={{ fontWeight: 600 }}>{tx.description || '–'}</div>
          <div style={{ color: 'var(--ink-muted)', fontSize: '0.8rem' }}>
            <span className="mono">{tx.date}</span>{tx.counterparty ? ` · ${tx.counterparty}` : ''} · <span className="mono">{fmt(Number(tx.amount) || 0)}</span>
            {tx.voidedAt ? ` · ${t('Makulerat')}` : ''}
          </div>
        </div>

        {error && <div className="notice" style={{ background: 'var(--red-soft)', borderColor: 'var(--red)', color: 'var(--red)', marginBottom: 12 }}>{error}</div>}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
          {review ? (
            <span className="badge badge-income" style={{ letterSpacing: 0 }}>
              <Check size={12} /> {t('Granskat av {namn} {datum}', { namn: nameOf(review.by), datum: when(review.at) })}
            </span>
          ) : <span style={{ fontSize: '0.85rem', color: 'var(--ink-muted)' }}>{t('Inte granskat än')}</span>}
          {canReview && (
            <button className={`btn btn-sm ${review ? 'btn-secondary' : 'btn-primary'}`} disabled={busy} onClick={() => run(() => onReview(tx.id, !review))}>
              {review ? t('Ta bort markeringen') : <><Check size={13} /> {t('Markera som granskat')}</>}
            </button>
          )}
        </div>

        <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><MessageSquare size={14} /> {t('Anmärkningar')} ({remarks.length})</div>
        {remarks.length === 0 && <p style={{ fontSize: '0.85rem', color: 'var(--ink-muted)', margin: '4px 0 14px' }}>{t('Inga anmärkningar.')}</p>}
        <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
          {remarks.map(r => (
            <div key={r.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '10px 12px', background: r.resolvedAt ? 'var(--paper-2)' : 'var(--amber-soft)', opacity: r.resolvedAt ? 0.8 : 1 }}>
              <div style={{ fontSize: '0.88rem', whiteSpace: 'pre-wrap' }}>{r.text}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 6, fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
                <span>{nameOf(r.author)} · {when(r.createdAt)}{r.resolvedAt ? ` · ${t('Åtgärdad')} ${when(r.resolvedAt)}` : ''}</span>
                {canRemark && (
                  <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => run(() => onResolveRemark(r.id, !r.resolvedAt))}>
                    {r.resolvedAt ? t('Öppna igen') : <><Check size={12} /> {t('Markera som åtgärdad')}</>}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {canRemark && (
          <form onSubmit={addRemark}>
            <label>{t('Ny anmärkning eller svar')}</label>
            <textarea rows={3} value={text} maxLength={1000} onChange={e => setText(e.target.value)} placeholder={t('Till exempel: Kvitto saknas, eller: Beloppet stämmer inte med fakturan')} style={{ width: '100%' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !text.trim()}>{t('Lägg till')}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
