import JSZip from 'jszip'
import { attachments, txsForPeriod, txLines, reviews as reviewsApi, isDemoMode } from './store'
import { supabase } from './supabase'
import { translate as tr } from './i18n'

export function sortPeriodTxs(txs) {
  return [...txs].sort((a, b) =>
    a.date.localeCompare(b.date) || (a.createdAt || '').localeCompare(b.createdAt || ''))
}

export function verFolderName(tx, index) {
  const desc = (tx.description || tr('verifikat')).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 30)
  return `${tr('VER')}${String(index + 1).padStart(3, '0')}_${desc}`
}

function toDate(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

const MONEY = '#,##0.00;[Red]-#,##0.00'
const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } }
const HEAD_FONT = { bold: true, color: { argb: 'FFFFFFFF' } }

function styleHeader(row) {
  row.eachCell(c => { c.fill = HEAD_FILL; c.font = HEAD_FONT; c.alignment = { vertical: 'middle', wrapText: true } })
}

// Verifikatnummer för en period. Makulerade verifikat har egna nummer, så numreringen är sammanhängande
// och en lucka aldrig betyder att något försvunnit. Returnerar { id: nummer }.
export function verNumbers(transactions, voided = []) {
  return Object.fromEntries(sortPeriodTxs([...transactions, ...voided]).map((t, i) => [t.id, i + 1]))
}
const pad3 = n => String(n).padStart(3, '0')

// Revisorns granskning till Excel: vilka verifikat som är granskade och vilka anmärkningar som finns.
// Returnerar null om inget är granskat eller har anmärkningar (då läggs inga kolumner till) eller om datan inte kan hämtas.
export async function loadReviewData(orgId) {
  try {
    const { reviews, remarks } = await reviewsApi.list(orgId)
    if (!reviews.length && !remarks.length) return null
    let names = {}
    if (!isDemoMode()) {
      const { data } = await supabase.rpc('get_org_members_with_email', { p_org_id: orgId })
      names = Object.fromEntries((data || []).map(m => [m.user_id, m.nickname || m.email]))
    }
    return { reviews, remarks, names }
  } catch { return null }   // granskningen är ett tillägg och får aldrig stoppa exporten
}

export async function buildPeriodWorkbook({ orgName, period, transactions, categories, budget, attachmentsByTx, projects = [], projectLabel = '', voided = [], extras = null, review = null }) {
  const catMap = Object.fromEntries(categories.map(c => [c.id, c]))
  const txs = sortPeriodTxs(transactions)
  const voidedTxs = sortPeriodTxs(voided)
  const verNo = verNumbers(transactions, voided)
  const opening = Number(period.openingBalance ?? 0)

  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Föreningsbalans'
  wb.created = new Date()

  // ── Kassabok ──────────────────────────────────────────────
  const ws = wb.addWorksheet(tr('Kassabok'), { views: [{ state: 'frozen', ySplit: 1 }] })
  const maxAtt = Math.max(0, ...txs.map(t => (attachmentsByTx[t.id] || []).length))
  const projectNames = Object.fromEntries(projects.map(p => [p.id, p.name]))
  const hasProjects = txs.some(t => txLines(t).some(l => l.projectId && projectNames[l.projectId]))
  const reviewBy = Object.fromEntries((review?.reviews || []).map(r => [r.txId, r]))
  const remarksBy = {}
  for (const r of review?.remarks || []) (remarksBy[r.txId] ||= []).push(r)
  const who = id => review?.names?.[id] || ''
  const cols = [
    { header: tr('Ver.nr'), key: 'ver', width: 8 },
    { header: tr('Datum'), key: 'date', width: 12, style: { numFmt: 'yyyy-mm-dd' } },
    { header: tr('Beskrivning'), key: 'desc', width: 40 },
    { header: tr('Motpart'), key: 'cp', width: 24 },
    { header: tr('Kategori-ID'), key: 'catId', width: 12 },
    { header: tr('Kategori'), key: 'cat', width: 26 },
    { header: tr('Typ'), key: 'type', width: 10 },
    { header: tr('Inkomst (kr)'), key: 'inc', width: 15, style: { numFmt: MONEY } },
    { header: tr('Utgift (kr)'), key: 'exp', width: 15, style: { numFmt: MONEY } },
    { header: tr('Saldo (kr)'), key: 'bal', width: 15, style: { numFmt: MONEY } },
    ...(hasProjects ? [{ header: projectLabel || 'Projekt', key: 'project', width: 24 }] : []),
    { header: tr('Kommentar'), key: 'comment', width: 36 },
    { header: tr('Registrerad'), key: 'created', width: 18, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
    { header: tr('Antal bilagor'), key: 'attCount', width: 13 },
    ...(review ? [
      { header: tr('Granskad'), key: 'reviewed', width: 11 },
      { header: tr('Granskad av'), key: 'reviewedBy', width: 22 },
      { header: tr('Granskad datum'), key: 'reviewedAt', width: 16, style: { numFmt: 'yyyy-mm-dd' } },
      { header: tr('Öppna anm.'), key: 'openRem', width: 11 },
      { header: tr('Anmärkningar'), key: 'remarks', width: 44 },
    ] : []),
  ]
  for (let i = 0; i < maxAtt; i++) cols.push({ header: `${tr('Bilaga')} ${i + 1}`, key: `att${i}`, width: 34 })
  ws.columns = cols
  styleHeader(ws.getRow(1))

  let balance = opening
  let totalInc = 0
  let totalExp = 0

  if (opening) {
    ws.addRow({ desc: tr('Ingående saldo'), bal: opening }).font = { italic: true }
  }

  // Ett verifikat med flera konton får en rad per konto (samma verifikatnummer);
  // kommentar, registrerad och bilagor står bara på den första raden.
  txs.forEach(tx => {
    const atts = attachmentsByTx[tx.id] || []
    const folder = verFolderName(tx, verNo[tx.id] - 1)
    const replaces = tx.replacesId && verNo[tx.replacesId] ? `${tr('Ersätter')} ${tr('VER')}${pad3(verNo[tx.replacesId])}. ` : ''
    txLines(tx).forEach((line, li) => {
      const cat = catMap[line.categoryId]
      const isInc = cat?.type === 'income'
      const amount = Number(line.amount) || 0
      balance += isInc ? amount : -amount
      if (isInc) totalInc += amount; else totalExp += amount

      const first = li === 0
      const row = ws.addRow({
        ver: pad3(verNo[tx.id]),
        date: toDate(tx.date),
        desc: tx.description || '',
        cp: first ? (tx.counterparty || '') : '',
        catId: line.categoryId,
        cat: cat?.name || '',
        type: cat ? (isInc ? tr('Inkomst') : tr('Utgift')) : '',
        inc: isInc ? amount : null,
        exp: !isInc ? amount : null,
        bal: balance,
        project: projectNames[line.projectId] || '',
        comment: first ? (replaces + (tx.comment || '')) : '',
        created: first && tx.createdAt ? new Date(tx.createdAt) : null,
        attCount: first ? atts.length : null,
        ...(review && first ? {
          reviewed: reviewBy[tx.id] ? tr('Ja') : tr('Nej'),
          reviewedBy: reviewBy[tx.id] ? who(reviewBy[tx.id].by) : '',
          reviewedAt: reviewBy[tx.id] ? new Date(reviewBy[tx.id].at) : null,
          openRem: (remarksBy[tx.id] || []).filter(r => !r.resolvedAt).length,
          remarks: (remarksBy[tx.id] || []).map(r => `${r.resolvedAt ? '✓ ' : ''}${r.text}`).join('\n'),
        } : {}),
      })
      if (review && first && (remarksBy[tx.id] || []).length) row.getCell('remarks').alignment = { wrapText: true, vertical: 'top' }
      if (first) {
        atts.forEach((filename, k) => {
          const cell = row.getCell(`att${k}`)
          cell.value = { text: filename, hyperlink: encodeURI(`${tr('bilagor')}/${folder}/${filename}`) }
          cell.font = { color: { argb: 'FF0563C1' }, underline: true }
        })
      }
    })
  })

  const totalRow = ws.addRow({ catId: '', cat: tr('TOTALT'), inc: totalInc, exp: totalExp, bal: balance })
  totalRow.font = { bold: true }
  totalRow.eachCell({ includeEmpty: true }, c => { c.border = { top: { style: 'thin' } } })
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }

  // ── Sammanfattning ────────────────────────────────────────
  const sum = wb.addWorksheet(tr('Sammanfattning'))
  sum.columns = [{ width: 26 }, { width: 24 }]
  const info = [
    [tr('Förening'), orgName],
    [tr('Räkenskapsperiod'), period.label],
    [tr('Startdatum'), period.start],
    [tr('Slutdatum'), period.end],
    [tr('Status'), period.locked ? tr('Låst') : tr('Öppen')],
    [tr('Antal verifikat'), txs.length],
    [],
    [tr('Ingående saldo (kr)'), opening],
    [tr('Summa inkomster (kr)'), totalInc],
    [tr('Summa utgifter (kr)'), totalExp],
    [tr('Nettoresultat (kr)'), totalInc - totalExp],
    [tr('Utgående saldo (kr)'), opening + totalInc - totalExp],
  ]
  info.forEach(r => sum.addRow(r))
  for (let r = 8; r <= 12; r++) sum.getCell(`B${r}`).numFmt = MONEY
  if (voidedTxs.length) {
    sum.addRow([])
    sum.addRow([tr('Antal makulerade verifikat'), voidedTxs.length])
    sum.addRow([tr('Makulerade verifikat ingår inte i summorna. De redovisas på bladet Makulerade verifikat.')])
  }
  const moneyRows = []
  if (extras?.prev) {
    sum.addRow([])
    moneyRows.push(sum.addRow([`${tr('Nettoresultat föregående år')} (${extras.prev.label}) (kr)`, extras.prev.net]).number)
  }
  const un = extras?.unpaid
  if (un && (un.receivables.length || un.payables.length)) {
    sum.addRow([])
    moneyRows.push(sum.addRow([tr('Fakturor att få in vid periodens slut (kr)'), un.recvTotal]).number)
    moneyRows.push(sum.addRow([tr('Fakturor och utlägg att betala vid periodens slut (kr)'), un.payTotal]).number)
    sum.addRow([tr('Posterna ingår inte i kassarapporten (in- och utbetalningar) och bokförs när de betalas. De listas på bladet Obetalda poster.')])
  }
  moneyRows.forEach(r => { sum.getCell(`B${r}`).numFmt = MONEY })
  sum.getColumn(1).font = { bold: true }
  sum.getColumn(2).alignment = { horizontal: 'left' }

  // ── Kategorier ────────────────────────────────────────────
  const cs = wb.addWorksheet(tr('Kategorier'), { views: [{ state: 'frozen', ySplit: 1 }] })
  cs.columns = [
    { header: tr('Kategori-ID'), key: 'id', width: 12 },
    { header: tr('Kategori'), key: 'name', width: 30 },
    { header: tr('Typ'), key: 'type', width: 10 },
    { header: tr('Utfall (kr)'), key: 'actual', width: 16, style: { numFmt: MONEY } },
    { header: tr('Budget (kr)'), key: 'budget', width: 16, style: { numFmt: MONEY } },
    { header: tr('Avvikelse (kr)'), key: 'diff', width: 16, style: { numFmt: MONEY } },
    ...(extras?.prev ? [{ header: `${tr('Föregående år')} ${extras.prev.label} (kr)`, key: 'prev', width: 20, style: { numFmt: MONEY } }] : []),
  ]
  styleHeader(cs.getRow(1))
  const periodBudget = budget?.[period.id] || {}
  const actuals = {}
  for (const tx of txs) for (const l of txLines(tx)) actuals[l.categoryId] = (actuals[l.categoryId] || 0) + (Number(l.amount) || 0)
  for (const c of [...categories].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    const actual = actuals[c.id] || 0
    const bud = periodBudget[c.id] || 0
    const prevAmt = extras?.prev?.actuals?.[c.id] || 0
    if (!actual && !bud && !prevAmt) continue
    cs.addRow({ id: c.id, name: c.name, type: c.type === 'income' ? tr('Inkomst') : tr('Utgift'), actual, budget: bud, diff: actual - bud, prev: extras?.prev ? prevAmt : undefined })
  }

  // ── Obetalda poster vid periodens slut (upplysning) ──
  if (un && (un.receivables.length || un.payables.length)) {
    const us = wb.addWorksheet(tr('Obetalda poster'), { views: [{ state: 'frozen', ySplit: 1 }] })
    us.columns = [
      { header: tr('Typ'), key: 'type', width: 26 },
      { header: tr('Datum'), key: 'date', width: 12 },
      { header: tr('Avser'), key: 'what', width: 40 },
      { header: tr('Förfaller'), key: 'due', width: 12 },
      { header: tr('Belopp (kr)'), key: 'amount', width: 16, style: { numFmt: MONEY } },
    ]
    styleHeader(us.getRow(1))
    const kind = i => (i.kind === 'expense' ? tr('Utlägg') : tr('Faktura'))
    for (const i of un.receivables) us.addRow({ type: tr('Att få in'), date: i.date, what: `${kind(i)}${i.no ? ' ' + i.no : ''}${i.party ? ' · ' + i.party : ''}`, due: i.due || '', amount: i.amount })
    for (const i of un.payables) us.addRow({ type: tr('Att betala'), date: i.date, what: `${kind(i)}${i.no ? ' ' + i.no : ''}${i.party ? ' · ' + i.party : ''}`, due: i.due || '', amount: i.amount })
  }

  // ── Anmärkningar: en rad per anmärkning, med vem som skrev den och om den är åtgärdad ──
  const periodRemarks = (review?.remarks || []).filter(r => verNo[r.txId])
  if (periodRemarks.length) {
    const rs = wb.addWorksheet(tr('Anmärkningar'), { views: [{ state: 'frozen', ySplit: 1 }] })
    rs.columns = [
      { header: tr('Ver.nr'), key: 'ver', width: 8 },
      { header: tr('Anmärkning'), key: 'text', width: 60 },
      { header: tr('Av'), key: 'by', width: 22 },
      { header: tr('Datum'), key: 'date', width: 12, style: { numFmt: 'yyyy-mm-dd' } },
      { header: tr('Status'), key: 'status', width: 18 },
    ]
    styleHeader(rs.getRow(1))
    periodRemarks.sort((a, b) => verNo[a.txId] - verNo[b.txId] || String(a.createdAt).localeCompare(String(b.createdAt))).forEach(r => {
      const row = rs.addRow({
        ver: pad3(verNo[r.txId]), text: r.text, by: who(r.author), date: new Date(r.createdAt),
        status: r.resolvedAt ? `${tr('Åtgärdad')} ${String(r.resolvedAt).slice(0, 10)}` : tr('Öppen'),
      })
      row.getCell('text').alignment = { wrapText: true, vertical: 'top' }
    })
  }

  // ── Makulerade verifikat: redovisas separat och ingår inte i summorna ──
  if (voidedTxs.length) {
    const vs = wb.addWorksheet(tr('Makulerade verifikat'), { views: [{ state: 'frozen', ySplit: 1 }] })
    vs.columns = [
      { header: tr('Ver.nr'), key: 'ver', width: 8 },
      { header: tr('Datum'), key: 'date', width: 12, style: { numFmt: 'yyyy-mm-dd' } },
      { header: tr('Beskrivning'), key: 'desc', width: 38 },
      { header: tr('Kategori'), key: 'cat', width: 34 },
      { header: tr('Belopp (kr)'), key: 'amount', width: 15, style: { numFmt: MONEY } },
      { header: tr('Registrerad'), key: 'created', width: 18, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
      { header: tr('Makulerad'), key: 'voided', width: 18, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
      { header: tr('Orsak'), key: 'reason', width: 36 },
      { header: tr('Ersatt av'), key: 'by', width: 12 },
      { header: tr('Antal bilagor'), key: 'attCount', width: 13 },
    ]
    styleHeader(vs.getRow(1))
    const replacedBy = Object.fromEntries(transactions.filter(t => t.replacesId).map(t => [t.replacesId, t.id]))
    voidedTxs.forEach(tx => {
      const lines = txLines(tx)
      vs.addRow({
        ver: pad3(verNo[tx.id]), date: toDate(tx.date), desc: tx.description || '',
        cat: lines.map(l => `${l.categoryId} ${catMap[l.categoryId]?.name || ''}`.trim()).join('; '),
        amount: lines.reduce((a, l) => a + (Number(l.amount) || 0), 0),
        created: tx.createdAt ? new Date(tx.createdAt) : null, voided: tx.voidedAt ? new Date(tx.voidedAt) : null,
        reason: tx.voidReason || '', by: replacedBy[tx.id] && verNo[replacedBy[tx.id]] ? `${tr('VER')}${pad3(verNo[replacedBy[tx.id]])}` : '',
        attCount: (attachmentsByTx[tx.id] || []).length,
      })
    })
  }

  return wb
}

// Skapar en ZIP med Excel-filen och alla bilagor för perioden.
// Bilagorna ligger i bilagor/VERxxx_.../ precis som i årsrapportens arkiv-ZIP.
export async function exportPeriodZip({ orgId, orgName, period, transactions, voidedTxs = [], categories, budget, projects = [], projectLabel = '', extras = null, onProgress = () => {} }) {
  const periodTxs = sortPeriodTxs(txsForPeriod(transactions, period))
  const periodVoided = sortPeriodTxs(txsForPeriod(voidedTxs, period))
  const verNo = verNumbers(periodTxs, periodVoided)

  onProgress(tr('Hämtar bilagor…'))
  const attachList = await attachments.listForPeriod(orgId, [...periodTxs, ...periodVoided].map(t => t.id))

  const attachmentsByTx = {}
  for (const a of attachList) (attachmentsByTx[a.txId] ||= []).push(a.filename)

  onProgress(tr('Skapar Excel-fil…'))
  const wb = await buildPeriodWorkbook({ orgName, period, transactions: periodTxs, voided: periodVoided, categories, budget, attachmentsByTx, projects, projectLabel, extras, review: await loadReviewData(orgId) })
  const xlsx = await wb.xlsx.writeBuffer()

  onProgress(tr('Packar ihop ZIP…'))
  const safePeriod = period.label.replace(/[^a-zA-Z0-9_-]/g, '_')
  const zip = new JSZip()
  zip.file(`foreningsbalans_${safePeriod}.xlsx`, xlsx)

  const folderByTx = Object.fromEntries([...periodTxs, ...periodVoided].map(t => [t.id, verFolderName(t, verNo[t.id] - 1)]))
  for (const { txId, filename, blob } of attachList) {
    zip.file(`${tr('bilagor')}/${folderByTx[txId] || txId}/${filename}`, blob)
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  return { blob, filename: `foreningsbalans_export_${safePeriod}.zip` }
}

export async function exportPeriodExcel({ orgId, orgName, period, transactions, voidedTxs = [], categories, budget, projects = [], projectLabel = '', extras = null }) {
  const periodTxs = sortPeriodTxs(txsForPeriod(transactions, period))
  const periodVoided = sortPeriodTxs(txsForPeriod(voidedTxs, period))
  const attachmentsByTx = await attachments.namesByTx(orgId, [...periodTxs, ...periodVoided].map(t => t.id))
  const wb = await buildPeriodWorkbook({ orgName, period, transactions: periodTxs, voided: periodVoided, categories, budget, attachmentsByTx, projects, projectLabel, extras, review: await loadReviewData(orgId) })
  const buf = await wb.xlsx.writeBuffer()
  const safePeriod = period.label.replace(/[^a-zA-Z0-9_-]/g, '_')
  return {
    blob: new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename: `foreningsbalans_${safePeriod}.xlsx`,
  }
}

// Milersättningsrapport som Excel: sammanställning per person, alla resor och (om områden används) per område.
export async function exportTripReportExcel({ orgName, periodLabel, rows }) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Föreningsbalans'
  wb.created = new Date()
  const round2 = n => Math.round(n * 100) / 100
  const STATUS = { submitted: tr('Väntar på godkännande'), approved: tr('Godkänt, ej utbetalt'), paid: tr('Utbetalt') }
  const group = key => {
    const m = new Map()
    for (const r of rows) {
      const g = m.get(r[key]) || { name: r[key], trips: 0, minutes: 0, miles: 0, amount: 0, paid: 0 }
      g.trips++; g.minutes += r.minutes || 0; g.miles = round2(g.miles + r.miles); g.amount = round2(g.amount + r.amount)
      if (r.status === 'paid') g.paid = round2(g.paid + r.amount)
      m.set(r[key], g)
    }
    return [...m.values()]
  }
  const sumSheet = (title, firstHeader, groups) => {
    const ws = wb.addWorksheet(title, { views: [{ state: 'frozen', ySplit: 1 }] })
    ws.columns = [
      { header: firstHeader, key: 'name', width: 30 },
      { header: tr('Antal resor'), key: 'trips', width: 12 },
      { header: tr('Tid (minuter)'), key: 'minutes', width: 14 },
      { header: tr('Mil'), key: 'miles', width: 10 },
      { header: tr('Ersättning (kr)'), key: 'amount', width: 17, style: { numFmt: MONEY } },
      { header: tr('Varav utbetalt (kr)'), key: 'paid', width: 19, style: { numFmt: MONEY } },
      { header: tr('Varav ej utbetalt (kr)'), key: 'unpaid', width: 21, style: { numFmt: MONEY } },
    ]
    styleHeader(ws.getRow(1))
    groups.forEach(g => ws.addRow({ ...g, name: g.name || '–', unpaid: round2(g.amount - g.paid) }))
    const tot = groups.reduce((a, g) => ({ trips: a.trips + g.trips, minutes: a.minutes + g.minutes, miles: round2(a.miles + g.miles), amount: round2(a.amount + g.amount), paid: round2(a.paid + g.paid) }), { trips: 0, minutes: 0, miles: 0, amount: 0, paid: 0 })
    const tr1 = ws.addRow({ name: tr('TOTALT'), ...tot, unpaid: round2(tot.amount - tot.paid) })
    tr1.font = { bold: true }
    tr1.eachCell({ includeEmpty: true }, c => { c.border = { top: { style: 'thin' } } })
    return ws
  }
  const s1 = sumSheet(tr('Sammanställning'), tr('Namn'), group('name'))
  s1.addRow({}); s1.addRow({ name: tr('Förening'), trips: orgName }); s1.addRow({ name: tr('Period'), trips: periodLabel })
  if (rows.some(r => r.area)) sumSheet(tr('Per område'), tr('Område'), group('area'))

  const ws = wb.addWorksheet(tr('Resor'), { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = [
    { header: tr('Namn'), key: 'name', width: 26 },
    { header: tr('Datum'), key: 'date', width: 12, style: { numFmt: 'yyyy-mm-dd' } },
    { header: tr('Område'), key: 'area', width: 18 },
    { header: tr('Tid (minuter)'), key: 'minutes', width: 14 },
    { header: tr('Mil'), key: 'miles', width: 10 },
    { header: tr('Kr per mil'), key: 'rate', width: 12, style: { numFmt: MONEY } },
    { header: tr('Ersättning (kr)'), key: 'amount', width: 17, style: { numFmt: MONEY } },
    { header: tr('Status'), key: 'status', width: 22 },
    { header: tr('Utbetalt'), key: 'paidDate', width: 12, style: { numFmt: 'yyyy-mm-dd' } },
  ]
  styleHeader(ws.getRow(1))
  rows.forEach(r => ws.addRow({ ...r, name: r.name || '–', date: toDate(r.date), status: STATUS[r.status] || r.status, paidDate: r.paidDate ? toDate(r.paidDate) : null }))
  const t2 = ws.addRow({ name: tr('TOTALT'), minutes: rows.reduce((a, r) => a + (r.minutes || 0), 0), miles: round2(rows.reduce((a, r) => a + r.miles, 0)), amount: round2(rows.reduce((a, r) => a + r.amount, 0)) })
  t2.font = { bold: true }
  t2.eachCell({ includeEmpty: true }, c => { c.border = { top: { style: 'thin' } } })
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 9 } }

  const buf = await wb.xlsx.writeBuffer()
  return {
    blob: new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename: `${tr('milersattning')}_${String(periodLabel).replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsx`,
  }
}

export async function exportPeriodVouchers({ orgId, period, transactions, voidedTxs = [], onProgress = () => {} }) {
  const periodTxs = sortPeriodTxs(txsForPeriod(transactions, period))
  const periodVoided = sortPeriodTxs(txsForPeriod(voidedTxs, period))
  const verNo = verNumbers(periodTxs, periodVoided)
  onProgress(tr('Hämtar bilagor…'))
  const attachList = await attachments.listForPeriod(orgId, [...periodTxs, ...periodVoided].map(t => t.id))
  if (!attachList.length) return null

  const folderByTx = Object.fromEntries([...periodTxs, ...periodVoided].map(t => [t.id, verFolderName(t, verNo[t.id] - 1)]))
  const zip = new JSZip()
  for (const { txId, filename, blob } of attachList) {
    zip.file(`${folderByTx[txId] || txId}/${filename}`, blob)
  }
  onProgress(tr('Packar ihop ZIP…'))
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  const safePeriod = period.label.replace(/[^a-zA-Z0-9_-]/g, '_')
  return { blob, filename: `${tr('verifikat')}_${safePeriod}.zip` }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
