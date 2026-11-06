import { useState, useEffect } from 'react';
import { X, Plus, Trash2, Loader } from 'lucide-react';
import { useI18n } from '../i18n';
import { fmt, todayStr, isValidIsoDate, expenses } from '../store';
import DateInput from './DateInput';

const toNum = v => Number(String(v ?? '').replace(',', '.'));
const round2 = n => Math.round(n * 100) / 100;
const milText = n => String(round2(n)).replace('.', ',');
const emptyRow = (area = '') => ({ date: todayStr(), area, minutes: '', miles: '' });

// Registrera körda resor (till exempel sladdning) med datum, område, tid och antal mil. Ersättningen räknas ut som mil x ersättning
// per mil, och kravet hanteras sedan som ett utlägg: godkänns, betalas ut och bokförs.
export default function TripModal({ orgId, claim, onSubmit, onClose }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState(null);
  const [rows, setRows] = useState(() => claim?.trips?.rows?.length
    ? claim.trips.rows.map(r => ({ date: r.date, area: r.area || '', minutes: r.minutes ?? '', miles: String(r.miles).replace('.', ',') }))
    : [emptyRow()]);
  const [comment, setComment] = useState(claim?.comment || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    expenses.getTripSettings(orgId).then(setSettings).catch(e => setError(t(e.message || 'okänt fel')));
  }, [orgId]);

  const areas = settings?.areas || [];
  const rate = Number(settings?.rate) || 0;
  const setRow = (i, patch) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const filled = rows.filter(r => String(r.miles).trim() !== '' || String(r.minutes).trim() !== '');
  const totalMiles = round2(filled.reduce((a, r) => a + (toNum(r.miles) || 0), 0));
  const total = round2(totalMiles * rate);
  const notReady = settings && !settings.categoryId;

  async function save(e) {
    e.preventDefault();
    setError('');
    if (!filled.length) { setError(t('Lägg till minst en resa.')); return; }
    for (const r of filled) {
      if (!isValidIsoDate(r.date)) { setError(t('Ange ett giltigt datum på formatet YYYY-MM-DD.')); return; }
      if (!(toNum(r.miles) > 0)) { setError(t('Ange antal mil för varje resa.')); return; }
      if (areas.length && !areas.includes(r.area)) { setError(t('Välj område för varje resa.')); return; }
    }
    setBusy(true);
    try {
      await onSubmit({ rows: filled, comment });
      onClose();
    } catch (err) {
      setError(t(err.message || 'okänt fel'));
    } finally { setBusy(false); }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !busy && onClose()}>
      <form className="modal" style={{ maxWidth: 640 }} onSubmit={save}>
        <div className="modal-header">
          <div className="modal-title">{claim ? t('Ändra resor') : t('Registrera resor')}</div>
          <button type="button" className="modal-close" onClick={onClose} disabled={busy} aria-label={t('Stäng')}><X size={18} /></button>
        </div>

        {settings?.note && <div className="notice notice-info" style={{ marginBottom: 12, whiteSpace: 'pre-wrap' }}>{settings.note}</div>}
        {notReady && (
          <div className="notice" style={{ background: 'var(--amber-soft)', borderColor: 'var(--amber)', color: 'var(--ink)', marginBottom: 12 }}>
            {t('En administratör måste först välja konto för körersättning under Inställningar → Funktioner.')}
          </div>
        )}
        {error && <div className="notice" style={{ background: 'var(--red-soft)', borderColor: 'var(--red)', color: 'var(--red)', marginBottom: 12 }}>{error}</div>}

        <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', margin: '0 0 12px' }}>
          {t('Ersättning: {belopp} per mil.', { belopp: fmt(rate) })}
        </p>

        <div style={{ display: 'grid', gap: 10 }}>
          {rows.map((r, i) => (
            <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '10px 12px', background: 'var(--paper-2)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, alignItems: 'end' }}>
                <div style={{ minWidth: 0 }}>
                  <label>{t('Datum')} *</label>
                  <DateInput value={r.date} onChange={v => setRow(i, { date: v })} />
                </div>
                {areas.length > 0 && (
                  <div style={{ minWidth: 0 }}>
                    <label>{t('Område')} *</label>
                    <select value={r.area} onChange={e => setRow(i, { area: e.target.value })}>
                      <option value="">{t('Välj…')}</option>
                      {areas.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                )}
                <div style={{ minWidth: 0 }}>
                  <label>{t('Tid (minuter)')}</label>
                  <input type="number" inputMode="numeric" min={0} max={1440} step={1} value={r.minutes} onChange={e => setRow(i, { minutes: e.target.value })} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <label>{t('Mil')} *</label>
                  <input type="text" inputMode="decimal" value={r.miles} placeholder="0,0" onChange={e => setRow(i, { miles: e.target.value })} />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, fontSize: '0.82rem', color: 'var(--ink-soft)' }}>
                <span className="mono">{toNum(r.miles) > 0 ? fmt(round2(toNum(r.miles) * rate)) : ''}</span>
                {rows.length > 1 && (
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} aria-label={t('Ta bort')} title={t('Ta bort')}>
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-sm btn-secondary" style={{ marginTop: 10 }} onClick={() => setRows(rs => [...rs, emptyRow(areas.length === 1 ? areas[0] : '')])}>
          <Plus size={13} /> {t('Lägg till resa')}
        </button>

        <div className="form-row" style={{ marginTop: 14 }}>
          <div>
            <label>{t('Kommentar (valfritt)')}</label>
            <textarea rows={2} maxLength={500} value={comment} onChange={e => setComment(e.target.value)} style={{ width: '100%' }} />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <span style={{ fontSize: '0.88rem' }}>{t('Summa')}: <strong>{milText(totalMiles)} {t('mil')}</strong></span>
          <span className="mono" style={{ fontSize: '1.1rem', fontWeight: 600 }}>{fmt(total)}</span>
        </div>

        <div className="btn-row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>{t('Avbryt')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !settings || notReady}>
            {busy && <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />} {claim ? t('Spara och skicka in') : t('Skicka in')}
          </button>
        </div>
      </form>
    </div>
  );
}
