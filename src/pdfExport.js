// pdfExport.js – generates annual report and budget PDF using jsPDF + autoTable
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { fmt, sumByCategory } from './store';

export function exportBudget({ orgName, period, categories, budget } = {}) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();

  const incCats = categories.filter(c => c.type === 'income');
  const expCats = categories.filter(c => c.type === 'expense');
  const totalBudgetIncome  = incCats.reduce((s, c) => s + (budget[c.id] || 0), 0);
  const totalBudgetExpense = expCats.reduce((s, c) => s + (budget[c.id] || 0), 0);
  const netBudget = totalBudgetIncome - totalBudgetExpense;

  const DARK   = [26, 26, 46];
  const GREEN  = [45, 106, 79];
  const RED    = [193, 18, 31];
  const PAPER  = [250, 249, 246];
  const BORDER = [213, 208, 197];

  // ── Cover block ───────────────────────────────────────────
  doc.setFillColor(...DARK);
  doc.rect(0, 0, W, 52, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('times', 'bolditalic');
  doc.setFontSize(26);
  doc.text('Budget', 18, 22);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(180, 180, 210);
  doc.text(orgName.toUpperCase(), 18, 31);

  doc.setFontSize(28);
  doc.setFont('times', 'italic');
  doc.setTextColor(255, 255, 255);
  doc.text(String(period?.label || ''), W - 18, 26, { align: 'right' });

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 160);
  const span = period ? `${period.start} – ${period.end}` : '';
  doc.text(span, W - 18, 36, { align: 'right' });
  doc.text(`Genererad ${new Date().toLocaleDateString('sv-SE')}`, W - 18, 46, { align: 'right' });

  let y = 62;

  // ── Summary cards (2 boxes) ───────────────────────────────
  const cardW = (W - 36 - 4) / 2;
  const cards = [
    { label: 'Budgeterade intäkter', value: fmt(totalBudgetIncome), color: GREEN },
    { label: 'Budgeterade kostnader', value: fmt(totalBudgetExpense), color: RED },
  ];
  cards.forEach((card, i) => {
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

  // ── Section header helper ─────────────────────────────────
  function sectionHeader(title) {
    doc.setFillColor(...DARK);
    doc.rect(18, y, W - 36, 8, 'F');
    doc.setFont('times', 'bolditalic');
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text(title, 22, y + 5.5);
    y += 8;
  }

  sectionHeader('Budgetförslag');

  const incRows = incCats.map(c => [`${c.id}  ${c.name}`, fmt(budget[c.id] || 0)]);
  const expRows = expCats.map(c => [`${c.id}  ${c.name}`, fmt(budget[c.id] || 0)]);

  autoTable(doc, {
    startY: y,
    head: [['Kategori', 'Budget']],
    body: [
      [{ content: 'INTÄKTER', colSpan: 2, styles: { fillColor: [216, 243, 220], textColor: GREEN, fontStyle: 'bold', fontSize: 8 } }],
      ...incRows,
      [{ content: 'Summa intäkter', styles: { fontStyle: 'bold' } }, fmt(totalBudgetIncome)],
      [{ content: 'KOSTNADER', colSpan: 2, styles: { fillColor: [253, 232, 234], textColor: RED, fontStyle: 'bold', fontSize: 8 } }],
      ...expRows,
      [{ content: 'Summa kostnader', styles: { fontStyle: 'bold' } }, fmt(totalBudgetExpense)],
    ],
    foot: [[
      { content: 'NETTORESULTAT', styles: { fontStyle: 'bold' } },
      { content: fmt(netBudget), styles: { fontStyle: 'bold', textColor: netBudget >= 0 ? GREEN : RED } },
    ]],
    headStyles: { fillColor: DARK, fontSize: 8, fontStyle: 'bold' },
    footStyles: { fillColor: [207, 226, 243], textColor: DARK, fontSize: 9 },
    columnStyles: {
      0: { cellWidth: 130 },
      1: { halign: 'right', font: 'courier' },
    },
    styles: { fontSize: 8.5, cellPadding: 3 },
    alternateRowStyles: { fillColor: PAPER },
    margin: { left: 18, right: 18 },
  });

  // ── Footer on each page ───────────────────────────────────
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(160, 160, 180);
    doc.text(`${orgName} · Budget ${period?.label || ''}`, 18, 291);
    doc.text(`Sida ${p} av ${pageCount}`, W - 18, 291, { align: 'right' });
    doc.setDrawColor(...BORDER);
    doc.line(18, 288, W - 18, 288);
  }

  doc.save(`budget_${(period?.label || '').replace(/[^a-zA-Z0-9]/g, '_')}_${orgName.replace(/\s+/g, '_')}.pdf`);
}

export function exportAnnualReport({ orgName, period, transactions, categories, budget, doc: existingDoc } = {}) {
  const doc = existingDoc || new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  // transactions are already filtered for the period by Arsrapport
  const yearTxs = transactions;
  const actuals = sumByCategory(yearTxs, categories);

  const incCats  = categories.filter(c => c.type === 'income');
  const expCats  = categories.filter(c => c.type === 'expense');

  const totalIncome  = incCats.reduce((s, c) => s + (actuals[c.id] || 0), 0);
  const totalExpense = expCats.reduce((s, c) => s + (actuals[c.id] || 0), 0);
  const netResult    = totalIncome - totalExpense;

  const budgetIncome  = incCats.reduce((s, c) => s + (budget[c.id] || 0), 0);
  const budgetExpense = expCats.reduce((s, c) => s + (budget[c.id] || 0), 0);

  const DARK   = [26, 26, 46];
  const GREEN  = [45, 106, 79];
  const RED    = [193, 18, 31];
  const PAPER  = [250, 249, 246];
  const BORDER = [213, 208, 197];

  let y = 0;

  // ── Cover block ───────────────────────────────────────────
  doc.setFillColor(...DARK);
  doc.rect(0, 0, W, 52, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('times', 'bolditalic');
  doc.setFontSize(26);
  doc.text('Årsrapport', 18, 22);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(180, 180, 210);
  doc.text(orgName.toUpperCase(), 18, 31);

  doc.setFontSize(28);
  doc.setFont('times', 'italic');
  doc.setTextColor(255, 255, 255);
  doc.text(String(period?.label || ''), W - 18, 26, { align: 'right' });

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 160);
  const span = period ? `${period.start} – ${period.end}` : '';
  doc.text(span, W - 18, 36, { align: 'right' });
  doc.text(`Genererad ${new Date().toLocaleDateString('sv-SE')}`, W - 18, 46, { align: 'right' });

  y = 62;

  // ── Summary cards (3 boxes) ───────────────────────────────
  const cardW = (W - 36 - 8) / 3;
  const cards = [
    { label: 'Totala intäkter', value: fmt(totalIncome), color: GREEN },
    { label: 'Totala kostnader', value: fmt(totalExpense), color: RED },
    { label: 'Nettoresultat', value: fmt(netResult), color: netResult >= 0 ? GREEN : RED },
  ];
  cards.forEach((card, i) => {
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

  // ── Helper: section header ────────────────────────────────
  function sectionHeader(title) {
    doc.setFillColor(...DARK);
    doc.rect(18, y, W - 36, 8, 'F');
    doc.setFont('times', 'bolditalic');
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text(title, 22, y + 5.5);
    y += 8;
  }

  // ── Resultaträkning ───────────────────────────────────────
  sectionHeader('Resultaträkning');

  const buildRows = (cats, type) => cats
    .filter(c => (actuals[c.id] || 0) !== 0 || (budget[c.id] || 0) !== 0)
    .map(c => {
      const act = actuals[c.id] || 0;
      const bud = budget[c.id] || 0;
      const dev = act - bud;
      return [
        `${c.id}  ${c.name}`,
        bud !== 0 ? fmt(bud) : '–',
        fmt(act),
        bud !== 0 ? fmt(dev) : '–',
      ];
    });

  const incRows = buildRows(incCats, 'income');
  const expRows = buildRows(expCats, 'expense');

  autoTable(doc, {
    startY: y,
    head: [['Kategori', 'Budget', 'Utfall', 'Avvikelse']],
    body: [
      [{ content: 'INTÄKTER', colSpan: 4, styles: { fillColor: [216, 243, 220], textColor: GREEN, fontStyle: 'bold', fontSize: 8 } }],
      ...incRows,
      [{ content: `Summa intäkter`, styles: { fontStyle: 'bold' } }, fmt(budgetIncome), fmt(totalIncome), fmt(totalIncome - budgetIncome)],
      [{ content: 'KOSTNADER', colSpan: 4, styles: { fillColor: [253, 232, 234], textColor: RED, fontStyle: 'bold', fontSize: 8 } }],
      ...expRows,
      [{ content: `Summa kostnader`, styles: { fontStyle: 'bold' } }, fmt(budgetExpense), fmt(totalExpense), fmt(totalExpense - budgetExpense)],
    ],
    foot: [[
      { content: 'NETTORESULTAT', styles: { fontStyle: 'bold' } },
      { content: fmt(budgetIncome - budgetExpense), styles: { fontStyle: 'bold' } },
      { content: fmt(netResult), styles: { fontStyle: 'bold', textColor: netResult >= 0 ? GREEN : RED } },
      { content: fmt(netResult - (budgetIncome - budgetExpense)), styles: { fontStyle: 'bold' } },
    ]],
    headStyles: { fillColor: DARK, fontSize: 8, fontStyle: 'bold' },
    footStyles: { fillColor: [207, 226, 243], textColor: DARK, fontSize: 9 },
    columnStyles: {
      0: { cellWidth: 80 },
      1: { halign: 'right', font: 'courier' },
      2: { halign: 'right', font: 'courier' },
      3: { halign: 'right', font: 'courier' },
    },
    styles: { fontSize: 8.5, cellPadding: 3 },
    alternateRowStyles: { fillColor: PAPER },
    margin: { left: 18, right: 18 },
    didParseCell: (data) => {
      if (data.section === 'body') {
        const txt = typeof data.cell.raw === 'string' ? data.cell.raw : '';
        if (txt.startsWith('-') || txt.startsWith('−')) {
          data.cell.styles.textColor = RED;
        }
        if (data.column.index >= 1) {
          const val = parseFloat((typeof data.cell.raw === 'string' ? data.cell.raw : '').replace(/[^\d.,-]/g, '').replace(',', '.'));
          if (!isNaN(val) && val < 0) data.cell.styles.textColor = RED;
        }
      }
    },
  });

  y = doc.lastAutoTable.finalY + 12;

  // ── Verifikatlista ────────────────────────────────────────
  if (y > 220) { doc.addPage(); y = 18; }

  sectionHeader('Verifikatlista');

  const catMap = Object.fromEntries(categories.map(c => [c.id, c]));
  const sorted = [...yearTxs].sort((a, b) => a.date.localeCompare(b.date));

  autoTable(doc, {
    startY: y,
    head: [['Ver.nr', 'Datum', 'Beskrivning', 'Kategori', 'Inkomst', 'Utgift']],
    body: sorted.map((tx, i) => {
      const cat = catMap[tx.categoryId];
      const isInc = cat?.type === 'income';
      return [
        String(i + 1).padStart(3, '0'),
        tx.date,
        tx.description || '',
        cat ? `${cat.id} ${cat.name}` : tx.categoryId,
        isInc ? fmt(tx.amount) : '',
        !isInc ? fmt(tx.amount) : '',
      ];
    }),
    foot: [[
      '', '', '', 'TOTALT',
      fmt(totalIncome),
      fmt(totalExpense),
    ]],
    headStyles: { fillColor: DARK, fontSize: 8 },
    footStyles: { fillColor: [207, 226, 243], fontStyle: 'bold', fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 14, halign: 'center' },
      1: { cellWidth: 22 },
      2: { cellWidth: 65 },
      3: { cellWidth: 44 },
      4: { halign: 'right', font: 'courier', textColor: GREEN },
      5: { halign: 'right', font: 'courier', textColor: RED },
    },
    styles: { fontSize: 8, cellPadding: 2.5 },
    alternateRowStyles: { fillColor: PAPER },
    margin: { left: 18, right: 18 },
  });

  // ── Footer on each page ───────────────────────────────────
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(160, 160, 180);
    doc.text(`${orgName} · ${period?.label || ''}`, 18, 291);
    doc.text(`Sida ${p} av ${pageCount}`, W - 18, 291, { align: 'right' });
    doc.setDrawColor(...BORDER);
    doc.line(18, 288, W - 18, 288);
  }

  // Only trigger download if not called from zip export (which uses doc.output)
  if (!existingDoc) {
    doc.save(`arsrapport_${(period?.label||'').replace(/[^a-zA-Z0-9]/g,'_')}_${orgName.replace(/\s+/g,'_')}.pdf`);
  }
  return doc;
}
