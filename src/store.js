import { supabase } from './supabase'
import { locale, translate } from './i18n'
import { optimizeImage } from './imageCompress'

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024 // samma som bucketens gräns i Supabase

// Kategorier sorteras alltid efter kod, med siffror i talordning (U2 före U10).
export const compareCategoryIds = (a, b) =>
  String(a).localeCompare(String(b), 'sv', { numeric: true, sensitivity: 'base' })
export const sortCats = cats => [...(cats || [])].sort((a, b) => compareCategoryIds(a.id, b.id))

// Bokföringslagen: ett verifikat får inte ändras efter registreringen. Nya verifikat har 1 timmes frist (grace period)
// där de kan ändras eller raderas. Därefter kan de bara kompletteras (kommentar, projekt, bilagor) eller makuleras.
// Databasen spärrar detta på riktigt; här styr det bara vilka knappar som visas.
export const GRACE_MS = 60 * 60 * 1000
export const isTxLocked = tx => !!tx?.createdAt && Date.now() - new Date(tx.createdAt).getTime() > GRACE_MS
export const graceMinutesLeft = tx => Math.max(0, Math.ceil((new Date(tx.createdAt).getTime() + GRACE_MS - Date.now()) / 60000))
const lockedError = () => new Error('Verifikatet är äldre än 1 timme och kan inte ändras. Makulera och ersätt det i stället.')

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

const emptyProjectData = () => ({ allowed: false, expensesAllowed: false, invoicingAllowed: false, invoicingEnabled: false, invoiceDetails: {}, enabled: false, labelSingular: '', labelPlural: '', projects: [] })
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
        voidedAt:    t.voided_at || null,
        voidReason:  t.void_reason || '',
        replacesId:  t.replaces_id || null,
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
      supabase.from('org_settings').select('projects_enabled, project_label_singular, project_label_plural, invoicing_enabled, invoice_details').eq('org_id', orgId).maybeSingle(),
      supabase.from('projects').select('*').eq('org_id', orgId).order('created_at'),
      supabase.from('project_members').select('project_id, user_id, is_lead').eq('org_id', orgId),
      supabase.rpc('get_org_plan', { p_org: orgId }),
    ])
    for (const res of [setRes, projRes, memRes]) if (res.error) throw res.error
    const membersByProject = {}
    for (const m of memRes.data || []) (membersByProject[m.project_id] ||= []).push({ userId: m.user_id, isLead: !!m.is_lead })
    return {
      allowed:       !!planRes.data?.projects_allowed,
      expensesAllowed: !!planRes.data?.expenses_allowed,
      invoicingAllowed: !!planRes.data?.invoicing_allowed,
      invoicingEnabled: !!setRes.data?.invoicing_enabled,
      invoiceDetails: setRes.data?.invoice_details || {},
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
    const { error } = await supabase.rpc('reassign_category', { p_org: orgId, p_tx: txId, p_old: oldCat, p_new: newCat })
    if (error) throw error
  },

  // Komplettering av ett låst verifikat: bara kommentar och projektmärkning (databasen släpper inte igenom mer)
  async updateLockedTransaction(orgId, id, { comment, lineProjects = [] }) {
    const { error } = await supabase.from('transactions').update({ comment: comment || '' }).eq('id', id).eq('org_id', orgId)
    if (error) throw error
    for (const { lineId, projectId } of lineProjects) {
      if (!lineId) continue
      const { error: lineErr } = await supabase.from('transaction_lines').update({ project_id: projectId || null }).eq('id', lineId).eq('org_id', orgId)
      if (lineErr) throw lineErr
    }
  },

  // Makulerar ett verifikat (det ligger kvar i kassaboken men räknas inte) och lägger vid behov in ett ersättande.
  // Bilagorna kopieras till det ersättande verifikatet. Returnerar det nya verifikatets id (eller null).
  async voidTransaction(orgId, id, reason, replacement = null) {
    const { data, error } = await supabase.rpc('void_transaction', {
      p_id: id, p_reason: reason,
      p_new: replacement && {
        date: replacement.date, description: replacement.description || '', comment: replacement.comment || '',
        lines: cleanLines(replacement.lines),
      },
    })
    if (error) throw error
    if (data) {
      try { await dbAttachments.copyFolder(orgId, id, data) } catch (e) { console.warn('Bilagorna kunde inte kopieras', e) }
    }
    return data || null
  },

  async deleteTransaction(orgId, id) {
    // Verifikatet först: databasen nekar efter fristen, och då ska bilagorna vara kvar
    const { error } = await supabase.from('transactions').delete().eq('id', id).eq('org_id', orgId)
    if (error) throw error
    const { data: files } = await supabase.storage.from('attachments').list(`${orgId}/${id}`)
    if (files?.length) {
      await supabase.storage.from('attachments').remove(files.map(f => `${orgId}/${id}/${f.name}`))
    }
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
    for (const original of files) {
      const file = await optimizeImage(original)
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

  // Kopierar alla filer från en mapp till en annan (bilagorna följer med till ett ersättande verifikat)
  async copyFolder(orgId, fromId, toId) {
    const bucket = supabase.storage.from('attachments')
    const { data: files, error } = await bucket.list(`${orgId}/${fromId}`, { limit: 1000 })
    if (error) throw error
    for (const f of files || []) {
      const { error: cpErr } = await bucket.copy(`${orgId}/${fromId}/${f.name}`, `${orgId}/${toId}/${f.name}`)
      if (cpErr) throw cpErr
    }
  },

  // Flyttar alla filer från en mapp till en annan (utläggets kvitton flyttas till verifikatet när utlägget betalats ut)
  async moveFolder(orgId, fromId, toId) {
    const bucket = supabase.storage.from('attachments')
    const { data: files, error } = await bucket.list(`${orgId}/${fromId}`, { limit: 1000 })
    if (error) throw error
    for (const f of files || []) {
      const { error: cpErr } = await bucket.copy(`${orgId}/${fromId}/${f.name}`, `${orgId}/${toId}/${f.name}`)
      if (cpErr) throw cpErr
    }
    if (files?.length) await bucket.remove(files.map(f => `${orgId}/${fromId}/${f.name}`))
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

// ── Utlägg ─────────────────────────────────────────────────────
// Den som lagt ut pengar skickar in ett utlägg. Det godkänns av någon med skrivrätt och blir ett verifikat först när
// utbetalningen bekräftats. Kvittona ligger i mappen claim_<id> och flyttas till verifikatet vid utbetalning.
export const claimFolder = id => `claim_${id}`

const claimFromRow = r => ({
  id: r.id, userId: r.user_id, registeredBy: r.registered_by || null, date: r.date, description: r.description || '', comment: r.comment || '',
  lines: (r.lines || []).map(l => ({ categoryId: l.categoryId, amount: Number(l.amount), projectId: l.projectId || null })),
  total: Number(r.total), status: r.status, rejectReason: r.reject_reason || '',
  kind: r.kind || 'expense', supplier: r.supplier || '', invoiceNo: r.invoice_no || '', dueDate: r.due_date || null, paymentRef: r.payment_ref || '',
  createdAt: r.created_at, decidedAt: r.decided_at, paidAt: r.paid_at, paidDate: r.paid_date, txId: r.tx_id || null,
})

const dbExpenses = {
  async list(orgId) {
    const { data, error } = await supabase.from('expense_claims').select('*').eq('org_id', orgId).order('created_at', { ascending: false })
    if (error) throw error
    return (data || []).map(claimFromRow)
  },

  // Skickar in ett nytt utlägg (eller uppdaterar ett befintligt när claim.id finns). Returnerar { claim, uploadError }.
  async submit(orgId, claim, files = []) {
    const id = claim.id || crypto.randomUUID()
    const inv = claim.invoice
    const { data, error } = inv
      ? await supabase.rpc('submit_invoice_claim', {
          p_id: id, p_org: orgId, p_date: claim.date, p_supplier: inv.supplier || '', p_invoice_no: inv.invoiceNo || '',
          p_due_date: inv.dueDate || null, p_payment_ref: inv.paymentRef || '',
          p_description: claim.description || '', p_comment: claim.comment || '', p_lines: cleanLines(claim.lines),
        })
      : await supabase.rpc('submit_expense_claim', {
          p_id: id, p_org: orgId, p_date: claim.date, p_description: claim.description || '', p_comment: claim.comment || '',
          p_lines: cleanLines(claim.lines), p_for_user: claim.forUser || null,
        })
    if (error) throw error
    let uploadError = null
    if (files.length) {
      try { await dbAttachments.upload(orgId, claimFolder(id), files) } catch (e) { uploadError = e }
    }
    return { claim: claimFromRow(data), uploadError }
  },

  async decide(_orgId, id, approve, reason = '') {
    const { data, error } = await supabase.rpc('decide_expense_claim', { p_id: id, p_approve: !!approve, p_reason: reason })
    if (error) throw error
    return claimFromRow(data)
  },

  // Bekräftar utbetalning: skapar verifikatet och flyttar kvittona dit. Returnerar verifikatets id.
  async pay(orgId, id, paidDate) {
    const { data: txId, error } = await supabase.rpc('pay_expense_claim', { p_id: id, p_paid_date: paidDate })
    if (error) throw error
    try { await dbAttachments.moveFolder(orgId, claimFolder(id), txId) }
    catch (e) { console.warn('Kvittona kunde inte flyttas till verifikatet', e) }   // ligger kvar på utlägget
    return txId
  },

  async remove(orgId, id) {
    const { data: files } = await supabase.storage.from('attachments').list(`${orgId}/${claimFolder(id)}`)
    if (files?.length) await supabase.storage.from('attachments').remove(files.map(f => `${orgId}/${claimFolder(id)}/${f.name}`))
    const { error } = await supabase.rpc('delete_expense_claim', { p_id: id })
    if (error) throw error
  },

  // Mejlbesked om utlägget (godkännare vid nytt utlägg, den som lagt ut pengarna vid beslut). Fel ignoreras.
  async notify(id) {
    try { await supabase.functions.invoke('notify-expense', { body: { claimId: id } }) } catch { /* ignoreras */ }
  },

  async getSettings(orgId) {
    const { data, error } = await supabase.from('org_settings').select('notify_expense_submitted, notify_expense_decided').eq('org_id', orgId).maybeSingle()
    if (error) throw error
    return { notifySubmitted: data?.notify_expense_submitted ?? true, notifyDecided: data?.notify_expense_decided ?? true }
  },
  async setSettings(orgId, { notifySubmitted, notifyDecided }) {
    const { error } = await supabase.from('org_settings').upsert({
      org_id: orgId, notify_expense_submitted: !!notifySubmitted, notify_expense_decided: !!notifyDecided })
    if (error) throw error
  },
}

// ── Fakturering: kundregister och utgående fakturor ────────────
// Bara ägare skapar och skickar. Fakturan får sitt nummer när den utfärdas och kan därefter inte ändras (bara betalas eller makuleras).
// När en faktura markeras som betald skapas intäktsverifikatet i kassaboken.
const customerFromRow = r => ({
  id: r.id, name: r.name, orgNumber: r.org_number || '', contactPerson: r.contact_person || '', email: r.email || '', phone: r.phone || '',
  address: r.address || '', zip: r.zip || '', city: r.city || '', reference: r.reference || '', note: r.note || '',
})
const invoiceFromRow = r => ({
  id: r.id, customerId: r.customer_id, customer: r.customer || {}, invoiceNo: r.invoice_no || '', invoiceDate: r.invoice_date,
  paymentDays: r.payment_days, dueDate: r.due_date, reference: r.reference || '', note: r.note || '',
  lines: (r.lines || []).map(l => ({ description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), amount: Number(l.amount), categoryId: l.categoryId })),
  total: Number(r.total), status: r.status, issuedAt: r.issued_at, sentAt: r.sent_at, sentTo: r.sent_to || '', sentCount: r.sent_count || 0,
  paidDate: r.paid_date, txId: r.tx_id || null, voidReason: r.void_reason || '', createdAt: r.created_at,
})
const customerRow = (orgId, c) => ({
  org_id: orgId, name: (c.name || '').trim(), org_number: (c.orgNumber || '').trim(), contact_person: (c.contactPerson || '').trim(),
  email: (c.email || '').trim(), phone: (c.phone || '').trim(), address: (c.address || '').trim(), zip: (c.zip || '').trim(),
  city: (c.city || '').trim(), reference: (c.reference || '').trim(), note: (c.note || '').trim(),
})
const invoiceLines = lines => (lines || []).map(l => ({
  description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), categoryId: l.categoryId,
  amount: Math.round(Number(l.quantity) * Number(l.unitPrice) * 100) / 100,
}))

const blobToBase64 = blob => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result).split(',')[1])
  reader.onerror = () => reject(new Error('Kunde inte läsa filen.'))
  reader.readAsDataURL(blob)
})

const dbInvoicing = {
  async listCustomers(orgId) {
    const { data, error } = await supabase.from('customers').select('*').eq('org_id', orgId).order('name')
    if (error) throw error
    return (data || []).map(customerFromRow)
  },
  async saveCustomer(orgId, c) {
    if (!(c.name || '').trim()) throw new Error('Ange kundens namn.')
    const q = c.id ? supabase.from('customers').update(customerRow(orgId, c)).eq('id', c.id).eq('org_id', orgId)
                   : supabase.from('customers').insert(customerRow(orgId, c))
    const { data, error } = await q.select().single()
    if (error) throw error
    return customerFromRow(data)
  },
  async deleteCustomer(orgId, id) {
    const { error } = await supabase.from('customers').delete().eq('id', id).eq('org_id', orgId)
    if (error) throw error
  },
  async listInvoices(orgId) {
    const { data, error } = await supabase.from('outgoing_invoices').select('*').eq('org_id', orgId).order('created_at', { ascending: false })
    if (error) throw error
    return (data || []).map(invoiceFromRow)
  },
  async saveInvoice(orgId, inv) {
    const id = inv.id || crypto.randomUUID()
    const { data, error } = await supabase.rpc('save_outgoing_invoice', {
      p_id: id, p_org: orgId, p_customer: inv.customerId, p_invoice_date: inv.invoiceDate, p_payment_days: Number(inv.paymentDays),
      p_reference: inv.reference || '', p_note: inv.note || '', p_lines: invoiceLines(inv.lines),
    })
    if (error) throw error
    return invoiceFromRow(data)
  },
  async issueInvoice(_o, id) {
    const { data, error } = await supabase.rpc('issue_outgoing_invoice', { p_id: id })
    if (error) throw error
    return invoiceFromRow(data)
  },
  async payInvoice(_o, id, paidDate) {
    const { data, error } = await supabase.rpc('mark_outgoing_invoice_paid', { p_id: id, p_paid_date: paidDate })
    if (error) throw error
    return data
  },
  async voidInvoice(_o, id, reason) {
    const { error } = await supabase.rpc('void_outgoing_invoice', { p_id: id, p_reason: reason })
    if (error) throw error
  },
  async deleteInvoice(_o, id) {
    const { error } = await supabase.rpc('delete_outgoing_invoice', { p_id: id })
    if (error) throw error
  },
  // Skickar fakturan som mejl från föreningen (PDF som bilaga). Mottagaren hämtas av servern från fakturan.
  async sendInvoice(_o, id, pdfBlob, filename) {
    const pdfBase64 = await blobToBase64(pdfBlob)
    const { data, error } = await supabase.functions.invoke('send-org-invoice', { body: { invoiceId: id, pdfBase64, filename } })
    if (error) throw new Error('Tjänsten för att skicka fakturor kunde inte nås.')
    if (data?.error) throw new Error(data.error)
    return data
  },
  async getSettings(orgId) {
    const { data, error } = await supabase.from('org_settings').select('invoicing_enabled, invoice_details').eq('org_id', orgId).maybeSingle()
    if (error) throw error
    return { enabled: !!data?.invoicing_enabled, details: data?.invoice_details || {} }
  },
  async setSettings(orgId, { enabled, details }) {
    const { error } = await supabase.from('org_settings').upsert({ org_id: orgId, invoicing_enabled: !!enabled, invoice_details: details || {} })
    if (error) throw error
  },
}

// ── Demoläge ───────────────────────────────────────────────────
// Demokontot läser riktig data men all skrivning sker i minnet och försvinner vid omladdning.
let demo = null // { data, files: Map<txId, [{name, file}]>, seq, claims, customers, invoices, invSeq }
export function setDemoMode(on) { demo = on ? { data: null, files: new Map(), seq: 0, claims: [], customers: [], invoices: [], invSeq: 0, aiReads: 0 } : null }
export const isDemoMode = () => !!demo
// Demoläget tillåter en AI-avläsning per session (nollställs när man loggar in på demon igen)
export const DEMO_AI_LIMIT = 1
export const demoAiUsed = () => demo?.aiReads || 0
export const demoAiCount = () => { if (demo) demo.aiReads++ }

const clone = v => structuredClone(v)
const remapKeys = (obj, map) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [map[k] ?? k, v]))

// Exempeldata i minnet så att demon visar utlägg, fakturor, fakturering och makulerade verifikat. Inget av det sparas i databasen.
async function seedDemo() {
  const day = off => { const d = new Date(); d.setDate(d.getDate() + off); return d.toISOString().slice(0, 10) }
  const cats = demo.data.categories
  const exp = cats.filter(c => c.type === 'expense' && !c.hidden)
  const inc = cats.filter(c => c.type === 'income' && !c.hidden)
  if (!exp.length || !inc.length) return
  const me = await demoUserId()
  const pd = demo.data.projectData
  Object.assign(pd, { expensesAllowed: true, invoicingAllowed: true, invoicingEnabled: true, invoiceDetails: {
    address: 'Björkvägen 4', zip: '123 45', city: 'Björkby', org_number: '802400-0000', email: 'kassor@bjorkbyif.example', phone: '070-123 45 67',
    bankgiro: '123-4567', swish: '123 456 78 90', payment_days: 30, invoice_prefix: '',
  } })

  // Utlägg och fakturor i inkorgen
  const claim = o => ({ id: `demo-c-${++demo.seq}`, userId: me, registeredBy: null, kind: 'expense', supplier: '', invoiceNo: '', dueDate: null, paymentRef: '', comment: '',
    status: 'submitted', rejectReason: '', decidedAt: null, paidAt: null, paidDate: null, txId: null, createdAt: new Date().toISOString(), ...o,
    lines: o.lines, total: o.lines.reduce((a, l) => a + l.amount, 0) })
  const line = (cat, amount) => ({ categoryId: cat.id, amount, projectId: null })
  demo.claims.push(
    claim({ date: day(-2), description: 'Fika till årsmötet', comment: 'Kaffe, kakor och muggar', lines: [line(exp[0], 640)] }),
    claim({ date: day(-6), description: 'Bensin till materialtransport', status: 'approved', decidedAt: new Date().toISOString(), lines: [line(exp[Math.min(1, exp.length - 1)], 420)] }),
    claim({ date: day(-5), kind: 'invoice', supplier: 'Elbolaget Norr AB', invoiceNo: '2026-4471', dueDate: day(9), paymentRef: 'OCR 1234567890', description: 'El, lokalen', lines: [line(exp[Math.min(2, exp.length - 1)], 1850)] }),
    claim({ date: day(-30), kind: 'invoice', supplier: 'Björkbyns bygdegård', invoiceNo: '118', dueDate: day(-3), paymentRef: 'Bankgiro 555-1234', description: 'Hyra av lokal', lines: [line(exp[Math.min(3, exp.length - 1)], 2500)] }),
  )

  // Kundregister och fakturor
  const cust = (name, o) => ({ id: `demo-k-${++demo.seq}`, name, orgNumber: '', contactPerson: '', email: '', phone: '', address: '', zip: '', city: '', reference: '', note: '', ...o })
  const k1 = cust('Björkbyns Bygg AB', { orgNumber: '556000-1111', email: 'ekonomi@bjorkbygg.example', address: 'Verkstadsgatan 2', zip: '123 46', city: 'Björkby', contactPerson: 'Anna Berg' })
  const k2 = cust('Fjällgården Turism AB', { orgNumber: '556000-2222', email: 'info@fjallgarden.example', address: 'Fjällvägen 9', zip: '123 47', city: 'Björkby' })
  const k3 = cust('Skidklubben Norr', { email: 'kassor@skidnorr.example' })
  demo.customers.push(k1, k2, k3)
  const snap = c => ({ name: c.name, org_number: c.orgNumber, contact_person: c.contactPerson, email: c.email, phone: c.phone, address: c.address, zip: c.zip, city: c.city, reference: c.reference })
  const inv = (c, o) => {
    const lines = o.lines.map(l => ({ ...l, categoryId: inc[0].id, amount: Math.round(l.quantity * l.unitPrice * 100) / 100 }))
    return { id: `demo-i-${++demo.seq}`, customerId: c.id, customer: snap(c), paymentDays: 30, reference: '', note: '', invoiceNo: '', dueDate: null, status: 'draft',
      issuedAt: null, sentAt: null, sentTo: '', sentCount: 0, paidDate: null, txId: null, voidReason: '', createdAt: new Date().toISOString(), ...o,
      lines, total: lines.reduce((a, l) => a + l.amount, 0) }
  }
  const issued = (c, n, offset, o) => inv(c, { status: 'issued', invoiceNo: String(n).padStart(4, '0'), invoiceDate: day(offset), dueDate: day(offset + 30), issuedAt: new Date().toISOString(),
    sentAt: new Date().toISOString(), sentTo: c.email, sentCount: 1, ...o })
  demo.invoices.push(
    issued(k1, 1, -45, { lines: [{ description: 'Annons i klubbtidningen', quantity: 1, unitPrice: 3000 }] }),   // förfallen
    issued(k2, 2, -10, { lines: [{ description: 'Sponsring säsongen', quantity: 1, unitPrice: 5000 }, { description: 'Banderoll vid arenan', quantity: 2, unitPrice: 750 }] }),
    inv(k3, { invoiceDate: day(0), lines: [{ description: 'Bidrag till gemensamt läger', quantity: 4, unitPrice: 400 }] }),
  )
  demo.invSeq = 2

  // Ett makulerat verifikat med ersättare (samma belopp, så summorna är oförändrade)
  const old = demo.data.transactions.find(t => !t.voidedAt && t.categoryId && cats.find(c => c.id === t.categoryId)?.type === 'expense')
  if (old) {
    const other = exp.find(c => c.id !== old.categoryId)
    Object.assign(old, { voidedAt: new Date().toISOString(), voidReason: 'Bokfördes på fel konto' })
    const id = `demo-${++demo.seq}`
    const lines = txLines(old).map((l, i) => ({ ...l, id: `${id}-l${i}`, categoryId: other ? other.id : l.categoryId }))
    demo.data.transactions.push({ ...clone(old), id, voidedAt: null, voidReason: '', replacesId: old.id, categoryId: lines[0].categoryId, lines,
      comment: old.comment, createdAt: old.createdAt })
    demo.data.transactions.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  }
}

const demoStore = {
  async getAll(orgId) {
    // Flera anrop kan komma samtidigt vid start: ladda och fyll på exempeldata bara en gång
    demo.loading ||= (async () => { demo.data = clone(await dbStore.getAll(orgId)); await seedDemo() })()
    await demo.loading
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
    const lines = cleanLines(tx.lines || [{ categoryId: tx.categoryId, amount: tx.amount }]).map((l, i) => ({ ...l, id: `${id}-l${i}` }))
    demo.data.transactions.push({
      id, date: tx.date, description: tx.description, categoryId: lines[0].categoryId,
      amount: sumLines(lines), comment: tx.comment || '', createdAt, lines,
    })
    demo.data.transactions.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    return { ...tx, id, lines, createdAt }
  },
  async updateTransaction(_o, id, updates) {
    if (isTxLocked(demo.data.transactions.find(t => t.id === id))) throw lockedError()
    const lines = updates.lines ? cleanLines(updates.lines) : null
    demo.data.transactions = demo.data.transactions.map(t => t.id === id ? {
      ...t,
      ...Object.fromEntries(['date', 'description', 'categoryId', 'amount', 'comment']
        .filter(k => updates[k] !== undefined).map(k => [k, updates[k]])),
      ...(lines ? { lines, categoryId: lines[0].categoryId, amount: sumLines(lines) } : {}),
    } : t)
    demo.data.transactions.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  },
  async updateLockedTransaction(_o, id, { comment, lineProjects = [] }) {
    demo.data.transactions = demo.data.transactions.map(t => {
      if (t.id !== id) return t
      const byLine = Object.fromEntries(lineProjects.map(l => [l.lineId, l.projectId || null]))
      return { ...t, comment: comment || '', lines: t.lines ? t.lines.map(l => (l.id in byLine ? { ...l, projectId: byLine[l.id] } : l)) : t.lines }
    })
  },
  async voidTransaction(orgId, id, reason, replacement = null) {
    const old = demo.data.transactions.find(t => t.id === id)
    if (!old || old.voidedAt) throw new Error('Verifikatet är redan makulerat.')
    if (!reason?.trim()) throw new Error('Ange en orsak till makuleringen.')
    Object.assign(old, { voidedAt: new Date().toISOString(), voidReason: reason.trim() })
    if (!replacement) return null
    const added = await demoStore.addTransaction(orgId, replacement)
    demo.data.transactions.find(t => t.id === added.id).replacesId = id
    await demoAttachments.copyFolder(orgId, id, added.id)
    return added.id
  },
  async deleteTransaction(_o, id) {
    if (isTxLocked(demo.data.transactions.find(t => t.id === id))) throw new Error('Verifikatet är äldre än 1 timme och kan inte raderas. Makulera det i stället.')
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
    for (const original of files) {
      const file = await optimizeImage(original)
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
  async copyFolder(_o, fromId, toId) {
    demo.files.set(toId, [...(demo.files.get(toId) || []), ...(demo.files.get(fromId) || [])])
  },
  async moveFolder(_o, fromId, toId) {
    demo.files.set(toId, [...(demo.files.get(toId) || []), ...(demo.files.get(fromId) || [])])
    demo.files.delete(fromId)
  },
}

// Utlägg i demoläget: allt sker i minnet. Demoanvändaren är ensam, så reglerna om att inte få godkänna eget utlägg gäller inte här.
const demoUserId = async () => (await supabase.auth.getUser()).data.user?.id
const demoExpenses = {
  async list() { return clone(demo.claims).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) },
  async submit(orgId, claim, files = []) {
    const lines = cleanLines(claim.lines)
    if (!lines.length) throw new Error('Välj konto och ange belopp.')
    const existing = claim.id && demo.claims.find(c => c.id === claim.id)
    const inv = claim.invoice
    const base = { date: claim.date, description: claim.description || '', comment: claim.comment || '', lines, total: sumLines(lines),
      ...(inv ? { kind: 'invoice', supplier: (inv.supplier || '').trim(), invoiceNo: inv.invoiceNo || '', dueDate: inv.dueDate || null, paymentRef: inv.paymentRef || '' } : {}) }
    if (inv && !base.supplier) throw new Error('Ange leverantör.')
    let saved
    if (existing) {
      Object.assign(existing, base, { status: 'submitted', rejectReason: '' })
      saved = existing
    } else {
      saved = { id: `demo-c-${++demo.seq}`, userId: await demoUserId(), kind: 'expense', supplier: '', invoiceNo: '', dueDate: null, paymentRef: '', ...base, status: 'submitted', rejectReason: '',
        createdAt: new Date().toISOString(), decidedAt: null, paidAt: null, paidDate: null, txId: null }
      demo.claims.push(saved)
    }
    if (files.length) await demoAttachments.upload(orgId, claimFolder(saved.id), files)
    return { claim: clone(saved), uploadError: null }
  },
  async decide(_o, id, approve, reason = '') {
    const c = demo.claims.find(x => x.id === id)
    if (!c || c.status !== 'submitted') throw new Error('Utlägget är redan hanterat.')
    if (c.kind === 'invoice' && approve) throw new Error('Fakturor betalas direkt och behöver inte godkännas.')
    if (!approve && !reason.trim()) throw new Error('Ange en anledning till avslaget.')
    Object.assign(c, { status: approve ? 'approved' : 'rejected', rejectReason: approve ? '' : reason.trim(), decidedAt: new Date().toISOString() })
    return clone(c)
  },
  async pay(orgId, id, paidDate) {
    const c = demo.claims.find(x => x.id === id)
    if (!c || c.status !== (c.kind === 'invoice' ? 'submitted' : 'approved')) throw new Error(c?.kind === 'invoice' ? 'Bara fakturor i inkorgen kan markeras som betalda.' : 'Bara godkända utlägg kan markeras som utbetalda.')
    const added = await demoStore.addTransaction(orgId, {
      date: paidDate, description: c.kind === 'invoice' ? (c.description || c.supplier) : c.description,
      comment: c.kind === 'invoice' ? `Faktura från ${c.supplier}${c.invoiceNo ? ` (nr ${c.invoiceNo})` : ''}${c.comment ? ` – ${c.comment}` : ''}` : c.comment,
      lines: c.lines })
    await demoAttachments.moveFolder(orgId, claimFolder(id), added.id)
    Object.assign(c, { status: 'paid', paidAt: new Date().toISOString(), paidDate, txId: added.id })
    return added.id
  },
  async remove(_o, id) {
    demo.claims = demo.claims.filter(c => c.id !== id)
    demo.files.delete(claimFolder(id))
  },
  async notify() {},
  async getSettings() { return { notifySubmitted: true, notifyDecided: true } },
  async setSettings() {},
}


// Fakturering i demoläget: allt i minnet
const demoInvoicing = {
  async listCustomers() { return clone(demo.customers).sort((a, b) => a.name.localeCompare(b.name, 'sv')) },
  async saveCustomer(_o, c) {
    if (!(c.name || '').trim()) throw new Error('Ange kundens namn.')
    const row = { name: c.name.trim(), orgNumber: c.orgNumber || '', contactPerson: c.contactPerson || '', email: c.email || '', phone: c.phone || '',
      address: c.address || '', zip: c.zip || '', city: c.city || '', reference: c.reference || '', note: c.note || '' }
    if (c.id) { demo.customers = demo.customers.map(x => x.id === c.id ? { ...x, ...row } : x); return { id: c.id, ...row } }
    const saved = { id: `demo-k-${++demo.seq}`, ...row }
    demo.customers.push(saved)
    return clone(saved)
  },
  async deleteCustomer(_o, id) { demo.customers = demo.customers.filter(c => c.id !== id) },
  async listInvoices() { return clone(demo.invoices).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) },
  async saveInvoice(_o, inv) {
    const customer = demo.customers.find(c => c.id === inv.customerId)
    if (!customer) throw new Error('Välj en kund.')
    const lines = invoiceLines(inv.lines)
    if (!lines.length) throw new Error('Lägg till minst en fakturarad.')
    const snap = { name: customer.name, org_number: customer.orgNumber, contact_person: customer.contactPerson, email: customer.email, phone: customer.phone,
      address: customer.address, zip: customer.zip, city: customer.city, reference: customer.reference }
    const base = { customerId: customer.id, customer: snap, invoiceDate: inv.invoiceDate, paymentDays: Number(inv.paymentDays), reference: inv.reference || '', note: inv.note || '',
      lines, total: Math.round(lines.reduce((a, l) => a + l.amount, 0) * 100) / 100 }
    const existing = inv.id && demo.invoices.find(x => x.id === inv.id)
    if (existing) {
      if (existing.status !== 'draft') throw new Error('En utfärdad faktura kan inte ändras. Makulera den och skapa en ny.')
      Object.assign(existing, base)
      return clone(existing)
    }
    const saved = { id: `demo-i-${++demo.seq}`, invoiceNo: '', dueDate: null, status: 'draft', issuedAt: null, sentAt: null, sentTo: '', sentCount: 0,
      paidDate: null, txId: null, voidReason: '', createdAt: new Date().toISOString(), ...base }
    demo.invoices.push(saved)
    return clone(saved)
  },
  async issueInvoice(_o, id) {
    const inv = demo.invoices.find(x => x.id === id)
    if (!inv || inv.status !== 'draft') throw new Error('Fakturan är redan utfärdad.')
    const due = new Date(inv.invoiceDate); due.setDate(due.getDate() + inv.paymentDays)
    Object.assign(inv, { status: 'issued', issuedAt: new Date().toISOString(), invoiceNo: String(++demo.invSeq).padStart(4, '0'), dueDate: due.toISOString().slice(0, 10) })
    return clone(inv)
  },
  async payInvoice(orgId, id, paidDate) {
    const inv = demo.invoices.find(x => x.id === id)
    if (!inv || inv.status !== 'issued') throw new Error('Bara utfärdade, obetalda fakturor kan markeras som betalda.')
    const added = await demoStore.addTransaction(orgId, { date: paidDate, description: `Faktura ${inv.invoiceNo} – ${inv.customer.name}`,
      comment: `Betald faktura till ${inv.customer.name}`, lines: inv.lines.map(l => ({ categoryId: l.categoryId, amount: l.amount })) })
    Object.assign(inv, { status: 'paid', paidDate, txId: added.id })
    return added.id
  },
  async voidInvoice(_o, id, reason) {
    const inv = demo.invoices.find(x => x.id === id)
    if (!inv || inv.status !== 'issued') throw new Error('Bara utfärdade, obetalda fakturor kan makuleras.')
    if (!reason?.trim()) throw new Error('Ange en orsak till makuleringen.')
    Object.assign(inv, { status: 'void', voidReason: reason.trim() })
  },
  async deleteInvoice(_o, id) {
    const inv = demo.invoices.find(x => x.id === id)
    if (!inv || inv.status !== 'draft') throw new Error('Bara fakturautkast kan tas bort.')
    demo.invoices = demo.invoices.filter(x => x.id !== id)
  },
  async sendInvoice(_o, id) {
    const inv = demo.invoices.find(x => x.id === id)
    if (!inv?.customer.email) throw new Error('Kunden saknar en giltig e-postadress.')
    Object.assign(inv, { sentAt: new Date().toISOString(), sentTo: inv.customer.email, sentCount: inv.sentCount + 1 })
    return { ok: true, to: inv.customer.email, demo: true }   // i demoläget skickas inget mejl
  },
  async getSettings() { return { enabled: !!demo.data?.projectData?.invoicingEnabled, details: clone(demo.data?.projectData?.invoiceDetails || {}) } },
  async setSettings(_o, { enabled, details }) {
    Object.assign(demo.data.projectData, { invoicingEnabled: !!enabled, invoiceDetails: clone(details || {}) })
  },
}

const withDemo = (real, fake) => new Proxy(real, {
  get: (target, key, receiver) => (demo && key in fake ? fake[key] : Reflect.get(target, key, receiver)),
})
export const store = withDemo(dbStore, demoStore)
export const attachments = withDemo(dbAttachments, demoAttachments)
export const expenses = withDemo(dbExpenses, demoExpenses)
export const invoicing = withDemo(dbInvoicing, demoInvoicing)

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
