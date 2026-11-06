import { useState, useEffect, useCallback, useMemo } from 'react'
import { ArrowLeft, Loader, FileDown, RefreshCw, Mail } from 'lucide-react'
import { clickable } from '../a11y'
import { supabase } from '../supabase'
import { buildInvoicePdf, money } from './invoicePdf'
import { fmtDate, isoDate, isoDateTime, todayStr } from '../store'
import DateInput from '../components/DateInput'

// Adminportal för plattformsägaren. Bara på svenska – används inte av föreningarna.

const TABS = [
  ['oversikt', 'Översikt'], ['foreningar', 'Föreningar'], ['anvandare', 'Användare'],
  ['bestallningar', 'Beställningar'], ['fakturor', 'Fakturor'], ['demo', 'Demo'], ['planer', 'Planer'], ['rabatter', 'Rabattkoder'], ['installningar', 'Inställningar'],
]
const ORDER_STATUS = { new: 'Ny', invoiced: 'Fakturerad', paid: 'Betald', cancelled: 'Avbruten' }
const INV_STATUS = { draft: 'Underlag', sent: 'Skickad', paid: 'Betald', void: 'Makulerad' }
const STATUS_COLOR = { new: '#b45309', invoiced: '#1d4ed8', paid: '#15803d', cancelled: '#6b7280', draft: '#b45309', sent: '#1d4ed8', void: '#6b7280' }

// Datum visas alltid som YYYY-MM-DD; tidsstämplar räknas om till lokal tid, rena datum lämnas som de är
const day = v => fmtDate(v) || '–'
const mb = b => (b ? `${(b / 1048576).toFixed(1)} MB` : '0 MB')

function Pill({ status, label }) {
  const c = STATUS_COLOR[status] || '#6b7280'
  return <span style={{ color: c, background: `${c}18`, padding: '2px 9px', borderRadius: 99, fontSize: '0.74rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</span>
}

function Bar({ used, limit }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const color = pct >= 100 ? 'var(--red)' : pct >= 80 ? '#b45309' : 'var(--accent-2)'
  return (
    <div style={{ minWidth: 110 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{used} / {limit}</div>
      <div style={{ height: 4, background: 'var(--paper-3)', borderRadius: 2, marginTop: 3 }}>
        <div style={{ width: `${pct}%`, height: 4, background: color, borderRadius: 2 }} />
      </div>
    </div>
  )
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={wide ? { maxWidth: 720 } : undefined} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="modal-close" onClick={onClose} aria-label="Stäng">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return <label style={{ display: 'block', marginBottom: 12 }}><div style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', marginBottom: 3 }}>{label}</div>{children}</label>
}

function Table({ head, rows, empty = 'Inget att visa.' }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={head.length} style={{ color: 'var(--ink-muted)', textAlign: 'center', padding: 24 }}>{empty}</td></tr>}
          {rows}
        </tbody>
      </table>
    </div>
  )
}

function useRpc(fn, args) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const reload = useCallback(async () => {
    setError('')
    const { data, error } = await supabase.rpc(fn, args)
    if (error) setError(error.message); else setData(data)
  }, [fn]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload() }, [reload])
  return [data, error, reload]
}

function useQuery(table, select, order) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const reload = useCallback(async () => {
    setError('')
    let q = supabase.from(table).select(select)
    if (order) q = q.order(order, { ascending: false })
    const { data, error } = await q
    if (error) setError(error.message); else setData(data)
  }, [table, select, order])
  useEffect(() => { reload() }, [reload])
  return [data, error, reload]
}

const Err = ({ msg }) => msg ? <div className="notice notice-warn">{msg}</div> : null
const Busy = () => <div style={{ padding: 24, color: 'var(--ink-muted)' }}><Loader size={18} style={{ animation: 'spin 1s linear infinite' }} /></div>

// ── Demo: besök i demokontot ──────────────────────────────────────
const SOURCE_LABEL = { hemsidan: 'Hemsidans knapp', inloggning: 'Inloggningssidan', okand: 'Okänd' }
const browserOf = ua => {
  const u = ua || ''
  const b = /Edg\//.test(u) ? 'Edge' : /OPR\/|Opera/.test(u) ? 'Opera' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : 'Okänd'
  const o = /Windows/.test(u) ? 'Windows' : /Android/.test(u) ? 'Android' : /iPhone|iPad|iOS/.test(u) ? 'iOS' : /Mac OS X/.test(u) ? 'macOS' : /Linux/.test(u) ? 'Linux' : ''
  return o ? `${b} · ${o}` : b
}
function DemoActivity() {
  const [days, setDays] = useState(30)
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    setErr('')
    const { data, error } = await supabase.rpc('admin_demo_activity', { p_days: days })
    if (error) setErr(error.message); else setD(data)
  }, [days])
  useEffect(() => { load() }, [load])
  async function clear() {
    if (!window.confirm('Radera hela demologgen? Det går inte att ångra.')) return
    const { error } = await supabase.rpc('admin_clear_demo_visits')
    if (error) setErr(error.message); else load()
  }
  // Egna besök ska inte räknas: en webbläsare kan markeras, och enskilda rader i listan kan markeras som "jag"
  async function setIgnored(visitor, on) {
    const { error } = await supabase.rpc('admin_set_demo_ignored', { p_visitor: visitor, p_ignored: on })
    if (error) setErr(error.message); else load()
  }
  async function ignoreThisBrowser() {
    let vid = null
    try {
      vid = localStorage.getItem('kb_demo_vid')
      if (!vid) { vid = crypto.randomUUID?.() || String(Math.random()).slice(2) + Date.now(); localStorage.setItem('kb_demo_vid', vid) }
    } catch { /* ignoreras */ }
    if (vid) await setIgnored(vid, true)
  }
  if (err) return <Err msg={err} />
  if (!d) return <Busy />
  let myVid = null
  try { myVid = localStorage.getItem('kb_demo_vid') } catch { /* ignoreras */ }
  const mineIgnored = !!myVid && (d.ignored_ids || []).includes(myVid)
  const max = Math.max(1, ...d.per_day.map(x => x.visits))
  const tiles = [['Besök (perioden)', d.visits], ['Unika besökare', d.unique], ['Idag', d.today], ['Senaste 7 dagarna', d.last7], ['Totalt sedan start', d.total]]
  const small = { fontSize: '0.74rem', color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }
  const breakdown = (title, obj, label = x => x) => (
    <div className="card" style={{ flex: '1 1 200px' }}>
      <div style={{ ...small, marginBottom: 6 }}>{title}</div>
      {Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', padding: '2px 0' }}><span>{label(k)}</span><span className="mono">{n}</span></div>
      ))}
      {Object.keys(obj).length === 0 && <div style={{ fontSize: '0.85rem', color: 'var(--ink-muted)' }}>Inga besök</div>}
    </div>
  )
  return (
    <>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <label style={{ margin: 0, width: 'auto' }}>Period</label>
        <select value={days} onChange={e => setDays(Number(e.target.value))} style={{ width: 'auto' }}>
          {[7, 30, 90, 365].map(n => <option key={n} value={n}>Senaste {n} dagarna</option>)}
        </select>
        <span style={{ fontSize: '0.8rem', color: 'var(--ink-muted)' }}>Ett besök loggas när någon startar demon. Samma webbläsare räknas högst en gång per 30 minuter. Ingen IP-adress sparas. Besök från testverktyg och localhost loggas inte.</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {mineIgnored
            ? <button className="btn btn-secondary btn-sm" onClick={() => setIgnored(myVid, false)}>Den här webbläsaren räknas inte (ångra)</button>
            : <button className="btn btn-secondary btn-sm" onClick={ignoreThisBrowser}>Räkna inte den här webbläsaren</button>}
          <button className="btn btn-secondary btn-sm" onClick={clear}>Rensa loggen</button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))', gap: 14, marginBottom: 20 }}>
        {tiles.map(([label, v]) => (
          <div key={label} className="card">
            <div style={small}>{label}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.6rem', marginTop: 4 }}>{v}</div>
          </div>
        ))}
      </div>
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ ...small, marginBottom: 10 }}>Besök per dag</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 120 }} role="img" aria-label="Staplar med antal demobesök per dag">
          {d.per_day.map(x => (
            <div key={x.day} title={`${x.day}: ${x.visits} besök, ${x.unique} unika`} style={{ flex: 1, minWidth: 2, background: x.visits ? 'var(--accent)' : 'var(--border)', height: `${x.visits ? Math.max(4, (x.visits / max) * 100) : 2}%`, borderRadius: '2px 2px 0 0' }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--ink-muted)', marginTop: 4 }}><span>{d.per_day[0]?.day}</span><span>{d.per_day[d.per_day.length - 1]?.day}</span></div>
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 20 }}>
        {breakdown('Hur de kom in', d.by_source, k => SOURCE_LABEL[k] || k)}
        {breakdown('Enhet', d.by_device)}
        {breakdown('Språk', d.by_lang)}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Tid</th><th>Hur</th><th>Enhet</th><th>Webbläsare</th><th>Språk</th><th>Kom från</th><th></th></tr></thead>
          <tbody>
            {d.recent.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 30, color: 'var(--ink-muted)' }}>Inga besök loggade ännu.</td></tr>}
            {d.recent.map((r, i) => (
              <tr key={i} style={r.ignored ? { opacity: 0.5 } : undefined}>
                <td className="mono">{new Date(r.visited_at).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td>{SOURCE_LABEL[r.source] || r.source}</td>
                <td>{r.device || '–'}</td>
                <td>{browserOf(r.user_agent)}</td>
                <td>{r.lang || '–'}</td>
                <td>{r.referrer || 'direkt'}</td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => setIgnored(r.visitor, !r.ignored)}
                    title={r.ignored ? 'Besökaren räknas inte. Klicka för att räkna igen.' : 'Markera som ditt eget besök så att besökaren inte räknas, nu och framöver'}>
                    {r.ignored ? 'Räknas inte · ångra' : 'Det här är jag'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ── Översikt ─────────────────────────────────────────────────────
function Overview({ onGo }) {
  const [d, err] = useRpc('admin_overview')
  if (err) return <Err msg={err} />
  if (!d) return <Busy />
  const tiles = [
    ['Föreningar', d.orgs, 'foreningar'], ['Användare', d.users, 'anvandare'], ['Betalande föreningar', d.paying_orgs, 'foreningar'],
    ['Nya beställningar', d.new_orders, 'bestallningar'], ['Öppna fakturor', d.open_invoices, 'fakturor'],
    ['Obetalt (kr)', money(d.unpaid_total), 'fakturor'], ['Betalt totalt (kr)', money(d.paid_total), 'fakturor'], ['Verifikat totalt', d.vouchers, 'foreningar'],
    ['Fillagring (Supabase)', `${mb(d.storage_bytes)} / ${mb(d.storage_budget_bytes)}`, 'foreningar'],
    ['Databas (Supabase)', `${mb(d.db_bytes)} / ${mb(d.db_budget_bytes)}`, 'installningar'],
  ]
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(190px,1fr))', gap: 14 }}>
        {tiles.map(([label, v, tab]) => (
          <button key={label} className="card" onClick={() => onGo(tab)} style={{ textAlign: 'left', cursor: 'pointer' }}>
            <div style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.6rem', marginTop: 4 }}>{v}</div>
          </button>
        ))}
      </div>
      <div className="notice notice-info" style={{ marginTop: 20, fontSize: '0.85rem', lineHeight: 1.6 }}>
        <strong>Så hänger lagringsgränserna ihop med Supabase</strong>
        <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
          <li><strong>Supabase gratisplan</strong> ger 1 GB fillagring, 500 MB databas och max 50 MB per fil. Trafiken (egress) är 5 GB ohämtat och 5 GB cachat per månad, delat av allt. Siffrorna är de som gällde när detta skrevs, så kontrollera dem i Supabase-kontot.</li>
          <li><strong>Per fil:</strong> max 10 MB, satt i lagringsbucketen. Gäller alltid.</li>
          <li><strong>Per förening:</strong> planens lagringskvot (ändras under Planer). Nya bilagor stoppas när föreningen nått kvoten. Kontrolleras före uppladdning, så en fil kan passera gränsen med högst 10 MB.</li>
          <li><strong>Hela kontot:</strong> fillagringsbudgeten under Inställningar. När summan av alla föreningars bilagor når den stoppas nya bilagor för alla. Sätt den till ca 90 % av det kontot tillåter. Databasbudgeten är bara en varning här på översikten.</li>
          <li>Per-förening- och kontogränserna gäller bara när <em>Verkställ planernas gränser</em> är på under Inställningar.</li>
          <li><strong>Uppgraderar du Supabase?</strong> Höj fillagrings- och databasbudgeten under Inställningar så att den följer det nya kontot. Planernas kvoter påverkas inte.</li>
        </ul>
      </div>
    </>
  )
}

// ── Föreningar ───────────────────────────────────────────────────
function Orgs({ plans }) {
  const [orgs, err, reload] = useRpc('admin_list_orgs')
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState(null)
  const planLabel = c => plans.find(p => p.code === c)?.name || c
  const list = useMemo(() => (orgs || []).filter(o => `${o.name} ${o.owner_email || ''}`.toLowerCase().includes(q.toLowerCase())), [orgs, q])
  if (err) return <Err msg={err} />
  if (!orgs) return <Busy />
  return (
    <>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <input placeholder="Sök förening eller ägare…" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 320 }} />
        <button className="btn btn-secondary" onClick={reload}><RefreshCw size={14} /> Uppdatera</button>
      </div>
      <Table head={['Förening', 'Plan', 'Giltig till', 'Användare', 'Verifikat (period)', 'AI-läsningar (månad)', 'Lagring', 'Senaste aktivitet', '']}
        rows={list.map(o => (
          <tr key={o.org_id}>
            <td><strong>{o.name}</strong><div style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>{o.owner_email || '–'} · skapad {day(o.created_at)}</div></td>
            <td>{planLabel(o.effective_plan)}{o.plan_code !== o.effective_plan && <div style={{ fontSize: '0.72rem', color: 'var(--red)' }}>({planLabel(o.plan_code)} har gått ut)</div>}</td>
            <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{o.plan_code === 'prova' ? '–' : day(o.plan_valid_until)}</td>
            <td style={{ fontFamily: 'var(--font-mono)' }}>{o.members} / {o.member_limit}</td>
            <td><Bar used={o.vouchers_period} limit={o.voucher_limit} /><div style={{ fontSize: '0.7rem', color: 'var(--ink-muted)' }}>{o.vouchers_total} totalt</div></td>
            <td><Bar used={o.ai_used} limit={o.ai_limit} /></td>
            <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}><Bar used={Math.round(o.storage_bytes / 104857.6) / 10} limit={Math.round(o.storage_limit / 1048576)} /></td>
            <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{day(o.last_activity)}</td>
            <td><button className="btn btn-secondary btn-sm" onClick={() => setEdit(o)}>Ändra plan</button></td>
          </tr>
        ))} />
      {edit && <PlanModal org={edit} plans={plans} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload() }} />}
    </>
  )
}

function PlanModal({ org, plans, onClose, onSaved }) {
  const inAYear = () => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); return isoDate(d) }
  const [plan, setPlan] = useState(org.plan_code)
  const [until, setUntil] = useState(org.plan_valid_until || inAYear())
  const [err, setErr] = useState('')
  async function save() {
    const { error } = await supabase.rpc('admin_set_org_plan', { p_org: org.org_id, p_plan: plan, p_valid_until: plan === 'prova' ? null : until || null })
    if (error) setErr(error.message); else onSaved()
  }
  return (
    <Modal title={`Plan – ${org.name}`} onClose={onClose}>
      <Err msg={err} />
      <Field label="Plan"><select value={plan} onChange={e => setPlan(e.target.value)}>{plans.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}</select></Field>
      {plan !== 'prova' && <Field label="Giltig till"><DateInput value={until} onChange={setUntil} /></Field>}
      <div className="btn-row"><button className="btn btn-primary" onClick={save}>Spara</button><button className="btn btn-secondary" onClick={onClose}>Avbryt</button></div>
    </Modal>
  )
}

// ── Användare ────────────────────────────────────────────────────
function Users() {
  const [users, err] = useRpc('admin_list_users')
  if (err) return <Err msg={err} />
  if (!users) return <Busy />
  return (
    <Table head={['E-post', 'Skapad', 'Senast inloggad', 'Föreningar']}
      rows={users.map(u => (
        <tr key={u.user_id}>
          <td>{u.email}{u.is_admin && <span className="badge badge-income" style={{ marginLeft: 8 }}>admin</span>}</td>
          <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{day(u.created_at)}</td>
          <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{day(u.last_sign_in_at)}</td>
          <td>{u.memberships.length ? u.memberships.map(m => `${m.name} (${m.role})`).join(', ') : <span style={{ color: 'var(--ink-muted)' }}>–</span>}</td>
        </tr>
      ))} />
  )
}

// ── Beställningar ────────────────────────────────────────────────
function Orders({ plans }) {
  const [orders, err, reload] = useQuery('orders', '*', 'created_at')
  const [orgs] = useRpc('admin_list_orgs')
  const [open, setOpen] = useState(null)
  if (err) return <Err msg={err} />
  if (!orders) return <Busy />
  const planName = c => plans.find(p => p.code === c)?.name || c
  return (
    <>
      <Table head={['Nr', 'Datum', 'Förening', 'Plan', 'Belopp (kr)', 'Kontakt', 'Kopplad förening', 'Status']}
        rows={orders.map(o => (
          <tr key={o.id} {...clickable(() => setOpen(o))} aria-label={`Beställning ${o.order_no}`} style={{ cursor: 'pointer' }}>
            <td style={{ fontFamily: 'var(--font-mono)' }}>{o.order_no}</td>
            <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{day(o.created_at)}</td>
            <td><strong>{o.org_name}</strong><div style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>{o.org_number}</div></td>
            <td>{planName(o.plan_code)}</td>
            <td style={{ fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{money(o.total)}</td>
            <td>{o.contact_name}<div style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>{o.contact_email}</div></td>
            <td>{o.org_id ? (orgs || []).find(x => x.org_id === o.org_id)?.name || 'ja' : <span style={{ color: '#b45309' }}>ej kopplad</span>}</td>
            <td><Pill status={o.status} label={ORDER_STATUS[o.status]} /></td>
          </tr>
        ))} />
      {open && <OrderModal order={open} orgs={orgs || []} planName={planName} onClose={() => setOpen(null)} onChanged={() => { reload(); setOpen(null) }} />}
    </>
  )
}

function OrderModal({ order, orgs, planName, onClose, onChanged }) {
  const [orgId, setOrgId] = useState(order.org_id || '')
  const [err, setErr] = useState('')
  const suggested = orgs.filter(o => o.owner_email && [order.account_email, order.contact_email].includes(o.owner_email))
  async function link() {
    const { error } = await supabase.rpc('admin_link_order', { p_order: order.id, p_org: orgId || null })
    if (error) setErr(error.message); else onChanged()
  }
  const rows = [
    ['Order', order.order_no], ['Skapad', isoDateTime(new Date(order.created_at))], ['Plan', planName(order.plan_code)],
    ['Belopp', `${money(order.total)} kr (varav moms ${money(order.vat_amount)})`],
    ['Rabattkod', order.discount_code ? `${order.discount_code} (${order.discount_percent} %)` : '–'],
    ['Förening', `${order.org_name} (${order.org_number})`], ['Adress', `${order.address}, ${order.zip} ${order.city}`],
    ['Kontakt', `${order.contact_name}, ${order.contact_email}${order.contact_phone ? ', ' + order.contact_phone : ''}`],
    ['Faktura till', order.invoice_email], ['Er referens', order.invoice_reference || '–'],
    ['Konto i appen', order.account_email || '–'], ['Meddelande', order.note || '–'], ['Språk', order.lang],
  ]
  return (
    <Modal title={`Beställning ${order.order_no}`} onClose={onClose} wide>
      <Err msg={err} />
      <table style={{ marginBottom: 16 }}><tbody>{rows.map(([k, v]) => <tr key={k}><td style={{ color: 'var(--ink-muted)', width: 130 }}>{k}</td><td>{v}</td></tr>)}</tbody></table>
      <Field label="Koppla till förening i appen (planen aktiveras direkt när beställningen kopplas)">
        <select value={orgId} onChange={e => setOrgId(e.target.value)}>
          <option value="">– ingen –</option>
          {suggested.length > 0 && <optgroup label="Förslag (samma e-post)">{suggested.map(o => <option key={o.org_id} value={o.org_id}>{o.name}</option>)}</optgroup>}
          <optgroup label="Alla föreningar">{orgs.map(o => <option key={o.org_id} value={o.org_id}>{o.name} – {o.owner_email}</option>)}</optgroup>
        </select>
      </Field>
      <div className="btn-row"><button className="btn btn-primary" onClick={link}>Spara koppling</button><button className="btn btn-secondary" onClick={onClose}>Stäng</button></div>
    </Modal>
  )
}

// ── Fakturor ─────────────────────────────────────────────────────
function Invoices({ settings }) {
  const [invoices, err, reload] = useQuery('invoices', '*, orders(order_no)', 'created_at')
  const [msg, setMsg] = useState('')
  const [sending, setSending] = useState('')
  if (err) return <Err msg={err} />
  if (!invoices) return <Busy />

  async function run(rpc, args, okMsg) {
    setMsg('')
    const { error } = await supabase.rpc(rpc, args)
    if (error) setMsg(error.message); else { setMsg(okMsg); reload() }
  }
  // Skickar fakturan som e-post (PDF som bilaga) från faktura@foreningsbalans.se via funktionen send-invoice
  async function send(inv) {
    if (!window.confirm(`Skicka faktura ${inv.invoice_no} till ${inv.customer?.email}?`)) return
    setMsg(''); setSending(inv.id)
    try {
      const doc = buildInvoicePdf({ invoice: inv, seller: settings.seller })
      const pdfBase64 = doc.output('datauristring').split(',')[1]
      const { data, error } = await supabase.functions.invoke('send-invoice', { body: { invoiceId: inv.id, pdfBase64, filename: `${inv.invoice_no}.pdf` } })
      if (error) setMsg('Tjänsten för e-post kunde inte nås.')
      else if (data?.error) setMsg(data.error)
      else { setMsg(`Fakturan skickades till ${data.to}.`); reload() }
    } finally { setSending('') }
  }
  function pdf(inv) {
    const doc = buildInvoicePdf({ invoice: inv, seller: settings.seller })
    doc.save(`${inv.invoice_no || 'faktureringsunderlag_' + (inv.orders?.order_no || inv.id.slice(0, 6))}.pdf`)
  }
  return (
    <>
      {msg && <div className="notice notice-info">{msg}</div>}
      {!settings.seller?.name && <div className="notice notice-warn">Säljaruppgifter saknas. Fyll i dem under Inställningar innan du skickar fakturor.</div>}
      <Table head={['Faktura', 'Order', 'Kund', 'Belopp (kr)', 'Datum', 'Förfaller', 'Status', '']}
        rows={invoices.map(i => (
          <tr key={i.id}>
            <td style={{ fontFamily: 'var(--font-mono)' }}>{i.invoice_no || '(underlag)'}</td>
            <td style={{ fontFamily: 'var(--font-mono)' }}>{i.orders?.order_no}</td>
            <td>{i.customer?.name}<div style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>{i.customer?.email}</div></td>
            <td style={{ fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{money(i.total)}</td>
            <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{day(i.issue_date)}</td>
            <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{day(i.due_date)}</td>
            <td><Pill status={i.status} label={INV_STATUS[i.status]} />{i.status === 'paid' && <div style={{ fontSize: '0.72rem', color: 'var(--ink-muted)' }}>{day(i.paid_date)}</div>}{i.sent_at && <div style={{ fontSize: '0.72rem', color: 'var(--ink-muted)' }}>Mejlad {day(i.sent_at)} till {i.sent_to}</div>}</td>
            <td>
              <div className="btn-row">
                <button className="btn btn-secondary btn-sm" onClick={() => pdf(i)}><FileDown size={13} /> PDF</button>
                {i.status === 'sent' && <button className="btn btn-secondary btn-sm" disabled={sending === i.id} onClick={() => send(i)}><Mail size={13} /> {sending === i.id ? 'Skickar…' : i.sent_at ? 'Skicka igen' : 'Skicka'}</button>}
                {i.status === 'draft' && <button className="btn btn-primary btn-sm" onClick={() => run('admin_issue_invoice', { p_invoice: i.id }, 'Faktura utfärdad. Klicka på Skicka för att maila den till kunden, eller ladda ner PDF:en.')}>Utfärda</button>}
                {i.status === 'sent' && <button className="btn btn-primary btn-sm" onClick={() => run('admin_mark_invoice_paid', { p_invoice: i.id, p_paid: todayStr() }, 'Markerad som betald.')}>Markera betald</button>}
                {(i.status === 'draft' || i.status === 'sent') && <button className="btn btn-danger btn-sm" onClick={() => window.confirm('Makulera fakturan?') && run('admin_void_invoice', { p_invoice: i.id }, 'Fakturan är makulerad.')}>Makulera</button>}
              </div>
            </td>
          </tr>
        ))} />
    </>
  )
}

// ── Planer ───────────────────────────────────────────────────────
function Plans({ plans, reload }) {
  const [rows, setRows] = useState(plans)
  const [msg, setMsg] = useState('')
  const set = (code, k, v) => setRows(r => r.map(p => p.code === code ? { ...p, [k]: v } : p))
  async function save(p) {
    const { error } = await supabase.from('plans').update({
      name: p.name, description: p.description, price_incl_vat_sek: Number(p.price_incl_vat_sek),
      voucher_limit: Number(p.voucher_limit), max_members: Number(p.max_members), storage_mb: Number(p.storage_mb), ai_reads_per_month: Number(p.ai_reads_per_month), has_projects: !!p.has_projects, has_expenses: !!p.has_expenses, has_invoicing: !!p.has_invoicing, active: p.active,
    }).eq('code', p.code)
    setMsg(error ? error.message : `${p.name} sparad.`)
    if (!error) reload()
  }
  return (
    <>
      <div className="notice notice-info">Priser anges inklusive moms per 12 månader. Planen Prova (gratis) är reservläget för föreningar utan betald plan och kan inte beställas. Ändringar slår på nya beställningar, inte på utfärdade fakturor. Priserna på hemsidan ligger i HTML-filen och måste ändras separat.</div>
      {msg && <div className="notice notice-success">{msg}</div>}
      <Table head={['Kod', 'Namn', 'Pris inkl. moms (kr/år)', 'Verifikat / räkenskapsår', 'AI-läsningar / månad', 'Användare', 'Lagring (MB)', 'Märkning (projekt)', 'Utlägg', 'Fakturering', 'Aktiv', '']}
        rows={rows.map(p => (
          <tr key={p.code}>
            <td style={{ fontFamily: 'var(--font-mono)' }}>{p.code}</td>
            <td><input value={p.name} onChange={e => set(p.code, 'name', e.target.value)} /></td>
            <td><input type="number" min="0" value={p.price_incl_vat_sek} onChange={e => set(p.code, 'price_incl_vat_sek', e.target.value)} /></td>
            <td><input type="number" min="1" value={p.voucher_limit} onChange={e => set(p.code, 'voucher_limit', e.target.value)} /></td>
            <td><input type="number" min="0" value={p.ai_reads_per_month} onChange={e => set(p.code, 'ai_reads_per_month', e.target.value)} /></td>
            <td><input type="number" min="1" value={p.max_members} onChange={e => set(p.code, 'max_members', e.target.value)} /></td>
            <td><input type="number" min="1" value={p.storage_mb} onChange={e => set(p.code, 'storage_mb', e.target.value)} /></td>
            <td><input type="checkbox" checked={!!p.has_projects} onChange={e => set(p.code, 'has_projects', e.target.checked)} style={{ width: 'auto' }} /></td>
            <td><input type="checkbox" checked={!!p.has_expenses} onChange={e => set(p.code, 'has_expenses', e.target.checked)} style={{ width: 'auto' }} /></td>
            <td><input type="checkbox" checked={!!p.has_invoicing} onChange={e => set(p.code, 'has_invoicing', e.target.checked)} style={{ width: 'auto' }} /></td>
            <td><input type="checkbox" checked={p.active} onChange={e => set(p.code, 'active', e.target.checked)} style={{ width: 'auto' }} /></td>
            <td><button className="btn btn-primary btn-sm" onClick={() => save(p)}>Spara</button></td>
          </tr>
        ))} />
    </>
  )
}

// ── Rabattkoder ──────────────────────────────────────────────────
function Discounts({ plans }) {
  const [codes, err, reload] = useRpc('admin_list_discounts')
  const empty = { code: '', percent: '50', max_uses: '', valid_until: '', plan_code: '', note: '' }
  const [form, setForm] = useState(empty)
  const [msg, setMsg] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function create(e) {
    e.preventDefault()
    setMsg('')
    const { error } = await supabase.from('discount_codes').insert({
      code: form.code.trim().toUpperCase(), percent: Number(form.percent),
      max_uses: form.max_uses ? Number(form.max_uses) : null, valid_until: form.valid_until || null,
      plan_code: form.plan_code || null, note: form.note.trim() || null,
    })
    if (error) setMsg(error.message.includes('check') ? 'Koden får bara innehålla A–Z, 0–9, - och _ (3–30 tecken).' : error.message)
    else { setForm(empty); reload() }
  }
  async function toggle(c) {
    const { error } = await supabase.from('discount_codes').update({ active: !c.active }).eq('code', c.code)
    if (error) setMsg(error.message); else reload()
  }
  async function remove(c) {
    if (!window.confirm(`Ta bort koden ${c.code}? Beställningar som redan använt den påverkas inte.`)) return
    const { error } = await supabase.from('discount_codes').delete().eq('code', c.code)
    if (error) setMsg(error.message); else reload()
  }
  function randomCode() {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    set('code', Array.from(crypto.getRandomValues(new Uint8Array(8)), b => abc[b % abc.length]).join(''))
  }
  if (err) return <Err msg={err} />
  if (!codes) return <Busy />
  return (
    <>
      {msg && <div className="notice notice-warn">{msg}</div>}
      <form className="card" onSubmit={create} style={{ marginBottom: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, alignItems: 'end' }}>
        <Field label="Kod"><div style={{ display: 'flex', gap: 6 }}><input required value={form.code} onChange={e => set('code', e.target.value.toUpperCase())} placeholder="t.ex. VAR2027" /><button type="button" className="btn btn-secondary btn-sm" onClick={randomCode}>Slumpa</button></div></Field>
        <Field label="Rabatt (%)"><input required type="number" min="1" max="100" value={form.percent} onChange={e => set('percent', e.target.value)} /></Field>
        <Field label="Max antal användningar"><input type="number" min="1" value={form.max_uses} onChange={e => set('max_uses', e.target.value)} placeholder="obegränsat" /></Field>
        <Field label="Giltig till"><DateInput value={form.valid_until} onChange={v => set('valid_until', v)} /></Field>
        <Field label="Bara för plan"><select value={form.plan_code} onChange={e => set('plan_code', e.target.value)}><option value="">alla</option>{plans.filter(p => p.price_incl_vat_sek > 0).map(p => <option key={p.code} value={p.code}>{p.name}</option>)}</select></Field>
        <Field label="Anteckning (syns bara här)"><input value={form.note} onChange={e => set('note', e.target.value)} /></Field>
        <div style={{ marginBottom: 12 }}><button className="btn btn-primary" type="submit">Skapa kod</button></div>
      </form>
      <Table head={['Kod', 'Rabatt', 'Använd', 'Giltig till', 'Plan', 'Anteckning', 'Status', '']}
        rows={codes.map(c => {
          const exhausted = c.max_uses && c.uses >= c.max_uses
          const expired = c.valid_until && c.valid_until < todayStr()
          const on = c.active && !exhausted && !expired
          return (
            <tr key={c.code}>
              <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{c.code}</td>
              <td style={{ fontFamily: 'var(--font-mono)' }}>{c.percent} %</td>
              <td style={{ fontFamily: 'var(--font-mono)' }}>{c.uses}{c.max_uses ? ` / ${c.max_uses}` : ''}</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{day(c.valid_until)}</td>
              <td>{c.plan_code ? (plans.find(p => p.code === c.plan_code)?.name || c.plan_code) : 'alla'}</td>
              <td>{c.note || ''}</td>
              <td><span style={{ color: on ? '#15803d' : '#6b7280', fontWeight: 600, fontSize: '0.78rem' }}>{!c.active ? 'Avstängd' : exhausted ? 'Slut' : expired ? 'Utgången' : 'Aktiv'}</span></td>
              <td><div className="btn-row">
                <button className="btn btn-secondary btn-sm" onClick={() => toggle(c)}>{c.active ? 'Stäng av' : 'Slå på'}</button>
                <button className="btn btn-danger btn-sm" onClick={() => remove(c)}>Ta bort</button>
              </div></td>
            </tr>
          )
        })} empty="Inga rabattkoder än." />
    </>
  )
}

// ── Inställningar ────────────────────────────────────────────────
function Settings({ settings, reload }) {
  const [seller, setSeller] = useState({ ...settings.seller })
  const [vat, setVat] = useState(String(settings.vat_rate))
  const [days, setDays] = useState(String(settings.payment_terms_days))
  const [enforce, setEnforce] = useState(!!settings.enforce_limits)
  const [storageBudget, setStorageBudget] = useState(String(settings.storage_budget_mb ?? 900))
  const [dbBudget, setDbBudget] = useState(String(settings.db_budget_mb ?? 450))
  const [msg, setMsg] = useState('')
  const f = (k, label, extra) => <Field label={label} key={k}><input value={seller[k] || ''} onChange={e => setSeller(s => ({ ...s, [k]: e.target.value }))} {...extra} /></Field>

  async function save() {
    const rows = [
      { key: 'seller', value: seller }, { key: 'vat_rate', value: Number(vat) },
      { key: 'payment_terms_days', value: Number(days) }, { key: 'enforce_limits', value: enforce },
      { key: 'storage_budget_mb', value: Number(storageBudget) }, { key: 'db_budget_mb', value: Number(dbBudget) },
    ]
    const { error } = await supabase.from('platform_settings').upsert(rows)
    setMsg(error ? error.message : 'Sparat.')
    if (!error) reload()
  }
  return (
    <div style={{ maxWidth: 640 }}>
      {msg && <div className="notice notice-info">{msg}</div>}
      <h3 style={{ margin: '0 0 12px' }}>Säljare (visas på fakturan)</h3>
      {f('name', 'Företagsnamn')}{f('org_number', 'Organisationsnummer')}{f('vat_number', 'Momsregistreringsnummer')}
      {f('address', 'Adress')}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>{f('zip', 'Postnummer')}{f('city', 'Ort')}</div>
      {f('email', 'E-post')}{f('phone', 'Telefon')}{f('bankgiro', 'Bankgiro / betalningsmottagare')}
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={!!seller.f_skatt} onChange={e => setSeller(s => ({ ...s, f_skatt: e.target.checked }))} /> Godkänd för F-skatt
      </label>
      <h3 style={{ margin: '8px 0 12px' }}>Fakturering</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Moms (%)"><input type="number" value={vat} onChange={e => setVat(e.target.value)} /></Field>
        <Field label="Betalningsvillkor (dagar)"><input type="number" value={days} onChange={e => setDays(e.target.value)} /></Field>
      </div>
      <h3 style={{ margin: '8px 0 12px' }}>Gränser</h3>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 16 }}>
        <input type="checkbox" style={{ width: 'auto', marginTop: 4 }} checked={enforce} onChange={e => setEnforce(e.target.checked)} />
        <span><strong>Verkställ planernas gränser</strong><br /><span style={{ fontSize: '0.82rem', color: 'var(--ink-soft)' }}>
          När detta är på stoppas nya verifikat över planens gräns och AI-läsningar följer planens kvot. Alla föreningar som inte har en betald plan räknas som Prova (15 verifikat per räkenskapsår, inga AI-läsningar). Kontrollera i Föreningar-fliken att ingen befintlig förening redan ligger över sin gräns innan du slår på det.
        </span></span>
      </label>
      <h3 style={{ margin: '8px 0 12px' }}>Supabase-kontots utrymme</h3>
      <p style={{ fontSize: '0.82rem', color: 'var(--ink-soft)', marginBottom: 12 }}>
        Supabase gratisplan ger 1 GB fillagring och 500 MB databas, med max 50 MB per fil. Fillagringsbudgeten stoppar nya bilagor för alla föreningar när den nås (när gränserna ovan är på). Sätt den till ungefär 90 % av det kontot tillåter och höj den om du uppgraderar. Databasbudgeten visas bara på översikten.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Fillagringsbudget (MB)"><input type="number" min="1" value={storageBudget} onChange={e => setStorageBudget(e.target.value)} /></Field>
        <Field label="Databasbudget (MB)"><input type="number" min="1" value={dbBudget} onChange={e => setDbBudget(e.target.value)} /></Field>
      </div>
      <button className="btn btn-primary" onClick={save}>Spara</button>
    </div>
  )
}

// ── Skal ─────────────────────────────────────────────────────────
export default function AdminPortal() {
  const [allowed, setAllowed] = useState(undefined)
  const [tab, setTab] = useState(() => { const t = window.location.hash.split('/')[1]; return TABS.some(x => x[0] === t) ? t : 'oversikt' })
  const [plans, setPlans] = useState([])
  const [settings, setSettings] = useState(null)

  const loadBase = useCallback(async () => {
    const [{ data: p }, { data: s }] = await Promise.all([
      supabase.from('plans').select('*').order('sort_order'),
      supabase.from('platform_settings').select('*'),
    ])
    setPlans(p || [])
    setSettings(Object.fromEntries((s || []).map(r => [r.key, r.value])))
  }, [])

  useEffect(() => {
    supabase.rpc('is_platform_admin').then(({ data }) => {
      setAllowed(!!data)
      if (data) loadBase()
    })
  }, [loadBase])

  function go(t) { setTab(t); window.history.replaceState(null, '', `#admin/${t}`) }

  if (allowed === undefined) return <div style={{ padding: 40 }}><Busy /></div>
  if (!allowed) return (
    <div style={{ padding: 40 }}>
      <p>Du har inte behörighet till adminportalen.</p>
      <a href="#dashboard" className="btn btn-secondary" style={{ marginTop: 12 }}>Till appen</a>
    </div>
  )
  return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <header style={{ background: 'var(--ink)', color: '#fff', padding: '14px 28px', display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <img src="/favicon.svg" alt="" width="24" height="24" />
        <strong>Föreningsbalans – admin</strong>
        <nav style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flex: 1 }}>
          {TABS.map(([id, label]) => (
            <button key={id} onClick={() => go(id)} className={`nav-btn${tab === id ? ' active' : ''}`} style={{ width: 'auto' }}>{label}</button>
          ))}
        </nav>
        <a href="#dashboard" style={{ color: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}><ArrowLeft size={14} /> Till appen</a>
      </header>
      <main style={{ padding: '24px 28px', maxWidth: 1280, margin: '0 auto' }}>
        {!settings ? <Busy /> : (
          <>
            {tab === 'oversikt' && <Overview onGo={go} />}
            {tab === 'foreningar' && <Orgs plans={plans} />}
            {tab === 'anvandare' && <Users />}
            {tab === 'bestallningar' && <Orders plans={plans} />}
            {tab === 'fakturor' && <Invoices settings={settings} />}
            {tab === 'demo' && <DemoActivity />}
            {tab === 'planer' && <Plans plans={plans} reload={loadBase} />}
            {tab === 'rabatter' && <Discounts plans={plans} />}
            {tab === 'installningar' && <Settings settings={settings} reload={loadBase} />}
          </>
        )}
      </main>
    </div>
  )
}
