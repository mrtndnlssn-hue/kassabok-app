import { useState, useMemo } from 'react';
import { X, FileSpreadsheet, FileText, Loader } from 'lucide-react';
import { useI18n } from '../i18n';
import { tripReportRows, todayStr } from '../store';
import { exportTripReportExcel, downloadBlob } from '../excelExport';
import { exportTripReport } from '../pdfExport';

// Milersättningsrapport: välj period och (för den som ser alla) person, och hämta den som Excel eller PDF.
// Den som bara ser sina egna resor får bara sina egna med.
export default function TripReportModal({ claims, names, fiscalPeriods, orgName, canSeeAll, myId, onClose }) {
  const { t } = useI18n();
  const today = todayStr();
  const current = fiscalPeriods.find(p => today >= p.start && today <= p.end);
  const [periodId, setPeriodId] = useState(current?.id || '');
  const [userId, setUserId] = useState('');
  const [onlyPaid, setOnlyPaid] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const tripClaims = useMemo(() => claims.filter(c => c.trips), [claims]);
  const nameOf = id => names[id] || t('Tidigare medlem');
  const people = useMemo(() => [...new Set(tripClaims.map(c => c.userId))].sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'sv')), [tripClaims, names]);
  const period = fiscalPeriods.find(p => p.id === periodId) || null;
  const periodLabel = period ? period.label : t('Alla perioder');
  const rows = useMemo(() => tripReportRows({
    claims: tripClaims, names: Object.fromEntries(people.map(id => [id, nameOf(id)])), unknownName: t('Tidigare medlem'),
    period, onlyPaid, userId: canSeeAll ? (userId || null) : myId,
  }), [tripClaims, people, period, onlyPaid, userId, canSeeAll, myId]);
  const totalMiles = Math.round(rows.reduce((a, r) => a + r.miles, 0) * 100) / 100;

  async function run(kind) {
    setBusy(kind); setError('');
    try {
      if (kind === 'excel') {
        const { blob, filename } = await exportTripReportExcel({ orgName, periodLabel, rows });
        downloadBlob(blob, filename);
      } else {
        exportTripReport({ orgName, periodLabel, rows, onlyPaid });
      }
    } catch (e) {
      setError(t(e.message || 'Något gick fel.'));
    } finally { setBusy(''); }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <div className="modal-title">{t('Milersättningsrapport')}</div>
          <button className="modal-close" onClick={onClose} disabled={!!busy} aria-label={t('Stäng')}><X size={18} /></button>
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', margin: '0 0 14px' }}>
          {t('Alla registrerade resor med mil och ersättning, per person. Avslagna resor ingår inte.')}
        </p>
        {error && <div className="notice" style={{ background: 'var(--red-soft)', borderColor: 'var(--red)', color: 'var(--red)', marginBottom: 12 }}>{error}</div>}

        <div className="form-row"><div>
          <label>{t('Period')}</label>
          <select value={periodId} onChange={e => setPeriodId(e.target.value)}>
            <option value="">{t('Alla perioder')}</option>
            {fiscalPeriods.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div></div>
        {canSeeAll && (
          <div className="form-row"><div>
            <label>{t('Person')}</label>
            <select value={userId} onChange={e => setUserId(e.target.value)}>
              <option value="">{t('Alla')}</option>
              {people.map(id => <option key={id} value={id}>{nameOf(id)}</option>)}
            </select>
          </div></div>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.88rem', fontWeight: 400, textTransform: 'none', letterSpacing: 0, cursor: 'pointer', marginBottom: 14 }}>
          <input type="checkbox" checked={onlyPaid} onChange={e => setOnlyPaid(e.target.checked)} style={{ width: 'auto', flex: 'none' }} />
          {t('Bara utbetalda resor')}
        </label>

        <div style={{ fontSize: '0.85rem', marginBottom: 14 }}>
          {rows.length ? t('Antal resor: {n}, {mil} mil.', { n: rows.length, mil: String(totalMiles).replace('.', ',') }) : t('Det finns inga resor för det här urvalet.')}
        </div>

        <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={() => run('pdf')} disabled={!rows.length || !!busy}>
            {busy === 'pdf' ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <FileText size={14} />} PDF
          </button>
          <button className="btn btn-primary" onClick={() => run('excel')} disabled={!rows.length || !!busy}>
            {busy === 'excel' ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <FileSpreadsheet size={14} />} Excel
          </button>
        </div>
      </div>
    </div>
  );
}
