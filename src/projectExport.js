// projectExport.js – rapport för ett projekt (eller sektion/event): PDF och Excel över alla räkenskapsperioder
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { fmt as fmtRaw, projectRows, projectTotals, isoDate, fmtDate } from './store';
import { translate as t } from './i18n';

// jsPDF:s standardfonter saknar Unicode-minus
const fmt = v => fmtRaw(v).replace(/−/g, '-');

const DARK   = [26, 26, 46];
const GREEN  = [45, 106, 79];
const RED    = [193, 18, 31];
const PAPER  = [250, 249, 246];
const BORDER = [213, 208, 197];

const slug = s => String(s || 'projekt').trim().replace(/[^\wåäöÅÄÖ-]+/g, '_').replace(/^_+|_+$/g, '') || 'projekt';
const sortCats = cats => [...cats].sort((a, b) => String(a.id).localeCompare(String(b.id), 'sv', { numeric: true }));

function collect({ project, transactions, categories }) {
  const catMap = Object.fromEntries(categories.map(c => [c.id, c]));
  const rows = projectRows(transactions, project.id);
  const totals = projectTotals(transactions, categories, project.id);
  const statusText = project.closed
    ? t('Stängd {datum}', { datum: fmtDate(project.closedAt) || '' }).trim()
    : t('Pågående');
  const span = project.start || project.end ? `${project.start || '…'} – ${project.end || '…'}` : '';
  return { catMap, rows, totals, statusText, span };
}

export function exportProjectPdf({ orgName, project, labelOne, transactions, categories }) {
  const { catMap, rows, totals, statusText, span } = collect({ project, transactions, categories });
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();

  // ── Omslag ────────────────────────────────────────────────
  doc.setFillColor(...DARK);
  doc.rect(0, 0, W, 52, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('times', 'bolditalic');
  doc.setFontSize(22);
  const titleLines = doc.splitTextToSize(project.name, W - 36 - 60).slice(0, 2);
  doc.text(titleLines, 18, 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(180, 180, 210);
  doc.text(String(orgName || '').toUpperCase(), 18, 36);
  doc.setFontSize(9);
  doc.text(`${labelOne} · ${t('Rapport')}`, 18, 43);

  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text(statusText, W - 18, 22, { align: 'right' });
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 160);
  if (span) doc.text(span, W - 18, 31, { align: 'right' });
  doc.text(t('Genererad {datum}', { datum: isoDate() }), W - 18, 46, { align: 'right' });

  let y = 62;
  if (project.description) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 80);
    const lines = doc.splitTextToSize(project.description, W - 36);
    doc.text(lines, 18, y);
    y += lines.length * 4.5 + 6;
  }

  // ── Sammanfattning ────────────────────────────────────────
  const cardW = (W - 36 - 8) / 3;
  [
    { label: t('Totala intäkter'),  value: fmt(totals.income),  color: GREEN },
    { label: t('Totala kostnader'), value: fmt(totals.expense), color: RED },
    { label: t('Resultat'),         value: fmt(totals.net),     color: totals.net >= 0 ? GREEN : RED },
  ].forEach((card, i) => {
    const x = 18 + i * (cardW + 4);
    doc.setFillColor(...PAPER);
    doc.setDrawColor(...BORDER);
    doc.roundedRect(x, y, cardW, 22, 2, 2, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(130, 130, 160);
    doc.text(card.label.toUpperCase(), x + 6, y + 8);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...card.color);
    doc.text(card.value, x + 6, y + 17);
  });
  y += 30;

  function sectionHeader(title) {
    if (y > 255) { doc.addPage(); y = 18; }
    doc.setFillColor(...DARK);
    doc.rect(18, y, W - 36, 8, 'F');
    doc.setFont('times', 'bolditalic');
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text(title, 22, y + 5.5);
    y += 8;
  }

  // ── Per kategori ──────────────────────────────────────────
  sectionHeader(t('Per kategori'));
  const usedCats = sortCats(Object.keys(totals.byCategory).map(id => catMap[id] || { id, name: '', type: 'expense' }));
  autoTable(doc, {
    startY: y,
    head: [[t('Kategori'), { content: t('Intäkt'), styles: { halign: 'right' } }, { content: t('Kostnad'), styles: { halign: 'right' } }]],
    body: usedCats.map(c => [
      `${c.id}  ${c.name}`,
      c.type === 'income' ? fmt(totals.byCategory[c.id]) : '',
      c.type === 'income' ? '' : fmt(totals.byCategory[c.id]),
    ]),
    foot: [[
      { content: t('Summa'), styles: { fontStyle: 'bold' } },
      { content: fmt(totals.income),  styles: { fontStyle: 'bold', halign: 'right', font: 'courier', textColor: GREEN } },
      { content: fmt(totals.expense), styles: { fontStyle: 'bold', halign: 'right', font: 'courier', textColor: RED } },
    ]],
    headStyles: { fillColor: DARK, fontSize: 8, fontStyle: 'bold' },
    footStyles: { fillColor: [207, 226, 243], textColor: DARK, fontSize: 9 },
    showFoot: 'lastPage',
    columnStyles: { 0: { cellWidth: 90 }, 1: { halign: 'right', font: 'courier' }, 2: { halign: 'right', font: 'courier' } },
    styles: { fontSize: 8, cellPadding: 1.8 },
    alternateRowStyles: { fillColor: PAPER },
    margin: { left: 18, right: 18 },
  });
  y = doc.lastAutoTable.finalY + 12;

  // ── Verifikat ─────────────────────────────────────────────
  sectionHeader(t('Verifikat ({n})', { n: totals.count }));
  autoTable(doc, {
    startY: y,
    head: [[t('Datum'), t('Beskrivning'), t('Kategori'), { content: t('Belopp'), styles: { halign: 'right' } }]],
    body: rows.map(({ tx, line }) => {
      const cat = catMap[line.categoryId];
      const isInc = cat?.type === 'income';
      return [
        tx.date,
        tx.description || '–',
        `${line.categoryId}  ${cat?.name || ''}`,
        { content: `${isInc ? '+' : '-'}${fmt(line.amount)}`, styles: { textColor: isInc ? GREEN : RED } },
      ];
    }),
    headStyles: { fillColor: DARK, fontSize: 8, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 22, font: 'courier' }, 1: { cellWidth: 62 }, 2: { cellWidth: 52 }, 3: { halign: 'right', font: 'courier' } },
    styles: { fontSize: 8, cellPadding: 1.8, overflow: 'linebreak' },
    alternateRowStyles: { fillColor: PAPER },
    margin: { left: 18, right: 18 },
  });

  // ── Sidfot ────────────────────────────────────────────────
  const pages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(160, 160, 180);
    doc.text(`${orgName} · ${project.name}`, 18, 291);
    doc.text(t('Sida {p} av {n}', { p, n: pages }), W - 18, 291, { align: 'right' });
    doc.setDrawColor(...BORDER);
    doc.line(18, 288, W - 18, 288);
  }

  doc.save(`${slug(project.name)}_${t('rapport')}.pdf`);
}

export async function buildProjectWorkbook({ orgName, project, labelOne, transactions, categories }) {
  const { catMap, rows, totals, statusText, span } = collect({ project, transactions, categories });
  const MONEY = '#,##0.00;[Red]-#,##0.00';
  const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
  const HEAD_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
  const styleHeader = row => row.eachCell(c => { c.fill = HEAD_FILL; c.font = HEAD_FONT; c.alignment = { vertical: 'middle', wrapText: true }; });
  const toDate = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };

  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Föreningsbalans';
  wb.created = new Date();

  // ── Sammanfattning ──
  const sum = wb.addWorksheet(t('Sammanfattning'));
  sum.columns = [{ width: 26 }, { width: 44 }];
  [
    [t('Förening'), orgName],
    [labelOne, project.name],
    [t('Status'), statusText],
    [t('Period'), span],
    [t('Beskrivning'), project.description || ''],
    [t('Antal verifikat'), totals.count],
    [],
    [t('Summa inkomster (kr)'), totals.income],
    [t('Summa utgifter (kr)'), totals.expense],
    [t('Resultat (kr)'), totals.net],
  ].forEach(r => sum.addRow(r));
  for (let r = 8; r <= 10; r++) sum.getCell(`B${r}`).numFmt = MONEY;
  sum.getColumn(1).font = { bold: true };
  sum.getColumn(2).alignment = { horizontal: 'left', wrapText: true };

  // ── Verifikat ──
  const ws = wb.addWorksheet(t('Verifikat'), { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: t('Datum'), key: 'date', width: 12, style: { numFmt: 'yyyy-mm-dd' } },
    { header: t('Beskrivning'), key: 'desc', width: 40 },
    { header: t('Kategori-ID'), key: 'catId', width: 12 },
    { header: t('Kategori'), key: 'cat', width: 28 },
    { header: t('Typ'), key: 'type', width: 10 },
    { header: t('Inkomst (kr)'), key: 'inc', width: 15, style: { numFmt: MONEY } },
    { header: t('Utgift (kr)'), key: 'exp', width: 15, style: { numFmt: MONEY } },
    { header: t('Kommentar'), key: 'comment', width: 36 },
  ];
  styleHeader(ws.getRow(1));
  for (const { tx, line } of rows) {
    const cat = catMap[line.categoryId];
    const isInc = cat?.type === 'income';
    ws.addRow({
      date: toDate(tx.date), desc: tx.description || '', catId: line.categoryId, cat: cat?.name || '',
      type: cat ? (isInc ? t('Inkomst') : t('Utgift')) : '',
      inc: isInc ? line.amount : null, exp: isInc ? null : line.amount, comment: tx.comment || '',
    });
  }
  const totalRow = ws.addRow({ cat: t('TOTALT'), inc: totals.income, exp: totals.expense });
  totalRow.font = { bold: true };
  totalRow.eachCell({ includeEmpty: true }, c => { c.border = { top: { style: 'thin' } }; });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 8 } };

  // ── Kategorier ──
  const cs = wb.addWorksheet(t('Kategorier'), { views: [{ state: 'frozen', ySplit: 1 }] });
  cs.columns = [
    { header: t('Kategori-ID'), key: 'id', width: 12 },
    { header: t('Kategori'), key: 'name', width: 30 },
    { header: t('Typ'), key: 'type', width: 10 },
    { header: t('Summa (kr)'), key: 'sum', width: 16, style: { numFmt: MONEY } },
  ];
  styleHeader(cs.getRow(1));
  for (const c of sortCats(Object.keys(totals.byCategory).map(id => catMap[id] || { id, name: '', type: 'expense' }))) {
    cs.addRow({ id: c.id, name: c.name, type: c.type === 'income' ? t('Inkomst') : t('Utgift'), sum: totals.byCategory[c.id] });
  }
  return wb;
}

export async function exportProjectExcel(args) {
  const wb = await buildProjectWorkbook(args);
  const buf = await wb.xlsx.writeBuffer();
  return {
    blob: new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename: `${slug(args.project.name)}_${t('rapport')}.xlsx`,
  };
}
