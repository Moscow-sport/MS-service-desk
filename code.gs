// ===== SCRIPT PROPERTIES =====
const PROP_TG_TOKEN    = 'TELEGRAM_BOT_TOKEN';
const PROP_TG_CHAT     = 'TELEGRAM_CHAT_ID';
const PROP_SHEET_ID    = 'SPREADSHEET_ID';
const PROP_SHEET_NAME  = 'REQUESTS_SHEET_NAME';

function prop(key, fallback) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  return (v && v.trim()) ? v.trim() : fallback;
}

const TELEGRAM_TOKEN   = prop(PROP_TG_TOKEN,  '');
const TELEGRAM_CHAT_ID = prop(PROP_TG_CHAT,   '');
const SPREADSHEET_ID   = prop(PROP_SHEET_ID,  '');
const SHEET_NAME       = prop(PROP_SHEET_NAME,'АНО МС');

const LAST_ROW_PROP    = 'lastProcessedRow';

const HEADER_ROW       = 2;
const DATA_START_ROW   = HEADER_ROW + 1;

const WORK_START_HOUR = 9;
const WORK_END_HOUR   = 17;
const WORK_END_HOUR_FRIDAY = 16;

const ASSIGNEE_HEADER  = 'Сотрудник';
const STATUS_HEADER    = 'Статус';
const INITIATOR_HEADER = 'Инициатор';
const DEPT_HEADER      = 'ИТ/АХО';
const REQ_TYPE_HEADER  = 'Тип заявки';
const STATUS_DONE      = 'Выполнено';
const REQUEST_ID_HEADER = 'Request ID';   // ← не показывается в ТГ

const FEEDBACK_GID = 802148978;

const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbx7GlFOKznL1mEUQqn_bVzr9tCVlsEUXW6GZN_11ankOSXtXOK4dehmdY4OUtLZxswo/exec';

const DEPT_OPTIONS     = ['ИТ', 'АХО'];
const REQ_TYPE_OPTIONS = ['Выдача', 'тех поддержка', 'помещение'];

const REJECT_MARKERS = ['нахуй', 'отказ', 'отказан', 'отклон', 'небудет', 'На хуй'];
const REJECT_DISPLAY = 'Отказано';

const RU_MONTHS_NOM = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'
];

// ===== НАСТРОЙКА PROPERTIES (запустить один раз) =====
function setupTestProperties() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(PROP_TG_TOKEN,   '8500766815:AAGLtnsiReTYbt8rD2NWeHfx7ZVKK6635SI');
  props.setProperty(PROP_TG_CHAT,    '-1004335523607');
  props.setProperty(PROP_SHEET_ID,   '1qaZitrJy4g72iS7qK5X3FzwS0R8045O05RaUjZSra1I');
  props.setProperty(PROP_SHEET_NAME, 'АНО МС');

  console.log('Настройки установлены:');
  console.log('  Chat ID:', props.getProperty(PROP_TG_CHAT));
  console.log('  Sheet ID:', props.getProperty(PROP_SHEET_ID));
  console.log('  Лист:', props.getProperty(PROP_SHEET_NAME));
}

// ===== ТОЧКА ВХОДА =====
function doPost(e) {
  
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput('OK');
    }
    let data;
    try { data = JSON.parse(e.postData.contents); }
    catch (parseErr) { return ContentService.createTextOutput('OK'); }

    if (data.callback_query) {
      processUpdate({ callback_query: data.callback_query });
      return ContentService.createTextOutput('OK');
    }

    if (data.action === 'submitRequest')    return jsonOut(handleWebRequest(data));
    if (data.action === 'checkStatus') {
      return jsonOut(checkRequestStatus(data.requestId || data.row));
    }

    if (data.action === 'addFeedback') {
      return jsonOut(addFeedback(data.requestId || data.row, data.comment));
    }
    if (data.action === 'getEmployeeNames') return jsonOut(getEmployeeNames());

    if (data.action === 'checkAdmin')       return jsonOut(checkAdmin(data.email));
    if (data.action === 'getAdmins')        return jsonOut(getAdmins(data.email));
    if (data.action === 'addAdmin')         return jsonOut(addAdmin(data.email, data.newEmail));
    if (data.action === 'removeAdmin')      return jsonOut(removeAdmin(data.email, data.targetEmail));

    if (data.action === 'getEmployees')     return jsonOut(getEmployeesData(data.email));
    if (data.action === 'saveEmployees')    return jsonOut(saveEmployeesData(data.email, data.data));
    if (data.action === 'parsePptxPreview') return jsonOut(parsePptxPreview(data));
    if (data.action === 'generateReport')   return jsonOut(generateReport(data.email));
    if (data.action === 'generateMonthlyReport') return jsonOut(generateMonthlyReport(data.month, data.email, data.mode));

    return jsonOut({ ok: false, error: 'unknown action' });
  } catch (err) {
    console.error('doPost error:', err);
    return jsonOut({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  return jsonOut({ ok: true, status: 'alive', time: new Date().toISOString() });
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== ОБРАБОТКА НАЖАТИЯ =====
function processUpdate(update) {
  if (!update || !update.callback_query) return;
  const cq = update.callback_query;
  const parts = (cq.data || '').split('|');

  // 1. Мгновенно отвечаем TG
  if (parts[0] === 'toggle') {
    answerCallbackQuery(cq.id, parts[1] === 'show' ? 'Показано' : 'Скрыто');
  } else if (parts[0] === 'noop') {
    answerCallbackQuery(cq.id, 'Откройте таблицу');
    return;
  } else if (parts[0] === 'set') {
    answerCallbackQuery(cq.id, 'Ок');
  } else {
    return;
  }

  const sheet = getSheet();
  if (!sheet) return;

  // 2. Заголовки — из кэша
  const headers = getCachedHeaders(sheet);
  const lastCol = headers.length;
  const assigneeCol = findColumn(headers, ASSIGNEE_HEADER);
  const statusCol   = findColumn(headers, STATUS_HEADER);

  // === toggle ===
  if (parts[0] === 'toggle') {
    const action = parts[1];
    const row = parseInt(parts[2], 10);

    // ОДИН запрос: значения строки + все валидации
    const rowRange = sheet.getRange(row, 1, 1, lastCol);
    const rowValues = rowRange.getValues()[0];
    const validations = rowRange.getDataValidations()[0];

    const currentAssignee = assigneeCol ? rowValues[assigneeCol - 1] : '';
    const currentStatus   = statusCol   ? rowValues[statusCol - 1]   : '';
    const newText = buildMessage(headers, rowValues, row);

    const keyboard = buildFullKeyboardFast(
      row, assigneeCol, statusCol,
      currentAssignee, currentStatus,
      action === 'show',
      rowValues, validations, headers
    );

    editMessageText(cq.message.chat.id, cq.message.message_id, newText, keyboard);
    return;
  }

  if (parts[0] !== 'set') return;

  // === set ===
const row = parseInt(parts[1], 10);
const col = parseInt(parts[2], 10);
const value = parts.slice(3).join('|');

if (!row || !col) return;

const rowRange = sheet.getRange(row, 1, 1, lastCol);
const rowValues = rowRange.getValues()[0];
const validations = rowRange.getDataValidations()[0];

// Сначала меняем значение в оперативной копии строки
rowValues[col - 1] = value;

// Сначала записываем значение в Google Sheets
try {
  sheet.getRange(row, col).setValue(value);
  SpreadsheetApp.flush();
} catch (setErr) {
  console.error('Ошибка setValue:', setErr);
  answerCallbackQuery(cq.id, 'Ошибка сохранения');
  return;
}

const currentAssignee = assigneeCol
  ? rowValues[assigneeCol - 1]
  : '';

const currentStatus = statusCol
  ? rowValues[statusCol - 1]
  : '';

const newText = buildMessage(headers, rowValues, row);

const oldKeyboard =
  cq.message.reply_markup &&
  cq.message.reply_markup.inline_keyboard
    ? cq.message.reply_markup.inline_keyboard
    : [];

const hadExtras = oldKeyboard.some(function(r) {
  return r.some(function(btn) {
    return btn.callback_data &&
      btn.callback_data.indexOf('toggle|hide') === 0;
  });
});

const keyboard = buildFullKeyboardFast(
  row,
  assigneeCol,
  statusCol,
  currentAssignee,
  currentStatus,
  hadExtras,
  rowValues,
  validations,
  headers
);

// Затем обновляем сообщение Telegram
editMessageText(
  cq.message.chat.id,
  cq.message.message_id,
  newText,
  keyboard
);

// ===== ПОЛНАЯ КЛАВИАТУРА =====
function buildFullKeyboard(sheet, rowNumber, assigneeCol, statusCol, currentAssignee, currentStatus, extrasVisible) {
  const rows = [];

  const assigneeOptions = getCellDropdownOptions(sheet, rowNumber, assigneeCol)
    .filter(function(o) { return o !== ASSIGNEE_HEADER; });

  const statusOptions = getCellDropdownOptions(sheet, rowNumber, statusCol)
    .filter(function(o) { return o !== STATUS_HEADER; });

  const baseOptions = [];

  assigneeOptions.forEach(function(opt) {
    const selected = String(opt) === String(currentAssignee);
    baseOptions.push({
      text: (selected ? '✅ ' : '👤 ') + opt,
      callback_data: 'set|' + rowNumber + '|' + assigneeCol + '|' + opt
    });
  });

  statusOptions.forEach(function(opt) {
    const selected = String(opt) === String(currentStatus);
    baseOptions.push({
      text: (selected ? '✅ ' : '📌 ') + opt,
      callback_data: 'set|' + rowNumber + '|' + statusCol + '|' + opt
    });
  });

  for (let i = 0; i < baseOptions.length; i += 2) {
    rows.push(baseOptions.slice(i, i + 2));
  }

  if (!extrasVisible) {
    rows.push([{
      text: '🔽 Показать кнопки',
      callback_data: 'toggle|show|' + rowNumber
    }]);
  } else {
    rows.push([{
      text: '🔼 Скрыть кнопки',
      callback_data: 'toggle|hide|' + rowNumber
    }]);

    const headers = getHeaders(sheet);
    const deptCol = findColumn(headers, DEPT_HEADER);
    const typeCol = findColumn(headers, REQ_TYPE_HEADER);
    const initCol = findColumn(headers, INITIATOR_HEADER);

    const extraOptions = [];

    if (deptCol) {
      const cur = String(sheet.getRange(rowNumber, deptCol).getValue() || '').trim();
      DEPT_OPTIONS.forEach(function(opt) {
        extraOptions.push({
          text: (cur === opt ? '✅ ' : '🏢 ') + opt,
          callback_data: 'set|' + rowNumber + '|' + deptCol + '|' + opt
        });
      });
    }

    if (typeCol) {
      const cur = String(sheet.getRange(rowNumber, typeCol).getValue() || '').trim();
      REQ_TYPE_OPTIONS.forEach(function(opt) {
        extraOptions.push({
          text: (cur === opt ? '✅ ' : '📋 ') + opt,
          callback_data: 'set|' + rowNumber + '|' + typeCol + '|' + opt
        });
      });
    }

    if (initCol) {
      let opts = getCellDropdownOptions(sheet, rowNumber, initCol);
      if (!opts || !opts.length) opts = getDepartmentCodes();
      opts = opts.filter(function(o) {
        return String(o).trim().toLowerCase() !== 'ано мс';
      });

      const cur = String(sheet.getRange(rowNumber, initCol).getValue() || '').trim();
      opts.forEach(function(opt) {
        extraOptions.push({
          text: (cur === opt ? '✅ ' : '🏷 ') + opt,
          callback_data: 'set|' + rowNumber + '|' + initCol + '|' + opt
        });
      });
    }

    for (let i = 0; i < extraOptions.length; i += 2) {
      rows.push(extraOptions.slice(i, i + 2));
    }
  }

  return { inline_keyboard: rows };
}

// ===== ВСПОМОГАТЕЛЬНЫЕ =====
function getSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return ss.getSheetByName(SHEET_NAME);
}

function getSheetByGid(ss, gid) {
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === Number(gid)) return sheets[i];
  }
  return null;
}

function getHeaders(sheet) {
  const lastCol = sheet.getLastColumn();
  return sheet.getRange(HEADER_ROW, 1, 1, lastCol).getValues()[0];
}

function findColumn(headers, name) {
  const idx = headers.findIndex(function(h) {
    return String(h).trim().toLowerCase() === name.toLowerCase();
  });
  return idx + 1;
}

function getCellDropdownOptions(sheet, row, colIndex) {
  const validation = sheet.getRange(row, colIndex).getDataValidation();
  if (!validation) return [];
  if (validation.getCriteriaType() !== SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) return [];

  const criteriaValues = validation.getCriteriaValues();
  if (!criteriaValues || !criteriaValues[0]) return [];

  const list = criteriaValues[0];
  if (!Array.isArray(list)) return [];

  return list.map(function(v) { return String(v).trim(); }).filter(function(v) { return v !== ''; });
}

function getDepartmentCodes() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const s = ss.getSheetByName('Сотрудники');
  if (!s) return [];
  const lastCol = s.getLastColumn();
  if (lastCol < 1) return [];
  return s.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function(v) { return String(v).trim(); })
    .filter(function(v) { return v !== ''; });
}

function getEmployeeNames() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const s = ss.getSheetByName('Сотрудники');
  if (!s) return { ok: true, names: [] };

  const lastCol = s.getLastColumn();
  const lastRow = s.getLastRow();
  if (lastCol < 1 || lastRow < 2) return { ok: true, names: [] };

  const values = s.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const set = {};
  values.forEach(function(row) {
    row.forEach(function(v) {
      const t = String(v || '').trim();
      if (t) set[t] = true;
    });
  });

  const names = Object.keys(set).sort(function(a, b) {
    return a.localeCompare(b, 'ru');
  });
  return { ok: true, names: names };
}

// ===== TELEGRAM API =====
function sendToTelegram(text, replyMarkup) {
  const url = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendMessage';
  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;

  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

function answerCallbackQuery(callbackQueryId, text) {
  const url = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/answerCallbackQuery';
  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      callback_query_id: callbackQueryId,
      text: text,
      show_alert: false
    }),
    muteHttpExceptions: true
  });
}

function editMessageText(chatId, messageId, text, replyMarkup) {
  const url = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/editMessageText';
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;

  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

// ===== СООБЩЕНИЕ =====
function buildMessage(headers, values, rowNumber) {
  let message = '<b>НОВАЯ ЗАЯВКА</b>';
  if (rowNumber) message += ' <i>(строка ' + rowNumber + ')</i>';
  message += '\n━━━━━━━━━━━━━━━━━━\n\n';

  headers.forEach(function(header, i) {
    let value = values[i];
    if (!header || String(header).trim() === '') return;

    // Request ID не показываем в ТГ
    if (String(header).trim() === REQUEST_ID_HEADER) return;

    if (value === null || value === undefined) return;
    if (!(value instanceof Date) && String(value).trim() === '') return;

    if (value instanceof Date) {
      value = Utilities.formatDate(value, Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm:ss');
    }
    message += '<b>' + header + ':</b>\n' + value + '\n\n';
  });

  return message;
}

// ===== ПРОВЕРКА НОВЫХ СТРОК =====
function checkNewRows() {
  const now = new Date();
  const hour = now.getHours();
  const day  = now.getDay();

  if (day === 0 || day === 6) return;
  if (hour < WORK_START_HOUR || hour > WORK_END_HOUR) return;
  if (day === 5 && hour > WORK_END_HOUR_FRIDAY) return;

  try {
    const props = PropertiesService.getScriptProperties();
    const lastRow = Number(props.getProperty(LAST_ROW_PROP) || HEADER_ROW);

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return;

    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(HEADER_ROW, 1, 1, lastCol).getValues()[0];

    const fioCol = findColumn(headers, 'ФИО');
    if (!fioCol) return;

    let currentLastRow = sheet.getLastRow();
    if (currentLastRow >= DATA_START_ROW) {
      const fioValues = sheet
        .getRange(DATA_START_ROW, fioCol, currentLastRow - DATA_START_ROW + 1, 1)
        .getValues();
      let real = DATA_START_ROW - 1;
      for (let i = fioValues.length - 1; i >= 0; i--) {
        const t = String(fioValues[i][0] || '').replace(/[\s\u00a0\u200b\ufeff]/g, '');
        if (t) { real = DATA_START_ROW + i; break; }
      }
      currentLastRow = real;
    }

    if (currentLastRow < DATA_START_ROW) return;
    if (currentLastRow <= lastRow) return;

    const startRow = Math.max(lastRow + 1, DATA_START_ROW);
    const newRows = sheet
      .getRange(startRow, 1, currentLastRow - startRow + 1, lastCol)
      .getValues();

    let lastRealRow = lastRow;

    newRows.forEach(function(row, idx) {
      const rowNumber = startRow + idx;

      const fioVal = String(row[fioCol - 1] || '').replace(/[\s\u00a0\u200b\ufeff]/g, '');
      if (!fioVal) return;

      const message = buildMessage(headers, row, rowNumber);
      const assigneeCol = findColumn(headers, ASSIGNEE_HEADER);
      const statusCol   = findColumn(headers, STATUS_HEADER);

      if (assigneeCol && statusCol) {
        const keyboard = buildFullKeyboard(
          sheet, rowNumber, assigneeCol, statusCol,
          row[assigneeCol - 1], row[statusCol - 1],
          false
        );
        sendToTelegram(message, keyboard);
      } else {
        sendToTelegram(message);
      }
      lastRealRow = rowNumber;
    });

    if (lastRealRow > lastRow) {
      props.setProperty(LAST_ROW_PROP, String(lastRealRow));
    }
  } catch (error) {
    console.error('Ошибка в checkNewRows:', error);
  }
}

// ===== НОВАЯ ЗАЯВКА С САЙТА =====
function handleWebRequest(data) {
  const sheet = getSheet();
  if (!sheet) return { ok: false, error: 'sheet not found' };

  const headers = getHeaders(sheet);
  const lastCol = sheet.getLastColumn();

  const fioCol     = findColumn(headers, 'ФИО') || 1;
  const cabinetCol = findColumn(headers, 'Номер кабинета') || 2;
  const requestCol = findColumn(headers, 'Что требуется?') || 3;
  const tsCol      = findColumn(headers, 'Отметка времени');

  let realLast = DATA_START_ROW - 1;
  const maxRow = sheet.getLastRow();
  if (maxRow >= DATA_START_ROW && fioCol) {
    const fioValues = sheet
      .getRange(DATA_START_ROW, fioCol, maxRow - DATA_START_ROW + 1, 1)
      .getValues();
    for (let i = fioValues.length - 1; i >= 0; i--) {
      const t = String(fioValues[i][0] || '').replace(/[\s\u00a0\u200b\ufeff]/g, '');
      if (t) { realLast = DATA_START_ROW + i; break; }
    }
  }
  const newRow = realLast + 1;

  if (newRow > DATA_START_ROW) {
    try {
      const srcRange = sheet.getRange(newRow - 1, 1, 1, lastCol);
      const dstRange = sheet.getRange(newRow, 1, 1, lastCol);
      srcRange.copyTo(dstRange, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
      srcRange.copyTo(dstRange, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    } catch (e) { console.warn('валидация/формат:', e); }
  }

  sheet.getRange(newRow, fioCol).setValue(data.fio || '');
  sheet.getRange(newRow, cabinetCol).setValue(data.cabinet || '');
  sheet.getRange(newRow, requestCol).setValue(data.request || '');

  // requestId: используем пришедший с клиента, иначе генерируем
  const requestId = String(data.requestId || '').trim() || Utilities.getUuid();
  const ridCol = ensureRequestIdColumn(sheet);
  if (ridCol) {
    sheet.getRange(newRow, ridCol).setValue(requestId);
  }

  if (tsCol) {
    const tsCell = sheet.getRange(newRow, tsCol);
    tsCell.setValue(new Date());
    tsCell.setNumberFormat('dd.MM.yyyy HH:mm:ss');
  }

  try {
    const rowValues = sheet.getRange(newRow, 1, 1, lastCol).getValues()[0];
    const message = buildMessage(headers, rowValues, newRow);
    const assigneeCol = findColumn(headers, ASSIGNEE_HEADER);
    const statusCol   = findColumn(headers, STATUS_HEADER);

    if (assigneeCol && statusCol) {
      const keyboard = buildFullKeyboard(
        sheet, newRow, assigneeCol, statusCol,
        rowValues[assigneeCol - 1], rowValues[statusCol - 1],
        false
      );
      sendToTelegram(message, keyboard);
    } else {
      sendToTelegram(message);
    }

    PropertiesService.getScriptProperties().setProperty(LAST_ROW_PROP, String(newRow));
  } catch (e) {
    console.error('Не удалось отправить в ТГ:', e);
  }

  return { ok: true, row: newRow, requestId: requestId };
}

// Ищет колонку Request ID, если нет — создаёт
function ensureRequestIdColumn(sheet) {
  const headers = getHeaders(sheet);
  let col = findColumn(headers, REQUEST_ID_HEADER);
  if (col) return col;

  const lastCol = sheet.getLastColumn();
  col = lastCol + 1;
  sheet.getRange(HEADER_ROW, col).setValue(REQUEST_ID_HEADER);
  sheet.getRange(HEADER_ROW, col).setFontWeight('bold');
  return col;
}

// ===== СТАТУС =====
function getDisplayStatus(rawStatus) {
  const s = String(rawStatus || '').trim();
  if (!s) return '';
  const compact = s.toLowerCase().replace(/\s+/g, '');
  for (let i = 0; i < REJECT_MARKERS.length; i++) {
    if (compact.indexOf(REJECT_MARKERS[i]) !== -1) return REJECT_DISPLAY;
  }
  return s;
}

function checkRequestStatus(ref) {
  const sheet = getSheet();
  if (!sheet) return { ok: false, error: 'sheet not found' };

  const row = resolveRequestRow(ref);
  if (!row) {
    return {
      ok: false,
      error: 'request not found'
    };
  }

  const headers = getHeaders(sheet);
  const statusCol = findColumn(headers, STATUS_HEADER);

  if (!statusCol) {
    return {
      ok: false,
      error: 'status column not found'
    };
  }

  const raw = String(sheet.getRange(row, statusCol).getValue() || '');
  const display = getDisplayStatus(raw);

  return {
    ok: true,
    row: row,
    status: raw,
    display: display,
    done: raw.trim().toLowerCase() === STATUS_DONE.toLowerCase()
  };
}

// ===== ОТЗЫВ =====
function addFeedback(ref, comment) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const mainSheet = ss.getSheetByName(SHEET_NAME);

  if (!mainSheet) {
    return {
      ok: false,
      error: 'main sheet not found'
    };
  }

  const row = resolveRequestRow(ref);

  if (!row) {
    return {
      ok: false,
      error: 'request not found'
    };
  }

  const headers = getHeaders(mainSheet);
  const fioCol = findColumn(headers, 'ФИО');
  const requestCol = findColumn(headers, 'Что требуется?');

  const fio = fioCol
    ? mainSheet.getRange(row, fioCol).getValue()
    : '';

  const request = requestCol
    ? mainSheet.getRange(row, requestCol).getValue()
    : '';

  const fbSheet = getSheetByGid(ss, FEEDBACK_GID);

  if (!fbSheet) {
    return {
      ok: false,
      error: 'feedback sheet not found'
    };
  }

  fbSheet.appendRow([
    fio,
    request,
    comment || '',
    row
  ]);

  return {
    ok: true
  };
}

// ===== СПРАВОЧНИК =====
function getEmployeesData(email) {
  if (!checkAdmin(email).isAdmin) return { ok: false, error: 'forbidden' };

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Сотрудники');
  if (!sheet) return { ok: true, codes: [], rows: [] };

  const lastCol = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  if (lastCol < 1 || lastRow < 1) return { ok: true, codes: [], rows: [] };

  const codes = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(v) { return String(v).trim(); });
  const rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
  return { ok: true, codes: codes, rows: rows };
}

function saveEmployeesData(email, payload) {
  if (!checkAdmin(email).isAdmin) return { ok: false, error: 'forbidden' };
  if (!payload || !Array.isArray(payload.codes)) return { ok: false, error: 'bad payload' };

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName('Сотрудники');
  if (!sheet) sheet = ss.insertSheet('Сотрудники');
  sheet.clear();

  const codes = payload.codes.map(function(c) { return String(c || '').trim(); });
  const rows = Array.isArray(payload.rows) ? payload.rows : [];

  sheet.getRange(1, 1, 1, codes.length).setValues([codes]);
  if (rows.length) {
    const grid = rows.map(function(r) {
      return codes.map(function(_, i) { return String((r[i] != null ? r[i] : '')).trim(); });
    });
    sheet.getRange(2, 1, grid.length, codes.length).setValues(grid);
  }

  const headerRange = sheet.getRange(1, 1, 1, codes.length);
  headerRange.setFontWeight('bold').setBackground('#e8eefc').setHorizontalAlignment('center');
  sheet.setFrozenRows(1);
  for (let i = 1; i <= codes.length; i++) sheet.setColumnWidth(i, 220);

  return { ok: true, codes: codes.length, rows: rows.length };
}

// ===== АДМИНЫ =====
const EDITOR_ROLES = ['owner', 'organizer', 'fileOrganizer', 'writer'];

function listPermissions() {
  const fileId = SpreadsheetApp.openById(SPREADSHEET_ID).getId();
  const res = Drive.Permissions.list(fileId, {
    fields: 'permissions(id, emailAddress, displayName, role, type)'
  });
  return res.permissions || [];
}

function checkAdmin(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return { ok: true, isAdmin: false, email: '' };
  try {
    const perms = listPermissions();
    const isEditor = perms.some(function(p) {
      return p.emailAddress &&
        String(p.emailAddress).toLowerCase() === e &&
        EDITOR_ROLES.indexOf(p.role) !== -1;
    });
    return { ok: true, isAdmin: isEditor, email: e };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function getAdmins(email) {
  if (!checkAdmin(email).isAdmin) return { ok: false, error: 'forbidden' };
  try {
    const perms = listPermissions();
    const admins = perms
      .filter(function(p) { return p.emailAddress && EDITOR_ROLES.indexOf(p.role) !== -1; })
      .map(function(p) {
        return { id: p.id, email: p.emailAddress, name: p.displayName || '', role: p.role };
      });
    return { ok: true, admins: admins };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function addAdmin(email, newEmail) {
  if (!checkAdmin(email).isAdmin) return { ok: false, error: 'forbidden' };

  const e = String(newEmail || '').trim().toLowerCase();
  if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    return { ok: false, error: 'Некорректный email' };
  }

  try {
    const fileId = SpreadsheetApp.openById(SPREADSHEET_ID).getId();
    const perms = listPermissions();
    const exists = perms.find(function(p) {
      return p.emailAddress && String(p.emailAddress).toLowerCase() === e;
    });

    if (exists) {
      if (EDITOR_ROLES.indexOf(exists.role) !== -1) return { ok: true, already: true };
      Drive.Permissions.update({ role: 'writer' }, fileId, exists.id,
        { fields: 'id, role, emailAddress' });
      return { ok: true, upgraded: true };
    }

    Drive.Permissions.create(
      { role: 'writer', type: 'user', emailAddress: e }, fileId,
      { sendNotificationEmail: false, fields: 'id, role, emailAddress' }
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function removeAdmin(email, targetEmail) {
  if (!checkAdmin(email).isAdmin) return { ok: false, error: 'forbidden' };

  const t = String(targetEmail || '').trim().toLowerCase();
  if (!t) return { ok: false, error: 'Некорректный email' };

  try {
    const fileId = SpreadsheetApp.openById(SPREADSHEET_ID).getId();
    const perms = listPermissions();
    const target = perms.find(function(p) {
      return p.emailAddress && String(p.emailAddress).toLowerCase() === t;
    });
    if (!target) return { ok: true, notFound: true };
    if (target.role === 'owner') return { ok: false, error: 'Нельзя удалить владельца' };
    Drive.Permissions.delete(fileId, target.id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ===== PPTX =====
function parsePptxPreview(data) {
  if (!checkAdmin(data.email).isAdmin) return { ok: false, error: 'forbidden' };
  const byDept = parsePptxBase64(data.fileBase64 || '');
  return { ok: true, byDept: byDept };
}

const DEPT_ORDER = [
  'АНО МС','ЛС','СВД','приемная','УК','ЮУ','УЗ','Бухгалтерия',
  'УВК','УИ','ФЭУ','УЦ','Пиар','УП','УКБ'
];

const DEPT_PATTERNS = [
  { code: 'приемная',    re: /ПРИЕМНАЯ\s+ГЕНЕРАЛЬНОГО/i },
  { code: 'УК',          re: /УПРАВЛЕНИЕ\s+КАДРОВ/i },
  { code: 'УЗ',          re: /УПРАВЛЕНИЕ\s+ЗАКУПОК/i },
  { code: 'ЮУ',          re: /ЮРИДИЧЕСКОЕ\s+УПРАВЛЕНИЕ/i },
  { code: 'УМ',          re: /УПРАВЛЕНИЕ\s+МАРКЕТИНГА/i },
  { code: 'ФЭУ',         re: /ФИНАНСОВО[\-\s]ЭКОНОМИЧЕСКОЕ/i },
  { code: 'Бухгалтерия', re: /БУХГАЛТЕРИЯ/i },
  { code: 'УВК',         re: /ВНУТРЕННЕГО\s+КОНТРОЛЯ/i },
  { code: 'УИ',          re: /УПРАВЛЕНИЕ\s+ИНФРАСТРУКТУРЫ/i },
  { code: 'Пиар',        re: /СВЯЗЯМ\s+С\s+ОБЩЕСТВЕННОСТЬЮ/i },
  { code: 'УЦ',          re: /УПРАВЛЕНИЕ\s+ЦИФРОВИЗАЦИИ/i },
  { code: 'УП',          re: /УПРАВЛЕНИЕ\s+ПРОТОКОЛА/i },
  { code: 'УКБ',         re: /КОМПЛЕКСНОЙ\s+БЕЗОПАСНОСТИ/i },
  { code: 'ЛС',          re: /СПОРТИВНО[\-\s]МАССОВЫХ/i },
  { code: 'СВД',         re: /ВЫСШИХ\s+ДОСТИЖЕНИЙ/i }
];

const PERSON_OVERRIDES = {
  'Челушкина Анастасия Викторовна': 'ЛС',
  'Зацепина Евгения Евгеньевна':    'ФЭУ',
  'Яирова Оксана Николаевна':       'СВД',
  'Гражданов Дмитрий Николаевич':   'УЦ',
  'Велединская Анна Григорьевна':   'Пиар',
  'Кузнецов Иван Владимирович':     'АНО МС'
};

const FIO_BLACKLIST = /^(Московский|Телефонный|Справочник|Должность|Заместитель|Начальник|Руководитель|Менеджер|Специалист|Ведущий|Главный|Администратор|Секретарь|Дизайнер|Аналитик|Корректор|Бухгалтер|Управление|ПРИЕМНАЯ|ОХРАНА|ДОБІ)/i;

function parsePptxBase64(b64) {
  const blob = Utilities.newBlob(
    Utilities.base64Decode(b64),
    'application/zip',
    'src.pptx'
  );

  const files = Utilities.unzip(blob);
  const slides = files
    .filter(function(f) { return /^ppt\/slides\/slide\d+\.xml$/.test(f.getName()); })
    .sort(function(a, b) {
      const na = Number(a.getName().match(/(\d+)/)[1]);
      const nb = Number(b.getName().match(/(\d+)/)[1]);
      return na - nb;
    });

  let fullText = '';
  slides.forEach(function(f) {
    const xml = f.getDataAsString('UTF-8')
      .replace(/&nbsp;/g, ' ')
      .replace(/\u00a0/g, ' ');
    const re = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const t = m[1].replace(/\s+/g, ' ').trim();
      if (t) fullText += t + ' ';
    }
  });

  fullText = fullText
    .replace(/([а-яё])([А-ЯЁ])/g, '$1 $2')
    .replace(/([А-ЯЁ]{2,})([А-ЯЁ][а-яё])/g, '$1 $2')
    .replace(/\s+/g, ' ');

  const deptMatches = [];
  DEPT_PATTERNS.forEach(function(p) {
    const re = new RegExp(p.re.source, 'gi');
    let m;
    while ((m = re.exec(fullText)) !== null) {
      deptMatches.push({ code: p.code, start: m.index, end: m.index + m[0].length });
    }
  });
  deptMatches.sort(function(a, b) { return a.start - b.start; });

  const byDept = {};
  const fioRe = /[А-ЯЁ][а-яё\-]+(?:\s+[А-ЯЁ][а-яё\-]+){2,2}(?:\s+[а-яё]{3,10})?/g;

  let fm;
  fioRe.lastIndex = 0;
  while ((fm = fioRe.exec(fullText)) !== null) {
    const name = fm[0].trim();
    const firstWord = name.split(/\s+/)[0];
    if (FIO_BLACKLIST.test(firstWord) || name.length < 15) {
      fioRe.lastIndex = fm.index + 1;
      continue;
    }

    let deptCode = null;
    for (let i = deptMatches.length - 1; i >= 0; i--) {
      if (deptMatches[i].end <= fm.index) { deptCode = deptMatches[i].code; break; }
    }
    if (!deptCode) continue;

    if (!byDept[deptCode]) byDept[deptCode] = [];
    byDept[deptCode].push(name);
  }

  Object.keys(byDept).forEach(function(k) {
    byDept[k] = Array.from(new Set(byDept[k]));
  });

  Object.keys(PERSON_OVERRIDES).forEach(function(fio) {
    const dept = PERSON_OVERRIDES[fio];
    Object.keys(byDept).forEach(function(k) {
      byDept[k] = byDept[k].filter(function(x) { return x !== fio; });
    });
    if (!byDept[dept]) byDept[dept] = [];
    if (byDept[dept].indexOf(fio) === -1) byDept[dept].unshift(fio);
  });

  const ordered = {};
  DEPT_ORDER.forEach(function(code) { ordered[code] = byDept[code] || []; });
  Object.keys(byDept).forEach(function(code) {
    if (!ordered[code]) ordered[code] = byDept[code];
  });

  return ordered;
}

// ===== ОТЧЁТ =====
function generateReport(email) {
  if (!checkAdmin(email).isAdmin) return { ok: false, error: 'forbidden' };

  const sheet = getSheet();
  if (!sheet) return { ok: false, error: 'no sheet' };

  const headers = getHeaders(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return { ok: true, rows: [], summary: emptySummary() };

  const data = sheet
    .getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, headers.length)
    .getValues();

  const colIdx = {
    fio:    findColumn(headers, 'ФИО'),
    ts:     findColumn(headers, 'Отметка времени'),
    status: findColumn(headers, STATUS_HEADER),
    init:   findColumn(headers, INITIATOR_HEADER),
    type:   findColumn(headers, REQ_TYPE_HEADER),
    dept:   findColumn(headers, DEPT_HEADER),
    text:   findColumn(headers, 'Что требуется?')
  };

  const rows = data.map(function(r, i) {
    return {
      row:       DATA_START_ROW + i,
      fio:       colIdx.fio    ? String(r[colIdx.fio - 1] || '') : '',
      ts:        colIdx.ts     ? (r[colIdx.ts - 1] instanceof Date
                    ? Utilities.formatDate(r[colIdx.ts - 1], Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm')
                    : String(r[colIdx.ts - 1] || '')) : '',
      status:    colIdx.status ? String(r[colIdx.status - 1] || '') : '',
      initiator: colIdx.init   ? String(r[colIdx.init - 1] || '') : '',
      type:      colIdx.type   ? String(r[colIdx.type - 1] || '') : '',
      dept:      colIdx.dept   ? String(r[colIdx.dept - 1] || '') : '',
      text:      colIdx.text   ? String(r[colIdx.text - 1] || '') : ''
    };
  });

  const summary = emptySummary();
  summary.total = rows.length;
  rows.forEach(function(x) {
    if (x.status.trim().toLowerCase() === STATUS_DONE.toLowerCase()) summary.done++;
    if (x.type) summary.byType[x.type] = (summary.byType[x.type] || 0) + 1;
    if (x.dept) summary.byDept[x.dept] = (summary.byDept[x.dept] || 0) + 1;
    if (x.initiator) summary.byInitiator[x.initiator] = (summary.byInitiator[x.initiator] || 0) + 1;
  });

  return { ok: true, rows: rows, summary: summary };
}

function emptySummary() {
  return { total: 0, done: 0, byType: {}, byDept: {}, byInitiator: {} };
}

function parseRuDate(str) {
  if (!str) return null;
  if (str instanceof Date && !isNaN(str.getTime())) return str;

  const s = String(str).trim().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');

  let m = s.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{2,4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    return new Date(year, Number(m[2]) - 1, Number(m[1]),
      Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  }

  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  }

  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  return null;
}

// ===== МЕСЯЧНЫЙ ОТЧЁТ =====
function generateMonthlyReport(monthStr, email, mode) {
  if (!checkAdmin(email).isAdmin) return { ok: false, error: 'forbidden' };
  mode = mode || 'telegram';

  const parts = String(monthStr || '').split('-');
  if (parts.length !== 2) return { ok: false, error: 'bad month' };
  const targetYear  = parseInt(parts[0], 10);
  const targetMonth = parseInt(parts[1], 10) - 1;

  const sheet = getSheet();
  if (!sheet) return { ok: false, error: 'no sheet' };

  const headers = getHeaders(sheet);
  const fioCheckCol = findColumn(headers, 'ФИО');
  const rawData = sheet
    .getRange(DATA_START_ROW, 1, sheet.getLastRow() - DATA_START_ROW + 1, headers.length)
    .getValues();

  const data = rawData.filter(function(r) {
    return String(r[fioCheckCol - 1] || '').replace(/[\s\u00a0\u200b\ufeff]/g, '') !== '';
  });

  if (!data.length) return { ok: false, error: 'no data' };

  const colIdx = {
    fio:    findColumn(headers, 'ФИО'),
    cab:    findColumn(headers, 'Номер кабинета'),
    text:   findColumn(headers, 'Что требуется?'),
    ts:     findColumn(headers, 'Отметка времени'),
    emp:    findColumn(headers, ASSIGNEE_HEADER),
    status: findColumn(headers, STATUS_HEADER),
    dept:   findColumn(headers, DEPT_HEADER),
    init:   findColumn(headers, INITIATOR_HEADER),
    type:   findColumn(headers, REQ_TYPE_HEADER)
  };

  const rows = [];
  data.forEach(function(r) {
    const d = parseRuDate(r[colIdx.ts - 1]);
    if (!d) return;
    if (d.getFullYear() !== targetYear || d.getMonth() !== targetMonth) return;
    rows.push({
      date:   r[colIdx.ts - 1],
      fio:    colIdx.fio    ? String(r[colIdx.fio - 1] || '')    : '',
      cab:    colIdx.cab    ? String(r[colIdx.cab - 1] || '')    : '',
      text:   colIdx.text   ? String(r[colIdx.text - 1] || '')   : '',
      emp:    colIdx.emp    ? String(r[colIdx.emp - 1] || '')    : '',
      status: colIdx.status ? String(r[colIdx.status - 1] || '') : '',
      dept:   colIdx.dept   ? String(r[colIdx.dept - 1] || '')   : '',
      init:   colIdx.init   ? String(r[colIdx.init - 1] || '')   : '',
      type:   colIdx.type   ? String(r[colIdx.type - 1] || '')   : ''
    });
  });

  let totalDone = 0, totalReject = 0;
  const byType = {};
  const byInit = {};

  rows.forEach(function(x) {
    const st = String(x.status).trim().toLowerCase();
    if (st === STATUS_DONE.toLowerCase()) totalDone++;
    if (getDisplayStatus(x.status) === REJECT_DISPLAY) totalReject++;

    const t = x.type || '—';
    if (!byType[t]) byType[t] = { total: 0, byInit: {} };
    byType[t].total++;
    const i = x.init || '—';
    byType[t].byInit[i] = (byType[t].byInit[i] || 0) + 1;
    byInit[i] = (byInit[i] || 0) + 1;
  });

  const monthLabel = RU_MONTHS_NOM[targetMonth] + ' ' + targetYear;
  const ssName = 'Отчёт ' + monthLabel + ' — ' + Utilities.formatDate(new Date(), 'Europe/Moscow', 'dd.MM.yyyy HH-mm-ss');
  const tmpSS = SpreadsheetApp.create(ssName);
  const tmpId = tmpSS.getId();
  const sh = tmpSS.getActiveSheet();
  sh.setName('Отчёт');

  let row = 1;
  sh.getRange(row, 1, 1, 9).merge().setValue('ОТЧЁТ ЗА ' + monthLabel.toUpperCase())
    .setFontWeight('bold').setFontSize(14).setBackground('#6f0701').setFontColor('#ffffff')
    .setHorizontalAlignment('center');
  row += 2;

  const colHeaders = ['Дата','ФИО','Кабинет','Что требуется?','Сотрудник','Статус','ИТ/АХО','Инициатор','Тип заявки'];
  sh.getRange(row, 1, 1, colHeaders.length).setValues([colHeaders])
    .setFontWeight('bold').setBackground('#e8eefc');
  row++;

  if (rows.length) {
    const grid = rows.map(function(x) {
      return [x.date, x.fio, x.cab, x.text, x.emp, x.status, x.dept, x.init, x.type];
    });
    sh.getRange(row, 1, grid.length, colHeaders.length).setValues(grid);
    row += grid.length;
  } else {
    sh.getRange(row, 1).setValue('Заявок за этот месяц нет.');
    row++;
  }

  row += 2;
  sh.getRange(row, 1, 1, 9).merge().setValue('ИТОГО').setFontWeight('bold').setFontSize(12);
  row++;
  sh.getRange(row, 1).setValue('Всего заявок:').setFontWeight('bold');
  sh.getRange(row, 2).setValue(rows.length); row++;
  sh.getRange(row, 1).setValue('Выполнено:').setFontWeight('bold');
  sh.getRange(row, 2).setValue(totalDone); row++;
  sh.getRange(row, 1).setValue('Отказано:').setFontWeight('bold');
  sh.getRange(row, 2).setValue(totalReject); row += 2;

  sh.getRange(row, 1, 1, 9).merge().setValue('ПО ТИПАМ ЗАЯВОК').setFontWeight('bold').setFontSize(12);
  row++;
  Object.keys(byType).sort().forEach(function(t) {
    const info = byType[t];
    sh.getRange(row, 1).setValue(t + ' — всего ' + info.total).setFontWeight('bold');
    row++;
    Object.keys(info.byInit).sort().forEach(function(init) {
      sh.getRange(row, 2).setValue('• ' + init + ': ' + info.byInit[init]);
      row++;
    });
    row++;
  });

  sh.getRange(row, 1, 1, 9).merge().setValue('ПО ПОДРАЗДЕЛЕНИЯМ (ИНИЦИАТОРАМ)').setFontWeight('bold').setFontSize(12);
  row++;
  Object.keys(byInit).sort().forEach(function(init) {
    sh.getRange(row, 1).setValue('• ' + init + ': ' + byInit[init]);
    row++;
  });

  for (let c = 1; c <= colHeaders.length; c++) sh.autoResizeColumn(c);

  SpreadsheetApp.flush();
  Utilities.sleep(1000);

  const exportUrl = 'https://docs.google.com/spreadsheets/d/' + tmpId + '/export?format=xlsx';
  const resp = UrlFetchApp.fetch(exportUrl, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });

  if (resp.getResponseCode() !== 200) {
    DriveApp.getFileById(tmpId).setTrashed(true);
    return { ok: false, error: 'export failed: ' + resp.getResponseCode() };
  }

  const xlsxBlob = resp.getBlob();
  const fileName = 'Отчёт ' + monthLabel + '.xlsx';

  if (mode === 'download') {
    const bytes = xlsxBlob.getBytes();
    const base64 = Utilities.base64Encode(bytes);
    DriveApp.getFileById(tmpId).setTrashed(true);
    return { ok: true, base64: base64, filename: fileName, rows: rows.length, month: monthLabel };
  }

  const tgUrl = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendDocument';
  const caption = '<b>Отчёт за ' + monthLabel + '</b>\n'
                + 'Всего заявок: ' + rows.length + '\n'
                + 'Выполнено: ' + totalDone + '\n'
                + 'Отказано: ' + totalReject;

  const tgResp = UrlFetchApp.fetch(tgUrl, {
    method: 'post',
    payload: {
      chat_id: TELEGRAM_CHAT_ID,
      document: xlsxBlob.setName(fileName),
      caption: caption,
      parse_mode: 'HTML'
    },
    muteHttpExceptions: true
  });

  DriveApp.getFileById(tmpId).setTrashed(true);

  if (tgResp.getResponseCode() !== 200) {
    return { ok: false, error: 'telegram failed: ' + tgResp.getContentText() };
  }
  return { ok: true, sent: true, rows: rows.length, month: monthLabel };
}

// ===== ИНИЦИАЛИЗАЦИЯ =====
function initializeLastRow() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  const headers = getHeaders(sheet);
  const fioCol = findColumn(headers, 'ФИО');
  const lastRow = sheet.getLastRow();

  let realLast = DATA_START_ROW - 1;

  if (lastRow >= DATA_START_ROW && fioCol) {
    const values = sheet
      .getRange(DATA_START_ROW, fioCol, lastRow - DATA_START_ROW + 1, 1)
      .getValues();
    for (let i = values.length - 1; i >= 0; i--) {
      const t = String(values[i][0] || '').replace(/[\s\u00a0\u200b\ufeff]/g, '');
      if (t) { realLast = DATA_START_ROW + i; break; }
    }
  }

  PropertiesService.getScriptProperties().setProperty(LAST_ROW_PROP, String(realLast));
  console.log('Реальная последняя строка с ФИО:', realLast);
}

// ===== ВЕБХУК =====
function setWebhook() {
  const url = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/setWebhook?url=' + encodeURIComponent(WEBAPP_URL) + '&drop_pending_updates=true';
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  console.log(res.getContentText());
}

function deleteWebhook() {
  UrlFetchApp.fetch('https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/deleteWebhook?drop_pending_updates=true', { muteHttpExceptions: true });
}

function checkWebhook() {
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/getWebhookInfo', { muteHttpExceptions: true });
  console.log(res.getContentText());
}
// ===== КЭШ ЗАГОЛОВКОВ =====
function getCachedHeaders(sheet) {
  const cache = CacheService.getScriptCache();
  const key = 'hdr_' + sheet.getSheetId();
  const cached = cache.get(key);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(HEADER_ROW, 1, 1, lastCol).getValues()[0];
  cache.put(key, JSON.stringify(headers), 300); // 5 минут
  return headers;
}

// ===== КЭШ СПРАВОЧНИКА СОТРУДНИКОВ =====
function getCachedDepartmentCodes() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('dept_codes');
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }
  const codes = getDepartmentCodes();
  cache.put('dept_codes', JSON.stringify(codes), 300);
  return codes;
}

// ===== БЫСТРАЯ КЛАВИАТУРА =====
// Не делает запросов к Sheets — все данные уже прочитаны заранее.
function buildFullKeyboardFast(rowNumber, assigneeCol, statusCol, currentAssignee, currentStatus, extrasVisible, rowValues, validations, headers) {
  const rows = [];
  const assigneeOptions = dropdownFromValidation(validations[assigneeCol - 1])
    .filter(function(o) { return o !== ASSIGNEE_HEADER; });
  const statusOptions = dropdownFromValidation(validations[statusCol - 1])
    .filter(function(o) { return o !== STATUS_HEADER; });

  const baseOptions = [];
  assigneeOptions.forEach(function(opt) {
    const selected = String(opt) === String(currentAssignee);
    baseOptions.push({
      text: (selected ? '✅ ' : '👤 ') + opt,
      callback_data: 'set|' + rowNumber + '|' + assigneeCol + '|' + opt
    });
  });
  statusOptions.forEach(function(opt) {
    const selected = String(opt) === String(currentStatus);
    baseOptions.push({
      text: (selected ? '✅ ' : '📌 ') + opt,
      callback_data: 'set|' + rowNumber + '|' + statusCol + '|' + opt
    });
  });

  for (let i = 0; i < baseOptions.length; i += 2) {
    rows.push(baseOptions.slice(i, i + 2));
  }

  if (!extrasVisible) {
    rows.push([{ text: '🔽 Показать кнопки', callback_data: 'toggle|show|' + rowNumber }]);
    return { inline_keyboard: rows };
  }

  rows.push([{ text: '🔼 Скрыть кнопки', callback_data: 'toggle|hide|' + rowNumber }]);

  const deptCol = findColumn(headers, DEPT_HEADER);
  const typeCol = findColumn(headers, REQ_TYPE_HEADER);
  const initCol = findColumn(headers, INITIATOR_HEADER);

  const extraOptions = [];

  if (deptCol) {
    const cur = String(rowValues[deptCol - 1] || '').trim();
    DEPT_OPTIONS.forEach(function(opt) {
      extraOptions.push({
        text: (cur === opt ? '✅ ' : '🏢 ') + opt,
        callback_data: 'set|' + rowNumber + '|' + deptCol + '|' + opt
      });
    });
  }

  if (typeCol) {
    const cur = String(rowValues[typeCol - 1] || '').trim();
    REQ_TYPE_OPTIONS.forEach(function(opt) {
      extraOptions.push({
        text: (cur === opt ? '✅ ' : '📋 ') + opt,
        callback_data: 'set|' + rowNumber + '|' + typeCol + '|' + opt
      });
    });
  }

  if (initCol) {
    let opts = dropdownFromValidation(validations[initCol - 1]);
    if (!opts || !opts.length) opts = getCachedDepartmentCodes();
    opts = opts.filter(function(o) {
      return String(o).trim().toLowerCase() !== 'ано мс';
    });

    const cur = String(rowValues[initCol - 1] || '').trim();
    opts.forEach(function(opt) {
      extraOptions.push({
        text: (cur === opt ? '✅ ' : '🏷 ') + opt,
        callback_data: 'set|' + rowNumber + '|' + initCol + '|' + opt
      });
    });
  }

  for (let i = 0; i < extraOptions.length; i += 2) {
    rows.push(extraOptions.slice(i, i + 2));
  }

  return { inline_keyboard: rows };
}

// Извлекает список из уже прочитанного объекта валидации
function dropdownFromValidation(validation) {
  if (!validation) return [];
  if (validation.getCriteriaType() !== SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) return [];
  const criteriaValues = validation.getCriteriaValues();
  if (!criteriaValues || !criteriaValues[0]) return [];
  const list = criteriaValues[0];
  if (!Array.isArray(list)) return [];
  return list.map(function(v) { return String(v).trim(); }).filter(function(v) { return v !== ''; });
}
function resolveRequestRow(ref) {
  const sheet = getSheet();
  if (!sheet || ref === undefined || ref === null || String(ref).trim() === '') {
    return 0;
  }

  const value = String(ref).trim();

  // Для обратной совместимости поддерживаем номер строки
  if (/^\d+$/.test(value)) {
    const row = Number(value);
    return row >= DATA_START_ROW ? row : 0;
  }

  const headers = getHeaders(sheet);
  const ridCol = findColumn(headers, REQUEST_ID_HEADER);

  if (!ridCol) return 0;

  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return 0;

  const range = sheet.getRange(
    DATA_START_ROW,
    ridCol,
    lastRow - DATA_START_ROW + 1,
    1
  );

  const cell = range
    .createTextFinder(value)
    .matchEntireCell(true)
    .findNext();

  return cell ? cell.getRow() : 0;
}
