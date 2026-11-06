import { useState, useEffect } from 'react'
import { Receipt, Inbox, FileText, Sparkles, Layers, Rocket, Puzzle, Check, Route } from 'lucide-react'
import { useAuth, isAdminRole } from '../auth/AuthProvider'
import { useI18n } from '../i18n'
import { useProjects, defaultLabels } from '../ProjectsContext'
import { store, expenses, invoicing, orgFeatures } from '../store'
import { getReceiptUsage } from '../receiptAi'

// Texter och ikoner per funktion. Funktioner som saknas här (nya i registret) visas ändå, med bara sitt namn.
const META = {
  expenses:        { icon: Receipt,  desc: 'Medlemmar som lagt ut egna pengar begär ersättning med kvitto. Bokförs när utbetalningen bekräftas.' },
  trips:           { icon: Route,    desc: 'Medlemmar registrerar körda resor och får ersättning per mil. Hanteras som utlägg: godkänns, betalas ut och bokförs.' },
  invoice_inbox:   { icon: Inbox,    desc: 'Ladda upp inkommande fakturor. De bokförs först när kassören har betalat dem.' },
  invoicing:       { icon: FileText, desc: 'Kundregister och fakturor från föreningen, med PDF och utskick. Bara administratörer kan skapa och skicka. Ingen moms.' },
  ai_receipts:     { icon: Sparkles, desc: 'En uppladdad PDF eller bild läses av med AI, som föreslår datum, belopp, beskrivning och kategori. Förslaget tar hänsyn till hur liknande poster bokförts tidigare.' },
  projects:        { icon: Layers,   desc: 'Följ projekt, sektioner eller event genom att märka inkomster och utgifter. Du får en egen rapport per märkning.' },
  getting_started: { icon: Rocket,   desc: 'Kom igång-sidan visar några steg för att göra föreningen redo. När ni är klara kan ni dölja den.' },
}
const GROUPS = { ekonomi: 'Ekonomi', hjalpmedel: 'Hjälpmedel', uppfoljning: 'Uppföljning' }
const errBox = { background: 'var(--red-soft)', borderColor: 'var(--red)', color: 'var(--red)' }
const checkLabel = { display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: '0.9rem', textTransform: 'none', letterSpacing: 0, fontWeight: 400 }

function Switch({ on, disabled, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      style={{ width: 40, height: 22, borderRadius: 11, border: 'none', padding: 0, flex: 'none', marginTop: 4, position: 'relative',
        background: on ? 'var(--accent)' : 'var(--border-strong, #bbb)', opacity: disabled ? 0.45 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <span style={{ position: 'absolute', top: 2, left: on ? 20 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
    </button>
  )
}

// E-postbesked för utlägg och fakturor i inkorgen
function ExpenseMail({ orgId, canManage }) {
  const { t } = useI18n()
  const [settings, setSettings] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { expenses.getSettings(orgId).then(setSettings).catch(e => setError(e.message)) }, [orgId])
  async function toggle(key, value) {
    const next = { ...settings, [key]: value }
    setError('')
    try { await expenses.setSettings(orgId, next); setSettings(next) } catch (e) { setError(t(e.message)) }
  }
  if (!settings) return error ? <div className="notice" style={errBox}>{error}</div> : null
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <p style={{ fontSize: '0.8rem', color: 'var(--ink-muted)', margin: 0 }}>{t('Välj vilka e-postbesked som ska skickas.')}</p>
      {error && <div className="notice" style={errBox}>{error}</div>}
      {[
        ['notifySubmitted', t('E-post till de som kan godkänna eller betala när ett nytt utlägg eller en ny faktura kommer in')],
        ['notifyDecided', t('E-post till den som lagt ut pengarna eller laddat upp fakturan när den godkänns, avslås och betalas')],
      ].map(([key, label]) => (
        <label key={key} style={{ ...checkLabel, cursor: canManage ? 'pointer' : 'default' }}>
          <input type="checkbox" checked={settings[key]} disabled={!canManage} onChange={e => toggle(key, e.target.checked)} style={{ width: 'auto', flex: 'none', marginTop: 3 }} />
          {label}
        </label>
      ))}
    </div>
  )
}

// Föreningens uppgifter på fakturorna
function InvoicingSettings({ orgId, canManage, onChanged }) {
  const { t } = useI18n()
  const [s, setS] = useState(null)   // { enabled, details }
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { invoicing.getSettings(orgId).then(setS).catch(e => setError(e.message)) }, [orgId])
  const setD = (k, v) => setS(x => ({ ...x, details: { ...x.details, [k]: v } }))
  async function save(e) {
    e.preventDefault()
    setError(''); setDone(false)
    if (s.details.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.details.email.trim())) { setError(t('Ange en giltig e-postadress.')); return }
    setSaving(true)
    try { await invoicing.setSettings(orgId, { ...s, enabled: true }); await onChanged?.(); setDone(true); setTimeout(() => setDone(false), 3000) }
    catch (err) { setError(t(err.message)) } finally { setSaving(false) }
  }
  if (!s) return error ? <div className="notice" style={errBox}>{error}</div> : null
  return (
    <form onSubmit={save}>
      <p style={{ fontSize: '0.8rem', color: 'var(--ink-muted)', margin: '0 0 10px' }}>{t('Uppgifterna visas på fakturorna och i mejlet som skickas till kunden.')}</p>
      {error && <div className="notice" style={{ ...errBox, marginBottom: 12 }}>{error}</div>}
      {done && <div className="notice notice-success" style={{ marginBottom: 12 }}>{t('Inställningarna har sparats.')}</div>}
      <fieldset disabled={!canManage} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {[
          [['org_number', t('Organisationsnummer')], ['email', t('E-post (kunder svarar hit)')]],
          [['address', t('Adress')], null],
          [['zip', t('Postnummer')], ['city', t('Ort')]],
          [['phone', t('Telefon')], null],
          [['bankgiro', t('Bankgiro')], ['plusgiro', t('Plusgiro')]],
          [['bank_account', t('Bankkonto (clearing och kontonummer)')], ['swish', t('Swish-nummer')]],
          [['payment_days', t('Betalningsvillkor (dagar)'), 'number'], ['invoice_prefix', t('Prefix på fakturanummer (valfritt)')]],
        ].map((row, i) => (
          <div key={i} className="form-row form-row-cols">
            {row.map((f, j) => f ? (
              <div key={f[0]}><label>{f[1]}</label>
                <input type={f[2] || 'text'} min={f[2] === 'number' ? 0 : undefined} max={f[2] === 'number' ? 365 : undefined} value={s.details[f[0]] ?? ''} maxLength={120}
                  onChange={e => setD(f[0], e.target.value)} /></div>
            ) : <div key={j} />)}
          </div>
        ))}
        <div className="form-row"><div><label>{t('Standardtext på fakturor (valfritt)')}</label>
          <textarea rows={2} maxLength={1000} style={{ width: '100%' }} value={s.details.note || ''} onChange={e => setD('note', e.target.value)} /></div></div>
      </fieldset>
      {canManage && <button className="btn btn-primary" type="submit" disabled={saving} style={{ marginTop: 8 }}><Check size={14} /> {saving ? t('Sparar…') : t('Spara')}</button>}
    </form>
  )
}

// Vad funktionen heter hos föreningen (Projekt, Sektion, Event …)
function ProjectSettings({ orgId, canManage, onChanged }) {
  const { t } = useI18n()
  const { settings } = useProjects()
  const [one, setOne] = useState(settings?.labelSingular || '')
  const [many, setMany] = useState(settings?.labelPlural || '')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setOne(settings?.labelSingular || ''); setMany(settings?.labelPlural || '') }, [settings?.labelSingular, settings?.labelPlural])
  const dirty = one.trim() !== (settings?.labelSingular || '') || many.trim() !== (settings?.labelPlural || '')
  async function save(e) {
    e.preventDefault()
    setError(''); setDone(false)
    if (!!one.trim() !== !!many.trim()) { setError(t('Fyll i både enkelform och flertal, eller lämna båda tomma.')); return }
    setSaving(true)
    try { await store.setProjectSettings(orgId, { enabled: true, singular: one, plural: many }); await onChanged?.(); setDone(true); setTimeout(() => setDone(false), 3000) }
    catch (err) { setError(t(err.message)) } finally { setSaving(false) }
  }
  return (
    <form onSubmit={save}>
      <p style={{ fontSize: '0.8rem', color: 'var(--ink-muted)', margin: '0 0 10px' }}>
        {t('Vad ska funktionen heta hos er? Till exempel Sektion och Sektioner, Projekt och Projekt eller Event och Event. Lämna tomt för Projekt.')}
      </p>
      {error && <div className="notice" style={{ ...errBox, marginBottom: 12 }}>{error}</div>}
      {done && <div className="notice notice-success" style={{ marginBottom: 12 }}>{t('Inställningarna har sparats.')}</div>}
      <div className="form-row form-row-cols">
        <div><label>{t('Enkelform')}</label><input type="text" value={one} maxLength={30} placeholder={defaultLabels().one} disabled={!canManage} onChange={e => { setOne(e.target.value); setDone(false) }} /></div>
        <div><label>{t('Flertal')}</label><input type="text" value={many} maxLength={30} placeholder={defaultLabels().many} disabled={!canManage} onChange={e => { setMany(e.target.value); setDone(false) }} /></div>
      </div>
      {canManage && <button className="btn btn-primary" type="submit" disabled={saving || !dirty} style={{ marginTop: 8 }}>{saving ? t('Sparar…') : <><Check size={14} /> {t('Spara')}</>}</button>}
    </form>
  )
}

// Resor och körersättning: ersättning per mil, vad det heter, vilka områden som finns och vilket konto det bokförs på
function TripSettings({ orgId, canManage, categories }) {
  const { t } = useI18n()
  const [s, setS] = useState(null)
  const [areasText, setAreasText] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { expenses.getTripSettings(orgId).then(x => { setS({ ...x, rate: String(x.rate).replace('.', ',') }); setAreasText((x.areas || []).join('\n')) }).catch(e => setError(t(e.message))) }, [orgId])
  const expCats = (categories || []).filter(c => c.type === 'expense' && !c.hidden)
  async function save(e) {
    e.preventDefault()
    setError(''); setDone(false)
    const rate = Number(String(s.rate).replace(',', '.'))
    if (!(rate > 0)) { setError(t('Ange en ersättning per mil.')); return }
    setSaving(true)
    try {
      await expenses.setTripSettings(orgId, { rate, label: s.label.trim(), areas: areasText.split('\n').map(x => x.trim()).filter(Boolean), categoryId: s.categoryId || '', note: s.note })
      setDone(true); setTimeout(() => setDone(false), 3000)
    } catch (err) { setError(t(err.message)) } finally { setSaving(false) }
  }
  if (!s) return error ? <div className="notice" style={errBox}>{error}</div> : null
  const set = (k, v) => { setS(x => ({ ...x, [k]: v })); setDone(false) }
  return (
    <form onSubmit={save}>
      {error && <div className="notice" style={{ ...errBox, marginBottom: 12 }}>{error}</div>}
      {done && <div className="notice notice-success" style={{ marginBottom: 12 }}>{t('Inställningarna har sparats.')}</div>}
      {!s.categoryId && <div className="notice" style={{ background: 'var(--amber-soft)', borderColor: 'var(--amber)', color: 'var(--ink)', marginBottom: 12, fontSize: '0.82rem' }}>{t('Välj ett konto nedan, annars går det inte att registrera resor.')}</div>}
      <fieldset disabled={!canManage} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="form-row form-row-cols">
          <div><label>{t('Ersättning per mil (kr)')}</label><input type="text" inputMode="decimal" value={s.rate} onChange={e => set('rate', e.target.value)} /></div>
          <div><label>{t('Vad ersättningen heter')}</label><input type="text" maxLength={40} value={s.label} placeholder="Körersättning" onChange={e => set('label', e.target.value)} /></div>
        </div>
        <div className="form-row"><div>
          <label>{t('Bokförs på konto')}</label>
          <select value={s.categoryId || ''} onChange={e => set('categoryId', e.target.value)}>
            <option value="">{t('Välj…')}</option>
            {expCats.map(c => <option key={c.id} value={c.id}>{c.id} {c.name}</option>)}
          </select>
        </div></div>
        <div className="form-row"><div>
          <label>{t('Områden (ett per rad, valfritt)')}</label>
          <textarea rows={3} style={{ width: '100%' }} value={areasText} placeholder={'Område 1\nOmråde 2'} onChange={e => { setAreasText(e.target.value); setDone(false) }} />
        </div></div>
        <div className="form-row"><div>
          <label>{t('Information som visas när man registrerar (valfritt)')}</label>
          <textarea rows={2} maxLength={500} style={{ width: '100%' }} value={s.note} onChange={e => set('note', e.target.value)} />
        </div></div>
      </fieldset>
      {canManage && <button className="btn btn-primary" type="submit" disabled={saving} style={{ marginTop: 8 }}><Check size={14} /> {saving ? t('Sparar…') : t('Spara')}</button>}
    </form>
  )
}

// Förbrukning och sekretess för AI-avläsning
function AiInfo({ orgId }) {
  const { t } = useI18n()
  const [usage, setUsage] = useState(null)
  useEffect(() => { getReceiptUsage(orgId).then(setUsage).catch(() => {}) }, [orgId])
  return (
    <div style={{ fontSize: '0.8rem', color: 'var(--ink-muted)', lineHeight: 1.6 }}>
      {usage && <p style={{ margin: '0 0 6px' }}>{t('{used}/{limit} använda denna månad', { used: usage.used, limit: usage.limit })}</p>}
      <p style={{ margin: 0 }}>{t('När funktionen används skickas den valda filen till Anthropic för avläsning. Filen kan innehålla personuppgifter, så aktivera bara om föreningen är bekväm med det.')}</p>
    </div>
  )
}

export default function Funktioner({ orgId, features, categories = [], onFeaturesChange, onProjectSettingsChange }) {
  const { t } = useI18n()
  const { role } = useAuth()
  const canManage = isAdminRole(role)
  const [busy, setBusy] = useState('')
  const [notes, setNotes] = useState({})   // { [key]: { text, kind: 'warn' | 'info' | 'error' } }
  const nameOf = key => t(features.find(f => f.key === key)?.name || key)
  const setNote = (key, text, kind = 'warn') => setNotes(n => ({ ...n, [key]: text ? { text, kind } : undefined }))

  const blockerText = (f, b) => {
    if (b.code === 'open_expenses') return t('Det finns {n} utlägg som väntar på hantering. Godkänn, avslå eller betala ut dem först.', { n: b.n })
    if (b.code === 'open_trips') return t('Det finns {n} reseersättningar som väntar på hantering. Godkänn, avslå eller betala ut dem först.', { n: b.n })
    if (b.code === 'open_invoices') return t('Det finns {n} fakturor i inkorgen som väntar på betalning. Betala eller avvisa dem först.', { n: b.n })
    if (b.code === 'open_outgoing') return t('Det finns {n} fakturor som är utkast eller obetalda. Markera dem som betalda, makulera eller ta bort dem först.', { n: b.n })
    if (b.code === 'dependents') return t('Stäng av {namn} först, den kräver {denna}.', { namn: nameOf(b.by), denna: nameOf(f.key) })
    return t('Funktionen kan inte stängas av just nu.')
  }

  async function toggle(f, on) {
    setNote(f.key, '')
    if (!on && f.blocker) { setNote(f.key, blockerText(f, f.blocker)); return }
    setBusy(f.key)
    try {
      const before = new Set(features.filter(x => x.enabled).map(x => x.key))
      const next = await orgFeatures.set(orgId, f.key, on)
      await onFeaturesChange?.(next)
      const alsoOn = on ? next.filter(x => x.enabled && x.key !== f.key && !before.has(x.key)).map(x => nameOf(x.key)) : []
      if (alsoOn.length) setNote(f.key, t('Vi slog också på {namn}, som funktionen kräver.', { namn: alsoOn.join(` ${t('och')} `) }), 'info')
    } catch (e) { setNote(f.key, t(e.message), 'error') }
    finally { setBusy('') }
  }

  if (!features.length) return <p style={{ fontSize: '0.85rem', color: 'var(--ink-muted)' }}>{t('Laddar…')}</p>
  const groups = []
  for (const f of features) { let g = groups.find(x => x.key === f.group); if (!g) groups.push(g = { key: f.group, items: [] }); g.items.push(f) }
  const mailOwner = features.find(f => f.key === 'expenses' && f.effective) ? 'expenses' : features.find(f => f.key === 'invoice_inbox' && f.effective) ? 'invoice_inbox' : null

  const settingsFor = f => {
    if (!f.effective) return null
    if (f.key === 'invoicing') return <InvoicingSettings orgId={orgId} canManage={canManage} onChanged={onProjectSettingsChange} />
    if (f.key === 'projects') return <ProjectSettings orgId={orgId} canManage={canManage} onChanged={onProjectSettingsChange} />
    if (f.key === 'ai_receipts') return <AiInfo orgId={orgId} />
    if (f.key === 'trips') return <TripSettings orgId={orgId} canManage={canManage} categories={categories} />
    if (f.key === mailOwner) return <ExpenseMail orgId={orgId} canManage={canManage} />
    return null
  }

  return (
    <div>
      <p style={{ fontSize: '0.85rem', color: 'var(--ink-muted)', margin: '0 0 8px', lineHeight: 1.6 }}>
        {t('Slå på det ni behöver. Det som är avstängt döljs bara: ingen data försvinner, och allt finns kvar om ni slår på det igen.')}
      </p>
      {!canManage && <p style={{ fontSize: '0.78rem', color: 'var(--ink-muted)', margin: '0 0 12px' }}>{t('Bara administratörer kan ändra detta.')}</p>}

      <div className="card" style={{ marginBottom: 24, padding: '14px 18px' }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 4 }}>{t('Ingår alltid')}</div>
        <div style={{ fontSize: '0.82rem', color: 'var(--ink-soft)', lineHeight: 1.7 }}>
          {[t('Översikt'), t('Kassabok'), t('Budget & utfall'), t('Kategorier'), t('Räkenskapsperioder'), t('Rapporter & export'), t('Medlemmar')].join(' · ')}
        </div>
      </div>

      {groups.map(g => (
        <div key={g.key} style={{ marginBottom: 24 }}>
          <div className="section-title">{t(GROUPS[g.key] || g.key)}</div>
          <div className="card" style={{ padding: '4px 18px' }}>
            {g.items.map((f, i) => {
              const m = META[f.key] || {}
              const Icon = m.icon || Puzzle
              const note = notes[f.key]
              const settings = settingsFor(f)
              const missing = (f.requires || []).filter(r => !features.find(x => x.key === r)?.effective)
              return (
                <div key={f.key} style={{ display: 'flex', gap: 12, padding: '14px 0', borderTop: i ? '1px solid var(--border)' : 'none', alignItems: 'flex-start' }}>
                  <div style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--paper-2)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Icon size={18} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      {t(f.name)}
                      {f.tag === 'new' && <span className="badge badge-income" style={{ letterSpacing: 0 }}>{t('Ny')}</span>}
                      {f.tag === 'beta' && <span className="badge" style={{ background: 'var(--paper-2)', color: 'var(--ink-soft)', letterSpacing: 0 }}>{t('Beta')}</span>}
                      {!f.allowed && <span className="badge" style={{ background: 'var(--paper-2)', color: 'var(--ink-soft)', letterSpacing: 0 }}>{t('Ingår inte i ert paket')}</span>}
                    </div>
                    {m.desc && <div style={{ fontSize: '0.83rem', color: 'var(--ink-muted)', lineHeight: 1.55, marginTop: 2 }}>{t(m.desc)}</div>}
                    {!f.allowed && <div style={{ fontSize: '0.8rem', marginTop: 6 }}><a href="https://foreningsbalans.se/#priser">{t('Se planerna')}</a></div>}
                    {f.allowed && missing.length > 0 && !f.enabled && (
                      <div style={{ fontSize: '0.78rem', color: 'var(--ink-muted)', marginTop: 6 }}>{t('Kräver')}: {missing.map(nameOf).join(', ')}</div>
                    )}
                    {note && (
                      <div className="notice" style={{ marginTop: 8, fontSize: '0.8rem', ...(note.kind === 'info' ? {} : note.kind === 'error' ? errBox : { background: 'var(--amber-soft)', borderColor: 'var(--amber)', color: 'var(--ink)' }) }}>{note.text}</div>
                    )}
                    {settings && <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--border)' }}>{settings}</div>}
                  </div>
                  <Switch on={f.enabled} disabled={!canManage || !f.allowed || busy === f.key} label={t(f.name)} onChange={on => toggle(f, on)} />
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
