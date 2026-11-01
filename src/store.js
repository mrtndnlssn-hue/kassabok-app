import { supabase } from './supabase'
import { locale } from './i18n'

// Kategorier sorteras alltid efter kod, med siffror i talordning (U2 före U10).
export const compareCategoryIds = (a, b) =>
  String(a).localeCompare(String(b), 'sv', { numeric: true, sensitivity: 'base' })
export const sortCats = cats => [...(cats || [])].sort((a, b) => compareCategoryIds(a.id, b.id))

const dbStore = {
  async getAll(orgId) {
    const [orgRes, settingsRes, catsRes, txsRes, budgetRes, periodsRes] = await Promise.all([
      supabase.from('organizations').select('name').eq('id', orgId).single(),
      supabase.from('org_settings').select('active_period_id').eq('org_id', orgId).maybeSingle(),
      supabase.from('categories').select('*').eq('org_id', orgId).order('id'),
      supabase.from('transactions').select('*').eq('org_id', orgId).order('date', { ascending: false }),
      supabase.from('budget').select('*').eq('org_id', orgId),
      supabase.from('fiscal_periods').select('*').eq('org_id', orgId).order('start_date'),
    ])

    for (const res of [orgRes, catsRes, txsRes, budgetRes, periodsRes]) {
      if (res.error) throw res.error
    }

    const budgetObj = {}
    const commentObj = {}
    for (const row of budgetRes.data || []) {
      if (!budgetObj[row.period_id]) budgetObj[row.period_id] = {}
      budgetObj[row.period_id][row.category_id] = Number(row.amount)
      if (row.comment) {
        if (!commentObj[row.period_id]) commentObj[row.period_id] = {}
        commentObj[row.period_id][row.category_id] = row.comment
      }
    }

    return {
      orgName:        orgRes.data?.name || '',
      activePeriodId: settingsRes.data?.active_period_id || null,
      categories:     sortCats(catsRes.data),
      transactions:   (txsRes.data || []).map(t => ({
        id:          t.id,
        date:        t.date,
        description: t.description,
        categoryId:  t.category_id,
        amount:      Number(t.amount),
        comment:     t.comment || '',
        createdAt:   t.created_at,
      })),
      budget:         budgetObj,
      budgetComments: commentObj,
      fiscalPeriods:  (periodsRes.data || []).map(p => ({
        id:             p.id,
        label:          p.label,
        start:          p.start_date,
        end:            p.end_date,
        locked:         p.locked,
        openingBalance: Number(p.opening_balance ?? 0),
        budgetLocked:   p.budget_locked ?? false,
      })),
    }
  },

  async setOrgName(orgId, name) {
    const { error } = await supabase.from('organizations').update({ name }).eq('id', orgId)
    if (error) throw error
  },

  async setActivePeriodId(orgId, id) {
    const { error } = await supabase.from('org_settings')
      .upsert({ org_id: orgId, active_period_id: id })
    if (error) throw error
  },

  async saveCategories(orgId, categories) {
    const { error: delErr } = await supabase.from('categories').delete().eq('org_id', orgId)
    if (delErr) throw delErr
    if (categories.length > 0) {
      const { error } = await supabase.from('categories').insert(
        categories.map(c => ({ id: c.id, org_id: orgId, name: c.name, type: c.type, hidden: c.hidden ?? false }))
      )
      if (error) throw error
    }
  },

  async renameCategories(orgId, renames) {
    const { data, error } = await supabase.rpc('rename_categories', { p_org_id: orgId, p_renames: renames })
    if (error) throw error
    if (data?.error) throw new Error(data.error)
  },

  async toggleCategoryHidden(orgId, catId, hidden) {
    const { error } = await supabase.from('categories').update({ hidden }).eq('org_id', orgId).eq('id', catId)
    if (error) throw error
  },

  async setBudgetLine(orgId, periodId, catId, amount) {
    const { error } = await supabase.from('budget').upsert({
      org_id: orgId, period_id: periodId, category_id: catId, amount,
    })
    if (error) throw error
  },

  async setBudgetComment(orgId, periodId, catId, comment) {
    const { error } = await supabase.from('budget').upsert({
      org_id: orgId, period_id: periodId, category_id: catId, comment,
    })
    if (error) throw error
  },

  async setBudgetLocked(orgId, periodId, locked) {
    const { error } = await supabase.from('fiscal_periods')
      .update({ budget_locked: locked }).eq('org_id', orgId).eq('id', periodId)
    if (error) throw error
  },

  async saveFiscalPeriods(orgId, periods) {
    const { error: delErr } = await supabase.from('fiscal_periods').delete().eq('org_id', orgId)
    if (delErr) throw delErr
    if (periods.length > 0) {
      const { error } = await supabase.from('fiscal_periods').insert(
        periods.map(p => ({
          id:              p.id,
          org_id:          orgId,
          label:           p.label,
          start_date:      p.start,
          end_date:        p.end,
          locked:          p.locked ?? false,
          opening_balance: p.openingBalance ?? 0,
          budget_locked:   p.budgetLocked ?? false,
        }))
      )
      if (error) throw error
    }
  },

  async addTransaction(orgId, tx) {
    const { data, error } = await supabase.from('transactions').insert({
      org_id:      orgId,
      date:        tx.date,
      description: tx.description,
      category_id: tx.categoryId,
      amount:      tx.amount,
      comment:     tx.comment || '',
    }).select().single()
    if (error) throw error
    return { ...tx, id: data.id, createdAt: data.created_at }
  },

  async updateTransaction(orgId, id, updates) {
    const patch = {}
    if (updates.date        !== undefined) patch.date        = updates.date
    if (updates.description !== undefined) patch.description = updates.description
    if (updates.categoryId  !== undefined) patch.category_id = updates.categoryId
    if (updates.amount      !== undefined) patch.amount      = updates.amount
    if (updates.comment     !== undefined) patch.comment     = updates.comment
    const { error } = await supabase.from('transactions').update(patch).eq('id', id).eq('org_id', orgId)
    if (error) throw error
  },

  async deleteTransaction(orgId, id) {
    // Remove attachments first
    const { data: files } = await supabase.storage.from('attachments').list(`${orgId}/${id}`)
    if (files?.length) {
      await supabase.storage.from('attachments').remove(files.map(f => `${orgId}/${id}/${f.name}`))
    }
    const { error } = await supabase.from('transactions').delete().eq('id', id).eq('org_id', orgId)
    if (error) throw error
  },
}

const dbAttachments = {
  async list(orgId, txId) {
    const { data, error } = await supabase.storage.from('attachments').list(`${orgId}/${txId}`)
    if (error) throw error
    return await Promise.all((data || []).map(async f => {
      const path = `${orgId}/${txId}/${f.name}`
      const { data: urlData } = await supabase.storage.from('attachments').createSignedUrl(path, 3600)
      return { name: f.name, size: f.metadata?.size || 0, url: urlData?.signedUrl || '' }
    }))
  },

  async upload(orgId, txId, files) {
    for (const file of files) {
      const safeName = file.name.replace(/[^\w.\-åäöÅÄÖ]/g, '_')
      const { error } = await supabase.storage
        .from('attachments')
        .upload(`${orgId}/${txId}/${safeName}`, file, { upsert: true })
      if (error) throw error
    }
  },

  async delete(orgId, txId, filename) {
    const { error } = await supabase.storage
      .from('attachments')
      .remove([`${orgId}/${txId}/${filename}`])
    if (error) throw error
  },

  async namesByTx(orgId, txIds) {
    const result = {}
    for (const txId of txIds) {
      const { data: files } = await supabase.storage.from('attachments').list(`${orgId}/${txId}`)
      if (files?.length) result[txId] = files.map(f => f.name)
    }
    return result
  },

  // Tar bort alla bilagor för en förening (en mapp per verifikat) när föreningen raderas.
  async removeAllForOrg(orgId) {
    const { data: folders } = await supabase.storage.from('attachments').list(orgId, { limit: 1000 })
    for (const folder of folders || []) {
      const { data: files } = await supabase.storage.from('attachments').list(`${orgId}/${folder.name}`, { limit: 1000 })
      if (files?.length) await supabase.storage.from('attachments').remove(files.map(f => `${orgId}/${folder.name}/${f.name}`))
    }
  },

  async listForPeriod(orgId, txIds) {
    const results = []
    for (const txId of txIds) {
      const { data: files } = await supabase.storage.from('attachments').list(`${orgId}/${txId}`)
      for (const f of files || []) {
        const { data: blob } = await supabase.storage
          .from('attachments')
          .download(`${orgId}/${txId}/${f.name}`)
        if (blob) results.push({ txId, filename: f.name, blob })
      }
    }
    return results
  },
}

// ── Demoläge ───────────────────────────────────────────────────
// Demokontot läser riktig data men all skrivning sker i minnet och försvinner vid omladdning.
let demo = null // { data, files: Map<txId, [{name, file}]>, seq }
export function setDemoMode(on) { demo = on ? { data: null, files: new Map(), seq: 0 } : null }
export const isDemoMode = () => !!demo

const clone = v => structuredClone(v)
const remapKeys = (obj, map) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [map[k] ?? k, v]))

const demoStore = {
  async getAll(orgId) {
    if (!demo.data) demo.data = clone(await dbStore.getAll(orgId))
    return clone(demo.data)
  },
  async setOrgName(_o, name)        { demo.data.orgName = name },
  async setActivePeriodId(_o, id)   { demo.data.activePeriodId = id },
  async saveCategories(_o, cats) {
    demo.data.categories = sortCats(cats.map(c => ({ id: c.id, name: c.name, type: c.type, hidden: c.hidden ?? false })))
  },
  async renameCategories(_o, renames) {
    const map = Object.fromEntries(renames.map(r => [r.from, r.to]))
    const d = demo.data
    d.categories   = d.categories.map(c => map[c.id] ? { ...c, id: map[c.id] } : c)
    d.transactions = d.transactions.map(t => map[t.categoryId] ? { ...t, categoryId: map[t.categoryId] } : t)
    for (const pid of Object.keys(d.budget)) d.budget[pid] = remapKeys(d.budget[pid], map)
    for (const pid of Object.keys(d.budgetComments)) d.budgetComments[pid] = remapKeys(d.budgetComments[pid], map)
  },
  async toggleCategoryHidden(_o, catId, hidden) {
    demo.data.categories = demo.data.categories.map(c => c.id === catId ? { ...c, hidden } : c)
  },
  async setBudgetLine(_o, periodId, catId, amount) {
    ;(demo.data.budget[periodId] ||= {})[catId] = amount
  },
  async setBudgetComment(_o, periodId, catId, comment) {
    const m = (demo.data.budgetComments[periodId] ||= {})
    if (comment) m[catId] = comment
    else delete m[catId]
  },
  async setBudgetLocked(_o, periodId, locked) {
    demo.data.fiscalPeriods = demo.data.fiscalPeriods.map(p => p.id === periodId ? { ...p, budgetLocked: locked } : p)
  },
  async saveFiscalPeriods(_o, periods) {
    demo.data.fiscalPeriods = periods.map(p => ({
      id: p.id, label: p.label, start: p.start, end: p.end,
      locked: p.locked ?? false, openingBalance: Number(p.openingBalance ?? 0), budgetLocked: p.budgetLocked ?? false,
    }))
  },
  async addTransaction(_o, tx) {
    const id = `demo-${++demo.seq}`
    const createdAt = new Date().toISOString()
    demo.data.transactions.push({
      id, date: tx.date, description: tx.description, categoryId: tx.categoryId,
      amount: Number(tx.amount), comment: tx.comment || '', createdAt,
    })
    demo.data.transactions.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    return { ...tx, id, createdAt }
  },
  async updateTransaction(_o, id, updates) {
    demo.data.transactions = demo.data.transactions.map(t => t.id === id ? {
      ...t,
      ...Object.fromEntries(['date', 'description', 'categoryId', 'amount', 'comment']
        .filter(k => updates[k] !== undefined).map(k => [k, updates[k]])),
    } : t)
    demo.data.transactions.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  },
  async deleteTransaction(_o, id) {
    demo.data.transactions = demo.data.transactions.filter(t => t.id !== id)
    demo.files.delete(id)
  },
}

const demoAttachments = {
  async list(_o, txId) {
    return (demo.files.get(txId) || []).map(f => ({ name: f.name, size: f.file.size, url: URL.createObjectURL(f.file) }))
  },
  async upload(_o, txId, files) {
    const arr = demo.files.get(txId) || []
    for (const file of files) {
      const name = file.name.replace(/[^\w.\-åäöÅÄÖ]/g, '_')
      const i = arr.findIndex(f => f.name === name)
      if (i >= 0) arr[i] = { name, file }
      else arr.push({ name, file })
    }
    demo.files.set(txId, arr)
  },
  async delete(_o, txId, filename) {
    demo.files.set(txId, (demo.files.get(txId) || []).filter(f => f.name !== filename))
  },
  async namesByTx(_o, txIds) {
    const result = {}
    for (const id of txIds) {
      const files = demo.files.get(id)
      if (files?.length) result[id] = files.map(f => f.name)
    }
    return result
  },
  async listForPeriod(_o, txIds) {
    return txIds.flatMap(txId => (demo.files.get(txId) || []).map(f => ({ txId, filename: f.name, blob: f.file })))
  },
}

const withDemo = (real, fake) => new Proxy(real, {
  get: (target, key, receiver) => (demo && key in fake ? fake[key] : Reflect.get(target, key, receiver)),
})
export const store = withDemo(dbStore, demoStore)
export const attachments = withDemo(dbAttachments, demoAttachments)

// ── Formatering ────────────────────────────────────────────────
export function fmt(amount) {
  return new Intl.NumberFormat(locale(), {
    style: 'currency', currency: 'SEK', minimumFractionDigits: 2,
  }).format(amount ?? 0)
}
// Datum visas och matas alltid in som ÅÅÅÅ-MM-DD, oberoende av webbläsarens språkinställning.
const pad2 = n => String(n).padStart(2, '0')
export function isoDate(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`   // lokal tid, inte UTC
}
export function isoDateTime(d = new Date()) {
  return `${isoDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
export const todayStr = () => isoDate()
export function isValidIsoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}
export function fmtDate(value) {
  if (!value) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const d = new Date(value)
  return isNaN(d) ? '' : isoDate(d)
}
export function getYear() { return new Date().getFullYear() }

export function getOrBuildPeriods(data) {
  if (data.fiscalPeriods?.length > 0) return data.fiscalPeriods
  const years = [...new Set(
    (data.transactions || []).map(t => t.date?.slice(0, 4)).filter(Boolean).map(Number)
  )].sort()
  if (!years.includes(getYear())) years.push(getYear())
  return years.map(y => ({ id: String(y), label: String(y), start: `${y}-01-01`, end: `${y}-12-31` }))
}

export function txsForPeriod(txs, period) {
  if (!period) return []
  return (txs || []).filter(t => t.date && t.date >= period.start && t.date <= period.end)
}
export function txsForYear(txs, year) {
  return (txs || []).filter(t => t.date && t.date.startsWith(String(year)))
}
export function sumByCategory(txs, categories) {
  const result = {}
  for (const cat of categories) result[cat.id] = 0
  for (const tx of txs) {
    if (tx.categoryId in result) result[tx.categoryId] += Number(tx.amount) || 0
  }
  return result
}
