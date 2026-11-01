import { useState, useEffect, useCallback, useMemo } from 'react'
import { ArrowLeft, Loader, FileDown, RefreshCw } from 'lucide-react'
import { supabase } from '../supabase'
import { buildInvoicePdf, money } from './invoicePdf'

// Adminportal för plattformsägaren. Bara på svenska – används inte av föreningarna.

const TABS = [
  ['oversikt', 'Översikt'], ['foreningar', 'Föreningar'], ['anvandare', 'Användare'],
  ['bestallningar', 'Beställningar'], ['fakturor', 'Fakturor'], ['planer', 'Planer'], ['rabatter', 'Rabattkoder'], ['installningar', 'Inställningar'],
]
const ORDER_STATUS = { new: 'Ny', invoiced: 'Fakturerad', paid: 'Betald', cancelled: 'Avbruten' }
const INV_STATUS = { draft: 'Underlag', sent: 'Skickad', paid: 'Betald', void: 'Makulerad' }
const STATUS_COLOR = { new: '#b45309', invoiced: '#1d4ed8', paid: '#15803d', cancelled: '#6b7280', draft: '#b45309', sent: '#1d4ed8', void: '#6b7280' }

const day = v => (v ? String(v).slice(0, 10) : '–')
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

// ── Översikt ─────────────────────────────────────────────────────
function Overview({ onGo }) {
  const [d, err] = useRpc('admin_overview')
  if (err) return <Err msg={err} />
  if (!d) return <Busy />
  const tiles = [
    ['Föreningar', d.orgs, 'foreningar'], ['Användare', d.users, 'anvandare'], ['Betalande föreningar', d.paying_orgs, 'foreningar'],
    ['Nya beställningar', d.new_orders, 'bestallningar'], ['Öppna fakturor', d.open_invoices, 'fakturor'],
    ['Obetalt (kr)', money(d.unpaid_total), 'fakturor'], ['Betalt totalt (kr)', money(d.paid_total), 'fakturor'], ['Verifikat totalt', d.vouchers, 'foreningar'],
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(190px,1fr))', gap: 14 }}>
      {tiles.map(([label, v, tab]) => (
        <button key={label} className="card" onClick={() => onGo(tab)} style={{ textAlign: 'left', cursor: 'pointer' }}>
          <div style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.6rem', marginTop: 4 }}>{v}</div>
        </button>
      ))}
    </div>
  )
}

// ── Föreningar ───────────────────────────────────────────────────
function Orgs({ plans }) {
  const [orgs, err, reload] = useRpc('admin_list_orgs')
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState(null)
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
            <td>{o.effective_plan}{o.plan_code !== o.effective_plan && <div style={{ fontSize: '0.72rem', color: 'var(--red)' }}>({o.plan_code} har gått ut)</div>}</td>
            <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{o.plan_code === 'gratis' ? '–' : day(o.plan_valid_until)}</td>
            <td style={{ fontFamily: 'var(--font-mono)' }}>{o.members} / {o.member_limit}</td>
            <td><Bar used={o.vouchers_period} limit={o.voucher_limit} /><div style={{ fontSize: '0.7rem', color: 'var(--ink-muted)' }}>{o.vouchers_total} totalt</div></td>
            <td><Bar used={o.ai_used} limit={o.ai_limit} /></td>
            <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{mb(o.storage_bytes)}</td>
            <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{day(o.last_activity)}</td>
            <td><button className="btn btn-secondary btn-sm" onClick={() => setEdit(o)}>Ändra plan</button></td>
          </tr>
        ))} />
      {edit && <PlanModal org={edit} plans={plans} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload() }} />}
    </>
  )
}

function PlanModal({ org, plans, onClose, onSaved }) {
  const inAYear = () => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0, 10) }
  const [plan, setPlan] = useState(org.plan_code)
  const [until, setUntil] = useState(org.plan_valid_until || inAYear())
  const [err, setErr] = useState('')
  async function save() {
    const { error } = await supabase.rpc('admin_set_org_plan', { p_org: org.org_id, p_plan: plan, p_valid_until: plan === 'gratis' ? null : until || null })
    if (error) setErr(error.message); else onSaved()
  }
  return (
    <Modal title={`Plan – ${org.name}`} onClose={onClose}>
      <Err msg={err} />
      <Field label="Plan"><select value={plan} onChange={e => setPlan(e.target.value)}>{plans.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}</select></Field>
      {plan !== 'gratis' && <Field label="Giltig till"><input type="date" value={until} onChange={e => setUntil(e.target.value)} /></Field>}
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
          <tr key={o.id} onClick={() => setOpen(o)} style={{ cursor: 'pointer' }}>
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
    ['Order', order.order_no], ['Skapad', String(order.created_at).replace('T', ' ').slice(0, 16)], ['Plan', planName(order.plan_code)],
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
      <Field label="Koppla till förening i appen (planen aktiveras när fakturan markeras betald)">
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
  if (err) return <Err msg={err} />
  if (!invoices) return <Busy />

  async function run(rpc, args, okMsg) {
    setMsg('')
    const { error } = await supabase.rpc(rpc, args)
    if (error) setMsg(error.message); else { setMsg(okMsg); reload() }
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
            <td><Pill status={i.status} label={INV_STATUS[i.status]} />{i.status === 'paid' && <div style={{ fontSize: '0.72rem', color: 'var(--ink-muted)' }}>{day(i.paid_date)}</div>}</td>
            <td>
              <div className="btn-row">
                <button className="btn btn-secondary btn-sm" onClick={() => pdf(i)}><FileDown size={13} /> PDF</button>
                {i.status === 'draft' && <button className="btn btn-primary btn-sm" onClick={() => run('admin_issue_invoice', { p_invoice: i.id }, 'Faktura utfärdad. Ladda ner PDF:en och skicka den till kunden.')}>Utfärda</button>}
                {i.status === 'sent' && <button className="btn btn-primary btn-sm" onClick={() => run('admin_mark_invoice_paid', { p_invoice: i.id, p_paid: new Date().toISOString().slice(0, 10) }, 'Markerad som betald. Planen är aktiverad om beställningen är kopplad till en förening.')}>Markera betald</button>}
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
      voucher_limit: Number(p.voucher_limit), max_members: Number(p.max_members), ai_reads_per_month: Number(p.ai_reads_per_month), active: p.active,
    }).eq('code', p.code)
    setMsg(error ? error.message : `${p.name} sparad.`)
    if (!error) reload()
  }
  return (
    <>
      <div className="notice notice-info">Priser anges inklusive moms per 12 månader. Planen Prova (gratis) är reservläget för föreningar utan betald plan och kan inte beställas. Ändringar slår på nya beställningar, inte på utfärdade fakturor. Priserna på hemsidan ligger i HTML-filen och måste ändras separat.</div>
      {msg && <div className="notice notice-success">{msg}</div>}
      <Table head={['Kod', 'Namn', 'Pris inkl. moms (kr/år)', 'Verifikat / räkenskapsår', 'AI-läsningar / månad', 'Användare', 'Aktiv', '']}
        rows={rows.map(p => (
          <tr key={p.code}>
            <td style={{ fontFamily: 'var(--font-mono)' }}>{p.code}</td>
            <td><input value={p.name} onChange={e => set(p.code, 'name', e.target.value)} /></td>
            <td><input type="number" min="0" value={p.price_incl_vat_sek} onChange={e => set(p.code, 'price_incl_vat_sek', e.target.value)} /></td>
            <td><input type="number" min="1" value={p.voucher_limit} onChange={e => set(p.code, 'voucher_limit', e.target.value)} /></td>
            <td><input type="number" min="0" value={p.ai_reads_per_month} onChange={e => set(p.code, 'ai_reads_per_month', e.target.value)} /></td>
            <td><input type="number" min="1" value={p.max_members} onChange={e => set(p.code, 'max_members', e.target.value)} /></td>
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
        <Field label="Giltig till"><input type="date" value={form.valid_until} onChange={e => set('valid_until', e.target.value)} /></Field>
        <Field label="Bara för plan"><select value={form.plan_code} onChange={e => set('plan_code', e.target.value)}><option value="">alla</option>{plans.filter(p => p.price_incl_vat_sek > 0).map(p => <option key={p.code} value={p.code}>{p.name}</option>)}</select></Field>
        <Field label="Anteckning (syns bara här)"><input value={form.note} onChange={e => set('note', e.target.value)} /></Field>
        <div style={{ marginBottom: 12 }}><button className="btn btn-primary" type="submit">Skapa kod</button></div>
      </form>
      <Table head={['Kod', 'Rabatt', 'Använd', 'Giltig till', 'Plan', 'Anteckning', 'Status', '']}
        rows={codes.map(c => {
          const exhausted = c.max_uses && c.uses >= c.max_uses
          const expired = c.valid_until && c.valid_until < new Date().toISOString().slice(0, 10)
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
  const [msg, setMsg] = useState('')
  const f = (k, label, extra) => <Field label={label} key={k}><input value={seller[k] || ''} onChange={e => setSeller(s => ({ ...s, [k]: e.target.value }))} {...extra} /></Field>

  async function save() {
    const rows = [
      { key: 'seller', value: seller }, { key: 'vat_rate', value: Number(vat) },
      { key: 'payment_terms_days', value: Number(days) }, { key: 'enforce_limits', value: enforce },
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
            {tab === 'planer' && <Plans plans={plans} reload={loadBase} />}
            {tab === 'rabatter' && <Discounts plans={plans} />}
            {tab === 'installningar' && <Settings settings={settings} reload={loadBase} />}
          </>
        )}
      </main>
    </div>
  )
}
