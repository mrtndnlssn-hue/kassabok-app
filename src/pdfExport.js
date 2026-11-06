// pdfExport.js – generates annual report and budget PDF using jsPDF + autoTable
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { fmt as fmtRaw, sumByCategory, isoDate, txLines } from './store';
import { translate as t } from './i18n';

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
  doc.text(t('Budget'), 18, 22);

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
  doc.text(t('Genererad {datum}', { datum: isoDate() }), W - 18, 46, { align: 'right' });

  let y = 62;

  // ── Summary cards (2 boxes) ───────────────────────────────
  const cardW = (W - 36 - 8) / 3;
  const cards = [
    { label: t('Budgeterade intäkter'), value: fmt(totalBudgetIncome), color: GREEN },
    { label: t('Budgeterade kostnader'), value: fmt(totalBudgetExpense), color: RED },
    { label: t('Budgeterat netto'), value: fmt(netBudget), color: netBudget >= 0 ? GREEN : RED },
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

  sectionHeader(t('Budgetförslag'));

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
      head: [[t('Kategori'), t('Budget'), t('Kommentar')]],
      body: [
        [{ content: t('INTÄKTER'), colSpan: 3, styles: { fillColor: [216, 243, 220], textColor: GREEN, fontStyle: 'bold', fontSize: 8 } }],
        ...incRows,
        sumRow(t('Summa intäkter'), totalBudgetIncome),
      ],
    });

    let y2;
    if (splitExpenses) { d.addPage(); y2 = 18; }
    else y2 = d.lastAutoTable.finalY + 3;

    autoTable(d, {
      ...tableBase,
      startY: y2,
      head: splitExpenses ? [[t('Kategori'), t('Budget'), t('Kommentar')]] : [],
      body: [
        [{ content: t('KOSTNADER'), colSpan: 3, styles: { fillColor: [253, 232, 234], textColor: RED, fontStyle: 'bold', fontSize: 8 } }],
        ...expRows,
        sumRow(t('Summa kostnader'), totalBudgetExpense),
      ],
      foot: [[
        { content: t('NETTORESULTAT'), styles: { fontStyle: 'bold' } },
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
    d.text(t('Kassabudget'), 22, y3 + 5.5);

    autoTable(d, {
      startY: y3 + 8,
      body: [
        [t('Ingående saldo'), fmt(openingBalance)],
        [{ content: t('+ Budgeterade intakter'), styles: { textColor: GREEN } }, { content: fmt(totalBudgetIncome), styles: { halign: 'right', font: 'courier', textColor: GREEN } }],
        [{ content: t('- Budgeterade kostnader'), styles: { textColor: RED } }, { content: fmt(totalBudgetExpense), styles: { halign: 'right', font: 'courier', textColor: RED } }],
      ],
      foot: [[
        { content: t('Beräknad utgående saldo'), styles: { fontStyle: 'bold', fontSize: 9 } },
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
    doc.text(`${orgName} · ${t('Budget')} ${period?.label || ''}`, 18, 291);
    doc.text(t('Sida {p} av {n}', { p, n: pageCount }), W - 18, 291, { align: 'right' });
    doc.setDrawColor(...BORDER);
    doc.line(18, 288, W - 18, 288);
  }

  doc.save(`budget_${(period?.label || '').replace(/[^a-zA-Z0-9]/g, '_')}_${orgName.replace(/\s+/g, '_')}.pdf`);
}

export function exportAnnualReport({ orgName, period, transactions, voided = [], categories, budget, extras = null, doc: existingDoc } = {}) {
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

  // Föregående år som jämförelse, och poster som inte betalats vid periodens slut
  const prev = extras?.prev || null;
  const prevAct = prev?.actuals || {};
  const unpaid = extras?.unpaid || null;
  const ncol = prev ? 5 : 4;

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
  doc.text(t('Årsrapport'), 18, 22);

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
  doc.text(t('Genererad {datum}', { datum: isoDate() }), W - 18, 46, { align: 'right' });

  y = 62;

  // ── Summary cards (3 boxes) ───────────────────────────────
  const cardW = (W - 36 - 8) / 3;
  const cards = [
    { label: t('Totala intäkter'), value: fmt(totalIncome), color: GREEN },
    { label: t('Totala kostnader'), value: fmt(totalExpense), color: RED },
    { label: t('Nettoresultat'), value: fmt(netResult), color: netResult >= 0 ? GREEN : RED },
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
  sectionHeader(t('Resultaträkning'));

  const buildRows = (cats) => cats
    .filter(c => (actuals[c.id] || 0) !== 0 || (budget[c.id] || 0) !== 0 || (prevAct[c.id] || 0) !== 0)
    .map(c => {
      const act = actuals[c.id] || 0;
      const bud = budget[c.id] || 0;
      const dev = act - bud;
      return [
        `${c.id}  ${c.name}`,
        bud !== 0 ? fmt(bud) : '–',
        fmt(act),
        bud !== 0 ? fmt(dev) : '–',
        ...(prev ? [(prevAct[c.id] || 0) !== 0 ? fmt(prevAct[c.id]) : '–'] : []),
      ];
    });

  const incRows = buildRows(incCats);
  const expRows = buildRows(expCats);
  const prevNet = prev ? prev.income - prev.expense : 0;
  const bold = { fontStyle: 'bold' };

  autoTable(doc, {
    startY: y,
    head: [[t('Kategori'), t('Budget'), t('Utfall'), t('Avvikelse'), ...(prev ? [`${t('Föreg. år')} ${prev.label}`] : [])]],
    body: [
      [{ content: t('INTÄKTER'), colSpan: ncol, styles: { fillColor: [216, 243, 220], textColor: GREEN, fontStyle: 'bold', fontSize: 8 } }],
      ...incRows,
      [{ content: t('Summa intäkter'), styles: bold }, budgetIncome ? fmt(budgetIncome) : '–', fmt(totalIncome), budgetIncome ? fmt(totalIncome - budgetIncome) : '–', ...(prev ? [fmt(prev.income)] : [])],
      [{ content: t('KOSTNADER'), colSpan: ncol, styles: { fillColor: [253, 232, 234], textColor: RED, fontStyle: 'bold', fontSize: 8 } }],
      ...expRows,
      [{ content: t('Summa kostnader'), styles: bold }, budgetExpense ? fmt(budgetExpense) : '–', fmt(totalExpense), budgetExpense ? fmt(totalExpense - budgetExpense) : '–', ...(prev ? [fmt(prev.expense)] : [])],
    ],
    foot: [[
      { content: t('NETTORESULTAT'), styles: bold },
      { content: (budgetIncome || budgetExpense) ? fmt(budgetIncome - budgetExpense) : '–', styles: bold },
      { content: fmt(netResult), styles: { fontStyle: 'bold', textColor: netResult >= 0 ? GREEN : RED } },
      { content: (budgetIncome || budgetExpense) ? fmt(netResult - (budgetIncome - budgetExpense)) : '–', styles: bold },
      ...(prev ? [{ content: fmt(prevNet), styles: bold }] : []),
    ]],
    headStyles: { fillColor: DARK, fontSize: 8, fontStyle: 'bold' },
    footStyles: { fillColor: [207, 226, 243], textColor: DARK, fontSize: 9 },
    showFoot: 'lastPage',
    columnStyles: {
      0: { cellWidth: prev ? 62 : 80 },
      1: { halign: 'right', font: 'courier' },
      2: { halign: 'right', font: 'courier' },
      3: { halign: 'right', font: 'courier' },
      4: { halign: 'right', font: 'courier' },
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

  sectionHeader(t('Kassarapport'));

  const closingBalance = openingBalance + netResult;
  autoTable(doc, {
    startY: y,
    body: [
      [t('Ingående saldo'), fmt(openingBalance)],
      [{ content: t('+ Intakter'), styles: { textColor: GREEN } }, { content: fmt(totalIncome), styles: { halign: 'right', font: 'courier', textColor: GREEN } }],
      [{ content: t('- Kostnader'), styles: { textColor: RED } }, { content: fmt(totalExpense), styles: { halign: 'right', font: 'courier', textColor: RED } }],
    ],
    foot: [[
      { content: t('Utgående saldo (kontosaldo)'), styles: { fontStyle: 'bold', fontSize: 9 } },
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

  // ── Poster som inte betalats vid periodens slut: ingår inte i kassarapporten (kontantmetoden) men redovisas som upplysning ──
  if (unpaid && (unpaid.receivables.length || unpaid.payables.length)) {
    y = doc.lastAutoTable.finalY + 12;
    if (y > 200) { doc.addPage(); y = 18; }
    sectionHeader(t('Poster som inte betalats vid periodens slut'));
    const kindLabel = i => `${i.kind === 'expense' ? t('Utlägg') : t('Faktura')}${i.no ? ' ' + i.no : ''}${i.party ? ' · ' + i.party : ''}`;
    const group = (title, items, total, fill, color) => items.length ? [
      [{ content: title, colSpan: 4, styles: { fillColor: fill, textColor: color, fontStyle: 'bold', fontSize: 8 } }],
      ...items.map(i => [i.date, kindLabel(i), i.due || '–', fmt(i.amount)]),
      [{ content: t('Summa'), colSpan: 3, styles: { fontStyle: 'bold' } }, { content: fmt(total), styles: { fontStyle: 'bold' } }],
    ] : [];
    autoTable(doc, {
      startY: y,
      head: [[t('Datum'), t('Avser'), t('Förfaller'), t('Belopp')]],
      body: [
        ...group(t('Att få in (utgående fakturor)'), unpaid.receivables, unpaid.recvTotal, [216, 243, 220], GREEN),
        ...group(t('Att betala (fakturor och utlägg)'), unpaid.payables, unpaid.payTotal, [253, 232, 234], RED),
      ],
      foot: [[{ content: t('Posterna ingår inte i kassarapporten, som bygger på in- och utbetalningar. De bokförs när de betalas.'), colSpan: 4, styles: { fontStyle: 'italic', fontSize: 7.5 } }]],
      headStyles: { fillColor: [207, 226, 243], textColor: DARK, fontSize: 8 },
      footStyles: { fillColor: [255, 255, 255], textColor: [110, 110, 135] },
      columnStyles: { 3: { halign: 'right', font: 'courier' } },
      styles: { fontSize: 8, cellPadding: 2 },
      alternateRowStyles: { fillColor: PAPER },
      margin: { left: 18, right: 18 },
    });
  }

  // ── Makulerade verifikat: ingår inte i summorna men redovisas, så att verifikationskedjan är obruten ──
  if (voided.length) {
    y = doc.lastAutoTable.finalY + 12;
    if (y > 225) { doc.addPage(); y = 18; }
    sectionHeader(t('Makulerade verifikat'));
    autoTable(doc, {
      startY: y,
      head: [[t('Datum'), t('Beskrivning'), t('Belopp'), t('Orsak'), t('Makulerad')]],
      body: [...voided].sort((a, b) => a.date.localeCompare(b.date)).map(tx => [
        tx.date, tx.description || '–', fmt(Number(tx.amount) || 0), tx.voidReason || '–', String(tx.voidedAt || '').slice(0, 10),
      ]),
      foot: [[{ content: t('Makulerade verifikat ingår inte i summorna i rapporten.'), colSpan: 5, styles: { fontStyle: 'italic', fontSize: 7.5 } }]],
      headStyles: { fillColor: [207, 226, 243], textColor: DARK, fontSize: 8 },
      footStyles: { fillColor: [255, 255, 255], textColor: [110, 110, 135] },
      columnStyles: { 2: { halign: 'right', font: 'courier' } },
      styles: { fontSize: 8, cellPadding: 2 },
      alternateRowStyles: { fillColor: PAPER },
      margin: { left: 18, right: 18 },
    });
  }

  // ── Footer on each page ───────────────────────────────────
  const pageCount2 = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount2; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(160, 160, 180);
    doc.text(`${orgName} · ${period?.label || ''}`, 18, 291);
    doc.text(t('Sida {p} av {n}', { p, n: pageCount2 }), W - 18, 291, { align: 'right' });
    doc.setDrawColor(...BORDER);
    doc.line(18, 288, W - 18, 288);
  }

  // Only trigger download if not called from zip export (which uses doc.output)
  if (!existingDoc) {
    doc.save(`${t('arsrapport')}_${(period?.label||'').replace(/[^a-zA-Z0-9]/g,'_')}_${orgName.replace(/\s+/g,'_')}.pdf`);
  }
  return doc;
}


// Verifikationslista för revisorn: alla verifikat i perioden med motpart, kategori, belopp, bilagor och granskningsstatus,
// följt av anmärkningarna. Makulerade verifikat är med och är markerade.
export function exportVoucherList({ orgName, period, transactions, voided = [], categories, verNo = {}, attachmentsByTx = {}, reviews = [], remarks = [], names = {} } = {}) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const DARK = [26, 26, 46], GREEN = [45, 106, 79], RED = [193, 18, 31], PAPER = [250, 249, 246], BORDER = [213, 208, 197];
  const pad3 = n => String(n || 0).padStart(3, '0');
  const catMap = Object.fromEntries(categories.map(c => [c.id, c]));
  const reviewBy = Object.fromEntries(reviews.map(r => [r.txId, r]));
  const remarksBy = {};
  for (const r of remarks) (remarksBy[r.txId] ||= []).push(r);
  const all = [...transactions, ...voided].sort((a, b) => (verNo[a.id] || 0) - (verNo[b.id] || 0));
  const inPeriod = new Set(all.map(x => x.id));
  const periodRemarks = remarks.filter(r => inPeriod.has(r.txId));
  const reviewedCount = all.filter(x => !x.voidedAt && reviewBy[x.id]).length;
  const activeCount = all.filter(x => !x.voidedAt).length;
  const openCount = periodRemarks.filter(r => !r.resolvedAt).length;
  const day = iso => String(iso || '').slice(0, 10);

  doc.setFillColor(...DARK);
  doc.rect(0, 0, W, 34, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('times', 'bolditalic');
  doc.setFontSize(22);
  doc.text(t('Verifikationslista'), 18, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(180, 180, 210);
  doc.text(String(orgName || '').toUpperCase(), 18, 24);
  doc.setFontSize(18);
  doc.setFont('times', 'italic');
  doc.setTextColor(255, 255, 255);
  doc.text(String(period?.label || ''), W - 18, 16, { align: 'right' });
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(150, 150, 190);
  doc.text(`${period?.start || ''} – ${period?.end || ''}`, W - 18, 22, { align: 'right' });
  doc.text(t('Genererad {datum}', { datum: isoDate() }), W - 18, 28, { align: 'right' });

  doc.setTextColor(...DARK);
  doc.setFontSize(9);
  doc.text(`${t('Antal verifikat')}: ${activeCount}   ·   ${t('Granskade')}: ${reviewedCount}   ·   ${t('Inte granskade')}: ${activeCount - reviewedCount}   ·   ${t('Öppna anmärkningar')}: ${openCount}`, 18, 42);

  const rows = all.map(tx => {
    const lines = txLines(tx);
    const first = catMap[lines[0]?.categoryId];
    const sign = first?.type === 'income' ? 1 : -1;
    const rev = reviewBy[tx.id];
    const nOpen = (remarksBy[tx.id] || []).filter(r => !r.resolvedAt).length;
    return [
      pad3(verNo[tx.id]),
      tx.date,
      `${tx.description || '–'}${tx.counterparty ? '\n' + tx.counterparty : ''}${tx.voidedAt ? '\n(' + t('Makulerat') + ')' : ''}`,
      `${first ? first.id + ' ' + first.name : ''}${lines.length > 1 ? ` (+${lines.length - 1})` : ''}`,
      fmt(sign * (Number(tx.amount) || 0)),
      (attachmentsByTx[tx.id] || []).join(', ') || '–',
      rev ? `${day(rev.at)}${names[rev.by] ? ' ' + names[rev.by] : ''}` : (tx.voidedAt ? '–' : t('Nej')),
      nOpen ? String(nOpen) : '',
    ];
  });

  autoTable(doc, {
    startY: 47,
    head: [[t('Ver.'), t('Datum'), t('Beskrivning och motpart'), t('Kategori'), t('Belopp'), t('Bilagor'), t('Granskad'), t('Öppna anm.')]],
    body: rows,
    headStyles: { fillColor: DARK, fontSize: 8 },
    columnStyles: { 0: { cellWidth: 12 }, 1: { cellWidth: 22 }, 2: { cellWidth: 70 }, 3: { cellWidth: 48 }, 4: { halign: 'right', font: 'courier', cellWidth: 26 }, 5: { cellWidth: 40 }, 6: { cellWidth: 30 }, 7: { halign: 'center', cellWidth: 12 } },
    styles: { fontSize: 7.5, cellPadding: 1.6, overflow: 'linebreak' },
    alternateRowStyles: { fillColor: PAPER },
    margin: { left: 18, right: 18 },
    didParseCell: data => {
      if (data.section === 'body' && all[data.row.index]?.voidedAt) data.cell.styles.textColor = [140, 140, 160];
      if (data.section === 'body' && data.column.index === 6 && data.cell.raw === t('Nej')) data.cell.styles.textColor = RED;
      if (data.section === 'body' && data.column.index === 6 && data.cell.raw !== t('Nej') && data.cell.raw !== '–') data.cell.styles.textColor = GREEN;
    },
  });

  if (periodRemarks.length) {
    let y = doc.lastAutoTable.finalY + 12;
    if (y > 165) { doc.addPage(); y = 18; }
    doc.setFillColor(...DARK);
    doc.rect(18, y, W - 36, 8, 'F');
    doc.setFont('times', 'bolditalic');
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text(t('Anmärkningar'), 22, y + 5.5);
    autoTable(doc, {
      startY: y + 8,
      head: [[t('Ver.'), t('Anmärkning'), t('Av'), t('Skapad'), t('Status')]],
      body: periodRemarks.map(r => [pad3(verNo[r.txId]), r.text, names[r.author] || '–', day(r.createdAt), r.resolvedAt ? `${t('Åtgärdad')} ${day(r.resolvedAt)}` : t('Öppen')]),
      headStyles: { fillColor: [207, 226, 243], textColor: DARK, fontSize: 8 },
      columnStyles: { 0: { cellWidth: 12 }, 1: { cellWidth: 130 }, 2: { cellWidth: 40 }, 3: { cellWidth: 24 } },
      styles: { fontSize: 8, cellPadding: 1.8, overflow: 'linebreak' },
      alternateRowStyles: { fillColor: PAPER },
      margin: { left: 18, right: 18 },
    });
  }

  const pages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(160, 160, 180);
    doc.text(`${orgName} · ${period?.label || ''}`, 18, 204);
    doc.text(t('Sida {p} av {n}', { p, n: pages }), W - 18, 204, { align: 'right' });
    doc.setDrawColor(...BORDER);
    doc.line(18, 201, W - 18, 201);
  }
  doc.save(`${t('verifikationslista')}_${(period?.label || '').replace(/[^a-zA-Z0-9]/g, '_')}_${String(orgName || '').replace(/\s+/g, '_')}.pdf`);
  return doc;
}

// Milersättningsrapport: sammanställning per person och sedan en tabell per person i samma form som blanketten
// (datum, område, tid, mil, ersättning). Rader är de som tripReportRows ger.
export function exportTripReport({ orgName, periodLabel, rows, onlyPaid = false } = {}) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const DARK = [26, 26, 46], PAPER = [250, 249, 246], BORDER = [213, 208, 197];
  const round2 = n => Math.round(n * 100) / 100;
  const mil = n => String(round2(n)).replace('.', ',');
  const STATUS = { submitted: t('Väntar på godkännande'), approved: t('Godkänt, ej utbetalt'), paid: t('Utbetalt') };

  doc.setFillColor(...DARK);
  doc.rect(0, 0, W, 32, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('times', 'bolditalic');
  doc.setFontSize(21);
  doc.text(t('Milersättning'), 18, 15);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(180, 180, 210);
  doc.text(String(orgName || '').toUpperCase(), 18, 23);
  doc.setFont('times', 'italic');
  doc.setFontSize(15);
  doc.setTextColor(255, 255, 255);
  doc.text(String(periodLabel || ''), W - 18, 15, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 190);
  doc.text(t('Genererad {datum}', { datum: isoDate() }), W - 18, 22, { align: 'right' });
  if (onlyPaid) doc.text(t('Bara utbetalda resor'), W - 18, 27, { align: 'right' });

  const people = new Map();
  for (const r of rows) {
    const g = people.get(r.userId) || { name: r.name || '–', rows: [], miles: 0, amount: 0, paid: 0, minutes: 0 };
    g.rows.push(r); g.miles = round2(g.miles + r.miles); g.amount = round2(g.amount + r.amount); g.minutes += r.minutes || 0;
    if (r.status === 'paid') g.paid = round2(g.paid + r.amount);
    people.set(r.userId, g);
  }
  const list = [...people.values()];
  const totMiles = round2(list.reduce((a, g) => a + g.miles, 0));
  const totAmount = round2(list.reduce((a, g) => a + g.amount, 0));
  const totPaid = round2(list.reduce((a, g) => a + g.paid, 0));

  doc.setTextColor(...DARK);
  doc.setFont('times', 'bolditalic');
  doc.setFontSize(12);
  doc.text(t('Sammanställning'), 18, 42);
  autoTable(doc, {
    startY: 45,
    head: [[t('Namn'), t('Resor'), t('Mil'), t('Ersättning'), t('Varav utbetalt')]],
    body: [...list.map(g => [g.name, String(g.rows.length), mil(g.miles), fmt(g.amount), fmt(g.paid)]),
      [{ content: t('TOTALT'), styles: { fontStyle: 'bold' } }, { content: String(rows.length), styles: { fontStyle: 'bold' } }, { content: mil(totMiles), styles: { fontStyle: 'bold' } },
       { content: fmt(totAmount), styles: { fontStyle: 'bold' } }, { content: fmt(totPaid), styles: { fontStyle: 'bold' } }]],
    headStyles: { fillColor: DARK, fontSize: 8 },
    columnStyles: { 1: { halign: 'right', cellWidth: 18 }, 2: { halign: 'right', cellWidth: 22 }, 3: { halign: 'right', font: 'courier', cellWidth: 36 }, 4: { halign: 'right', font: 'courier', cellWidth: 36 } },
    styles: { fontSize: 8.5, cellPadding: 1.8 },
    alternateRowStyles: { fillColor: PAPER },
    margin: { left: 18, right: 18 },
  });

  const hasArea = rows.some(r => r.area);
  for (const g of list) {
    let y = doc.lastAutoTable.finalY + 12;
    if (y > 235) { doc.addPage(); y = 20; }
    doc.setFont('times', 'bolditalic');
    doc.setFontSize(12);
    doc.setTextColor(...DARK);
    doc.text(g.name, 18, y);
    autoTable(doc, {
      startY: y + 3,
      head: [[t('Datum'), ...(hasArea ? [t('Område')] : []), t('Tid (min)'), t('Mil'), t('Kr per mil'), t('Ersättning'), t('Status')]],
      body: [...g.rows.map(r => [r.date, ...(hasArea ? [r.area || ''] : []), r.minutes != null ? String(r.minutes) : '', mil(r.miles), fmt(r.rate), fmt(r.amount), STATUS[r.status] || r.status]),
        [{ content: t('Summa'), styles: { fontStyle: 'bold' } }, ...(hasArea ? [''] : []), { content: String(g.minutes || ''), styles: { fontStyle: 'bold' } }, { content: mil(g.miles), styles: { fontStyle: 'bold' } }, '',
         { content: fmt(g.amount), styles: { fontStyle: 'bold' } }, '']],
      headStyles: { fillColor: [207, 226, 243], textColor: DARK, fontSize: 8 },
      styles: { fontSize: 8, cellPadding: 1.6 },
      columnStyles: hasArea ? { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right', font: 'courier' }, 5: { halign: 'right', font: 'courier' } }
                            : { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right', font: 'courier' }, 4: { halign: 'right', font: 'courier' } },
      alternateRowStyles: { fillColor: PAPER },
      margin: { left: 18, right: 18 },
    });
  }

  const pages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(160, 160, 180);
    doc.text(`${orgName} · ${periodLabel || ''}`, 18, 291);
    doc.text(t('Sida {p} av {n}', { p, n: pages }), W - 18, 291, { align: 'right' });
    doc.setDrawColor(...BORDER);
    doc.line(18, 288, W - 18, 288);
  }
  doc.save(`${t('milersattning')}_${String(periodLabel || '').replace(/[^a-zA-Z0-9]/g, '_')}_${String(orgName || '').replace(/\s+/g, '_')}.pdf`);
  return doc;
}
