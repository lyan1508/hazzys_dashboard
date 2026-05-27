const S = {
  raw: { sales: [], targets: [], inventory: [], inventoryMeta: null },
  filters: { year: 'all', quarter: 'all', month: 'all', gender: 'all', type: 'all' },
  charts: {},
  revMode: 'monthly',
  cashierSelected: [],
};

const PALETTE = {
  multi: ['#1a56a8', '#059669', '#f59e0b', '#7c3aed', '#0891b2', '#db2777', '#dc2626', '#d97706'],
  gender: ['#1a56a8', '#db2777', '#f59e0b', '#6b7280']
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Bill flag column 0/1 */
const BILL_FIELD_ALIASES = ['bill', 'billflag', 'bill_flag', 'billno', 'bill_no', 'billnumber', 'billind', 'isbill', 'billindicator'];

// Spreadsheet must be shared "Anyone with the link can view" for these to work.
const GSHEET_BASE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT1crTHmD1Z5svqyGnu5FATk0Uxy2qoGEa4Faq_ayyiDa710qOq-NrAHHLvcYNBI_2RgMAUclr-UlVl/pub?output=csv';
const GSHEET_URLS = {
  'sale data':  GSHEET_BASE + '101553965',
  'target':     GSHEET_BASE + '281316279',
  'inventory':  GSHEET_BASE + '2031169837',
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
    return new Date(v.getFullYear(), v.getMonth(), v.getDate());
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
  if (Ymd) return new Date(Number(Ymd[1]), Number(Ymd[2]) - 1, Number(Ymd[3]));
  return null;
}

function parseMonthText(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return new Date(v.getFullYear(), v.getMonth(), 1);
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
    Bill: BILL_FIELD_ALIASES
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
  const masterRowsRaw = pickSheet(['master', 'catalog', 'product', 'inventory']) || [];

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
    const date = txDate || monthDate;
    if (!date) return null;
    const baseMonth = monthDate || date;
    const billFlag = num(readField(r, BILL_FIELD_ALIASES));
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
    return true;
  });
}

function filteredTargetsRows() {
  const f = S.filters;
  return S.raw.targets.filter((t) => {
    if (f.year !== 'all' && t.year !== f.year) return false;
    if (f.month !== 'all' && String(t.monthIndex).padStart(2, '0') !== f.month) return false;
    if (f.quarter !== 'all' && `Q${Math.ceil(t.monthIndex / 3)}` !== f.quarter) return false;
    return true;
  });
}

function safeGroupSum(rows, key) {
  const map = new Map();
  rows.forEach((r) => {
    const k = normalizeGroup(r[key]);
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
        bills: 0
      });
    }
    const m = monthMap.get(r.monthKey);
    m.actual += num(r.amount);
    m.qty += num(r.qty);
    m.bills += num(r.billFlag);
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
        bills: 0
      });
    }
    const m = monthMap.get(t.monthKey);
    m.target += num(t.target);
    m.traffic += num(t.traffic);
  });

  const months = [...monthMap.values()].sort((a, b) => a.monthKey.localeCompare(b.monthKey)).map((m) => {
    const billCount = num(m.bills);
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
  const bills = rows.reduce((s, r) => s + (num(r.billFlag) > 0 ? num(r.billFlag) : 0), 0);
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
      const p = map.get(key) || { label: key, amount: 0, qty: 0, bills: 0 };
      p.amount += num(r.amount);
      p.qty += num(r.qty);
      p.bills += num(r.billFlag) > 0 ? num(r.billFlag) : 0;
      map.set(key, p);
    });
    return [...map.values()].sort((a, b) => b.amount - a.amount);
  })();
  const cashierStats = (() => {
    const map = new Map();
    rows.forEach((r) => {
      const key = normalizeGroup(r.cashier);
      if (!key || key === 'UNKNOWN') return;
      const p = map.get(key) || { label: key, amount: 0, qty: 0, bills: 0 };
      p.amount += num(r.amount);
      p.qty += num(r.qty);
      p.bills += num(r.billFlag) > 0 ? num(r.billFlag) : 0;
      map.set(key, p);
    });
    return [...map.values()].sort((a, b) => b.amount - a.amount);
  })();

  const sortedDates = rows.map((r) => r.date).sort((a, b) => a - b);
  const rangeFrom = sortedDates[0]?.toLocaleDateString('vi-VN') || '—';
  const rangeTo = sortedDates[sortedDates.length - 1]?.toLocaleDateString('vi-VN') || '—';

  // ── ABC / Pareto over 9-char product model codes (source: valid 14-char SKUs) ──
  const abcAll = (() => {
    const map = new Map();
    rows.forEach((r) => {
      const raw = String(r.sku || r.upc || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (raw.length !== 14) return;
      const key = raw.slice(0, 9);
      const p = map.get(key) || { sku: key, value: 0, qty: 0 };
      p.value += num(r.amount);
      p.qty += num(r.qty);
      map.set(key, p);
    });
    const arr = [...map.values()].filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
    const total = arr.reduce((s, p) => s + p.value, 0);
    let cum = 0;
    arr.forEach((p) => { cum += p.value; p.cumPct = total > 0 ? (cum / total) * 100 : 0; p.tier = p.cumPct <= 80 ? 'A' : p.cumPct <= 95 ? 'B' : 'C'; });
    const counts = { A: 0, B: 0, C: 0 };
    const revenue = { A: 0, B: 0, C: 0 };
    arr.forEach((p) => { counts[p.tier]++; revenue[p.tier] += p.value; });
    return { arr, total, counts, revenue };
  })();

  // ── Cashier matrix: enrich cashierStats with daysWorked & per-day metrics ──
  const cashierMatrix = (() => {
    const map = new Map();
    rows.forEach((r) => {
      const key = normalizeGroup(r.cashier);
      if (!key || key === 'UNKNOWN') return;
      const p = map.get(key) || { label: key, amount: 0, qty: 0, bills: 0, dates: new Set() };
      p.amount += num(r.amount);
      p.qty += num(r.qty);
      p.bills += num(r.billFlag) > 0 ? num(r.billFlag) : 0;
      p.dates.add(r.dateStr);
      map.set(key, p);
    });
    return [...map.values()].map((p) => ({
      label: p.label,
      amount: p.amount,
      qty: p.qty,
      bills: p.bills,
      days: p.dates.size,
      billsPerDay: p.dates.size > 0 ? p.bills / p.dates.size : 0,
      revPerDay: p.dates.size > 0 ? p.amount / p.dates.size : 0,
      atv: p.bills > 0 ? p.amount / p.bills : 0,
      upt: p.bills > 0 ? p.qty / p.bills : 0,
    })).sort((a, b) => b.revPerDay - a.revPerDay);
  })();

  // ── DOW stats: Mon..Sun (display order) ──
  const dowStats = (() => {
    const DAY_NAMES_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const buckets = [0,1,2,3,4,5,6].map((d) => ({
      dow: d, label: DAY_NAMES_EN[d], revenue: 0, qty: 0, bills: 0, dates: new Set()
    }));
    rows.forEach((r) => {
      if (!r.date) return;
      const d = r.date.getDay();
      const b = buckets[d];
      b.revenue += num(r.amount);
      b.qty += num(r.qty);
      b.bills += num(r.billFlag) > 0 ? num(r.billFlag) : 0;
      b.dates.add(r.dateStr);
    });
    buckets.forEach((b) => {
      b.dayCount = b.dates.size;
      b.revPerDay = b.dayCount > 0 ? b.revenue / b.dayCount : 0;
      b.billsPerDay = b.dayCount > 0 ? b.bills / b.dayCount : 0;
      b.atv = b.bills > 0 ? b.revenue / b.bills : 0;
      delete b.dates;
    });
    // Display order: Mon..Sat..Sun
    return [1,2,3,4,5,6,0].map((i) => buckets[i]);
  })();

  return {
    rows, months, totalSales, qty, bills, traffic, target, cvr, atv, upt, topProducts, byType: safeGroupSum(rows, 'type'),
    byGender: safeGroupSum(rows, 'gender'), promotionStats, cashierStats, cashierMatrix, abcAll, dowStats, rangeFrom, rangeTo
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
  const hasData = m.months.length > 0;
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

  renderDoughnut('type', 'chartType', 'dTypeVal', 'legendType', m.byType, PALETTE.multi);
  renderDoughnut('gender', 'chartGender', 'dGenderVal', 'legendGender', m.byGender, PALETTE.gender);
  renderPromotionInfo(m);
  renderCashierBar(m);

  if (!hasData) return;
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
  const tgtEl = document.getElementById('kTarget');
  const achEl = document.getElementById('kAchieve');
  const achSub = document.getElementById('kAchieveSub');
  const achBar = document.getElementById('kAchieveBar');

  tgtEl.textContent = target > 0 ? fmtVNDShort(target) : '—';
  achEl.classList.remove('good', 'warn', 'bad');

  if (target > 0) {
    const pct = (num(m.totalSales) / target) * 100;
    achEl.textContent = fmtPct(pct);
    const gap = num(m.totalSales) - target;
    achSub.textContent = (gap >= 0 ? 'Over ' : 'Under ') + fmtVNDShort(Math.abs(gap));
    let cls, grad;
    if (pct >= 100)      { cls = 'good'; grad = 'linear-gradient(90deg,#16a34a,#4ade80)'; }
    else if (pct >= 80)  { cls = 'warn'; grad = 'linear-gradient(90deg,#d97706,#fbbf24)'; }
    else                 { cls = 'bad';  grad = 'linear-gradient(90deg,#dc2626,#f87171)'; }
    achEl.classList.add(cls);
    achBar.style.background = grad;
  } else {
    achEl.textContent = '—';
    achSub.textContent = 'No target set';
    achBar.style.background = 'linear-gradient(90deg,#94a3b8,#cbd5e1)';
  }
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
}

function syncFilters() {
  document.getElementById('fYear').value = S.filters.year;
  document.getElementById('fQuarter').value = S.filters.quarter;
  document.getElementById('fMonth').value = S.filters.month;
  document.getElementById('fGender').value = S.filters.gender;
  document.getElementById('fType').value = S.filters.type;
  highlightActiveFilters();
}

function highlightActiveFilters() {
  [['fYear','year'],['fQuarter','quarter'],['fMonth','month'],['fGender','gender'],['fType','type']]
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
  renderAbcPareto(m);
  renderCashierMatrix(m);
  renderTargetPace();
  renderDowHeatmap(m);
  renderYoy();
  renderForecast();
  renderInventory();
  requestAnimationFrame(() => syncCharts());
}

// ===== ABC / PARETO =====
function renderAbcPareto(m) {
  const sumEl = document.getElementById('abcSummary');
  const abc = m.abcAll;
  if (!abc || !abc.arr.length) {
    sumEl.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text-3);font-size:12px;padding:8px">No Data</div>';
    destroyChart('abc');
    return;
  }
  const totalSKU = abc.arr.length;
  const tierCard = (tier, lbl) => {
    const cnt = abc.counts[tier];
    const rev = abc.revenue[tier];
    const pctSku = totalSKU > 0 ? (cnt / totalSKU) * 100 : 0;
    const pctRev = abc.total > 0 ? (rev / abc.total) * 100 : 0;
    return `<div class="abc-chip tier-${tier.toLowerCase()}">
      <div class="abc-chip-lbl">${lbl}</div>
      <div class="abc-chip-val">${fmtN(cnt)} SKU</div>
      <div class="abc-chip-sub">${fmtPct(pctSku)} of SKUs · ${fmtPct(pctRev)} of revenue</div>
    </div>`;
  };
  sumEl.innerHTML = tierCard('A', 'Tier A · top 80%') + tierCard('B', 'Tier B · next 15%') + tierCard('C', 'Tier C · tail');

  // Chart: top 25 SKU bar + cumulative % line
  const top = abc.arr.slice(0, 25);
  const labels = top.map((p) => p.sku.length > 12 ? p.sku.slice(0, 12) + '…' : p.sku);
  const revData = top.map((p) => p.value);
  const cumData = top.map((p) => p.cumPct);
  const colors = top.map((p) => p.tier === 'A' ? css('--green') : p.tier === 'B' ? '#d97706' : css('--red'));

  destroyChart('abc');
  S.charts.abc = new Chart(document.getElementById('chartAbc'), {
    data: {
      labels,
      datasets: [
        {
          type: 'bar', label: 'Revenue', data: revData, backgroundColor: colors,
          borderRadius: 4, maxBarThickness: 22, yAxisID: 'y', order: 2
        },
        {
          type: 'line', label: 'Cumulative %', data: cumData,
          borderColor: css('--brand-mid'), backgroundColor: 'transparent',
          borderWidth: 2, pointRadius: 2, tension: 0.2, yAxisID: 'y1', order: 1
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', align: 'end',
          labels: { color: css('--text-2'), boxWidth: 10, padding: 8, font: { size: 11 } } },
        tooltip: {
          backgroundColor: css('--surface'), titleColor: css('--text'), bodyColor: css('--text-2'),
          borderColor: css('--border'), borderWidth: 1, padding: 10,
          callbacks: {
            title: (ctx) => top[ctx[0].dataIndex].sku,
            label: (ctx) => {
              const i = ctx.dataIndex; const p = top[i];
              if (ctx.dataset.label === 'Revenue') return `Revenue: ${fmtVND(p.value)} · ${p.qty} pcs · ${p.tier}`;
              return `Cumulative: ${fmtPct(p.cumPct)}`;
            }
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: css('--text-3'), font: { size: 10 }, maxRotation: 60, minRotation: 45 } },
        y: { type: 'linear', position: 'left', beginAtZero: true,
          title: { display: true, text: 'Revenue', color: css('--text-3'), font: { size: 10 } },
          grid: { color: css('--border') }, ticks: { color: css('--text-3'), font: { size: 10 }, callback: (v) => fmtShort(v) } },
        y1: { type: 'linear', position: 'right', beginAtZero: true, max: 100,
          title: { display: true, text: 'Cum %', color: css('--text-3'), font: { size: 10 } },
          grid: { drawOnChartArea: false }, ticks: { color: css('--brand-mid'), font: { size: 10 }, callback: (v) => v + '%' } }
      }
    }
  });
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
  const totBills = data.reduce((s, c) => s + c.bills, 0);
  const totAmount = data.reduce((s, c) => s + c.amount, 0);
  const totQty = data.reduce((s, c) => s + c.qty, 0);
  const totDays = data.reduce((s, c) => s + c.days, 0);
  const avgBillsPerDay = totDays > 0 ? totBills / totDays : 0;
  const avgRevPerDay = totDays > 0 ? totAmount / totDays : 0;
  const avgAtv = totBills > 0 ? totAmount / totBills : 0;
  const avgUpt = totBills > 0 ? totQty / totBills : 0;
  foot.innerHTML = `<tr>
    <td>TOTAL / AVG</td>
    <td>${fmtN(totDays)}</td>
    <td>${fmtN(totBills)}</td>
    <td>${avgBillsPerDay.toFixed(1)}</td>
    <td>${fmtShort(totAmount)}</td>
    <td>${fmtShort(avgRevPerDay)}</td>
    <td>${fmtShort(avgAtv)}</td>
    <td>${avgUpt.toFixed(2)}</td>
  </tr>`;
}

// ===== TARGET PACE =====
// Uses ALL data (ignores filters) to find latest period being run,
// then computes actual-to-date vs expected-to-date vs required-pace for remaining days.
function renderTargetPace() {
  const ctxEl = document.getElementById('paceContext');
  const allDates = S.raw.sales.map((r) => r.date).filter(Boolean);
  if (!allDates.length) {
    ctxEl.textContent = 'No sales data';
    return;
  }
  const latest = new Date(Math.max(...allDates.map((d) => +d)));
  const cy = latest.getFullYear();
  const cm = latest.getMonth() + 1;
  const cq = Math.ceil(cm / 3);
  ctxEl.textContent = `Reference: latest data ${latest.toLocaleDateString('en-GB')} · measuring run-rate for current month/quarter/year`;

  const sumActual = (filterFn) => S.raw.sales.filter(filterFn).reduce((s, r) => s + num(r.amount), 0);
  const sumTarget = (filterFn) => S.raw.targets.filter(filterFn).reduce((s, t) => s + num(t.target), 0);

  const setCard = (prefix, name, actual, target, daysElapsed, daysTotal) => {
    document.getElementById(`pace${prefix}Name`).textContent = name;
    document.getElementById(`pace${prefix}Actual`).textContent = fmtVNDShort(actual);
    document.getElementById(`pace${prefix}Target`).textContent = target > 0 ? fmtVNDShort(target) : '—';
    const expected = target > 0 ? target * (daysElapsed / daysTotal) : 0;
    document.getElementById(`pace${prefix}Expected`).textContent = target > 0 ? fmtVNDShort(expected) : '—';
    const daysLeft = Math.max(0, daysTotal - daysElapsed);
    const required = target > 0 && daysLeft > 0 ? Math.max(0, (target - actual) / daysLeft) : 0;
    document.getElementById(`pace${prefix}Required`).textContent = target > 0
      ? (daysLeft > 0 ? `${fmtVNDShort(required)} / day × ${daysLeft} days` : 'Period ended')
      : '—';

    const pctActual = target > 0 ? (actual / target) * 100 : 0;
    const pctExpected = (daysElapsed / daysTotal) * 100;
    const bar = document.getElementById(`pace${prefix}Bar`);
    const exp = document.getElementById(`pace${prefix}Exp`);
    bar.style.width = `${Math.min(100, pctActual)}%`;
    exp.style.left = `${Math.min(100, pctExpected)}%`;

    const statusEl = document.getElementById(`pace${prefix}Status`);
    statusEl.classList.remove('ahead', 'onpace', 'behind', 'idle');
    if (target <= 0) {
      statusEl.textContent = 'No target';
      statusEl.classList.add('idle');
      bar.style.background = 'var(--text-3)';
    } else {
      const ratio = expected > 0 ? actual / expected : 1;
      let label, cls, color;
      if (ratio >= 1.05)      { label = `↑ Above pace ${fmtPct((ratio-1)*100)}`; cls = 'ahead';  color = css('--green'); }
      else if (ratio >= 0.95) { label = `≈ On pace ${fmtPct((ratio-1)*100)}`; cls = 'onpace'; color = css('--brand-mid'); }
      else                    { label = `↓ Below pace ${fmtPct((1-ratio)*100)}`; cls = 'behind'; color = css('--red'); }
      statusEl.textContent = label;
      statusEl.classList.add(cls);
      bar.style.background = color;
    }
  };

  // ── MONTH ──
  const daysInMonth = new Date(cy, cm, 0).getDate();
  const mActual = sumActual((r) => r.year === String(cy) && r.monthIndex === cm);
  const mTarget = sumTarget((t) => t.year === String(cy) && t.monthIndex === cm);
  setCard('Month', `${MONTH_NAMES[cm-1]} ${cy}`, mActual, mTarget, latest.getDate(), daysInMonth);

  // ── QUARTER ──
  const qStartM = (cq - 1) * 3 + 1;
  const qEndM = qStartM + 2;
  const qDaysTotal = (() => {
    let d = 0;
    for (let mi = qStartM; mi <= qEndM; mi++) d += new Date(cy, mi, 0).getDate();
    return d;
  })();
  const qDaysElapsed = (() => {
    let d = 0;
    for (let mi = qStartM; mi < cm; mi++) d += new Date(cy, mi, 0).getDate();
    return d + latest.getDate();
  })();
  const qActual = sumActual((r) => r.year === String(cy) && r.monthIndex >= qStartM && r.monthIndex <= qEndM);
  const qTarget = sumTarget((t) => t.year === String(cy) && t.monthIndex >= qStartM && t.monthIndex <= qEndM);
  setCard('Quarter', `Q${cq} ${cy} (${MONTH_NAMES[qStartM-1]}–${MONTH_NAMES[qEndM-1]})`, qActual, qTarget, qDaysElapsed, qDaysTotal);

  // ── YEAR ──
  const yIsLeap = (cy % 4 === 0 && cy % 100 !== 0) || (cy % 400 === 0);
  const yDaysTotal = yIsLeap ? 366 : 365;
  const startOfYear = new Date(cy, 0, 1);
  const yDaysElapsed = Math.floor((latest - startOfYear) / 86400000) + 1;
  const yActual = sumActual((r) => r.year === String(cy));
  const yTarget = sumTarget((t) => t.year === String(cy));
  setCard('Year', `Year ${cy}`, yActual, yTarget, yDaysElapsed, yDaysTotal);
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
  const fmtFn = (v) => DOW_METRIC === 'bills' ? fmtN(v) : DOW_METRIC === 'atv' ? fmtVNDShort(v) : fmtVNDShort(v);
  const values = data.map(valFn);
  const maxV = Math.max(...values, 1);
  const minV = Math.min(...values.filter((v) => v > 0));
  const peakIdx = values.indexOf(maxV);
  const lowIdx = values.indexOf(minV);

  const totalRev = data.reduce((s, d) => s + d.revenue, 0);
  const totalDays = data.reduce((s, d) => s + d.dayCount, 0);
  const metricLbl = DOW_METRIC === 'bills' ? 'Bills/day' : DOW_METRIC === 'atv' ? 'ATV' : 'Revenue/day';
  ctxEl.textContent = `${metricLbl} · ${fmtN(totalDays)} days of data · Total revenue ${fmtVNDShort(totalRev)} · Peak: ${data[peakIdx].label}`;

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

// ===== REVENUE FORECAST =====
// Builds monthly revenue history from ALL sales (ignoring filters so forecast
// reflects the business as a whole). Uses two methods:
//  - Seasonal: same-month-last-year × recent YoY growth (preferred when prior-year data exists)
//  - Linear:   trailing 6-month average × monthly growth rate (fallback)
function buildMonthlyHistory() {
  const map = new Map();
  S.raw.sales.forEach(r => {
    const d = r.date; if (!d) return;
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    map.set(key, (map.get(key) || 0) + num(r.amount));
  });
  return [...map.entries()].sort((a,b) => a[0] < b[0] ? -1 : 1)
    .map(([k, v]) => ({ key: k, y: Number(k.slice(0,4)), m: Number(k.slice(5,7)), value: v }));
}

function forecastMonth(history, targetY, targetM) {
  // Try seasonal: same month last year × growth
  const sameLastYear = history.find(h => h.y === targetY - 1 && h.m === targetM);
  if (sameLastYear && sameLastYear.value > 0) {
    // Compute average YoY growth using up to 3 most recent complete-year-pairs
    const pairs = [];
    history.forEach(h => {
      const prev = history.find(p => p.y === h.y - 1 && p.m === h.m);
      if (prev && prev.value > 0) pairs.push(h.value / prev.value);
    });
    const recent = pairs.slice(-3);
    const growth = recent.length ? recent.reduce((s,v)=>s+v,0) / recent.length : 1;
    return { value: sameLastYear.value * growth, method: 'seasonal', growth };
  }
  // Fallback: linear trend from trailing 6 months
  const tail = history.slice(-6);
  if (!tail.length) return { value: 0, method: 'none' };
  const avg = tail.reduce((s, h) => s + h.value, 0) / tail.length;
  if (tail.length < 2) return { value: avg, method: 'flat' };
  const growthRate = (tail[tail.length-1].value / tail[0].value) ** (1 / (tail.length - 1));
  return { value: avg * (Number.isFinite(growthRate) ? growthRate : 1), method: 'linear' };
}

function drawFcSparkline(elId, history, fcValue) {
  const el = document.getElementById(elId);
  if (!el) return;
  const W = 92, H = 56;
  const tail = history.slice(-6);
  if (!tail.length) { el.innerHTML = ''; return; }
  const allVals = [...tail.map(h => h.value), fcValue];
  const minV = Math.min(...allVals) * 0.88;
  const maxV = Math.max(...allVals) * 1.08;
  const rng = maxV - minV || 1;
  const sx = (i, n) => 4 + (i / (n - 1)) * (W - 8);
  const sy = v => H - 8 - ((v - minV) / rng) * (H - 16);
  const pts = tail.map((h, i) => [sx(i, tail.length + 1), sy(h.value)]);
  const fp = [sx(tail.length, tail.length + 1), sy(fcValue)];
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const fcPath = `M${pts[pts.length-1][0].toFixed(1)},${pts[pts.length-1][1].toFixed(1)}L${fp[0].toFixed(1)},${fp[1].toFixed(1)}`;
  const areaPath = `${linePath}L${pts[pts.length-1][0].toFixed(1)},${H}L${pts[0][0].toFixed(1)},${H}Z`;
  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" overflow="visible">
    <defs><linearGradient id="fcG_${elId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--brand)" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="var(--brand)" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${areaPath}" fill="url(#fcG_${elId})"/>
    <path d="${linePath}" fill="none" stroke="var(--brand)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${fcPath}" fill="none" stroke="var(--brand)" stroke-width="1.5" stroke-dasharray="3,2.5" stroke-linecap="round"/>
    ${pts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2" fill="var(--brand)" opacity="0.45"/>`).join('')}
    <circle cx="${fp[0].toFixed(1)}" cy="${fp[1].toFixed(1)}" r="3.8" fill="var(--brand)" stroke="var(--surface-2)" stroke-width="1.8"/>
  </svg>`;
}

function drawFcQuarterBars(elId, months) {
  const el = document.getElementById(elId);
  if (!el) return;
  const W = 92, H = 56;
  const maxV = Math.max(...months.map(m => m.v)) || 1;
  const bW = 22, gap = (W - months.length * bW) / (months.length + 1);
  const barMaxH = H - 16;
  const bars = months.map((m, i) => {
    const x = gap + i * (bW + gap);
    const h = Math.max(2, (m.v / maxV) * barMaxH);
    const y = H - 12 - h;
    const op = (0.45 + 0.55 * (i / (months.length - 1 || 1))).toFixed(2);
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bW}" height="${h.toFixed(1)}" rx="3" fill="var(--brand)" opacity="${op}"/>
    <text x="${(x + bW/2).toFixed(1)}" y="${(H-2).toFixed(1)}" text-anchor="middle" font-size="8" fill="var(--text-3)" font-family="inherit">${m.label}</text>`;
  });
  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${bars.join('')}</svg>`;
}

function drawFcYearBars(elId, history, currentYear, fcMap) {
  const el = document.getElementById(elId);
  if (!el) return;
  const W = 92, H = 56;
  const months = Array.from({length: 12}, (_, i) => {
    const m = i + 1;
    const act = history.find(h => h.y === currentYear && h.m === m);
    return { m, value: act ? act.value : (fcMap[m] || 0), isActual: !!act };
  });
  const maxV = Math.max(...months.map(d => d.value)) * 1.1 || 1;
  const bW = (W - 4) / 12;
  const barMaxH = H - 10;
  const sepMonth = months.findIndex(d => !d.isActual);
  const bars = months.map((d, i) => {
    const x = 2 + i * bW;
    const h = Math.max(1, (d.value / maxV) * barMaxH);
    const y = H - 8 - h;
    const fill = 'var(--brand)';
    const op = d.isActual ? (0.35 + 0.65 * ((i+1)/12)).toFixed(2) : '0.22';
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bW - 1.2).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${fill}" opacity="${op}"/>`;
  });
  let sep = '';
  if (sepMonth > 0 && sepMonth < 12) {
    const sx = (2 + sepMonth * bW - 0.8).toFixed(1);
    sep = `<line x1="${sx}" y1="2" x2="${sx}" y2="${H-8}" stroke="var(--text-3)" stroke-width="0.8" stroke-dasharray="2,2" opacity="0.6"/>`;
  }
  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${bars.join('')}${sep}</svg>`;
}

function renderForecast() {
  const history = buildMonthlyHistory();
  const methodEl = document.getElementById('forecastMethod');
  if (history.length < 2) {
    methodEl.textContent = 'Not enough data to forecast (need ≥ 2 months)';
    ['fcMonthValue','fcQuarterValue','fcYearValue'].forEach(id =>
      document.getElementById(id).textContent = '—');
    return;
  }

  const last = history[history.length - 1];
  // Next month
  let nm = last.m + 1, ny = last.y;
  if (nm > 12) { nm = 1; ny++; }
  const fc1 = forecastMonth(history, ny, nm);

  // Next quarter (3 months after the next month)
  let q = [];
  let qMonths = [];
  let cy = ny, cm = nm;
  for (let i = 0; i < 3; i++) {
    q.push(forecastMonth(history, cy, cm));
    qMonths.push({ v: q[i].value, label: MONTH_NAMES[cm-1].slice(0,3) });
    cm++; if (cm > 12) { cm = 1; cy++; }
  }
  const quarterTotal = q.reduce((s, f) => s + f.value, 0);

  // Current year: actual months so far + forecast remaining months
  const currentYear = last.y;
  const monthsActualThisYear = history.filter(h => h.y === currentYear);
  const actualSum = monthsActualThisYear.reduce((s, h) => s + h.value, 0);
  let yearForecast = actualSum;
  const lastActualMonth = Math.max(...monthsActualThisYear.map(h => h.m));
  const fcMap = {};
  for (let m = lastActualMonth + 1; m <= 12; m++) {
    const mfc = forecastMonth(history, currentYear, m);
    yearForecast += mfc.value;
    fcMap[m] = mfc.value;
  }

  // Method label
  const methodLabels = { seasonal: 'seasonal (YoY)', linear: 'recent trend', flat: 'average', none: 'insufficient data' };
  const primaryMethod = methodLabels[fc1.method] || fc1.method;
  methodEl.textContent = `Method: ${primaryMethod} · History: ${history.length} months (${history[0].key} → ${last.key})`;

  // Confidence ±15% (loose band — adjust based on data variability later)
  const band = (v) => `${fmtVNDShort(v * 0.85)} – ${fmtVNDShort(v * 1.15)}`;
  const vsText = (forecastVal, baseVal, baseLabel) => {
    if (!baseVal || baseVal <= 0) return `<span style="color:var(--text-3)">No ${baseLabel} baseline</span>`;
    const pct = ((forecastVal - baseVal) / baseVal) * 100;
    const cls = pct >= 0 ? 'up' : 'down';
    const sign = pct >= 0 ? '↑' : '↓';
    return `<span class="${cls}">${sign} ${fmtPct(Math.abs(pct))}</span> vs ${baseLabel}`;
  };

  // Next month
  document.getElementById('fcMonthName').textContent = `${MONTH_NAMES[nm-1]} ${ny}`;
  document.getElementById('fcMonthValue').textContent = fmtVNDShort(fc1.value);
  document.getElementById('fcMonthRange').textContent = `Range: ${band(fc1.value)}`;
  document.getElementById('fcMonthVs').innerHTML = vsText(fc1.value, last.value, `${MONTH_NAMES[last.m-1]} ${last.y}`);

  // Next quarter
  const qStart = `${MONTH_NAMES[nm-1]} ${ny}`;
  const qEndM = ((nm - 1 + 2) % 12) + 1;
  const qEndY = nm + 2 > 12 ? ny + 1 : ny;
  document.getElementById('fcQuarterName').textContent = `${qStart} → ${MONTH_NAMES[qEndM-1]} ${qEndY}`;
  document.getElementById('fcQuarterValue').textContent = fmtVNDShort(quarterTotal);
  document.getElementById('fcQuarterRange').textContent = `Range: ${band(quarterTotal)}`;
  // Compare with last 3 actual months
  const lastQ = history.slice(-3).reduce((s, h) => s + h.value, 0);
  document.getElementById('fcQuarterVs').innerHTML = vsText(quarterTotal, lastQ, 'last 3 months');

  // Year
  document.getElementById('fcYearName').textContent = `Year ${currentYear}`;
  document.getElementById('fcYearValue').textContent = fmtVNDShort(yearForecast);
  document.getElementById('fcYearRange').textContent = `Actual ${monthsActualThisYear.length}/12 months + forecast ${12 - monthsActualThisYear.length} months`;
  const prevYearSum = history.filter(h => h.y === currentYear - 1).reduce((s, h) => s + h.value, 0);
  document.getElementById('fcYearVs').innerHTML = vsText(yearForecast, prevYearSum, `${currentYear - 1}`);

  // Draw mini charts on the right of each card
  drawFcSparkline('fcMonthChart', history, fc1.value);
  drawFcQuarterBars('fcQuarterChart', qMonths);
  drawFcYearBars('fcYearChart', history, currentYear, fcMap);
}

function switchRevChart(mode, btn) {
  S.revMode = mode;
  document.querySelectorAll('.chart-tab').forEach((t) => t.classList.remove('active'));
  btn.classList.add('active');
  if (!S.raw.sales.length) return;
  const m = aggregate();
  renderCharts(m);
}
window.switchRevChart = switchRevChart;

// Dark-mode only — theme toggle removed
function toggleTheme() {}

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
  const prevInv = S.raw?.inventory;
  const prevInvMeta = S.raw?.inventoryMeta;
  S.raw = ingestWorkbook(wb);
  // Auto-detect inventory sheet inside the same workbook — silently ignore if not present
  try {
    const inv = parseInventoryWorkbook(wb);
    if (inv && inv.rows.length) {
      S.raw.inventory = inv.rows;
      S.raw.inventoryMeta = inv.meta;
    } else if (prevInv) {
      S.raw.inventory = prevInv;
      S.raw.inventoryMeta = prevInvMeta;
    }
  } catch {
    if (prevInv) {
      S.raw.inventory = prevInv;
      S.raw.inventoryMeta = prevInvMeta;
    }
  }
  S.filters = { year: 'all', quarter: 'all', month: 'all', category: 'all', gender: 'all', type: 'all' };
  S.cashierSelected = [];
  initFilters();
  syncFilters();
  destroyAllCharts();
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('dashContent').style.display = 'block';
  renderAll();
  setStatus(successMsg, false);
}

// ---- Fetch with timeout (returns response or throws) ----
async function fetchWithTimeout(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

// ---- Pre-process CSV text from Google Sheets ----
function preprocessGSheetCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  // Fix EU-style decimal commas in quoted numbers: "5860000,86" -> 5860000.86
  text = text.replace(/"(\d+),(\d+)"/g, '$1.$2');
  // Convert US M/D/YYYY -> ISO YYYY-MM-DD so parseDate doesn't read as D/M/Y
  text = text.replace(/(^|[,\n"\s])(\d{1,2})\/(\d{1,2})\/(\d{4})(?=[,\n"\s]|$)/g,
    (_, pre, mo, d, y) => `${pre}${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
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
      wb = XLSX.read(text, { type: 'string', cellDates: true });
    } else {
      const buf = await file.arrayBuffer();
      wb = XLSX.read(buf, { type: 'array', cellDates: true });
    }
    applyWorkbook(wb, `Loaded: ${file.name} · ${fmtN(S.raw.sales.length)} rows`);
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
    const cacheBuster = Date.now();
    const entries = await Promise.all(
      Object.entries(GSHEET_URLS).map(async ([name, url]) => {
        const res = await fetchWithTimeout(`${url}&_=${cacheBuster}`, 30000);
        if (!res.ok) throw new Error(`Failed to fetch sheet "${name}" (HTTP ${res.status})`);
        const rawText = await res.text();
        // Google returns an HTML login page (not CSV) when the sheet is not
        // shared "Anyone with the link". Detect it so the user gets a real error.
        const head = rawText.slice(0, 256).trim().toLowerCase();
        if (head.startsWith('<!doctype') || head.startsWith('<html') || head.includes('<title>sign in')) {
          throw new Error(`Sheet "${name}" is not publicly accessible. In Google Sheets → Share → set "Anyone with the link – Viewer".`);
        }
        const text = preprocessGSheetCsv(rawText);
        const parsed = XLSX.read(text, { type: 'string', cellDates: true });
        const ws = parsed.Sheets[parsed.SheetNames[0]];
        return [name, ws];
      })
    );
    const wb = { SheetNames: [], Sheets: {} };
    entries.forEach(([name, ws]) => { wb.SheetNames.push(name); wb.Sheets[name] = ws; });
    const now = new Date();
    applyWorkbook(wb, `Synced at ${now.toLocaleTimeString('en-GB')} · ${fmtN(S.raw.sales.length)} rows`);
    syncBtn.title = `Last synced: ${now.toLocaleString('en-GB')}`;
  } catch (err) {
    console.error(err);
    const msg = err.name === 'AbortError'
      ? 'Timed out (30s). Check network and retry.'
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
  const bills   = rows.reduce((s,r) => s + (num(r.billFlag) > 0 ? num(r.billFlag) : 0), 0);
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

function metricLabel(metric) {
  return { revenue:'Revenue', bills:'Bills', qty:'Qty', atv:'ATV', cvr:'CVR%' }[metric] || metric;
}

function getYoyMonthlyData(year, months) {
  const rows = getYoyRows(year);
  const tgts = getYoyTargetRows(year);
  return months.map(m => {
    const mr = rows.filter(r => r.monthIndex === m);
    const mt = tgts.filter(t => t.monthIndex === m);
    const revenue = mr.reduce((s,r) => s + num(r.amount), 0);
    const qty     = mr.reduce((s,r) => s + num(r.qty), 0);
    const bills   = mr.reduce((s,r) => s + (num(r.billFlag) > 0 ? num(r.billFlag) : 0), 0);
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
        const bills   = mr.reduce((s,r)=>s+(num(r.billFlag)>0?num(r.billFlag):0),0);
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

// ============================================================
// SPRINT 2: INVENTORY
// ============================================================

// ---- Parse Vietnamese-headered "Tổng hợp Nhập-Xuất-Tồn" sheet ----
// Sheet layout: rows 1-5 are metadata/title, row 7 has the column headers
// (Mã SKU | Tồn đầu kỳ | Nhập trong kỳ | Xuất trong kỳ | Tồn cuối kỳ | …),
// row 8 is the "Số lượng" sub-header, data starts at row 9.
function parseInventoryWorkbook(wb) {
  const sheetNames = wb.SheetNames || [];
  let meta = { periodFrom: null, periodTo: null, store: '' };
  let rows = [];

  for (const name of sheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });
    if (!grid.length) continue;

    // Locate header row by looking for "Mã SKU" or "Tồn cuối kỳ"
    let headerIdx = -1;
    for (let r = 0; r < Math.min(grid.length, 20); r++) {
      const row = grid[r] || [];
      const flat = row.map((v) => String(v ?? '').toLowerCase()).join('|');
      if (flat.includes('mã sku') && flat.includes('tồn cuối')) { headerIdx = r; break; }
    }
    if (headerIdx < 0) continue;

    // Extract period info from rows above header
    for (let r = 0; r < headerIdx; r++) {
      const text = (grid[r] || []).map((v) => String(v ?? '')).join(' ');
      const m = text.match(/Từ ngày:\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*Đến ngày:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
      if (m) { meta.periodFrom = m[1]; meta.periodTo = m[2]; }
      const s = text.match(/Cửa hàng:\s*([^;]+)/i);
      if (s) meta.store = s[1].trim();
    }

    // Map header columns by Vietnamese name
    const headerRow = (grid[headerIdx] || []).map((v) => String(v ?? '').trim().toLowerCase());
    const colIdx = {
      sku: headerRow.findIndex((h) => h.includes('mã sku') || h === 'sku'),
      opening: headerRow.findIndex((h) => h.includes('tồn đầu')),
      received: headerRow.findIndex((h) => h.includes('nhập trong')),
      out: headerRow.findIndex((h) => h.includes('xuất trong')),
      closing: headerRow.findIndex((h) => h.includes('tồn cuối')),
      transitOut: headerRow.findIndex((h) => h.includes('chuyển đi')),
      incoming: headerRow.findIndex((h) => h.includes('sắp nhận')),
    };
    if (colIdx.sku < 0 || colIdx.closing < 0) continue;

    // Data rows start 2 after header (skip "Số lượng" sub-row)
    const dataStart = headerIdx + 2;
    for (let r = dataStart; r < grid.length; r++) {
      const row = grid[r] || [];
      const sku = String(row[colIdx.sku] ?? '').trim();
      if (!sku) continue;
      // Only keep 14-character SKUs (full Hazzys product codes incl. color+size)
      if (sku.length !== 14) continue;
      // Skip TOTAL / summary rows
      if (/^(tổng|total|t\.cộng)/i.test(sku)) continue;
      rows.push({
        sku: sku,
        styleKey: styleKey9(sku),
        opening: num(row[colIdx.opening]),
        received: num(row[colIdx.received]),
        out: num(row[colIdx.out]),
        closing: num(row[colIdx.closing]),
        transitOut: colIdx.transitOut >= 0 ? num(row[colIdx.transitOut]) : 0,
        incoming: colIdx.incoming >= 0 ? num(row[colIdx.incoming]) : 0,
      });
    }
    if (rows.length) break;
  }

  if (!rows.length) throw new Error('No valid stock sheet found. File must contain headers "Mã SKU" and "Tồn cuối kỳ", and 14-char SKU codes.');

  return { rows, meta };
}

async function onInventoryUpload(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  await loadInventoryFile(file);
  e.target.value = '';
}

async function loadInventoryFile(file) {
  const overlay = document.getElementById('loadingOverlay');
  overlay.classList.add('show');
  setStatus('Processing stock file…', false);
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const { rows, meta } = parseInventoryWorkbook(wb);
    S.raw.inventory = rows;
    S.raw.inventoryMeta = meta;
    renderInventory();
    const periodStr = meta.periodFrom ? ` · Period: ${meta.periodFrom} → ${meta.periodTo}` : '';
    setStatus(`Stock loaded: ${fmtN(rows.length)} SKUs${periodStr}`, false);
  } catch (err) {
    console.error(err);
    setStatus(`Stock load error: ${err.message}`, true);
    alert(`⚠️ ${err.message}`);
  } finally {
    overlay.classList.remove('show');
  }
}

// ---- Aggregate inventory: join with sales velocity ----
function aggregateInventory() {
  const inv = S.raw.inventory || [];
  if (!inv.length) return null;

  // Build per-SKU index from sales: prefer exact 14-char match, fall back to styleKey9.
  const salesBySku = new Map();
  const salesByStyle = new Map();
  S.raw.sales.forEach((r) => {
    const raw = String(r.sku || r.upc || '').trim();
    const exactKey = raw.length === 14 ? normalizeGroup(raw) : null;
    const styleKey = r.productKey || styleKey9(raw);
    const updateBucket = (map, key) => {
      if (!key) return;
      const p = map.get(key) || { key, type: r.type, gender: r.gender, category: r.category, sales90: 0, sales30: 0, salesAll: 0 };
      p.salesAll += num(r.qty);
      if (r.date) {
        const today = new Date();
        const daysAgo = (today - r.date) / 86400000;
        if (daysAgo <= 30) p.sales30 += num(r.qty);
        if (daysAgo <= 90) p.sales90 += num(r.qty);
      }
      map.set(key, p);
    };
    updateBucket(salesBySku, exactKey);
    updateBucket(salesByStyle, styleKey);
  });

  // Enrich each inventory row — exact 14-char SKU join first, fall back to style-level
  const enriched = inv.map((r) => {
    const skuKey = normalizeGroup(r.sku);
    const salesInfo = salesBySku.get(skuKey) || salesByStyle.get(r.styleKey) || {};
    const stock = r.closing;
    const sales30 = num(salesInfo.sales30);
    const sales90 = num(salesInfo.sales90);
    const dailyVel = sales30 / 30; // units per day, recent
    const daysOfStock = dailyVel > 0 ? stock / dailyVel : (stock > 0 ? 999 : 0);
    // Sell-through over the inventory period
    const denom = num(r.opening) + num(r.received);
    const sellThrough = denom > 0 ? (num(r.out) / denom) * 100 : 0;
    // Stockout risk: sales velocity > 0 AND stock < projected 30-day sales
    const proj30 = sales30; // already 30 days
    const stockoutRisk = sales30 > 0 && stock < proj30 ? (proj30 - stock) / proj30 : 0;
    // Aging: high stock + low recent sales
    const isAging = stock >= 3 && sales90 < (stock * 0.2);

    // Derive category directly from the 14-char SKU (pos 3-4) — never UNKNOWN for valid Hazzys codes
    const skuCat = deriveCategory('', salesInfo.category, salesInfo.type, r.sku);
    return {
      ...r,
      type: salesInfo.type || 'UNKNOWN',
      gender: salesInfo.gender || 'UNKNOWN',
      category: skuCat,
      sales30, sales90, dailyVel,
      daysOfStock,
      sellThrough,
      stockoutRisk,
      isAging,
      hasRecentSales: sales30 > 0,
    };
  });

  // Drop any UNKNOWN-category rows from inventory stats per user request
  const known = enriched.filter((r) => r.category && r.category !== 'UNKNOWN');

  // Apply dimension filters (category/gender/type from main filter bar) — only those that make sense
  const f = S.filters;
  const filtered = known.filter((r) => {
    if (f.gender !== 'all' && r.gender !== f.gender) return false;
    if (f.type !== 'all' && r.type !== f.type) return false;
    return true;
  });

  // Totals
  const totalSku = filtered.length;
  const totalStock = filtered.reduce((s, r) => s + num(r.closing), 0);
  const totalOpening = filtered.reduce((s, r) => s + num(r.opening), 0);
  const totalReceived = filtered.reduce((s, r) => s + num(r.received), 0);
  const totalOut = filtered.reduce((s, r) => s + num(r.out), 0);
  const sellThroughAgg = (totalOpening + totalReceived) > 0
    ? (totalOut / (totalOpening + totalReceived)) * 100
    : 0;

  // Group by category
  const byCategory = (() => {
    const map = new Map();
    filtered.forEach((r) => {
      const cat = r.category || 'UNKNOWN';
      const p = map.get(cat) || { label: cat, stock: 0, opening: 0, received: 0, out: 0, skuCount: 0 };
      p.stock += num(r.closing);
      p.opening += num(r.opening);
      p.received += num(r.received);
      p.out += num(r.out);
      p.skuCount += 1;
      map.set(cat, p);
    });
    return [...map.values()].map((p) => ({
      ...p,
      sellThrough: (p.opening + p.received) > 0 ? (p.out / (p.opening + p.received)) * 100 : 0,
    })).sort((a, b) => b.stock - a.stock);
  })();

  // Aggregate per 9-char product model (Brand+Cat+Year+Season+Design) — sum across size/color variants
  const byStyle = (() => {
    const map = new Map();
    filtered.forEach((r) => {
      const k = r.styleKey;
      if (!k || k === 'UNKNOWN') return;
      const p = map.get(k) || { sku: k, stock: 0, opening: 0, received: 0, out: 0, sales30: 0, sales90: 0 };
      p.stock    += num(r.closing);
      p.opening  += num(r.opening);
      p.received += num(r.received);
      p.out      += num(r.out);
      p.sales30  += num(r.sales30);
      p.sales90  += num(r.sales90);
      map.set(k, p);
    });
    return [...map.values()].map((p) => {
      const dailyVel    = p.sales30 / 30;
      const daysOfStock = dailyVel > 0 ? p.stock / dailyVel : (p.stock > 0 ? 999 : 0);
      return {
        ...p,
        dailyVel,
        daysOfStock,
        hasRecentSales: p.sales30 > 0,
        isAging: p.stock >= 3 && p.sales90 < (p.stock * 0.2),
      };
    });
  })();

  // Stockout alerts (style-level): recent sales AND projected to run out in ≤ 30 days (or already out)
  const stockoutAlerts = byStyle
    .filter((p) => p.hasRecentSales && (p.stock === 0 || p.daysOfStock <= 30))
    .map((p) => ({
      sku: p.sku,
      stock: p.stock,
      sales30: p.sales30,
      daysLeft: p.daysOfStock,
      severity: p.stock === 0 ? 'critical' : p.daysOfStock <= 7 ? 'critical' : p.daysOfStock <= 14 ? 'warn' : 'ok',
    }))
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 50);

  // Aging (style-level): stock ≥ 3 and 90-day sales < 20% of stock
  const aging = byStyle
    .filter((p) => p.isAging)
    .map((p) => ({
      sku: p.sku,
      stock: p.stock,
      sales90: p.sales90,
      daysOfStock: p.daysOfStock,
      severity: p.sales90 === 0 ? 'critical' : p.daysOfStock > 365 ? 'critical' : p.daysOfStock > 180 ? 'warn' : 'ok',
    }))
    .sort((a, b) => b.stock - a.stock)
    .slice(0, 50);

  const atRiskCount = stockoutAlerts.length + aging.length;

  return {
    rows: filtered,
    totalSku, totalStock, sellThrough: sellThroughAgg, atRiskCount,
    totalOpening, totalReceived, totalOut,
    byCategory, stockoutAlerts, aging,
  };
}

// ---- Render Inventory section ----
function renderInventory() {
  const section = document.getElementById('invSection');
  const empty = document.getElementById('invEmpty');
  const content = document.getElementById('invContent');
  if (!section) return;

  const m = aggregateInventory();
  if (!m) {
    empty.style.display = '';
    content.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  content.style.display = '';

  // Header sub-text
  const meta = S.raw.inventoryMeta || {};
  const headSub = document.getElementById('invHeadSub');
  const periodStr = meta.periodFrom ? `${meta.periodFrom} → ${meta.periodTo}` : '—';
  headSub.textContent = `${meta.store || 'All stores'} · ${periodStr}`;

  // KPIs
  document.getElementById('invKpiSkuVal').textContent = fmtN(m.totalSku);
  document.getElementById('invKpiStockVal').textContent = fmtN(m.totalStock);
  document.getElementById('invKpiSellThroughVal').textContent = fmtPct(m.sellThrough);
  document.getElementById('invKpiAtRiskVal').textContent = fmtN(m.atRiskCount);

  // Color KPIs based on health
  const sellKpi = document.getElementById('invKpiSellThrough');
  sellKpi.classList.remove('good', 'warn', 'bad');
  if (m.sellThrough >= 70) sellKpi.classList.add('good');
  else if (m.sellThrough >= 40) sellKpi.classList.add('warn');
  else sellKpi.classList.add('bad');

  // Chart: Stock by Category
  renderInvByCategoryChart(m);
  // Chart: Sell-through by Category
  renderInvSellThroughChart(m);
  // Tables
  renderInvStockoutTable(m);
  renderInvAgingTable(m);
}

function renderInvByCategoryChart(m) {
  const data = m.byCategory.slice(0, 12);
  document.getElementById('invStockByCatSub').textContent = `Top ${data.length} · ${fmtN(m.totalStock)} units`;
  destroyChart('invByCat');
  if (!data.length) return;
  S.charts.invByCat = new Chart(document.getElementById('chartInvByCat'), {
    type: 'bar',
    data: {
      labels: data.map((d) => d.label),
      datasets: [
        { label: 'Closing', data: data.map((d) => d.stock), backgroundColor: css('--brand-mid'), borderRadius: 4, maxBarThickness: 28 },
        { label: 'Out', data: data.map((d) => d.out), backgroundColor: css('--green'), borderRadius: 4, maxBarThickness: 28 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      indexAxis: 'y',
      plugins: {
        legend: { display: true, position: 'top', align: 'end', labels: { color: css('--text-2'), boxWidth: 10, font: { size: 11 } } },
        tooltip: { backgroundColor: css('--surface'), titleColor: css('--text'), bodyColor: css('--text-2'), borderColor: css('--border'), borderWidth: 1, padding: 10,
          callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtN(ctx.raw)} units` } },
      },
      scales: {
        x: { beginAtZero: true, grid: { color: css('--border') }, ticks: { color: css('--text-3'), font: { size: 10 }, callback: (v) => fmtShort(v) } },
        y: { grid: { display: false }, ticks: { color: css('--text-3'), font: { size: 10 } } },
      },
    },
  });
}

function renderInvSellThroughChart(m) {
  const data = m.byCategory.filter((d) => (d.opening + d.received) > 0).slice(0, 12);
  document.getElementById('invSellThroughSub').textContent = `Average ${fmtPct(m.sellThrough)}`;
  destroyChart('invSellThrough');
  if (!data.length) return;
  const colors = data.map((d) => d.sellThrough >= 70 ? css('--green') : d.sellThrough >= 40 ? '#d97706' : css('--red'));
  S.charts.invSellThrough = new Chart(document.getElementById('chartInvSellThrough'), {
    type: 'bar',
    data: {
      labels: data.map((d) => d.label),
      datasets: [{ label: 'Sell-through %', data: data.map((d) => d.sellThrough), backgroundColor: colors, borderRadius: 4, maxBarThickness: 28 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: css('--surface'), titleColor: css('--text'), bodyColor: css('--text-2'), borderColor: css('--border'), borderWidth: 1, padding: 10,
          callbacks: {
            label: (ctx) => {
              const d = data[ctx.dataIndex];
              return [`Sell-through: ${fmtPct(d.sellThrough)}`, `Out ${fmtN(d.out)} / In+Opening ${fmtN(d.opening + d.received)}`];
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: css('--text-3'), font: { size: 10 }, maxRotation: 45, minRotation: 30 } },
        y: { beginAtZero: true, max: 100, grid: { color: css('--border') }, ticks: { color: css('--text-3'), font: { size: 10 }, callback: (v) => v + '%' } },
      },
    },
  });
}

function renderInvStockoutTable(m) {
  const body = document.getElementById('invStockoutBody');
  if (!m.stockoutAlerts.length) {
    body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-3);padding:14px">No SKUs in stockout-risk zone 🎉</td></tr>';
    return;
  }
  body.innerHTML = m.stockoutAlerts.map((r) => {
    const days = r.daysLeft >= 999 ? '∞' : r.daysLeft.toFixed(1);
    const statusLbl = r.severity === 'critical' ? (r.stock === 0 ? 'OUT OF STOCK' : 'CRITICAL') : r.severity === 'warn' ? 'LOW' : 'WATCH';
    return `<tr>
      <td title="${esc(r.sku)}">${esc(r.sku)}</td>
      <td>${fmtN(r.stock)}</td>
      <td>${fmtN(r.sales30)}</td>
      <td>${days}</td>
      <td style="text-align:right"><span class="inv-badge ${r.severity}">${statusLbl}</span></td>
    </tr>`;
  }).join('');
}

function renderInvAgingTable(m) {
  const body = document.getElementById('invAgingBody');
  if (!m.aging.length) {
    body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-3);padding:14px">No aging SKUs</td></tr>';
    return;
  }
  body.innerHTML = m.aging.map((r) => {
    const days = r.daysOfStock >= 999 ? '∞' : r.daysOfStock.toFixed(0);
    const statusLbl = r.severity === 'critical' ? (r.sales90 === 0 ? 'DEAD STOCK' : 'VERY OLD') : r.severity === 'warn' ? 'OLD' : 'SLOW';
    return `<tr>
      <td title="${esc(r.sku)}">${esc(r.sku)}</td>
      <td>${fmtN(r.stock)}</td>
      <td>${fmtN(r.sales90)}</td>
      <td>${days}</td>
      <td style="text-align:right"><span class="inv-badge ${r.severity}">${statusLbl}</span></td>
    </tr>`;
  }).join('');
}

// ===== TAB SWITCHING =====
window.switchTab = function(name) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-pane').forEach((p) => p.classList.toggle('active', p.dataset.tabPane === name));
  // Re-size charts after the pane becomes visible (Chart.js needs visible canvas to measure)
  requestAnimationFrame(() => syncCharts());
};

function bindEvents() {
  [['fYear', 'year'], ['fQuarter', 'quarter'], ['fMonth', 'month'], ['fGender', 'gender'], ['fType', 'type']]
    .forEach(([id, key]) => {
      document.getElementById(id).addEventListener('change', (e) => {
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
    S.filters = { year: 'all', quarter: 'all', month: 'all', gender: 'all', type: 'all' };
    S.revMode = 'monthly';
    S.cashierSelected = [];
    document.getElementById('filterBar').classList.remove('filter-open');
    syncFilters();
    renderAll();
  });

  document.getElementById('fileInput').addEventListener('change', onUpload);
  // inventory now comes from the same workbook as sales — no separate upload
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
