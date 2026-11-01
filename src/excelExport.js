import JSZip from 'jszip'
import { attachments, txsForPeriod, txLines } from './store'
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

export async function buildPeriodWorkbook({ orgName, period, transactions, categories, budget, attachmentsByTx }) {
  const catMap = Object.fromEntries(categories.map(c => [c.id, c]))
  const txs = sortPeriodTxs(transactions)
  const opening = Number(period.openingBalance ?? 0)

  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Föreningsbalans'
  wb.created = new Date()

  // ── Kassabok ──────────────────────────────────────────────
  const ws = wb.addWorksheet(tr('Kassabok'), { views: [{ state: 'frozen', ySplit: 1 }] })
  const maxAtt = Math.max(0, ...txs.map(t => (attachmentsByTx[t.id] || []).length))
  const cols = [
    { header: tr('Ver.nr'), key: 'ver', width: 8 },
    { header: tr('Datum'), key: 'date', width: 12, style: { numFmt: 'yyyy-mm-dd' } },
    { header: tr('Beskrivning'), key: 'desc', width: 40 },
    { header: tr('Kategori-ID'), key: 'catId', width: 12 },
    { header: tr('Kategori'), key: 'cat', width: 26 },
    { header: tr('Typ'), key: 'type', width: 10 },
    { header: tr('Inkomst (kr)'), key: 'inc', width: 15, style: { numFmt: MONEY } },
    { header: tr('Utgift (kr)'), key: 'exp', width: 15, style: { numFmt: MONEY } },
    { header: tr('Saldo (kr)'), key: 'bal', width: 15, style: { numFmt: MONEY } },
    { header: tr('Kommentar'), key: 'comment', width: 36 },
    { header: tr('Registrerad'), key: 'created', width: 18, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
    { header: tr('Antal bilagor'), key: 'attCount', width: 13 },
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
  txs.forEach((tx, i) => {
    const atts = attachmentsByTx[tx.id] || []
    const folder = verFolderName(tx, i)
    txLines(tx).forEach((line, li) => {
      const cat = catMap[line.categoryId]
      const isInc = cat?.type === 'income'
      const amount = Number(line.amount) || 0
      balance += isInc ? amount : -amount
      if (isInc) totalInc += amount; else totalExp += amount

      const first = li === 0
      const row = ws.addRow({
        ver: String(i + 1).padStart(3, '0'),
        date: toDate(tx.date),
        desc: tx.description || '',
        catId: line.categoryId,
        cat: cat?.name || '',
        type: cat ? (isInc ? tr('Inkomst') : tr('Utgift')) : '',
        inc: isInc ? amount : null,
        exp: !isInc ? amount : null,
        bal: balance,
        comment: first ? (tx.comment || '') : '',
        created: first && tx.createdAt ? new Date(tx.createdAt) : null,
        attCount: first ? atts.length : null,
      })
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
  ]
  styleHeader(cs.getRow(1))
  const periodBudget = budget?.[period.id] || {}
  const actuals = {}
  for (const tx of txs) for (const l of txLines(tx)) actuals[l.categoryId] = (actuals[l.categoryId] || 0) + (Number(l.amount) || 0)
  for (const c of [...categories].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    const actual = actuals[c.id] || 0
    const bud = periodBudget[c.id] || 0
    if (!actual && !bud) continue
    cs.addRow({ id: c.id, name: c.name, type: c.type === 'income' ? tr('Inkomst') : tr('Utgift'), actual, budget: bud, diff: actual - bud })
  }

  return wb
}

// Skapar en ZIP med Excel-filen och alla bilagor för perioden.
// Bilagorna ligger i bilagor/VERxxx_.../ precis som i årsrapportens arkiv-ZIP.
export async function exportPeriodZip({ orgId, orgName, period, transactions, categories, budget, onProgress = () => {} }) {
  const periodTxs = sortPeriodTxs(txsForPeriod(transactions, period))

  onProgress(tr('Hämtar bilagor…'))
  const attachList = await attachments.listForPeriod(orgId, periodTxs.map(t => t.id))

  const attachmentsByTx = {}
  for (const a of attachList) (attachmentsByTx[a.txId] ||= []).push(a.filename)

  onProgress(tr('Skapar Excel-fil…'))
  const wb = await buildPeriodWorkbook({ orgName, period, transactions: periodTxs, categories, budget, attachmentsByTx })
  const xlsx = await wb.xlsx.writeBuffer()

  onProgress(tr('Packar ihop ZIP…'))
  const safePeriod = period.label.replace(/[^a-zA-Z0-9_-]/g, '_')
  const zip = new JSZip()
  zip.file(`foreningsbalans_${safePeriod}.xlsx`, xlsx)

  const folderByTx = Object.fromEntries(periodTxs.map((t, i) => [t.id, verFolderName(t, i)]))
  for (const { txId, filename, blob } of attachList) {
    zip.file(`${tr('bilagor')}/${folderByTx[txId] || txId}/${filename}`, blob)
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  return { blob, filename: `foreningsbalans_export_${safePeriod}.zip` }
}

export async function exportPeriodExcel({ orgId, orgName, period, transactions, categories, budget }) {
  const periodTxs = sortPeriodTxs(txsForPeriod(transactions, period))
  const attachmentsByTx = await attachments.namesByTx(orgId, periodTxs.map(t => t.id))
  const wb = await buildPeriodWorkbook({ orgName, period, transactions: periodTxs, categories, budget, attachmentsByTx })
  const buf = await wb.xlsx.writeBuffer()
  const safePeriod = period.label.replace(/[^a-zA-Z0-9_-]/g, '_')
  return {
    blob: new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename: `foreningsbalans_${safePeriod}.xlsx`,
  }
}

export async function exportPeriodVouchers({ orgId, period, transactions, onProgress = () => {} }) {
  const periodTxs = sortPeriodTxs(txsForPeriod(transactions, period))
  onProgress(tr('Hämtar bilagor…'))
  const attachList = await attachments.listForPeriod(orgId, periodTxs.map(t => t.id))
  if (!attachList.length) return null

  const folderByTx = Object.fromEntries(periodTxs.map((t, i) => [t.id, verFolderName(t, i)]))
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
