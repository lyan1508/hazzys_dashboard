const SOURCE_FOLDER_ID = '1-FXpj7gFp1YFzPmiS-KVOTh7_YuzsPPW';
const SOURCE_EXCEL_FILE_NAME = 'DATA.xlsx';
const DASHBOARD_SHEET_ID = '1l53PyTaGzb92aagtMTJwBoc8E_0p-EaSvLAv4dVehC8';

const TARGET_TABS = {
  sales: 'sale data',
  target: 'target',
  inventory: 'inventory',
};

function syncDashboardData() {
  const sourceExcelFile = findLatestSourceExcelFile_();
  const converted = Drive.Files.copy(
    {
      title: `TEMP_DASHBOARD_IMPORT_${new Date().toISOString()}`,
      mimeType: MimeType.GOOGLE_SHEETS,
    },
    sourceExcelFile.getId()
  );

  try {
    const source = SpreadsheetApp.openById(converted.id);
    const target = SpreadsheetApp.openById(DASHBOARD_SHEET_ID);
    const sourceSheets = source.getSheets();

    copySheetValues_(pickSalesSheet_(sourceSheets), target, TARGET_TABS.sales);
    copySheetValues_(pickTargetSheet_(sourceSheets), target, TARGET_TABS.target);
    copySheetValues_(pickInventorySheet_(sourceSheets), target, TARGET_TABS.inventory);

    PropertiesService.getScriptProperties().setProperty('LAST_SYNC_AT', new Date().toISOString());
  } finally {
    DriveApp.getFileById(converted.id).setTrashed(true);
  }
}

function findLatestSourceExcelFile_() {
  const folder = DriveApp.getFolderById(SOURCE_FOLDER_ID);
  const files = folder.getFilesByName(SOURCE_EXCEL_FILE_NAME);
  let latest = null;

  while (files.hasNext()) {
    const file = files.next();
    if (!latest || file.getLastUpdated() > latest.getLastUpdated()) {
      latest = file;
    }
  }

  if (!latest) {
    throw new Error(`Cannot find "${SOURCE_EXCEL_FILE_NAME}" in source folder.`);
  }

  return latest;
}

function copySheetValues_(sourceSheet, targetSpreadsheet, targetTabName) {
  if (!sourceSheet) {
    throw new Error(`Cannot find source sheet for "${targetTabName}".`);
  }

  let targetSheet = targetSpreadsheet.getSheetByName(targetTabName);
  if (!targetSheet) targetSheet = targetSpreadsheet.insertSheet(targetTabName);

  const range = sourceSheet.getDataRange();
  const values = range.getValues();

  targetSheet.clearContents();
  if (!values.length || !values[0].length) return;

  const neededRows = values.length;
  const neededColumns = values[0].length;
  if (targetSheet.getMaxRows() < neededRows) {
    targetSheet.insertRowsAfter(targetSheet.getMaxRows(), neededRows - targetSheet.getMaxRows());
  }
  if (targetSheet.getMaxColumns() < neededColumns) {
    targetSheet.insertColumnsAfter(targetSheet.getMaxColumns(), neededColumns - targetSheet.getMaxColumns());
  }

  targetSheet.getRange(1, 1, neededRows, neededColumns).setValues(values);
}

function pickSalesSheet_(sheets) {
  return findByName_(sheets, ['sale data', 'sales data', 'transaction', 'sale', 'data']) ||
    findByHeaders_(sheets, ['date', 'amount', 'quantity']);
}

function pickTargetSheet_(sheets) {
  return findByName_(sheets, ['target', 'kpi']);
}

function pickInventorySheet_(sheets) {
  return findByName_(sheets, ['inventory', 'stock', 'ton', 'nhap', 'xuat']) ||
    findByHeaders_(sheets, ['ma sku', 'ton cuoi ky']);
}

function findByName_(sheets, keywords) {
  return sheets.find((sheet) => {
    const name = normalize_(sheet.getName());
    return keywords.some((keyword) => name.includes(normalize_(keyword)));
  }) || null;
}

function findByHeaders_(sheets, requiredHeaders) {
  return sheets.find((sheet) => {
    const values = sheet.getDataRange().getDisplayValues().slice(0, 20);
    const text = normalize_(values.flat().join(' '));
    return requiredHeaders.every((header) => text.includes(normalize_(header)));
  }) || null;
}

function normalize_(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
