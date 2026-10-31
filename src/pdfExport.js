// pdfExport.js – generates annual report and budget PDF using jsPDF + autoTable
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { fmt as fmtRaw, sumByCategory, isoDate } from './store';

// jsPDF:s standardfonter saknar Unicode-minus, så negativa belopp skrivs med vanligt bindestreck
const fmt = v => fmtRaw(v).replace(/−/g, '-');

export function exportBudget({ orgName, period, categories, budget, comments = {} } = {}) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();

  const incCats = categories.filter(c => c.type === 'income' && !c.hidden);
  const expCats = categories.filter(c => c.type === 'expense' && !c.hidden);
  const totalBudgetIncome = incCats.reduce((s, c) => s + (budget[c.id] || 0), 0);
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
  doc.text(`Genererad ${isoDate()}`, W - 18, 46, { align: 'right' });

  let y = 62;

  // ── Summary cards (2 boxes) ───────────────────────────────
  const cardW = (W - 36 - 8) / 3;
  const cards = [
    { label: 'Budgeterade intäkter', value: fmt(totalBudgetIncome), color: GREEN },
    { label: 'Budgeterade kostnader', value: fmt(totalBudgetExpense), color: RED },
    { label: 'Budgeterat netto', value: fmt(netBudget), color: netBudget >= 0 ? GREEN : RED },
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

  const row = c => [`${c.id}  ${c.name}`, fmt(budget[c.id] || 0), comments[c.id] || ''];
  const used = c => (budget[c.id] || 0) !== 0 || !!comments[c.id];
  const incRows = incCats.filter(used).map(row);
  const expRows = expCats.filter(used).map(row);
  const SUM = { fontStyle: 'bold', fillColor: [236, 233, 224] };

  const openingBalance = Number(period?.openingBalance ?? 0);
  const closingBalance = openingBalance + netBudget;

  const tableBase = {
    headStyles: { fillColor: DARK, fontSize: 8, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 70 },
      1: { halign: 'right', font: 'courier', cellWidth: 36 },
      2: { cellWidth: 'auto', fontSize: 7.5 },
    },
    styles: { fontSize: 8, cellPadding: 1.8 },
    alternateRowStyles: { fillColor: PAPER },
    margin: { left: 18, right: 18 },
  };
  const sumRow = (label, total) => [{ content: label, styles: SUM }, { content: fmt(total), styles: SUM }, { content: '', styles: SUM }];

  // Ritar tabellerna på d. Vid splitExpenses börjar kostnaderna på en ny sida.
  function drawTables(d, startY, splitExpenses) {
    autoTable(d, {
      ...tableBase,
      startY,
      head: [['Kategori', 'Budget', 'Kommentar']],
      body: [
        [{ content: 'INTÄKTER', colSpan: 3, styles: { fillColor: [216, 243, 220], textColor: GREEN, fontStyle: 'bold', fontSize: 8 } }],
        ...incRows,
        sumRow('Summa intäkter', totalBudgetIncome),
      ],
    });

    let y2;
    if (splitExpenses) { d.addPage(); y2 = 18; }
    else y2 = d.lastAutoTable.finalY + 3;

    autoTable(d, {
      ...tableBase,
      startY: y2,
      head: splitExpenses ? [['Kategori', 'Budget', 'Kommentar']] : [],
      body: [
        [{ content: 'KOSTNADER', colSpan: 3, styles: { fillColor: [253, 232, 234], textColor: RED, fontStyle: 'bold', fontSize: 8 } }],
        ...expRows,
        sumRow('Summa kostnader', totalBudgetExpense),
      ],
      foot: [[
        { content: 'NETTORESULTAT', styles: { fontStyle: 'bold' } },
        { content: fmt(netBudget), styles: { fontStyle: 'bold', textColor: netBudget >= 0 ? GREEN : RED } },
        '',
      ]],
      footStyles: { fillColor: [207, 226, 243], textColor: DARK, fontSize: 9 },
      showFoot: 'lastPage',
    });

    let y3 = d.lastAutoTable.finalY + 10;
    if (y3 > 245) { d.addPage(); y3 = 18; }
    return y3;
  }

  function drawBalance(d, y3) {
    d.setFillColor(...DARK);
    d.rect(18, y3, W - 36, 8, 'F');
    d.setFont('times', 'bolditalic');
    d.setFontSize(10);
    d.setTextColor(255, 255, 255);
    d.text('Kassabudget', 22, y3 + 5.5);

    autoTable(d, {
      startY: y3 + 8,
      body: [
        ['Ingående saldo', fmt(openingBalance)],
        [{ content: '+ Budgeterade intakter', styles: { textColor: GREEN } }, { content: fmt(totalBudgetIncome), styles: { halign: 'right', font: 'courier', textColor: GREEN } }],
        [{ content: '- Budgeterade kostnader', styles: { textColor: RED } }, { content: fmt(totalBudgetExpense), styles: { halign: 'right', font: 'courier', textColor: RED } }],
      ],
      foot: [[
        { content: 'Beräknad utgående saldo', styles: { fontStyle: 'bold', fontSize: 9 } },
        { content: fmt(closingBalance), styles: { halign: 'right', font: 'courier', fontStyle: 'bold', fontSize: 9, textColor: closingBalance >= 0 ? GREEN : RED } },
      ]],
      columnStyles: { 0: { cellWidth: 106 }, 1: { halign: 'right', font: 'courier' } },
      footStyles: { fillColor: [207, 226, 243], textColor: DARK },
      styles: { fontSize: 8, cellPadding: 1.8 },
      alternateRowStyles: { fillColor: PAPER },
      margin: { left: 18, right: 18 },
    });
  }

  // Provkör på ett tillfälligt dokument: får allt plats på en sida läggs det samman,
  // annars flyttas kostnaderna till sida 2 så att tabellerna inte bryts mitt i.
  const probe = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  drawBalance(probe, drawTables(probe, y, false));
  const split = probe.internal.getNumberOfPages() > 1;

  drawBalance(doc, drawTables(doc, y, split));

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
  const openingBalance = Number(period?.openingBalance ?? 0);
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
  doc.text(`Genererad ${isoDate()}`, W - 18, 46, { align: 'right' });

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
      [{ content: `Summa intäkter`, styles: { fontStyle: 'bold' } }, budgetIncome ? fmt(budgetIncome) : '–', fmt(totalIncome), budgetIncome ? fmt(totalIncome - budgetIncome) : '–'],
      [{ content: 'KOSTNADER', colSpan: 4, styles: { fillColor: [253, 232, 234], textColor: RED, fontStyle: 'bold', fontSize: 8 } }],
      ...expRows,
      [{ content: `Summa kostnader`, styles: { fontStyle: 'bold' } }, budgetExpense ? fmt(budgetExpense) : '–', fmt(totalExpense), budgetExpense ? fmt(totalExpense - budgetExpense) : '–'],
    ],
    foot: [[
      { content: 'NETTORESULTAT', styles: { fontStyle: 'bold' } },
      { content: (budgetIncome || budgetExpense) ? fmt(budgetIncome - budgetExpense) : '–', styles: { fontStyle: 'bold' } },
      { content: fmt(netResult), styles: { fontStyle: 'bold', textColor: netResult >= 0 ? GREEN : RED } },
      { content: (budgetIncome || budgetExpense) ? fmt(netResult - (budgetIncome - budgetExpense)) : '–', styles: { fontStyle: 'bold' } },
    ]],
    headStyles: { fillColor: DARK, fontSize: 8, fontStyle: 'bold' },
    footStyles: { fillColor: [207, 226, 243], textColor: DARK, fontSize: 9 },
    showFoot: 'lastPage',
    columnStyles: {
      0: { cellWidth: 80 },
      1: { halign: 'right', font: 'courier' },
      2: { halign: 'right', font: 'courier' },
      3: { halign: 'right', font: 'courier' },
    },
    styles: { fontSize: 8, cellPadding: 1.8 },
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

  // ── Kassarapport (saldo) ──────────────────────────────────
  if (y > 240) { doc.addPage(); y = 18; }

  sectionHeader('Kassarapport');

  const closingBalance = openingBalance + netResult;
  autoTable(doc, {
    startY: y,
    body: [
      ['Ingående saldo', fmt(openingBalance)],
      [{ content: '+ Intakter', styles: { textColor: GREEN } }, { content: fmt(totalIncome), styles: { halign: 'right', font: 'courier', textColor: GREEN } }],
      [{ content: '- Kostnader', styles: { textColor: RED } }, { content: fmt(totalExpense), styles: { halign: 'right', font: 'courier', textColor: RED } }],
    ],
    foot: [[
      { content: 'Utgående saldo (kontosaldo)', styles: { fontStyle: 'bold', fontSize: 9 } },
      { content: fmt(closingBalance), styles: { halign: 'right', font: 'courier', fontStyle: 'bold', fontSize: 9, textColor: closingBalance >= 0 ? GREEN : RED } },
    ]],
    columnStyles: {
      0: { cellWidth: 120 },
      1: { halign: 'right', font: 'courier' },
    },
    footStyles: { fillColor: [207, 226, 243], textColor: DARK },
    styles: { fontSize: 8.5, cellPadding: 2 },
    alternateRowStyles: { fillColor: PAPER },
    margin: { left: 18, right: 18 },
  });

  // ── Footer on each page ───────────────────────────────────
  const pageCount2 = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount2; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(160, 160, 180);
    doc.text(`${orgName} · ${period?.label || ''}`, 18, 291);
    doc.text(`Sida ${p} av ${pageCount2}`, W - 18, 291, { align: 'right' });
    doc.setDrawColor(...BORDER);
    doc.line(18, 288, W - 18, 288);
  }

  // Only trigger download if not called from zip export (which uses doc.output)
  if (!existingDoc) {
    doc.save(`arsrapport_${(period?.label||'').replace(/[^a-zA-Z0-9]/g,'_')}_${orgName.replace(/\s+/g,'_')}.pdf`);
  }
  return doc;
}
