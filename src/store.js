import { supabase } from './supabase'
import { locale, translate } from './i18n'

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024 // samma som bucketens gräns i Supabase

// Kategorier sorteras alltid efter kod, med siffror i talordning (U2 före U10).
export const compareCategoryIds = (a, b) =>
  String(a).localeCompare(String(b), 'sv', { numeric: true, sensitivity: 'base' })
export const sortCats = cats => [...(cats || [])].sort((a, b) => compareCategoryIds(a.id, b.id))

// Ett verifikat har en eller flera rader (konto + belopp). Äldre verifikat utan rader räknas som en rad.
export const txLines = tx =>
  tx.lines && tx.lines.length ? tx.lines : [{ categoryId: tx.categoryId, amount: Number(tx.amount) || 0 }]

// Normaliserar rader från formuläret: bara rader med konto, belopp avrundat till öre.
const cleanLines = lines => (lines || [])
  .filter(l => l.categoryId)
  .map(l => ({ categoryId: l.categoryId, amount: Math.round((Number(l.amount) || 0) * 100) / 100, projectId: l.projectId || null }))

// Projektmärkning (projekt/sektion/event): sammanställer märkta rader över alla räkenskapsperioder.
export function projectRows(transactions, projectId) {
  const rows = []
  for (const tx of transactions || []) {
    for (const l of txLines(tx)) if (l.projectId === projectId) rows.push({ tx, line: l })
  }
  return rows.sort((a, b) => (a.tx.date || '').localeCompare(b.tx.date || ''))
}
export function projectTotals(transactions, categories, projectId) {
  const catMap = Object.fromEntries((categories || []).map(c => [c.id, c]))
  const byCategory = {}
  let income = 0, expense = 0
  const txIds = new Set()
  for (const { tx, line } of projectRows(transactions, projectId)) {
    const amount = Number(line.amount) || 0
    const type = catMap[line.categoryId]?.type
    if (type === 'income') income += amount
    else expense += amount
    byCategory[line.categoryId] = (byCategory[line.categoryId] || 0) + amount
    txIds.add(tx.id)
  }
  return { income, expense, net: income - expense, count: txIds.size, byCategory }
}

const emptyProjectData = () => ({ allowed: false, enabled: false, labelSingular: '', labelPlural: '', projects: [] })
const projectError = e => {
  if (e?.code === '23505') return new Error('Namnet används redan.')
  if (e?.code === '23503') return new Error('Verifikat är märkta med detta. Stäng det i stället för att ta bort det.')
  return e
}
const sumLines = lines => Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100

const dbStore = {
  async getAll(orgId) {
    const [orgRes, settingsRes, catsRes, txsRes, budgetRes, periodsRes, linesRes] = await Promise.all([
      supabase.from('organizations').select('name').eq('id', orgId).single(),
      supabase.from('org_settings').select('active_period_id, hide_getting_started').eq('org_id', orgId).maybeSingle(),
      supabase.from('categories').select('*').eq('org_id', orgId).order('id'),
      supabase.from('transactions').select('*').eq('org_id', orgId).order('date', { ascending: false }),
      supabase.from('budget').select('*').eq('org_id', orgId),
      supabase.from('fiscal_periods').select('*').eq('org_id', orgId).order('start_date'),
      supabase.from('transaction_lines').select('*').eq('org_id', orgId).order('position'),
    ])
    const projectData = await dbStore.getProjectData(orgId)

    for (const res of [orgRes, catsRes, txsRes, budgetRes, periodsRes, linesRes]) {
      if (res.error) throw res.error
    }

    const linesByTx = {}
    for (const l of linesRes.data || []) {
      (linesByTx[l.tx_id] ||= []).push({ id: l.id, categoryId: l.category_id, amount: Number(l.amount), projectId: l.project_id || null })
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
      hideGettingStarted: !!settingsRes.data?.hide_getting_started,
      categories:     sortCats(catsRes.data),
      transactions:   (txsRes.data || []).map(t => ({
        id:          t.id,
        date:        t.date,
        description: t.description,
        categoryId:  t.category_id,
        amount:      Number(t.amount),
        comment:     t.comment || '',
        createdAt:   t.created_at,
        lines:       linesByTx[t.id] || null,
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
      projectData,
    }
  },

  // Projekt (eller sektioner/event): inställning, namn på funktionen och projekten med kopplade medlemmar
  async getProjectData(orgId) {
    const [setRes, projRes, memRes, planRes] = await Promise.all([
      supabase.from('org_settings').select('projects_enabled, project_label_singular, project_label_plural').eq('org_id', orgId).maybeSingle(),
      supabase.from('projects').select('*').eq('org_id', orgId).order('created_at'),
      supabase.from('project_members').select('project_id, user_id, is_lead').eq('org_id', orgId),
      supabase.rpc('get_org_plan', { p_org: orgId }),
    ])
    for (const res of [setRes, projRes, memRes]) if (res.error) throw res.error
    const membersByProject = {}
    for (const m of memRes.data || []) (membersByProject[m.project_id] ||= []).push({ userId: m.user_id, isLead: !!m.is_lead })
    return {
      allowed:       !!planRes.data?.projects_allowed,
      enabled:       !!setRes.data?.projects_enabled,
      labelSingular: setRes.data?.project_label_singular || '',
      labelPlural:   setRes.data?.project_label_plural || '',
      projects: (projRes.data || []).map(p => ({
        id: p.id, name: p.name, description: p.description || '',
        start: p.start_date || '', end: p.end_date || '',
        closed: !!p.closed, closedAt: p.closed_at || null,
        members: membersByProject[p.id] || [],
      })),
    }
  },

  async setProjectSettings(orgId, { enabled, singular, plural }) {
    const { error } = await supabase.from('org_settings').upsert({
      org_id: orgId, projects_enabled: !!enabled,
      project_label_singular: (singular || '').trim() || null,
      project_label_plural:   (plural || '').trim() || null,
    })
    if (error) throw error
  },

  // Skapar eller uppdaterar ett projekt (och dess medlemmar); returnerar projektets id
  async saveProject(orgId, project) {
    const row = {
      name: project.name.trim(), description: (project.description || '').trim(),
      start_date: project.start || null, end_date: project.end || null,
    }
    let id = project.id
    if (id) {
      const { error } = await supabase.from('projects').update(row).eq('id', id).eq('org_id', orgId)
      if (error) throw projectError(error)
    } else {
      const { data, error } = await supabase.from('projects').insert({ ...row, org_id: orgId }).select('id').single()
      if (error) throw projectError(error)
      id = data.id
    }
    const { error: delErr } = await supabase.from('project_members').delete().eq('project_id', id)
    if (delErr) throw delErr
    const members = project.members || []
    if (members.length) {
      const { error } = await supabase.from('project_members').insert(
        members.map(m => ({ project_id: id, org_id: orgId, user_id: m.userId, is_lead: !!m.isLead })))
      if (error) throw error
    }
    return id
  },

  async setProjectClosed(orgId, id, closed) {
    const { error } = await supabase.from('projects').update({ closed }).eq('id', id).eq('org_id', orgId)
    if (error) throw error
  },

  async deleteProject(orgId, id) {
    const { error } = await supabase.from('projects').delete().eq('id', id).eq('org_id', orgId)
    if (error) throw projectError(error)
  },

  async setOrgName(orgId, name) {
    const { error } = await supabase.from('organizations').update({ name }).eq('id', orgId)
    if (error) throw error
  },

  async setGettingStartedHidden(orgId, hidden) {
    const { error } = await supabase.from('org_settings').upsert({ org_id: orgId, hide_getting_started: !!hidden })
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
    const lines = cleanLines(tx.lines || [{ categoryId: tx.categoryId, amount: tx.amount }])
    if (!lines.length) throw new Error('Verifikatet saknar konto.')
    const { data, error } = await supabase.from('transactions').insert({
      org_id:      orgId,
      date:        tx.date,
      description: tx.description,
      category_id: lines[0].categoryId,
      amount:      sumLines(lines),
      comment:     tx.comment || '',
    }).select().single()
    if (error) throw error
    const { error: lineErr } = await supabase.from('transaction_lines').insert(
      lines.map((l, i) => ({ tx_id: data.id, org_id: orgId, category_id: l.categoryId, amount: l.amount, position: i, project_id: l.projectId }))
    )
    if (lineErr) {
      await supabase.from('transactions').delete().eq('id', data.id)   // inget halvfärdigt verifikat
      throw lineErr
    }
    return { ...tx, id: data.id, lines, amount: sumLines(lines), categoryId: lines[0].categoryId, createdAt: data.created_at }
  },

  async updateTransaction(orgId, id, updates) {
    const patch = {}
    if (updates.date        !== undefined) patch.date        = updates.date
    if (updates.description !== undefined) patch.description = updates.description
    if (updates.categoryId  !== undefined) patch.category_id = updates.categoryId
    if (updates.amount      !== undefined) patch.amount      = updates.amount
    if (updates.comment     !== undefined) patch.comment     = updates.comment
    const lines = updates.lines ? cleanLines(updates.lines) : null
    if (lines) {
      if (!lines.length) throw new Error('Verifikatet saknar konto.')
      patch.category_id = lines[0].categoryId
      patch.amount      = sumLines(lines)
    }
    const { error } = await supabase.from('transactions').update(patch).eq('id', id).eq('org_id', orgId)
    if (error) throw error
    if (lines) {
      // Nya rader först, sedan de gamla bort: ett fel lämnar aldrig verifikatet utan rader
      const { data: old } = await supabase.from('transaction_lines').select('id').eq('tx_id', id)
      const { error: insErr } = await supabase.from('transaction_lines').insert(
        lines.map((l, i) => ({ tx_id: id, org_id: orgId, category_id: l.categoryId, amount: l.amount, position: i, project_id: l.projectId }))
      )
      if (insErr) throw insErr
      if (old?.length) await supabase.from('transaction_lines').delete().in('id', old.map(o => o.id))
    }
  },

  // Flyttar verifikatets rader från ett konto till ett annat (när ett konto tas bort)
  async reassignCategory(orgId, txId, oldCat, newCat) {
    const { error } = await supabase.from('transaction_lines').update({ category_id: newCat })
      .eq('tx_id', txId).eq('org_id', orgId).eq('category_id', oldCat)
    if (error) throw error
    const { error: e2 } = await supabase.from('transactions').update({ category_id: newCat })
      .eq('id', txId).eq('org_id', orgId).eq('category_id', oldCat)
    if (e2) throw e2
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
      if (file.size > MAX_ATTACHMENT_BYTES) {
        throw new Error(translate('{namn} är större än 10 MB och kan inte laddas upp.', { namn: file.name }))
      }
      const safeName = file.name.replace(/[^\w.\-åäöÅÄÖ]/g, '_')
      const { error } = await supabase.storage
        .from('attachments')
        .upload(`${orgId}/${txId}/${safeName}`, file, { upsert: true })
      if (error) {
        // Radnivåsäkerheten nekar när föreningens lagringsgräns (eller plattformens) är nådd
        if (/row-level security|violates/i.test(error.message || '')) {
          throw new Error(translate('Föreningens lagringsutrymme är fullt. Radera bilagor eller välj en större plan under Inställningar.'))
        }
        throw error
      }
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

  // Raderar alla bilagor för de givna verifikaten (frigör lagringsutrymme). Returnerar antal raderade filer.
  async removeForPeriod(orgId, txIds) {
    let removed = 0
    for (const txId of txIds) {
      const { data: files } = await supabase.storage.from('attachments').list(`${orgId}/${txId}`, { limit: 1000 })
      if (!files?.length) continue
      const { error } = await supabase.storage.from('attachments').remove(files.map(f => `${orgId}/${txId}/${f.name}`))
      if (error) throw error
      removed += files.length
    }
    return removed
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
  async getProjectData() { return clone(demo.data?.projectData || emptyProjectData()) },
  async setProjectSettings(_o, { enabled, singular, plural }) {
    Object.assign(demo.data.projectData, { enabled: !!enabled, labelSingular: (singular || '').trim(), labelPlural: (plural || '').trim() })
  },
  async saveProject(_o, project) {
    const pd = demo.data.projectData
    const name = project.name.trim()
    if (pd.projects.some(p => p.id !== project.id && p.name.trim().toLowerCase() === name.toLowerCase())) throw new Error('Namnet används redan.')
    const row = { name, description: (project.description || '').trim(), start: project.start || '', end: project.end || '',
      members: (project.members || []).map(m => ({ userId: m.userId, isLead: !!m.isLead })) }
    if (project.id) {
      pd.projects = pd.projects.map(p => p.id === project.id ? { ...p, ...row } : p)
      return project.id
    }
    const id = `demo-p-${++demo.seq}`
    pd.projects.push({ id, closed: false, closedAt: null, ...row })
    return id
  },
  async setProjectClosed(_o, id, closed) {
    demo.data.projectData.projects = demo.data.projectData.projects.map(p => p.id === id ? { ...p, closed, closedAt: closed ? new Date().toISOString() : null } : p)
  },
  async deleteProject(_o, id) {
    if (demo.data.transactions.some(t => txLines(t).some(l => l.projectId === id))) throw new Error('Verifikat är märkta med detta. Stäng det i stället för att ta bort det.')
    demo.data.projectData.projects = demo.data.projectData.projects.filter(p => p.id !== id)
  },
  async setOrgName(_o, name)        { demo.data.orgName = name },
  async setActivePeriodId(_o, id)   { demo.data.activePeriodId = id },
  async setGettingStartedHidden(_o, hidden) { demo.data.hideGettingStarted = !!hidden },
  async saveCategories(_o, cats) {
    demo.data.categories = sortCats(cats.map(c => ({ id: c.id, name: c.name, type: c.type, hidden: c.hidden ?? false })))
  },
  async renameCategories(_o, renames) {
    const map = Object.fromEntries(renames.map(r => [r.from, r.to]))
    const d = demo.data
    d.categories   = d.categories.map(c => map[c.id] ? { ...c, id: map[c.id] } : c)
    d.transactions = d.transactions.map(t => ({
      ...t,
      categoryId: map[t.categoryId] ?? t.categoryId,
      lines: t.lines ? t.lines.map(l => ({ ...l, categoryId: map[l.categoryId] ?? l.categoryId })) : t.lines,
    }))
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
    const lines = cleanLines(tx.lines || [{ categoryId: tx.categoryId, amount: tx.amount }])
    demo.data.transactions.push({
      id, date: tx.date, description: tx.description, categoryId: lines[0].categoryId,
      amount: sumLines(lines), comment: tx.comment || '', createdAt, lines,
    })
    demo.data.transactions.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    return { ...tx, id, lines, createdAt }
  },
  async updateTransaction(_o, id, updates) {
    const lines = updates.lines ? cleanLines(updates.lines) : null
    demo.data.transactions = demo.data.transactions.map(t => t.id === id ? {
      ...t,
      ...Object.fromEntries(['date', 'description', 'categoryId', 'amount', 'comment']
        .filter(k => updates[k] !== undefined).map(k => [k, updates[k]])),
      ...(lines ? { lines, categoryId: lines[0].categoryId, amount: sumLines(lines) } : {}),
    } : t)
    demo.data.transactions.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  },
  async deleteTransaction(_o, id) {
    demo.data.transactions = demo.data.transactions.filter(t => t.id !== id)
    demo.files.delete(id)
  },
  async reassignCategory(_o, txId, oldCat, newCat) {
    demo.data.transactions = demo.data.transactions.map(t => t.id !== txId ? t : {
      ...t,
      categoryId: t.categoryId === oldCat ? newCat : t.categoryId,
      lines: t.lines ? t.lines.map(l => l.categoryId === oldCat ? { ...l, categoryId: newCat } : l) : t.lines,
    })
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
  async removeForPeriod(_o, txIds) {
    let removed = 0
    for (const id of txIds) { removed += (demo.files.get(id) || []).length; demo.files.delete(id) }
    return removed
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
    for (const l of txLines(tx)) {
      if (l.categoryId in result) result[l.categoryId] += Number(l.amount) || 0
    }
  }
  return result
}
