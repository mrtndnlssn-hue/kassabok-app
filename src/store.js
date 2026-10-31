import { supabase } from './supabase'

export const store = {
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
      categories:     catsRes.data || [],
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

export const attachments = {
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

// ── Formatering ────────────────────────────────────────────────
export function fmt(amount) {
  return new Intl.NumberFormat('sv-SE', {
    style: 'currency', currency: 'SEK', minimumFractionDigits: 2,
  }).format(amount ?? 0)
}
export function fmtDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('sv-SE')
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
