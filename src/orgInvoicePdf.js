// Faktura-PDF för en förenings utgående faktura (föreningen är avsändare). Ingen moms.
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export const money = v => {
  const [i, d] = Math.abs(Number(v || 0)).toFixed(2).split('.')
  return `${Number(v) < 0 ? '-' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${d}`
}

// invoice: { invoiceNo, invoiceDate, dueDate, reference, note, lines, total, status, customer }
// seller:  { name, ...invoice_details }
export function buildOrgInvoicePdf({ invoice, seller }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const isDraft = invoice.status === 'draft'
  const c = invoice.customer || {}
  const s = seller || {}
  const ink = [26, 26, 46]
  const muted = [110, 110, 135]

  doc.setTextColor(...ink)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20)
  doc.text(isDraft ? 'Fakturautkast' : 'Faktura', 14, 22)
  doc.setFontSize(11)
  doc.text(s.name || '', W - 14, 20, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...muted)
  const sellerLines = [s.address, [s.zip, s.city].filter(Boolean).join(' '), s.org_number && `Org.nr ${s.org_number}`, s.email, s.phone].filter(Boolean)
  sellerLines.forEach((l, i) => doc.text(l, W - 14, 25 + i * 4.2, { align: 'right' }))

  doc.setTextColor(...ink); doc.setFontSize(10)
  const meta = [
    ['Fakturanummer', invoice.invoiceNo || '(tilldelas vid utfärdande)'],
    ['Fakturadatum', invoice.invoiceDate || '–'],
    ['Förfallodatum', invoice.dueDate || '–'],
    ['Er referens', invoice.reference || c.reference || '–'],
  ]
  meta.forEach(([k, v], i) => {
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...muted); doc.text(k, 14, 46 + i * 5.5)
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...ink); doc.text(String(v), 48, 46 + i * 5.5)
  })

  doc.setFont('helvetica', 'normal'); doc.setTextColor(...muted); doc.setFontSize(9)
  doc.text('Faktureras till', 120, 46)
  doc.setTextColor(...ink); doc.setFontSize(10)
  const cust = [c.name, c.contact_person && `Att: ${c.contact_person}`, c.org_number && `Org.nr ${c.org_number}`, c.address, [c.zip, c.city].filter(Boolean).join(' ')].filter(Boolean)
  cust.forEach((l, i) => { doc.setFont('helvetica', i === 0 ? 'bold' : 'normal'); doc.text(l, 120, 51 + i * 5) })

  autoTable(doc, {
    startY: 86,
    head: [['Beskrivning', 'Antal', 'À-pris (kr)', 'Belopp (kr)']],
    body: (invoice.lines || []).map(l => [l.description, String(l.quantity).replace('.', ','), money(l.unitPrice), money(l.amount)]),
    styles: { fontSize: 10, cellPadding: 2.5, textColor: ink },
    headStyles: { fillColor: ink, textColor: 255 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  })

  let y = doc.lastAutoTable.finalY + 8
  doc.setDrawColor(...muted); doc.line(120, y - 4, W - 14, y - 4)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...ink)
  doc.text('Att betala', 120, y + 1); doc.text(`${money(invoice.total)} kr`, W - 14, y + 1, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...muted)
  doc.text('Ingen moms tillkommer.', W - 14, y + 6, { align: 'right' })

  y += 16
  doc.setFontSize(10); doc.setTextColor(...ink)
  const pay = [
    s.bankgiro && `Bankgiro: ${s.bankgiro}`,
    s.plusgiro && `Plusgiro: ${s.plusgiro}`,
    s.bank_account && `Bankkonto: ${s.bank_account}`,
    s.swish && `Swish: ${s.swish}`,
    invoice.invoiceNo && `Ange fakturanummer ${invoice.invoiceNo} som betalningsreferens.`,
    invoice.dueDate && `Betala senast ${invoice.dueDate}.`,
  ].filter(Boolean)
  pay.forEach(l => { doc.text(l, 14, y); y += 5 })
  if (invoice.note) { y += 2; doc.setTextColor(...muted); doc.text(doc.splitTextToSize(invoice.note, W - 28), 14, y) }

  doc.setFontSize(8); doc.setTextColor(...muted)
  const foot = [s.name, s.org_number && `Org.nr ${s.org_number}`, s.email].filter(Boolean).join('  ·  ')
  doc.text(foot, W / 2, H - 12, { align: 'center' })
  if (isDraft) { doc.setFontSize(9); doc.text('Utkastet är inte en faktura förrän det utfärdats.', W / 2, H - 8, { align: 'center' }) }
  return doc
}
