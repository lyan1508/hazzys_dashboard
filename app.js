const S = {
  raw: { sales: [], targets: [] },
  filters: { year: 'all', quarter: 'all', month: 'all', gender: 'all', type: 'all', store: 'all' },
  charts: {},
  revMode: 'monthly',
};

const PALETTE = {
  multi: ['#1a56a8', '#059669', '#f59e0b', '#7c3aed', '#0891b2', '#db2777', '#dc2626', '#d97706'],
  gender: ['#1a56a8', '#db2777', '#f59e0b', '#6b7280']
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Bill flag column 0/1 — one line per receipt is marked */
const BILL_FLAG_ALIASES = ['bill', 'billflag', 'bill_flag', 'billind', 'isbill', 'billindicator'];
/** Receipt id column, e.g. "TAKA-0900001IPIP" — preferred over the 0/1 flag */
const BILLNO_ALIASES = ['billno', 'bill_no', 'billnumber', 'billid', 'invoiceno', 'invoice', 'receiptno', 'receipt'];

// Primary data source: a stable Google Sheet. Keep the file and tab names fixed;
// the dashboard reads by tab name so changing gid values will not break sync.
const STABLE_GSHEET_ID = '1l53PyTaGzb92aagtMTJwBoc8E_0p-EaSvLAv4dVehC8';
const stableSheetUrl = (sheetName) =>
  `https://docs.google.com/spreadsheets/d/${STABLE_GSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;

// Legacy published links stay as a fallback until the new stable sheet is filled.
const LEGACY_GSHEET_BASE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT0EnQS5moW_LgjKBPFsLaPGvXFUR7IoK_DRzR-I6lMfL9wr3ibdVaRjKYJidBcrg/pub?gid=';
const GSHEET_URLS = {
  'sale data':  [stableSheetUrl('sale data'), LEGACY_GSHEET_BASE + '1504946670'],
  'target':     [stableSheetUrl('target'), LEGACY_GSHEET_BASE + '227957717'],
};

function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v === null || v === undefined) return 0;
  let s = String(v).trim();
  if (!s) return 0;
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[₫đ]/gi, '').replace(/\s+/g, '').replace(/[^0-9,.\-]/g, '');
  if (!s) return 0;

  // 1.234.567,89 -> 1234567.89
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
  // 1,234,567.89 -> 1234567.89
  } else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    s = s.replace(/,/g, '');
  // 1234567,89 -> 1234567.89
  } else if (/^-?\d+,\d+$/.test(s)) {
    s = s.replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}
function fmtVND(v) { return `${new Intl.NumberFormat('vi-VN').format(Math.round(num(v)))} ₫`; }
function fmtN(v) { return new Intl.NumberFormat('vi-VN').format(Math.round(num(v))); }
function fmtPct(v) { return `${num(v).toFixed(1)}%`; }
function fmtVNDShort(v) {
  const n = num(v), a = Math.abs(n);
  if (a >= 1e9)  return `${(n / 1e9).toFixed(a >= 10e9 ? 1 : 2)} B ₫`;
  if (a >= 1e6)  return `${(n / 1e6).toFixed(1)} M ₫`;
  if (a >= 1e3)  return `${(n / 1e3).toFixed(0)} K ₫`;
  return `${Math.round(n)} ₫`;
}
function fmtShort(v) {
  const n = num(v), a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(a >= 10e9 ? 1 : 2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(Math.round(n));
}
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function monthKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function monthLabelYY(d) { return `${MONTH_NAMES[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`; }
function localDateKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

function normalizeText(v) {
  const base = String(v ?? '').trim().toUpperCase();
  return base || 'UNKNOWN';
}
function normalizeGender(v) {
  const g = normalizeText(v).replace(/\s+/g, '');
  if (['M', 'MEN', 'MALE', 'NAM'].includes(g)) return 'MEN';
  if (['F', 'WOMEN', 'FEMALE', 'NU', 'NỮ'].includes(g)) return 'WOMEN';
  return 'UNKNOWN';
}
function normalizeGroup(v) {
  return normalizeText(v).replace(/\s+/g, ' ');
}
function styleKey9(v) {
  const raw = String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!raw) return 'UNKNOWN';
  return raw.slice(0, 9);
}
function deriveCategory(rawCategory, infoCategory, typeValue, productKey) {
  const product = String(productKey || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (product.length >= 4) return product.slice(2, 4);
  const primary = normalizeGroup(rawCategory || infoCategory);
  if (primary !== 'UNKNOWN') return primary;
  const t = normalizeGroup(typeValue);
  if (t !== 'UNKNOWN') return t;
  return 'UNKNOWN';
}

function parseDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // SheetJS (cellDates) can land a midnight date ~7h early — e.g. 01/10 becomes
    // 30/09 23:59 in local time — which pushes 1st-of-month rows into the previous
    // month. Nudge +12h before taking the calendar day so it rounds to the right day.
    const d = new Date(v.getTime() + 12 * 3600 * 1000);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  // Excel serial number (raw:true path)
  if (typeof v === 'number') {
    try {
      const o = XLSX.SSF.parse_date_code(v);
      if (o) return new Date(o.y, o.m - 1, o.d);
    } catch (_) {}
  }
  const s = String(v).trim();
  if (!s) return null;
  const datePart = s.split(/\s+/)[0].replace(/\./g, '/');
  const dmY = datePart.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmY) {
    const a = Number(dmY[1]);
    const b = Number(dmY[2]);
    const y = Number(dmY[3]);
    if (b > 12) return new Date(y, a - 1, b);
    return new Date(y, b - 1, a);
  }
  const dmY2 = datePart.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if (dmY2) {
    const a = Number(dmY2[1]);
    const b = Number(dmY2[2]);
    const y = 2000 + Number(dmY2[3]);
    if (b > 12) return new Date(y, a - 1, b);
    return new Date(y, b - 1, a);
  }
  // ISO format YYYY-MM-DD
  const Ymd = datePart.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (Ymd) {
    const y = Number(Ymd[1]);
    const m = Number(Ymd[2]);
    const d = Number(Ymd[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return new Date(y, m - 1, d);
    return null;
  }
  return null;
}

function parseMonthText(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) { const d = new Date(v.getTime() + 12 * 3600 * 1000); return new Date(d.getFullYear(), d.getMonth(), 1); }
  if (typeof v === 'number') {
    try {
      const o = XLSX.SSF.parse_date_code(v);
      if (o) return new Date(o.y, o.m - 1, 1);
    } catch (_) {}
  }
  const s = String(v).trim();
  if (!s) return null;
  const normalized = s.replace(/\./g, '/').replace(/\-/g, '/');
  const mmyyyy = normalized.match(/^(\d{1,2})\/(\d{4})$/);
  if (mmyyyy) {
    const m = Number(mmyyyy[1]);
    const y = Number(mmyyyy[2]);
    if (m >= 1 && m <= 12) return new Date(y, m - 1, 1);
  }
  const yyyymm = normalized.match(/^(\d{4})\/(\d{1,2})$/);
  if (yyyymm) {
    const y = Number(yyyymm[1]);
    const m = Number(yyyymm[2]);
    if (m >= 1 && m <= 12) return new Date(y, m - 1, 1);
  }
  const asDate = parseDate(s);
  if (asDate) return new Date(asDate.getFullYear(), asDate.getMonth(), 1);
  return null;
}

function parseMonthFromRow(row, aliases) {
  for (const alias of aliases) {
    const d = parseMonthText(readField(row, [alias]));
    if (d) return d;
  }
  return null;
}

function parseTargetMonth(row) {
  return parseMonthFromRow(row, ['mm/yyyy', 'm/yyyy', 'mm-yyyy', 'm-yyyy', 'monthyear', 'month_year', 'month', 'date', 'period', '월', '月']);
}

function flattenMergedRows(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  const merges = sheet['!merges'] || [];
  merges.forEach((merge) => {
    const top = rows[merge.s.r]?.[merge.s.c];
    for (let r = merge.s.r; r <= merge.e.r; r += 1) {
      rows[r] = rows[r] || [];
      for (let c = merge.s.c; c <= merge.e.c; c += 1) {
        if (rows[r][c] === null || rows[r][c] === undefined || rows[r][c] === '') rows[r][c] = top;
      }
    }
  });
  return rows;
}

function rowsToObjects(rows, fallbackPrefix = 'COL') {
  if (!rows || rows.length < 2) return [];
  const rawHeader = (rows[0] || []).map((h, i) => {
    const v = String(h ?? '').trim();
    return v ? v : `${fallbackPrefix}_${i + 1}`;
  });
  return rows.slice(1).filter((r) => r && r.some((v) => v !== null && v !== undefined && String(v).trim() !== '')).map((r) => {
    const o = {};
    rawHeader.forEach((h, i) => { o[h] = r?.[i]; });
    return o;
  });
}

function canonKey(s) {
  return String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ---- Bill counting ----
// The 0/1 BILL flag marks one line per receipt, but 86 of 2005 receipts in the
// source data have no line flagged, so summing the flag under-counts bills by
// ~4% and skews ATV / UPT / CVR. Count distinct receipt ids instead, and fall
// back to the flag only for datasets that carry no bill-number column.
function newBillAcc() { return { ids: new Set(), flagSum: 0 }; }
function addBill(acc, r) {
  if (r.billNo) acc.ids.add(r.billNo);
  const f = num(r.billFlag);
  if (f > 0) acc.flagSum += f;
}
function billTotal(acc) { return acc.ids.size || acc.flagSum; }
function countBills(rows) {
  const acc = newBillAcc();
  rows.forEach((r) => addBill(acc, r));
  return billTotal(acc);
}

function readField(row, aliases) {
  const keys = Object.keys(row || {});
  const keyMap = new Map(keys.map((k) => [canonKey(k), k]));
  for (const alias of aliases) {
    const hit = keyMap.get(canonKey(alias));
    if (hit) return row[hit];
  }
  return '';
}

function validateRequiredSalesColumns(salesRows) {
  if (!salesRows.length) throw new Error('Sales data sheet is empty.');
  const headerSet = new Set(Object.keys(salesRows[0]).map((k) => canonKey(k)));
  const requiredMap = {
    Date: ['date', 'trans_date', 'transdate'],
    Amount: ['amount', 'sales', 'revenue', 'netamount', 'net_amount', 'total'],
    Qty: ['qty', 'quantity', 'pcs', 'count'],
    // Either a receipt id or the 0/1 flag is enough to count bills.
    'Bill No. / Bill': BILLNO_ALIASES.concat(BILL_FLAG_ALIASES)
  };
  const missing = Object.entries(requiredMap).filter(([, aliases]) => !aliases.some((a) => headerSet.has(canonKey(a)))).map(([k]) => k);
  if (missing.length) throw new Error(`Missing required columns: ${missing.join(', ')}.`);
}

function ingestWorkbook(wb) {
  const sheets = {};
  (wb.SheetNames || []).forEach((n) => { sheets[n.toLowerCase()] = flattenMergedRows(wb.Sheets[n]); });
  const pickSheet = (keys) => {
    for (const k of keys) {
      const hit = Object.keys(sheets).find((n) => n.includes(k));
      if (hit) return sheets[hit];
    }
    return [];
  };

  const salesRowsRaw = pickSheet(['sale data', 'sales data', 'transaction', 'sale', 'data']) || Object.values(sheets)[0] || [];
  const targetRowsRaw = pickSheet(['target', 'kpi']) || [];
  const masterRowsRaw = pickSheet(['master', 'catalog', 'product']) || [];

  const salesRaw = rowsToObjects(salesRowsRaw, 'SALES_COL');
  const targetRaw = rowsToObjects(targetRowsRaw, 'TARGET_COL');
  const masterRaw = rowsToObjects(masterRowsRaw, 'MASTER_COL');
  validateRequiredSalesColumns(salesRaw);

  const catalog = {};
  const catalogByStyle = {};
  masterRaw.forEach((r) => {
    const skuRaw = String(readField(r, ['SKU', 'sku', 'UPC', 'upc']) || '').trim();
    if (!skuRaw) return;
    const sku = normalizeGroup(skuRaw);
    const style = styleKey9(skuRaw);
    const info = {
      type: readField(r, ['TYPE', 'type']),
      gender: readField(r, ['GENDER', 'gender']),
      category: readField(r, ['CATEGORY', 'category']),
      store: readField(r, ['STORE', 'store'])
    };
    catalog[sku] = info;
    catalogByStyle[style] = info;
  });

  const sales = salesRaw.map((r) => {
    const sku = String(readField(r, ['sku', 'itemcode', 'code']) || '').trim();
    const upc = String(readField(r, ['upc', 'barcode', 'ean']) || '').trim();
    const rawProduct = sku || upc;
    const p9 = styleKey9(rawProduct);
    const info = catalog[normalizeGroup(rawProduct)] || catalogByStyle[p9] || {};
    const txDate = parseDate(readField(r, ['date', 'trans_date', 'transdate', '날짜', '日付']));
    const monthDate = parseMonthFromRow(r, ['mm/yyyy', 'm/yyyy', 'mm-yyyy', 'm-yyyy', 'monthyear', 'month_year', 'month']);
    // The synced DATE column is unreliable: the source DATA.xlsx has scrambled dates
    // for ~40% of rows (the DATE month often disagrees with MM/YYYY, scattering rows
    // into future months and pushing the forecast a year or two ahead). MM/YYYY is
    // authoritative, so when DATE's month contradicts it, fall back to MM/YYYY.
    let date = txDate || monthDate;
    if (txDate && monthDate &&
        (txDate.getFullYear() !== monthDate.getFullYear() || txDate.getMonth() !== monthDate.getMonth())) {
      date = monthDate;
    }
    if (!date) return null;
    const baseMonth = monthDate || date;
    const billFlag = num(readField(r, BILL_FLAG_ALIASES));
    const billNo = normalizeGroup(readField(r, BILLNO_ALIASES));
    const rawCat = readField(r, ['category', 'catogory', 'cat', 'division', 'dept', 'department']);
    const store = normalizeGroup(readField(r, ['store', 'storename', 'store_name', 'shop', 'branch']) || info.store || '');
    return {
      date,
      dateStr: localDateKey(date),
      year: String(baseMonth.getFullYear()),
      quarter: `Q${Math.ceil((baseMonth.getMonth() + 1) / 3)}`,
      monthIndex: baseMonth.getMonth() + 1,
      monthKey: monthKey(baseMonth),
      monthLabelYY: monthLabelYY(baseMonth),
      billFlag,
      billNo: billNo === 'UNKNOWN' ? '' : billNo,
      store,
      sku: sku,
      upc: normalizeGroup(upc),
      productKey: p9,
      type: normalizeGroup(readField(r, ['type', 'itemtype', 'product_type', 'producttype']) || info.type),
      gender: normalizeGender(readField(r, ['gender', 'sex']) || info.gender),
      promotion: normalizeGroup(readField(r, ['promotion', 'promo', 'program', 'campaign'])),
      cashier: normalizeGroup(readField(r, ['cashier', 'staff', 'employee', 'seller'])),
      category: deriveCategory(rawCat, info.category, readField(r, ['type', 'itemtype', 'product_type', 'producttype']) || info.type, rawProduct),
      qty: num(readField(r, ['qty', 'quantity', 'pcs', 'count'])),
      amount: num(readField(r, ['amount', 'sales', 'revenue', 'netamount', 'net_amount', 'price', 'total']))
    };
  }).filter(Boolean);

  const targets = targetRaw.map((r) => {
    const date = parseTargetMonth(r);
    if (!date) return null;
    return {
      monthKey: monthKey(date),
      year: String(date.getFullYear()),
      monthIndex: date.getMonth() + 1,
      monthLabelYY: monthLabelYY(date),
      target: num(readField(r, ['target', 'kpi', 'budget', 'plan'])),
      traffic: num(readField(r, ['traffic', 'trafic', 'visitors', 'footfall'])),
      store: normalizeGroup(readField(r, ['store', 'storename', 'shop']))
    };
  }).filter(Boolean);

  return { sales, targets };
}

function filteredSalesRows() {
  const f = S.filters;
  return S.raw.sales.filter((r) => {
    if (f.year !== 'all' && r.year !== f.year) return false;
    if (f.quarter !== 'all' && r.quarter !== f.quarter) return false;
    if (f.month !== 'all' && String(r.monthIndex).padStart(2, '0') !== f.month) return false;
    if (f.gender !== 'all' && r.gender !== f.gender) return false;
    if (f.type !== 'all' && r.type !== f.type) return false;
    if (f.store !== 'all' && r.store !== f.store) return false;
    return true;
  });
}

function filteredTargetsRows() {
  const f = S.filters;
  return S.raw.targets.filter((t) => {
    if (f.year !== 'all' && t.year !== f.year) return false;
    if (f.month !== 'all' && String(t.monthIndex).padStart(2, '0') !== f.month) return false;
    if (f.quarter !== 'all' && `Q${Math.ceil(t.monthIndex / 3)}` !== f.quarter) return false;
    if (f.store !== 'all' && t.store !== f.store) return false;
    return true;
  });
}

function safeGroupSum(rows, key) {
  const map = new Map();
  rows.forEach((r) => {
    const k = normalizeGroup(r[key]);
    if (k === 'UNKNOWN') return;
    map.set(k, num(map.get(k)) + num(r.amount));
  });
  return [...map.entries()].map(([label, value]) => ({ label, value: num(value) })).sort((a, b) => b.value - a.value);
}

function aggregate() {
  const rows = filteredSalesRows();
  const targets = filteredTargetsRows();
  const monthMap = new Map();

  rows.forEach((r) => {
    if (!monthMap.has(r.monthKey)) {
      monthMap.set(r.monthKey, {
        monthKey: r.monthKey,
        monthIndex: r.monthIndex,
        monthLabelYY: r.monthLabelYY,
        year: r.year,
        actual: 0,
        target: 0,
        traffic: 0,
        qty: 0,
        billAcc: newBillAcc()
      });
    }
    const m = monthMap.get(r.monthKey);
    m.actual += num(r.amount);
    m.qty += num(r.qty);
    addBill(m.billAcc, r);
  });

  targets.forEach((t) => {
    if (!monthMap.has(t.monthKey)) {
      monthMap.set(t.monthKey, {
        monthKey: t.monthKey,
        monthIndex: t.monthIndex,
        monthLabelYY: t.monthLabelYY,
        year: t.year,
        actual: 0,
        target: 0,
        traffic: 0,
        qty: 0,
        billAcc: newBillAcc()
      });
    }
    const m = monthMap.get(t.monthKey);
    m.target += num(t.target);
    m.traffic += num(t.traffic);
  });

  const months = [...monthMap.values()].sort((a, b) => a.monthKey.localeCompare(b.monthKey)).map((m) => {
    const billCount = billTotal(m.billAcc);
    const actual = num(m.actual);
    const traffic = num(m.traffic);
    const qty = num(m.qty);
    return {
      ...m,
      billCount,
      actual,
      traffic,
      target: num(m.target),
      qty,
      cvr: traffic > 0 ? (billCount / traffic) * 100 : 0,
      atv: billCount > 0 ? actual / billCount : 0,
      upt: billCount > 0 ? qty / billCount : 0
    };
  });
  const totalSales = rows.reduce((s, r) => s + num(r.amount), 0);
  const qty = rows.reduce((s, r) => s + num(r.qty), 0);
  const bills = countBills(rows);
  const traffic = months.reduce((s, m) => s + num(m.traffic), 0);
  const target = months.reduce((s, m) => s + num(m.target), 0);
  const cvr = traffic > 0 ? (bills / traffic) * 100 : 0;
  const atv = bills > 0 ? totalSales / bills : 0;
  const upt = bills > 0 ? qty / bills : 0;
  const topProducts = (() => {
    // Group by 9-char product model code (Brand+Cat+Year+Season+Design),
    // requiring a valid 14-char Hazzys SKU as the source row.
    const map = new Map();
    rows.forEach((r) => {
      const raw = String(r.sku || r.upc || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (raw.length !== 14) return;
      const key = raw.slice(0, 9);
      const p = map.get(key) || { sku: key, type: r.type, gender: r.gender, value: 0, qty: 0 };
      p.value += num(r.amount);
      p.qty += num(r.qty);
      map.set(key, p);
    });
    return [...map.values()].sort((a, b) => b.value - a.value).slice(0, 30);
  })();
  const promotionStats = (() => {
    const map = new Map();
    rows.forEach((r) => {
      const key = normalizeGroup(r.promotion);
      const p = map.get(key) || { label: key, amount: 0, qty: 0, billAcc: newBillAcc() };
      p.amount += num(r.amount);
      p.qty += num(r.qty);
      addBill(p.billAcc, r);
      map.set(key, p);
    });
    return [...map.values()]
      .map((p) => ({ label: p.label, amount: p.amount, qty: p.qty, bills: billTotal(p.billAcc) }))
      .sort((a, b) => b.amount - a.amount);
  })();
  const cashierStats = (() => {
    const map = new Map();
    rows.forEach((r) => {
      const key = normalizeGroup(r.cashier);
      if (!key || key === 'UNKNOWN') return;
      const p = map.get(key) || { label: key, amount: 0, qty: 0, billAcc: newBillAcc() };
      p.amount += num(r.amount);
      p.qty += num(r.qty);
      addBill(p.billAcc, r);
      map.set(key, p);
    });
    return [...map.values()]
      .map((p) => ({ label: p.label, amount: p.amount, qty: p.qty, bills: billTotal(p.billAcc) }))
      .sort((a, b) => b.amount - a.amount);
  })();

  const sortedDates = rows.map((r) => r.date).sort((a, b) => a - b);
  const rangeFrom = sortedDates[0]?.toLocaleDateString('vi-VN') || '—';
  const rangeTo = sortedDates[sortedDates.length - 1]?.toLocaleDateString('vi-VN') || '—';

  // ── Cashier matrix: enrich cashierStats with daysWorked & per-day metrics ──
  const cashierMatrix = (() => {
    const map = new Map();
    rows.forEach((r) => {
      const key = normalizeGroup(r.cashier);
      if (!key || key === 'UNKNOWN') return;
      const p = map.get(key) || { label: key, amount: 0, qty: 0, billAcc: newBillAcc(), dates: new Set() };
      p.amount += num(r.amount);
      p.qty += num(r.qty);
      addBill(p.billAcc, r);
      p.dates.add(r.dateStr);
      map.set(key, p);
    });
    return [...map.values()].map((p) => {
      const bills = billTotal(p.billAcc);
      return {
        label: p.label,
        amount: p.amount,
        qty: p.qty,
        bills,
        days: p.dates.size,
        billsPerDay: p.dates.size > 0 ? bills / p.dates.size : 0,
        revPerDay: p.dates.size > 0 ? p.amount / p.dates.size : 0,
        atv: bills > 0 ? p.amount / bills : 0,
        upt: bills > 0 ? p.qty / bills : 0,
      };
    }).sort((a, b) => b.revPerDay - a.revPerDay);
  })();

  // ── Cashier grand totals ──
  // 28% of receipts list more than one cashier (staff share a sale), so each of
  // them legitimately counts that bill. Summing the per-cashier columns would
  // therefore double-count — the footer needs its own de-duplicated totals.
  const cashierTotals = (() => {
    const known = rows.filter((r) => {
      const k = normalizeGroup(r.cashier);
      return k && k !== 'UNKNOWN';
    });
    const bills = countBills(known);
    const amount = known.reduce((s, r) => s + num(r.amount), 0);
    const qty = known.reduce((s, r) => s + num(r.qty), 0);
    const days = new Set(known.map((r) => r.dateStr)).size;
    return {
      bills, amount, qty, days,
      billsPerDay: days > 0 ? bills / days : 0,
      revPerDay: days > 0 ? amount / days : 0,
      atv: bills > 0 ? amount / bills : 0,
      upt: bills > 0 ? qty / bills : 0,
    };
  })();

  // ── DOW stats: Mon..Sun (display order) ──
  const dowStats = (() => {
    const DAY_NAMES_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const buckets = [0,1,2,3,4,5,6].map((d) => ({
      dow: d, label: DAY_NAMES_EN[d], revenue: 0, qty: 0, billAcc: newBillAcc(), dates: new Set()
    }));
    rows.forEach((r) => {
      if (!r.date) return;
      const d = r.date.getDay();
      const b = buckets[d];
      b.revenue += num(r.amount);
      b.qty += num(r.qty);
      addBill(b.billAcc, r);
      b.dates.add(r.dateStr);
    });
    buckets.forEach((b) => {
      b.bills = billTotal(b.billAcc);
      b.dayCount = b.dates.size;
      b.revPerDay = b.dayCount > 0 ? b.revenue / b.dayCount : 0;
      b.billsPerDay = b.dayCount > 0 ? b.bills / b.dayCount : 0;
      b.atv = b.bills > 0 ? b.revenue / b.bills : 0;
      delete b.dates;
      delete b.billAcc;
    });
    // Display order: Mon..Sat..Sun
    return [1,2,3,4,5,6,0].map((i) => buckets[i]);
  })();

  return {
    rows, months, totalSales, qty, bills, traffic, target, cvr, atv, upt, topProducts,
    byType: safeGroupSum(rows, 'type'),
    byGender: safeGroupSum(rows, 'gender'),
    byCategory: safeGroupSum(rows, 'category'),
    promotionStats, cashierStats, cashierMatrix, cashierTotals, dowStats, rangeFrom, rangeTo
  };
}

function destroyChart(key) {
  if (S.charts[key]) {
    try { S.charts[key].destroy(); } catch (_) {}
    S.charts[key] = null;
  }
}
function destroyAllCharts() {
  Object.keys(S.charts).forEach((k) => destroyChart(k));
}

function safeDataset(values, fallbackLen) {
  const arr = (values || []).map((v) => num(v));
  return arr.length ? arr : new Array(fallbackLen).fill(0);
}
function safeLabels(labels) {
  return labels && labels.length ? labels : ['No Data'];
}

function baseOptions(yFmt, ttFmt, showLegend = false) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: {
        display: showLegend,
        labels: {
          color: css('--text-2'),
          boxWidth: 10,
          padding: 12,
          font: { size: 11 }
        }
      },
      tooltip: {
        enabled: true,
        backgroundColor: css('--surface'),
        titleColor: css('--text-2'),
        bodyColor: css('--text-2'),
        borderColor: css('--border'),
        borderWidth: 1,
        padding: 10,
        callbacks: {
          label: (ctx) => (ttFmt ? ttFmt(ctx) : `${ctx.dataset.label || ''}: ${num(ctx.raw)}`)
        }
      }
    },
    scales: {
      x: { grid: { color: css('--border'), drawBorder: false }, ticks: { color: css('--text-3'), font: { size: 11 } } },
      y: {
        beginAtZero: true,
        grid: { color: css('--border'), drawBorder: false },
        ticks: { color: css('--text-3'), font: { size: 11 }, callback: (v) => (yFmt ? yFmt(v) : v) }
      }
    }
  };
}

function renderNoDataLegend(legendId) {
  document.getElementById(legendId).innerHTML = '<div class="legend-item"><div class="legend-name">No Data</div></div>';
}

// External HTML tooltip — renders in body so it can overflow small chart containers
function externalTooltipHandler(context) {
  let el = document.getElementById('chartjs-ext-tooltip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'chartjs-ext-tooltip';
    el.style.cssText = 'position:fixed;z-index:9999;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:12px;color:var(--text-2);pointer-events:none;box-shadow:0 4px 14px rgba(0,0,0,.15);opacity:0;transition:opacity .12s;white-space:nowrap';
    document.body.appendChild(el);
  }
  const tt = context.tooltip;
  if (!tt || tt.opacity === 0) { el.style.opacity = 0; return; }
  const title = (tt.title || []).join(' ');
  const body  = (tt.body  || []).map(b => b.lines.join('<br>')).join('<br>');
  el.innerHTML = (title ? `<div style="font-weight:600;margin-bottom:2px;color:var(--text)">${title}</div>` : '') + body;
  const rect = context.chart.canvas.getBoundingClientRect();
  let x = rect.left + tt.caretX + 12;
  let y = rect.top  + tt.caretY - 4;
  // Keep inside viewport
  const elRect = el.getBoundingClientRect();
  if (x + elRect.width > window.innerWidth - 8) x = rect.left + tt.caretX - elRect.width - 12;
  if (y + elRect.height > window.innerHeight - 8) y = window.innerHeight - elRect.height - 8;
  if (y < 8) y = 8;
  el.style.left = x + 'px';
  el.style.top  = y + 'px';
  el.style.opacity = 1;
}

function renderDoughnut(chartKey, canvasId, centerId, legendId, data, colors) {
  destroyChart(chartKey);
  const clean = (data || []).filter((x) => num(x.value) > 0);
  const total = clean.reduce((s, x) => s + num(x.value), 0);
  document.getElementById(centerId).textContent = total > 0 ? fmtShort(total) : 'No Data';
  if (total <= 0) {
    renderNoDataLegend(legendId);
    return;
  }

  S.charts[chartKey] = new Chart(document.getElementById(canvasId), {
    type: 'doughnut',
    data: {
      labels: clean.map((x) => x.label),
      datasets: [{
        data: clean.map((x) => num(x.value)),
        backgroundColor: clean.map((_, i) => colors[i % colors.length]),
        borderColor: css('--surface'),
        borderWidth: 2,
        hoverOffset: 5
      }]
    },
    options: {
      responsive: false,
      maintainAspectRatio: true,
      cutout: '68%',
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external: externalTooltipHandler,
          callbacks: {
            label: (ctx) => {
              const value = num(ctx.raw);
              const pct = total > 0 ? (value / total) * 100 : 0;
              return `${ctx.label}: ${fmtVND(value)} (${fmtPct(pct)})`;
            }
          }
        }
      }
    }
  });

  document.getElementById(legendId).innerHTML = clean.slice(0, 6).map((x, i) => {
    const pct = total > 0 ? (num(x.value) / total) * 100 : 0;
    return `
      <div class="legend-item">
        <div class="legend-dot" style="background:${colors[i % colors.length]}"></div>
        <div class="legend-name" title="${esc(x.label)}">${esc(x.label)}</div>
        <div class="legend-pct">${fmtPct(pct)}</div>
      </div>
    `;
  }).join('');
}

function renderPromotionInfo(m) {
  const el = document.getElementById('promotionInfo');
  const list = (m.promotionStats || []).filter((x) => num(x.amount) > 0).slice(0, 12);
  if (!list.length) {
    el.innerHTML = '<div style="padding:14px 16px;color:var(--text-3);font-size:12px;text-align:center">No Data</div>';
    return;
  }
  const maxVal = num(list[0].amount) || 1;
  const totalVal = list.reduce((s, x) => s + num(x.amount), 0);
  el.innerHTML = `<div class="product-list promotion-list">${list.map((x, i) => `
    <div class="product-item">
      <div class="p-rank ${i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : ''}">${i + 1}</div>
      <div class="p-info">
        <div class="p-name" title="${esc(x.label)}">${esc(x.label)}</div>
        <div class="p-meta">${fmtN(x.qty)} units · ${fmtN(x.bills)} bills</div>
        <div class="p-bar-wrap"><div class="p-bar" style="width:${Math.max(6, (num(x.amount) / maxVal) * 100)}%"></div></div>
      </div>
      <div class="p-value">
        <div class="p-amount">${fmtShort(x.amount)}</div>
        <div class="p-qty">${fmtPct(totalVal > 0 ? (num(x.amount) / totalVal) * 100 : 0)}</div>
      </div>
    </div>
  `).join('')}</div>`;
}

function renderCashierBar(m) {
  const all = m.cashierStats || [];
  const shown = all.slice(0, 20);
  if (!shown.length) {
    destroyChart('cashier');
    return;
  }

  destroyChart('cashier');
  S.charts.cashier = new Chart(document.getElementById('chartCashierBar'), {
    type: 'bar',
    data: {
      labels: shown.map((x) => x.label),
      datasets: [
        {
          type: 'bar',
          label: 'Revenue',
          data: shown.map((x) => x.amount),
          yAxisID: 'y',
          backgroundColor: css('--brand-mid'),
          borderRadius: 6,
          maxBarThickness: 48,
          categoryPercentage: 0.65,
          barPercentage: 0.9,
          order: 2
        },
        {
          type: 'line',
          label: 'Units',
          data: shown.map((x) => x.qty),
          yAxisID: 'y1',
          borderColor: css('--accent'),
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 5,
          tension: 0.25,
          order: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: {
            color: css('--text-2'),
            boxWidth: 10,
            padding: 10,
            font: { size: 11 }
          }
        },
        tooltip: {
          enabled: true,
          backgroundColor: css('--surface'),
          titleColor: css('--text-2'),
          bodyColor: css('--text-2'),
          borderColor: css('--border'),
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: (ctx) => {
              const label = ctx.dataset.label || '';
              const raw = num(ctx.raw);
              if (label === 'Revenue') {
                return `Revenue: ${fmtVND(raw)}`;
              }
              if (label === 'Units') {
                return `Units: ${fmtN(raw)}`;
              }
              return `${label}: ${raw}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: css('--border'), drawBorder: false },
          ticks: { color: css('--text-3'), font: { size: 11 }, maxRotation: 45, minRotation: 0 }
        },
        y: {
          type: 'linear',
          position: 'left',
          beginAtZero: true,
          grace: '8%',
          title: { display: true, text: 'Revenue', color: css('--text-3'), font: { size: 11 } },
          grid: { color: css('--border'), drawBorder: false },
          ticks: { color: css('--text-3'), font: { size: 11 }, callback: (v) => fmtShort(v) }
        },
        y1: {
          type: 'linear',
          position: 'right',
          beginAtZero: true,
          grace: '8%',
          title: { display: true, text: 'Units', color: css('--text-3'), font: { size: 11 } },
          grid: { drawOnChartArea: false },
          ticks: { color: css('--accent'), font: { size: 11 }, callback: (v) => fmtN(v) }
        }
      }
    }
  });
}

function renderCharts(m) {
  const labels = safeLabels(m.months.map((x) => x.monthLabelYY));
  const actual = safeDataset(m.months.map((x) => x.actual), labels.length);
  const target = safeDataset(m.months.map((x) => x.target), labels.length);
  const bills = safeDataset(m.months.map((x) => x.billCount), labels.length);
  const traffic = safeDataset(m.months.map((x) => x.traffic), labels.length);

  destroyChart('rev');
  const revData = S.revMode === 'cumulative' ? actual.reduce((acc, x, i) => [...acc, x + (acc[i - 1] || 0)], []) : actual;
  const tgtData = S.revMode === 'cumulative' ? target.reduce((acc, x, i) => [...acc, x + (acc[i - 1] || 0)], []) : target;
  const revOptions = baseOptions((v) => fmtShort(v), (ctx) => `${ctx.dataset.label}: ${fmtVND(ctx.raw)}`);
  revOptions.layout = { padding: { top: 4, right: 8, bottom: 2, left: 2 } };
  revOptions.scales.x.grid = { color: css('--border'), drawBorder: false };
  revOptions.scales.x.ticks.color = css('--text-3');
  revOptions.scales.x.ticks.font = { size: 11 };
  revOptions.scales.x.ticks.maxRotation = labels.length > 10 ? 40 : 0;
  revOptions.scales.x.ticks.minRotation = 0;
  revOptions.scales.x.ticks.autoSkip = true;
  revOptions.scales.x.ticks.autoSkipPadding = 4;
  revOptions.scales.y.grace = '6%';
  S.charts.rev = new Chart(document.getElementById('chartRevenue'), {
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Actual',
          data: revData,
          backgroundColor: revData.map((v, i) => (v >= num(tgtData[i]) && num(tgtData[i]) > 0 ? css('--green') : css('--brand-mid'))),
          borderRadius: 6,
          maxBarThickness: 44,
          categoryPercentage: 0.72,
          barPercentage: 0.88,
          order: 2
        },
        {
          type: 'line',
          label: 'Target',
          data: tgtData,
          borderColor: css('--accent'),
          borderWidth: 2,
          borderDash: [5, 4],
          pointRadius: 3,
          tension: 0.25,
          order: 1,
          spanGaps: true
        }
      ]
    },
    options: revOptions
  });

  destroyChart('traffic');
  S.charts.traffic = new Chart(document.getElementById('chartTraffic'), {
    data: {
      labels,
      datasets: [
        { type: 'bar', label: 'Bills', data: bills, backgroundColor: css('--brand-mid'), borderRadius: 4 },
        { type: 'line', label: 'Traffic', data: traffic, borderColor: css('--green'), borderWidth: 2, pointRadius: 3, tension: 0.2 }
      ]
    },
    options: baseOptions((v) => fmtShort(v), (ctx) => `${ctx.dataset.label}: ${fmtN(ctx.raw)}`)
  });

  renderDoughnut('category', 'chartCategory', 'dCategoryVal', 'legendCategory', m.byCategory, PALETTE.multi);
  renderDoughnut('type', 'chartType', 'dTypeVal', 'legendType', m.byType, PALETTE.multi);
  renderDoughnut('gender', 'chartGender', 'dGenderVal', 'legendGender', m.byGender, PALETTE.gender);
  renderPromotionInfo(m);
  renderCashierBar(m);
}

function renderKPIs(m) {
  document.getElementById('kSales').textContent = fmtVNDShort(m.totalSales);
  document.getElementById('kBills').textContent = fmtN(m.bills);
  document.getElementById('kQty').textContent = fmtN(m.qty);
  document.getElementById('kTraffic').textContent = fmtN(m.traffic);
  document.getElementById('kCVR').textContent = fmtPct(m.cvr);
  document.getElementById('kUPT').textContent = num(m.upt).toFixed(2);
  document.getElementById('kATV').textContent = fmtVNDShort(m.atv);

  // Target + Achievement %
  const target = num(m.target);
  const achEl = document.getElementById('kAchieve');

  document.getElementById('kTarget').textContent = target > 0 ? fmtVNDShort(target) : '—';
  achEl.classList.remove('good', 'warn', 'bad');

  if (target > 0) {
    const pct = (num(m.totalSales) / target) * 100;
    achEl.textContent = fmtPct(pct);
    achEl.classList.add(pct >= 100 ? 'good' : pct >= 80 ? 'warn' : 'bad');
  } else {
    achEl.textContent = '—';
  }

  renderTargetProgressBar(m);
}

function renderTargetProgressBar(m) {
  const section = document.getElementById('targetProgressSection');
  if (!section) return;
  const target = num(m.target);
  if (target <= 0) { section.style.display = 'none'; return; }
  section.style.display = '';

  const actual = num(m.totalSales);
  const rawPct = (actual / target) * 100;
  const fillPct = Math.min(rawPct, 100);

  let color;
  if (rawPct >= 100)    color = 'var(--green)';
  else if (rawPct >= 85) color = '#d97706';
  else                   color = 'var(--red)';

  document.getElementById('tpPct').textContent = fmtPct(rawPct);
  document.getElementById('tpPct').style.color = color;

  const gap = actual - target;
  document.getElementById('tpMeta').textContent =
    `${fmtVNDShort(actual)} / ${fmtVNDShort(target)}  ·  ${gap >= 0 ? '▲ Over' : '▼ Under'} ${fmtVNDShort(Math.abs(gap))}`;

  const fill = document.getElementById('tpFill');
  fill.style.width = fillPct + '%';
  fill.style.background = color;
}

function renderTopProducts(m) {
  const el = document.getElementById('topProductList');
  if (!m.topProducts.length) {
    el.innerHTML = '<div style="padding:14px 16px;color:var(--text-3);font-size:12px;text-align:center">No Data</div>';
    return;
  }
  const list = m.topProducts.slice(0, 30);
  const maxVal = num(list[0].value) || 1;
  el.innerHTML = list.map((p, i) => `
    <div class="product-item">
      <div class="p-rank ${i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : ''}">${i + 1}</div>
      <div class="p-info">
        <div class="p-name" title="${esc(p.sku)}">${esc(p.sku)}</div>
        <div class="p-meta">${esc(p.type)} · ${esc(p.gender)}</div>
        <div class="p-bar-wrap"><div class="p-bar" style="width:${Math.max(6, (num(p.value) / maxVal) * 100)}%"></div></div>
      </div>
      <div class="p-value">
        <div class="p-amount">${fmtShort(p.value)}</div>
        <div class="p-qty">${fmtN(p.qty)} pcs</div>
      </div>
    </div>
  `).join('');
}

function initFilters() {
  initYoyFilters();
  const s = S.raw.sales;
  const options = (arr, id, allLabel, includeUnknown = false) => {
    const values = [...new Set(arr.filter((v) => v && (includeUnknown || v !== 'UNKNOWN')))].sort();
    document.getElementById(id).innerHTML = `<option value="all">${allLabel}</option>${values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}`;
  };
  options(s.map((r) => r.year), 'fYear', '—');
  options(s.map((r) => r.quarter), 'fQuarter', '—');
  const monthValues = [...new Set(s.map((r) => Number(r.monthIndex)).filter((v) => Number.isFinite(v) && v >= 1 && v <= 12))]
    .sort((a, b) => a - b);
  document.getElementById('fMonth').innerHTML = `<option value="all">—</option>${monthValues.map((m) => {
    const value = String(m).padStart(2, '0');
    return `<option value="${value}">${MONTH_NAMES[m - 1]}</option>`;
  }).join('')}`;
  options(s.map((r) => r.gender), 'fGender', '—');
  options(s.map((r) => r.type), 'fType', '—');
  // Store filter — only shown when multiple distinct stores exist in the data
  const stores = [...new Set(s.map((r) => r.store).filter((v) => v && v !== 'UNKNOWN'))].sort();
  const storeGroup = document.getElementById('fStoreGroup');
  if (storeGroup) {
    storeGroup.style.display = stores.length > 1 ? '' : 'none';
    options(s.map((r) => r.store), 'fStore', '—');
  }
}

function syncFilters() {
  document.getElementById('fYear').value = S.filters.year;
  document.getElementById('fQuarter').value = S.filters.quarter;
  document.getElementById('fMonth').value = S.filters.month;
  document.getElementById('fGender').value = S.filters.gender;
  document.getElementById('fType').value = S.filters.type;
  const fStore = document.getElementById('fStore');
  if (fStore) fStore.value = S.filters.store;
  highlightActiveFilters();
}

function highlightActiveFilters() {
  [['fYear','year'],['fQuarter','quarter'],['fMonth','month'],['fGender','gender'],['fType','type'],['fStore','store']]
    .forEach(([id, key]) => {
      const sel = document.getElementById(id);
      const group = sel?.closest('.filter-group');
      const isActive = S.filters[key] !== 'all';
      sel?.classList.toggle('active-filter', isActive);
      group?.classList.toggle('has-active', isActive);
    });
  // Update mobile filter toggle badge
  const activeCount = Object.values(S.filters).filter(v => v !== 'all').length;
  const countEl = document.getElementById('filterCount');
  const toggleEl = document.getElementById('filterToggle');
  if (countEl) {
    countEl.textContent = activeCount || '';
    countEl.classList.toggle('visible', activeCount > 0);
  }
  if (toggleEl) toggleEl.classList.toggle('has-filters', activeCount > 0);
}

function syncCharts() {
  Object.values(S.charts).forEach(ch => {
    if (ch && typeof ch.resize === 'function') { try { ch.resize(); } catch(_) {} }
  });
}

function renderAll() {
  if (!S.raw.sales.length) return;
  const m = aggregate();
  renderKPIs(m);
  renderCharts(m);
  renderTopProducts(m);
  renderCashierMatrix(m);
  renderDowHeatmap(m);
  syncYoyFromFilters();
  renderYoy();
  requestAnimationFrame(() => syncCharts());
}

// ===== CASHIER PRODUCTIVITY MATRIX =====
function renderCashierMatrix(m) {
  const body = document.getElementById('cashierMatrixBody');
  const foot = document.getElementById('cashierMatrixFoot');
  const data = m.cashierMatrix || [];
  if (!data.length) {
    body.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-3);padding:14px">No cashier data</td></tr>';
    foot.innerHTML = '';
    return;
  }
  // (sorted by revPerDay desc inside aggregate)
  body.innerHTML = data.map((c) => `
    <tr>
      <td title="${esc(c.label)}">${esc(c.label)}</td>
      <td>${fmtN(c.days)}</td>
      <td>${fmtN(c.bills)}</td>
      <td>${num(c.billsPerDay).toFixed(1)}</td>
      <td>${fmtShort(c.amount)}</td>
      <td>${fmtShort(c.revPerDay)}</td>
      <td>${fmtShort(c.atv)}</td>
      <td>${num(c.upt).toFixed(2)}</td>
    </tr>
  `).join('');
  // De-duplicated totals, not a column sum: one receipt can list several
  // cashiers, and each of them counts it in their own row.
  const t = m.cashierTotals || {};
  foot.innerHTML = `<tr>
    <td>TOTAL / AVG</td>
    <td>${fmtN(t.days)}</td>
    <td>${fmtN(t.bills)}</td>
    <td>${num(t.billsPerDay).toFixed(1)}</td>
    <td>${fmtShort(t.amount)}</td>
    <td>${fmtShort(t.revPerDay)}</td>
    <td>${fmtShort(t.atv)}</td>
    <td>${num(t.upt).toFixed(2)}</td>
  </tr>`;
}

// ===== DOW HEATMAP =====
let DOW_METRIC = 'revenue'; // revenue | bills | atv
window.switchDowMetric = function(metric, btn) {
  DOW_METRIC = metric;
  document.querySelectorAll('#dowMetricTabs .chart-tab').forEach((t) => t.classList.remove('active'));
  btn.classList.add('active');
  if (S.raw.sales.length) renderDowHeatmap(aggregate());
};

function renderDowHeatmap(m) {
  const strip = document.getElementById('dowStrip');
  const ctxEl = document.getElementById('dowContext');
  const data = m.dowStats || [];
  const hasData = data.some((d) => d.dayCount > 0);
  if (!hasData) {
    strip.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text-3);font-size:var(--fs-sm);padding:20px">No Data</div>';
    ctxEl.textContent = 'No data';
    return;
  }
  const valFn = (d) => DOW_METRIC === 'bills' ? d.billsPerDay : DOW_METRIC === 'atv' ? d.atv : d.revPerDay;
  const fmtFn = (v) => DOW_METRIC === 'bills' ? fmtN(v) : fmtVNDShort(v);
  const values = data.map(valFn);
  const posValues = values.filter((v) => v > 0);
  const maxV = posValues.length ? Math.max(...posValues) : 0;
  const minV = posValues.length ? Math.min(...posValues) : 0;
  const peakIdx = maxV > 0 ? values.indexOf(maxV) : -1;
  const lowIdx = minV > 0 ? values.indexOf(minV) : -1;

  const totalRev = data.reduce((s, d) => s + d.revenue, 0);
  const totalDays = data.reduce((s, d) => s + d.dayCount, 0);
  const metricLbl = DOW_METRIC === 'bills' ? 'Bills/day' : DOW_METRIC === 'atv' ? 'ATV' : 'Revenue/day';
  const peakLbl = peakIdx >= 0 ? data[peakIdx].label : '—';
  ctxEl.textContent = `${metricLbl} · ${fmtN(totalDays)} days of data · Total revenue ${fmtVNDShort(totalRev)} · Peak: ${peakLbl}`;

  strip.innerHTML = data.map((d, i) => {
    const v = valFn(d);
    const intensity = maxV > 0 ? v / maxV : 0;
    const cls = i === peakIdx && d.dayCount > 0 ? 'peak' : (i === lowIdx && d.dayCount > 0 && v > 0 ? 'low' : '');
    const pctRev = totalRev > 0 ? (d.revenue / totalRev) * 100 : 0;
    return `<div class="dow-cell ${cls}">
      <div class="dow-cell-fill" style="height:${Math.max(6, intensity * 100)}%;opacity:${0.35 + intensity * 0.5}"></div>
      <div class="dow-cell-day">${d.label}</div>
      <div class="dow-cell-rev">${d.dayCount > 0 ? fmtFn(v) : '—'}</div>
      <div class="dow-cell-meta">${fmtN(d.dayCount)} days<br>${fmtPct(pctRev)} of total</div>
    </div>`;
  }).join('');
}

function switchRevChart(mode, btn) {
  S.revMode = mode;
  // Scope to this card's own tab group — a global query would also clear the
  // Day-of-Week metric tabs, which now sit on the same page.
  (btn.closest('.chart-tabs') || document).querySelectorAll('.chart-tab').forEach((t) => t.classList.remove('active'));
  btn.classList.add('active');
  if (!S.raw.sales.length) return;
  const m = aggregate();
  renderCharts(m);
}
window.switchRevChart = switchRevChart;

// Dark-mode only — theme toggle removed

async function onUpload(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  await loadFile(file);
  e.target.value = '';
}

function setStatus(text, isIdle = false) {
  const dot = document.getElementById('statusDot');
  if (isIdle) dot.classList.add('idle');
  else dot.classList.remove('idle');
  document.getElementById('statusText').textContent = text;
  document.getElementById('statusTime').textContent = new Date().toLocaleString('vi-VN');
}

// ---- Shared helper: ingest workbook + reset UI state ----
function applyWorkbook(wb, successMsg) {
  S.raw = ingestWorkbook(wb);
  S.filters ={ year: 'all', quarter: 'all', month: 'all', gender: 'all', type: 'all', store: 'all' };
  initFilters();
  // Default the Year filter to the most recent year in the data — more intuitive
  // than showing all years combined on first load. Month/Quarter stay "all" so the
  // Overview still shows the full-year trend. (The "Clear filters" button resets to all.)
  const yearsInData = [...new Set(S.raw.sales.map((r) => r.year).filter(Boolean))].sort();
  if (yearsInData.length) S.filters.year = yearsInData[yearsInData.length - 1];
  syncFilters();
  destroyAllCharts();
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('dashContent').style.display = 'block';
  renderAll();
  // Substitute the row count now that S.raw.sales is populated (callers can't
  // know the count before this function parses the workbook).
  setStatus(String(successMsg).replace('{rows}', fmtN(S.raw.sales.length)), false);
}

// ---- Fetch with timeout (returns response or throws) ----
async function fetchWithTimeout(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

// ---- Fetch + parse one Google Sheet, with retry on transient failures ----
// Mobile networks drop requests intermittently; a single retry avoids the
// "have to reload a second time" symptom without waiting the full timeout.
async function fetchSheetCandidatesWithRetry(name, urls, attempts = 3) {
  const candidates = Array.isArray(urls) ? urls : [urls];
  let lastErr;
  for (const url of candidates) {
    for (let i = 0; i < attempts; i++) {
      try {
        const sep = url.includes('?') ? '&' : '?';
        const res = await fetchWithTimeout(`${url}${sep}_=${Date.now()}`, 20000);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rawText = await res.text();
        const head = rawText.slice(0, 256).trim().toLowerCase();
        if (head.startsWith('<!doctype') || head.startsWith('<html') || head.includes('<title>sign in')) {
          throw new Error(`Sheet "${name}" is not publicly accessible. In Google Sheets -> Share -> set "Anyone with the link - Viewer".`);
        }
        const text = preprocessGSheetCsv(rawText);
        if (!text.trim()) throw new Error(`Sheet "${name}" is empty.`);
        // raw:true keeps date cells as their original text (e.g. "03/10/2024") so our
      // DD/MM/YYYY-aware parseDate handles them. With cellDates:true, SheetJS auto-
      // parses CSV dates as US MM/DD/YYYY, swapping day↔month whenever day ≤ 12.
      const parsed = XLSX.read(text, { type: 'string', raw: true });
        return parsed.Sheets[parsed.SheetNames[0]];
      } catch (err) {
        lastErr = err;
        if (/not publicly accessible|is empty/.test(err.message)) break;
        if (i < attempts - 1) await new Promise(r => setTimeout(r, 600 * (i + 1)));
      }
    }
  }
  throw lastErr;
}

// ---- Pre-process CSV text from Google Sheets ----
function preprocessGSheetCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  // Fix EU-style decimal commas in quoted numbers: "5860000,86" -> 5860000.86
  text = text.replace(/"(\d+),(\d+)"/g, '$1.$2');
  return text;
}

async function loadFile(file) {
  const overlay = document.getElementById('loadingOverlay');
  overlay.classList.add('show');
  setStatus('Loading data…', false);
  try {
    const lower = (file.name || '').toLowerCase();
    let wb;
    if (lower.endsWith('.csv')) {
      let text = await file.text();
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      // raw:true: keep CSV date text intact for parseDate (see fetchSheet* note).
      wb = XLSX.read(text, { type: 'string', raw: true });
    } else {
      const buf = await file.arrayBuffer();
      wb = XLSX.read(buf, { type: 'array', cellDates: true });
    }
    applyWorkbook(wb, `Loaded: ${file.name} · {rows} rows`);
  } catch (err) {
    console.error(err);
    destroyAllCharts();
    setStatus(`Error: ${err.message}`, true);
    alert(`⚠️ ${err.message}\n\nPlease check the Excel file and required columns:\n- DATE (transaction date)\n- BILL (0/1)\n- AMOUNT (revenue)\n- QUANTITY (qty)\n\nRecommended: add a MM/YYYY column for accurate month mapping.`);
  } finally {
    overlay.classList.remove('show');
  }
}

async function loadFromGSheets() {
  const overlay = document.getElementById('loadingOverlay');
  const syncBtn = document.getElementById('syncBtn');
  overlay.classList.add('show');
  syncBtn.disabled = true;
  setStatus('Syncing from Google Sheets…', false);
  try {
    // Fetch all sheets in parallel but tolerate partial failure: only "sale
    // data" is required to render. If the target sheet fails on a flaky mobile
    // connection we still show the dashboard instead of an empty state.
    const names = Object.keys(GSHEET_URLS);
    const results = await Promise.allSettled(
      names.map(name => fetchSheetCandidatesWithRetry(name, GSHEET_URLS[name]))
    );

    const wb = { SheetNames: [], Sheets: {} };
    const failed = [];
    results.forEach((r, i) => {
      const name = names[i];
      if (r.status === 'fulfilled') { wb.SheetNames.push(name); wb.Sheets[name] = r.value; }
      else failed.push(name);
    });

    if (!wb.SheetNames.includes('sale data')) {
      // Sales is the one sheet we can't do without — surface its error.
      const salesErr = results[names.indexOf('sale data')].reason;
      throw salesErr || new Error('Could not load "sale data".');
    }

    const now = new Date();
    const warn = failed.length ? ` · ⚠️ skipped: ${failed.join(', ')}` : '';
    applyWorkbook(wb, `Synced at ${now.toLocaleTimeString('en-GB')} · {rows} rows${warn}`);
    syncBtn.title = `Last synced: ${now.toLocaleString('en-GB')}`;
  } catch (err) {
    console.error(err);
    const msg = err.name === 'AbortError'
      ? 'Timed out. Check network and retry.'
      : err.message;
    setStatus(`Sync error: ${msg}`, true);
    if (!S.raw.sales.length) {
      // First load failed — show empty state so user has clear next action
      document.getElementById('emptyState').style.display = 'flex';
      document.getElementById('dashContent').style.display = 'none';
    } else {
      alert(`⚠️ Could not sync from Google Sheets:\n${msg}\n\nKeeping the previously loaded data.`);
    }
  } finally {
    overlay.classList.remove('show');
    syncBtn.disabled = false;
  }
}

// ======== DIMENSION FILTER HELPER (shared by dashboard + YOY) ========
function applyDimFilters(rows) {
  const f = S.filters;
  return rows.filter(r => {
    if (f.gender !== 'all' && r.gender !== f.gender) return false;
    if (f.type     !== 'all' && r.type     !== f.type)     return false;
    return true;
  });
}

// ======== YOY COMPARISON ========
const YOY = { metric: 'revenue', rangeType: 'month', month: 1, quarter: 1, customFrom: 1, customTo: 1 };
window.setYoyMetric = function(metric, btn) {
  YOY.metric = metric;
  document.querySelectorAll('.yoy-metric-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderYoy();
};
window.onYoyRangeChange = function() {
  YOY.rangeType = document.getElementById('yoyRangeType').value;
  document.getElementById('yoyMonthRow').style.display   = YOY.rangeType === 'month'   ? '' : 'none';
  document.getElementById('yoyQuarterRow').style.display = YOY.rangeType === 'quarter' ? '' : 'none';
  document.getElementById('yoyCustomRow').style.display  = YOY.rangeType === 'custom'  ? '' : 'none';
  renderYoy();
};

// Drive the YoY panel's comparison period from the top filter bar: a selected
// Month wins, else a selected Quarter, else fall back to full-year (YTD). The
// panel's own period selectors are kept in sync and can still fine-tune after.
function syncYoyFromFilters() {
  const f = S.filters;
  if (f.month !== 'all') {
    YOY.rangeType = 'month';
    YOY.month = Number(f.month) || YOY.month;
  } else if (f.quarter !== 'all') {
    YOY.rangeType = 'quarter';
    YOY.quarter = Number(String(f.quarter).replace(/\D/g, '')) || YOY.quarter;
  } else {
    YOY.rangeType = 'ytd';
  }
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  setVal('yoyRangeType', YOY.rangeType);
  setVal('yoyMonth', String(YOY.month));
  setVal('yoyQuarter', String(YOY.quarter));
  const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
  show('yoyMonthRow', YOY.rangeType === 'month');
  show('yoyQuarterRow', YOY.rangeType === 'quarter');
  show('yoyCustomRow', YOY.rangeType === 'custom');
}

function initYoyFilters() {
  const months = [...new Set(S.raw.sales.map(r => r.monthIndex).filter(v => v >= 1 && v <= 12))].sort((a,b)=>a-b);
  const mOpts = months.map(m => `<option value="${m}">${MONTH_NAMES[m-1]}</option>`).join('');
  document.getElementById('yoyMonth').innerHTML = mOpts;
  document.getElementById('yoyCustomFrom').innerHTML = mOpts;
  document.getElementById('yoyCustomTo').innerHTML = mOpts;
  if (months.length) {
    YOY.month = months[months.length - 1];
    document.getElementById('yoyMonth').value = YOY.month;
    YOY.customFrom = months[0];
    YOY.customTo   = months[months.length - 1];
    document.getElementById('yoyCustomFrom').value = YOY.customFrom;
    document.getElementById('yoyCustomTo').value   = YOY.customTo;
  }
  document.getElementById('yoyMonth').addEventListener('change', e => { YOY.month = +e.target.value; renderYoy(); });
  document.getElementById('yoyQuarter').addEventListener('change', e => { YOY.quarter = +e.target.value; renderYoy(); });
  document.getElementById('yoyCustomFrom').addEventListener('change', e => { YOY.customFrom = +e.target.value; renderYoy(); });
  document.getElementById('yoyCustomTo').addEventListener('change', e => { YOY.customTo = +e.target.value; renderYoy(); });
}

function getYoyRows(year) {
  const rows = applyDimFilters(S.raw.sales).filter(r => r.year === String(year));
  const rt = YOY.rangeType;
  if (rt === 'month')   return rows.filter(r => r.monthIndex === YOY.month);
  if (rt === 'quarter') return rows.filter(r => Math.ceil(r.monthIndex / 3) === YOY.quarter);
  if (rt === 'ytd')     return rows;
  if (rt === 'custom') {
    const lo = Math.min(YOY.customFrom, YOY.customTo);
    const hi = Math.max(YOY.customFrom, YOY.customTo);
    return rows.filter(r => r.monthIndex >= lo && r.monthIndex <= hi);
  }
  return rows;
}

function getYoyTargetRows(year) {
  return S.raw.targets.filter(t => {
    if (t.year !== String(year)) return false;
    const rt = YOY.rangeType;
    if (rt === 'month')   return t.monthIndex === YOY.month;
    if (rt === 'quarter') return Math.ceil(t.monthIndex / 3) === YOY.quarter;
    if (rt === 'ytd')     return true;
    if (rt === 'custom') {
      const lo = Math.min(YOY.customFrom, YOY.customTo);
      const hi = Math.max(YOY.customFrom, YOY.customTo);
      return t.monthIndex >= lo && t.monthIndex <= hi;
    }
    return true;
  });
}

function calcYoyMetrics(year) {
  const rows = getYoyRows(year);
  const tgts = getYoyTargetRows(year);
  const revenue = rows.reduce((s,r) => s + num(r.amount), 0);
  const qty     = rows.reduce((s,r) => s + num(r.qty), 0);
  const bills   = countBills(rows);
  const traffic = tgts.reduce((s,t) => s + num(t.traffic), 0);
  const target  = tgts.reduce((s,t) => s + num(t.target), 0);
  const atv  = bills > 0 ? revenue / bills : 0;
  const upt  = bills > 0 ? qty / bills : 0;
  const cvr  = traffic > 0 ? (bills / traffic) * 100 : 0;
  return { revenue, qty, bills, traffic, target, atv, upt, cvr, rows };
}

function getMetricVal(m, metric) {
  if (metric === 'revenue') return m.revenue;
  if (metric === 'bills')   return m.bills;
  if (metric === 'qty')     return m.qty;
  if (metric === 'atv')     return m.atv;
  if (metric === 'cvr')     return m.cvr;
  return 0;
}

function fmtMetricVal(v, metric) {
  if (metric === 'revenue') return fmtVNDShort(v);
  if (metric === 'atv')     return fmtVNDShort(v);
  if (metric === 'cvr')     return fmtPct(v);
  return fmtN(v);
}

function getYoyMonthlyData(year, months) {
  const rows = getYoyRows(year);
  const tgts = getYoyTargetRows(year);
  return months.map(m => {
    const mr = rows.filter(r => r.monthIndex === m);
    const mt = tgts.filter(t => t.monthIndex === m);
    const revenue = mr.reduce((s,r) => s + num(r.amount), 0);
    const qty     = mr.reduce((s,r) => s + num(r.qty), 0);
    const bills   = countBills(mr);
    const traffic = mt.reduce((s,t) => s + num(t.traffic), 0);
    const atv  = bills > 0 ? revenue / bills : 0;
    const cvr  = traffic > 0 ? (bills / traffic) * 100 : 0;
    return { revenue, qty, bills, atv, cvr };
  });
}

function renderYoy() {
  const section = document.getElementById('yoySection');
  if (!S.raw.sales.length) { section.style.display = 'none'; return; }
  section.style.display = '';

  const allYears = [...new Set(S.raw.sales.map(r => r.year))].sort();
  if (allYears.length < 1) return;

  const metric = YOY.metric;
  const metricsPerYear = {};
  allYears.forEach(y => { metricsPerYear[y] = calcYoyMetrics(y); });

  // Hide years with no data in the viewed period (revenue=0, bills=0, qty=0)
  const years = allYears.filter(y => {
    const m = metricsPerYear[y];
    return m.revenue > 0 || m.bills > 0 || m.qty > 0;
  });

  // ── Year summary cards (all metrics per year) ──
  const YEAR_COLORS = [
    { accent:'#3558a8', bg:'rgba(53,88,168,.07)',  border:'rgba(53,88,168,.20)',  head:'#3558a8' },
    { accent:'#2a7a50', bg:'rgba(42,122,80,.07)',  border:'rgba(42,122,80,.22)',  head:'#2a7a50' },
    { accent:'#b85c28', bg:'rgba(184,92,40,.07)',  border:'rgba(184,92,40,.22)',  head:'#b85c28' },
    { accent:'#6040a0', bg:'rgba(96,64,160,.07)',  border:'rgba(96,64,160,.20)',  head:'#6040a0' },
  ];
  let kpiHtml = '';
  years.forEach((y, i) => {
    const m = metricsPerYear[y];
    const prev = i > 0 ? metricsPerYear[years[i-1]] : null;
    const c = YEAR_COLORS[i % YEAR_COLORS.length];
    const mkDelta = (cur, prv) => {
      if (!prv || prv <= 0) return '<span class="yoy-year-metric-delta empty">&nbsp;</span>';
      const pct = ((cur - prv) / prv) * 100;
      const cls = pct > 0 ? 'up' : pct < 0 ? 'down' : 'neu';
      const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '•';
      return `<span class="yoy-year-metric-delta ${cls}">${arrow}${Math.abs(pct).toFixed(1)}%</span>`;
    };
    const rows = [
      { lbl: 'Revenue', val: fmtVNDShort(m.revenue), delta: prev ? mkDelta(m.revenue, prev.revenue) : '<span class="yoy-year-metric-delta empty">&nbsp;</span>' },
      { lbl: 'Target',    val: fmtVNDShort(m.target),  delta: '<span class="yoy-year-metric-delta empty">&nbsp;</span>' },
      { lbl: 'Bills',     val: fmtN(m.bills),          delta: prev ? mkDelta(m.bills, prev.bills) : '<span class="yoy-year-metric-delta empty">&nbsp;</span>' },
      { lbl: 'Traffic',   val: fmtN(m.traffic),        delta: prev ? mkDelta(m.traffic, prev.traffic) : '<span class="yoy-year-metric-delta empty">&nbsp;</span>' },
      { lbl: 'CVR',       val: fmtPct(m.cvr),          delta: prev ? mkDelta(m.cvr, prev.cvr) : '<span class="yoy-year-metric-delta empty">&nbsp;</span>' },
      { lbl: 'ATV',       val: fmtVNDShort(m.atv),     delta: prev ? mkDelta(m.atv, prev.atv) : '<span class="yoy-year-metric-delta empty">&nbsp;</span>' },
      { lbl: 'UPT',       val: (m.upt||0).toFixed(2),  delta: prev ? mkDelta(m.upt, prev.upt) : '<span class="yoy-year-metric-delta empty">&nbsp;</span>' },
      { lbl: 'Qty',       val: fmtN(m.qty),            delta: prev ? mkDelta(m.qty, prev.qty) : '<span class="yoy-year-metric-delta empty">&nbsp;</span>' },
    ];
    kpiHtml += `
      <div class="yoy-year-card" style="background:${c.bg};border-color:${c.border};--card-accent:${c.accent}">
        <div class="yoy-year-card-head" style="color:${c.head};font-size:16px;letter-spacing:.5px">${y}</div>
        <div class="yoy-year-metrics">
          ${rows.map(r => `
            <div class="yoy-year-metric-row" style="border-color:${c.border}">
              <span class="yoy-year-metric-lbl">${r.lbl}</span>
              <span class="yoy-year-metric-val">${r.val}</span>
              ${r.delta}
            </div>`).join('')}
        </div>
      </div>`;
  });
  document.getElementById('yoyKpiRow').innerHTML = kpiHtml;

  // ── Filter badge: show active dimension filters ──
  const _fb = document.getElementById('yoyFilterBadge');
  if (_fb) {
    const _dims = [
      S.filters.gender !== 'all' ? S.filters.gender : null,
      S.filters.type   !== 'all' ? S.filters.type   : null,
    ].filter(Boolean);
    if (_dims.length) {
      _fb.style.display = '';
      _fb.innerHTML = `<span class="yoy-filter-badge">🔍 ${_dims.map(esc).join(' · ')}</span>`;
    } else {
      _fb.style.display = 'none';
      _fb.innerHTML = '';
    }
  }

  // ── Chart: bar/line per year ──
  const rt = YOY.rangeType;
  const needMonthly = (rt === 'ytd' || rt === 'custom' || rt === 'month');
  destroyChart('yoy');

  if (needMonthly) {
    let mLo = 1, mHi = 12;
    if (rt === 'month')   { mLo = mHi = YOY.month; }
    if (rt === 'custom')  { mLo = Math.min(YOY.customFrom, YOY.customTo); mHi = Math.max(YOY.customFrom, YOY.customTo); }
    const monthRange = [];
    for (let m = mLo; m <= mHi; m++) monthRange.push(m);
    const labels = monthRange.map(m => MONTH_NAMES[m-1]);

    const COLORS = ['#1a56a8','#059669','#f59e0b','#7c3aed','#0891b2','#db2777'];
    const datasets = years.map((y, i) => {
      const data = getYoyMonthlyData(y, monthRange);
      return {
        type: 'bar',
        label: y,
        data: data.map(d => getMetricVal(d, metric)),
        backgroundColor: COLORS[i % COLORS.length] + 'cc',
        borderColor: COLORS[i % COLORS.length],
        borderWidth: 1,
        borderRadius: 4
      };
    });

    S.charts.yoy = new Chart(document.getElementById('chartYoy'), {
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: {
          legend: { display: true, labels: { color: css('--text-2'), boxWidth: 12, padding: 14, font: { size: 13 } } },
          tooltip: {
            backgroundColor: css('--surface'), titleColor: css('--text'), bodyColor: css('--text-2'),
            borderColor: css('--border'), borderWidth: 1, padding: 10,
            callbacks: { label: ctx => `${ctx.dataset.label}: ${fmtMetricVal(ctx.raw, metric)}` }
          }
        },
        scales: {
          x: { grid: { color: css('--border') }, ticks: { color: css('--text-3'), font: { size: 13 } } },
          y: { beginAtZero: true, grid: { color: css('--border') },
               ticks: { color: css('--text-3'), font: { size: 12 }, callback: v => fmtMetricVal(v, metric) } }
        }
      }
    });


  } else {
    // Quarter view: bar per quarter per year
    const quarters = [1,2,3,4];
    const labels = quarters.map(q => `Q${q}`);
    const COLORS = ['#1a56a8','#059669','#f59e0b','#7c3aed','#0891b2','#db2777'];
    const datasets = years.map((y, i) => {
      const data = quarters.map(q => {
        const mr = applyDimFilters(S.raw.sales).filter(r => r.year===y && Math.ceil(r.monthIndex/3)===q);
        const mt = S.raw.targets.filter(t => t.year===y && Math.ceil(t.monthIndex/3)===q);
        const revenue = mr.reduce((s,r)=>s+num(r.amount),0);
        const qty     = mr.reduce((s,r)=>s+num(r.qty),0);
        const bills   = countBills(mr);
        const traffic = mt.reduce((s,t)=>s+num(t.traffic),0);
        const atv = bills>0?revenue/bills:0;
        const cvr = traffic>0?(bills/traffic)*100:0;
        return getMetricVal({revenue,qty,bills,atv,cvr},metric);
      });
      return { type:'bar', label:y, data, backgroundColor:COLORS[i%COLORS.length]+'cc', borderColor:COLORS[i%COLORS.length], borderWidth:1, borderRadius:4 };
    });
    S.charts.yoy = new Chart(document.getElementById('chartYoy'), {
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: {
          legend: { display:true, labels:{ color:css('--text-2'), boxWidth:12, padding:14, font:{size:13} } },
          tooltip: { backgroundColor:css('--surface'), titleColor:css('--text'), bodyColor:css('--text-2'), borderColor:css('--border'), borderWidth:1, padding:10,
            callbacks:{ label: ctx=>`${ctx.dataset.label}: ${fmtMetricVal(ctx.raw,metric)}` } }
        },
        scales: {
          x: { grid:{color:css('--border')}, ticks:{color:css('--text-3'),font:{size:13}} },
          y: { beginAtZero:true, grid:{color:css('--border')}, ticks:{color:css('--text-3'),font:{size:13}, callback:v=>fmtMetricVal(v,metric)} }
        }
      }
    });
  }
}
window.renderYoy = renderYoy;

function bindEvents() {
  [['fYear', 'year'], ['fQuarter', 'quarter'], ['fMonth', 'month'], ['fGender', 'gender'], ['fType', 'type'], ['fStore', 'store']]
    .forEach(([id, key]) => {
      document.getElementById(id)?.addEventListener('change', (e) => {
        S.filters[key] = e.target.value;
        highlightActiveFilters();
        renderAll();
      });
    });

  // Mobile filter toggle
  document.getElementById('filterToggle')?.addEventListener('click', () => {
    document.getElementById('filterBar').classList.toggle('filter-open');
  });

  document.getElementById('resetBtn').addEventListener('click', () => {
    S.filters = { year: 'all', quarter: 'all', month: 'all', gender: 'all', type: 'all', store: 'all' };
    S.revMode = 'monthly';
    document.getElementById('filterBar').classList.remove('filter-open');
    syncFilters();
    renderAll();
  });

  // Mobile: dismiss chart tooltip when tapping/clicking outside a canvas
  const hideExtTooltip = (e) => {
    if (e.target.tagName !== 'CANVAS') {
      const tt = document.getElementById('chartjs-ext-tooltip');
      if (tt) tt.style.opacity = 0;
    }
  };
  document.addEventListener('click', hideExtTooltip);
  document.addEventListener('touchstart', hideExtTooltip, { passive: true });

  document.getElementById('fileInput').addEventListener('change', onUpload);
  // theme toggle removed — dark mode only

  const dz = document.getElementById('dropZone');
  if (dz) {
    ['dragover', 'dragenter'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('dragover'); }));
    dz.addEventListener('drop', (e) => {
      const f = e.dataTransfer?.files?.[0];
      if (f) loadFile(f);
    });
  }
}

bindEvents();
document.getElementById('syncBtn').addEventListener('click', loadFromGSheets);
loadFromGSheets();
window.addEventListener('resize', () => { if (S.raw.sales.length) syncCharts(); });
