// Skapar faktura-PDF (eller faktureringsunderlag om fakturan inte är utfärdad än) med jsPDF
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export const money = v => {
  const [i, d] = Math.abs(Number(v || 0)).toFixed(2).split('.')
  return `${Number(v) < 0 ? '-' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${d}`
}

export function buildInvoicePdf({ invoice, seller }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const isDraft = invoice.status === 'draft'
  const c = invoice.customer || {}
  const s = seller || {}
  const ink = [26, 26, 46]
  const muted = [110, 110, 135]

  doc.setTextColor(...ink)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20)
  doc.text(isDraft ? 'Faktureringsunderlag' : 'Faktura', 14, 22)
  doc.setFontSize(11)
  doc.text(s.name || 'Föreningsbalans', W - 14, 20, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...muted)
  const sellerLines = [s.address, [s.zip, s.city].filter(Boolean).join(' '), s.email, s.phone].filter(Boolean)
  sellerLines.forEach((l, i) => doc.text(l, W - 14, 25 + i * 4.2, { align: 'right' }))

  // Fakturauppgifter
  doc.setTextColor(...ink); doc.setFontSize(10)
  const meta = [
    ['Fakturanummer', invoice.invoice_no || '(tilldelas vid utfärdande)'],
    ['Fakturadatum', invoice.issue_date || '–'],
    ['Förfallodatum', invoice.due_date || '–'],
    ['Er referens', c.reference || '–'],
  ]
  meta.forEach(([k, v], i) => {
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...muted); doc.text(k, 14, 46 + i * 5.5)
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...ink); doc.text(String(v), 48, 46 + i * 5.5)
  })

  // Kund
  doc.setFont('helvetica', 'normal'); doc.setTextColor(...muted); doc.setFontSize(9)
  doc.text('Faktureras till', 120, 46)
  doc.setTextColor(...ink); doc.setFontSize(10)
  const cust = [c.name, c.org_number && `Org.nr ${c.org_number}`, c.address, [c.zip, c.city].filter(Boolean).join(' ')].filter(Boolean)
  cust.forEach((l, i) => { doc.setFont('helvetica', i === 0 ? 'bold' : 'normal'); doc.text(l, 120, 51 + i * 5) })

  autoTable(doc, {
    startY: 82,
    head: [['Beskrivning', 'Antal', 'À-pris (kr)', 'Belopp (kr)']],
    body: (invoice.lines || []).map(l => [l.description, String(l.quantity), money(l.unit_price), money(l.amount)]),
    styles: { fontSize: 10, cellPadding: 2.5, textColor: ink },
    headStyles: { fillColor: ink, textColor: 255 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  })

  let y = doc.lastAutoTable.finalY + 8
  const row = (label, value, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(bold ? 12 : 10); doc.setTextColor(...ink)
    doc.text(label, 120, y); doc.text(value, W - 14, y, { align: 'right' }); y += bold ? 8 : 5.5
  }
  row('Summa exkl. moms', `${money(invoice.amount_excl_vat)} kr`)
  row(`Moms ${Number(invoice.vat_rate)} %`, `${money(invoice.vat_amount)} kr`)
  doc.setDrawColor(...muted); doc.line(120, y - 3, W - 14, y - 3); y += 2
  row('Att betala', `${money(invoice.total)} kr`, true)

  y += 6
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...ink)
  const pay = [
    s.bankgiro && `Bankgiro: ${s.bankgiro}`,
    invoice.invoice_no && `Ange fakturanummer ${invoice.invoice_no} som betalningsreferens.`,
    invoice.due_date && `Betala senast ${invoice.due_date}.`,
  ].filter(Boolean)
  pay.forEach(l => { doc.text(l, 14, y); y += 5 })
  if (invoice.note) { y += 2; doc.setTextColor(...muted); doc.text(doc.splitTextToSize(invoice.note, W - 28), 14, y) }

  // Sidfot
  const H = doc.internal.pageSize.getHeight()
  doc.setFontSize(8); doc.setTextColor(...muted)
  const foot = [s.name, s.org_number && `Org.nr ${s.org_number}`, s.vat_number && `Momsreg.nr ${s.vat_number}`, s.f_skatt && 'Godkänd för F-skatt']
    .filter(Boolean).join('  ·  ')
  doc.text(foot || 'Säljaruppgifter saknas – fyll i under Inställningar i adminportalen', W / 2, H - 12, { align: 'center' })
  if (isDraft) {
    doc.setFontSize(9); doc.text('Underlaget är inte en faktura förrän det utfärdats.', W / 2, H - 8, { align: 'center' })
  }
  return doc
}
