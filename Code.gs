/**
 * MS service desk backend (Google Apps Script).
 * Secrets (bot token, spreadsheet id, chat id) are read only from Script Properties.
 */

var PROP_SPREADSHEET_ID = 'SPREADSHEET_ID';
var PROP_TELEGRAM_BOT_TOKEN = 'TELEGRAM_BOT_TOKEN';
var PROP_TELEGRAM_CHAT_ID = 'TELEGRAM_CHAT_ID';
var PROP_ADMIN_EMAILS = 'ADMIN_EMAILS';
var REQUESTS_SHEET_NAME = 'Requests';

function doPost(e) {
  try {
    var body = parseJsonBody_(e);
    var action = String(body.action || '').trim();
    if (!action) return jsonOutput_({ ok: false, error: 'action is required' });

    switch (action) {
      case 'submitRequest':
        return jsonOutput_(submitRequest_(body));
      case 'checkStatus':
        return jsonOutput_(checkRequestStatus(body.requestId || body.row));
      case 'addFeedback':
        return jsonOutput_(addFeedback(body.requestId || body.row, body.comment));
      case 'telegramUpdate':
        return jsonOutput_(processUpdate(body.update || body));
      case 'checkAdmin':
        return jsonOutput_(checkAdmin_(body));
      case 'getAdmins':
        return jsonOutput_(getAdmins_(body));
      case 'addAdmin':
        return jsonOutput_(addAdmin_(body));
      case 'removeAdmin':
        return jsonOutput_(removeAdmin_(body));
      case 'getEmployees':
        return jsonOutput_(getEmployees_(body));
      case 'saveEmployees':
        return jsonOutput_(saveEmployees_(body));
      default:
        return jsonOutput_({ ok: false, error: 'unsupported action: ' + action });
    }
  } catch (err) {
    return jsonOutput_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doGet() {
  return ContentService
    .createTextOutput('OK')
    .setMimeType(ContentService.MimeType.TEXT);
}

function processUpdate(update) {
  if (!update || !update.callback_query) return { ok: true, skipped: true };

  var callback = update.callback_query;
  var callbackId = callback.id;
  var callbackData = String(callback.data || '');
  var message = callback.message || {};

  // 1) Answer callback immediately to speed up Telegram UI.
  answerCallbackQuery_(callbackId, 'Принято');

  var setPayload = parseSetPayload_(callbackData);
  if (!setPayload) return { ok: true, skipped: true };

  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(setPayload.sheetName || REQUESTS_SHEET_NAME);
  if (!sheet) return { ok: false, error: 'sheet not found: ' + (setPayload.sheetName || REQUESTS_SHEET_NAME) };

  var row = setPayload.row;
  var col = setPayload.col;
  if (!isPositiveInt_(row) || !isPositiveInt_(col)) {
    return { ok: false, error: 'invalid callback coordinates' };
  }

  var lastCol = sheet.getLastColumn();
  if (col > lastCol) return { ok: false, error: 'column out of range' };

  // 2) Single range read for row values + validations.
  var rowRange = sheet.getRange(row, 1, 1, lastCol);
  var rowValues = rowRange.getValues()[0];
  var rowValidations = rowRange.getDataValidations()[0];

  var value = setPayload.value;
  var rule = rowValidations[col - 1];
  if (rule) {
    var criteriaType = rule.getCriteriaType();
    var criteriaValues = rule.getCriteriaValues();
    if (criteriaType === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST && criteriaValues && criteriaValues[0]) {
      var allowed = criteriaValues[0];
      if (allowed.indexOf(value) === -1) {
        return { ok: false, error: 'value is not allowed by validation list' };
      }
    }
  }

  // 3) Single write.
  sheet.getRange(row, col).setValue(value);
  rowValues[col - 1] = value;

  // 4) Single message edit, keyboard preserved + selected state updated.
  var newReplyMarkup = withSelectedState_(message.reply_markup, callbackData);
  var text = buildCallbackMessageText_(rowValues, setPayload);

  editMessageText_(message.chat && message.chat.id, message.message_id, text, newReplyMarkup);

  return { ok: true };
}

function checkRequestStatus(requestRef) {
  var resolved = resolveRequestRef_(requestRef);
  if (!resolved.ok) return resolved;

  var row = resolved.row;
  var sheet = resolved.sheet;
  var header = resolved.header;

  var lastCol = sheet.getLastColumn();
  var values = sheet.getRange(row, 1, 1, lastCol).getDisplayValues()[0];

  var statusIdx = findHeaderIndex_(header, ['Display', 'display', 'Статус', 'status', 'Решение']);
  var requestIdIdx = findHeaderIndex_(header, ['Request ID', 'requestId', 'request_id']);

  var display = statusIdx >= 0 ? String(values[statusIdx] || '').trim() : '';
  var done = display === 'Выполнено' || display === 'Отказано';

  return {
    ok: true,
    row: row,
    requestId: requestIdIdx >= 0 ? String(values[requestIdIdx] || '').trim() : '',
    display: display,
    done: done
  };
}

function addFeedback(requestRef, comment) {
  var normalizedComment = String(comment || '').trim();
  if (!normalizedComment) return { ok: false, error: 'comment is required' };

  var resolved = resolveRequestRef_(requestRef);
  if (!resolved.ok) return resolved;

  var sheet = resolved.sheet;
  var row = resolved.row;
  var header = resolved.header;

  var commentIdx = findHeaderIndex_(header, ['Комментарий', 'Feedback', 'feedback', 'comment']);
  if (commentIdx < 0) {
    return { ok: false, error: 'feedback column not found' };
  }

  try {
    sheet.getRange(row, commentIdx + 1).setValue(normalizedComment);
    return { ok: true, row: row };
  } catch (err) {
    return { ok: false, error: 'failed to save feedback: ' + err.message };
  }
}

function resolveRequestRef_(requestRef) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(REQUESTS_SHEET_NAME);
  if (!sheet) return { ok: false, error: 'requests sheet not found' };

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return { ok: false, error: 'requests sheet is empty' };

  var header = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var refRaw = requestRef == null ? '' : String(requestRef).trim();
  if (!refRaw) return { ok: false, error: 'request reference is required' };

  if (isPositiveInt_(refRaw)) {
    var rowNum = Number(refRaw);
    if (rowNum >= 2 && rowNum <= lastRow) {
      return { ok: true, sheet: sheet, row: rowNum, header: header };
    }
    return { ok: false, error: 'row not found: ' + rowNum };
  }

  var requestIdIdx = findHeaderIndex_(header, ['Request ID', 'requestId', 'request_id']);
  if (requestIdIdx < 0) {
    return { ok: false, error: 'Request ID column not found' };
  }

  var values = sheet.getRange(2, requestIdIdx + 1, lastRow - 1, 1).getDisplayValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === refRaw) {
      return { ok: true, sheet: sheet, row: i + 2, header: header };
    }
  }

  return { ok: false, error: 'request not found' };
}

function submitRequest_(data) {
  var fio = String(data.fio || '').trim();
  var cabinet = String(data.cabinet || '').trim();
  var requestText = String(data.request || '').trim();
  var requestId = String(data.requestId || '').trim();

  if (!fio || !cabinet || !requestText) {
    return { ok: false, error: 'fio, cabinet and request are required' };
  }

  if (!requestId) {
    requestId = Utilities.getUuid();
  }

  var sheet = ensureRequestsSheet_();
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];

  var rowObj = {
    'Created At': new Date(),
    'FIO': fio,
    'Cabinet': cabinet,
    'Request': requestText,
    'Display': 'Новая',
    'Комментарий': '',
    'Request ID': requestId
  };

  var rowValues = [];
  for (var c = 0; c < header.length; c++) {
    rowValues.push(rowObj.hasOwnProperty(header[c]) ? rowObj[header[c]] : '');
  }

  sheet.appendRow(rowValues);
  var row = sheet.getLastRow();

  sendTelegramNotification_(sheet, row);

  return { ok: true, row: row, requestId: requestId };
}

function ensureRequestsSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(REQUESTS_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(REQUESTS_SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Created At', 'FIO', 'Cabinet', 'Request', 'Display', 'Комментарий', 'Request ID']);
  }

  return sheet;
}

function checkAdmin_(data) {
  var email = String(data.email || '').trim().toLowerCase();
  if (!email) return { ok: false, error: 'email is required' };
  return { ok: true, isAdmin: getAdminSet_().has(email) };
}

function getAdmins_(data) {
  var check = checkAdmin_(data);
  if (!check.ok || !check.isAdmin) return { ok: false, error: 'access denied' };
  var admins = Array.from(getAdminSet_()).map(function (email) {
    return { email: email, role: 'editor' };
  });
  return { ok: true, admins: admins };
}

function addAdmin_(data) {
  var check = checkAdmin_(data);
  if (!check.ok || !check.isAdmin) return { ok: false, error: 'access denied' };

  var email = String(data.newEmail || '').trim().toLowerCase();
  if (!email) return { ok: false, error: 'newEmail is required' };

  var admins = getAdminSet_();
  var already = admins.has(email);
  if (!already) admins.add(email);
  saveAdminSet_(admins);

  return { ok: true, already: already };
}

function removeAdmin_(data) {
  var check = checkAdmin_(data);
  if (!check.ok || !check.isAdmin) return { ok: false, error: 'access denied' };

  var email = String(data.targetEmail || '').trim().toLowerCase();
  if (!email) return { ok: false, error: 'targetEmail is required' };

  var admins = getAdminSet_();
  admins.delete(email);
  saveAdminSet_(admins);

  return { ok: true };
}

function getEmployees_(data) {
  var check = checkAdmin_(data);
  if (!check.ok || !check.isAdmin) return { ok: false, error: 'access denied' };

  var sheet = getSpreadsheet_().getSheetByName('Employees');
  if (!sheet || sheet.getLastRow() === 0) return { ok: true, codes: [], rows: [] };

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var all = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();

  return {
    ok: true,
    codes: all[0] || [],
    rows: all.slice(1)
  };
}

function saveEmployees_(data) {
  var check = checkAdmin_(data);
  if (!check.ok || !check.isAdmin) return { ok: false, error: 'access denied' };

  var payload = data.data || {};
  var codes = payload.codes || [];
  var rows = payload.rows || [];
  if (!codes.length) return { ok: false, error: 'codes are required' };

  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName('Employees');
  if (!sheet) sheet = ss.insertSheet('Employees');
  sheet.clearContents();

  var out = [codes].concat(rows);
  sheet.getRange(1, 1, out.length, codes.length).setValues(out);

  return { ok: true, codes: codes.length, rows: rows.length };
}

function parseJsonBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  var raw = e.postData.contents;
  if (!raw) return {};
  return JSON.parse(raw);
}

function getSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty(PROP_SPREADSHEET_ID);
  if (!id) throw new Error('Script property SPREADSHEET_ID is missing');
  return SpreadsheetApp.openById(id);
}

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function findHeaderIndex_(header, names) {
  var normalized = {};
  for (var i = 0; i < header.length; i++) {
    normalized[String(header[i] || '').trim().toLowerCase()] = i;
  }

  for (var j = 0; j < names.length; j++) {
    var key = String(names[j]).trim().toLowerCase();
    if (normalized.hasOwnProperty(key)) return normalized[key];
  }

  return -1;
}

function isPositiveInt_(value) {
  return /^\d+$/.test(String(value)) && Number(value) > 0;
}

function getAdminSet_() {
  var raw = PropertiesService.getScriptProperties().getProperty(PROP_ADMIN_EMAILS) || '';
  var set = new Set();
  raw.split(',').forEach(function (item) {
    var email = String(item || '').trim().toLowerCase();
    if (email) set.add(email);
  });
  return set;
}

function saveAdminSet_(set) {
  var raw = Array.from(set).sort().join(',');
  PropertiesService.getScriptProperties().setProperty(PROP_ADMIN_EMAILS, raw);
}

function parseSetPayload_(callbackData) {
  var data = String(callbackData || '').trim();
  if (!data) return null;

  if (data.charAt(0) === '{') {
    try {
      var parsed = JSON.parse(data);
      if (parsed && parsed.action === 'set') {
        return {
          sheetName: parsed.sheet || REQUESTS_SHEET_NAME,
          row: Number(parsed.row),
          col: Number(parsed.col),
          value: String(parsed.value || '')
        };
      }
    } catch (e) {}
  }

  var startsWithSet = /^set[:|]/.test(data);
  if (!startsWithSet) return null;

  var clean = data.replace(/^set[:|]/, '');
  var parts = clean.split(/[|:]/);

  if (parts.length < 3) {
    return null;
  }

  if (parts.length === 3) {
    return {
      sheetName: REQUESTS_SHEET_NAME,
      row: Number(parts[0]),
      col: Number(parts[1]),
      value: parts.slice(2).join('|')
    };
  }

  return {
    sheetName: parts[0] || REQUESTS_SHEET_NAME,
    row: Number(parts[1]),
    col: Number(parts[2]),
    value: parts.slice(3).join('|')
  };
}

function withSelectedState_(replyMarkup, callbackData) {
  if (!replyMarkup || !replyMarkup.inline_keyboard) return replyMarkup || null;

  var selectedValue = parseSetPayload_(callbackData);
  if (!selectedValue) return replyMarkup;

  var keyboard = JSON.parse(JSON.stringify(replyMarkup.inline_keyboard));

  for (var i = 0; i < keyboard.length; i++) {
    for (var j = 0; j < keyboard[i].length; j++) {
      var btn = keyboard[i][j];
      if (!btn || !btn.callback_data) continue;
      var payload = parseSetPayload_(btn.callback_data);
      if (!payload) continue;

      var text = String(btn.text || '').replace(/^✅\s*/, '');
      if (payload.row === selectedValue.row && payload.col === selectedValue.col && payload.value === selectedValue.value) {
        btn.text = '✅ ' + text;
      } else if (payload.row === selectedValue.row && payload.col === selectedValue.col) {
        btn.text = text;
      }
    }
  }

  return { inline_keyboard: keyboard };
}

function buildCallbackMessageText_(rowValues, setPayload) {
  var lines = ['Заявка обновлена:'];
  lines.push('Строка: ' + setPayload.row);
  lines.push('Поле: колонка ' + setPayload.col);
  lines.push('Значение: ' + String(setPayload.value || ''));
  if (rowValues && rowValues.length >= setPayload.col) {
    lines.push('Сохранено: ' + String(rowValues[setPayload.col - 1] || ''));
  }

  return lines.join('\n');
}

function answerCallbackQuery_(callbackQueryId, text) {
  if (!callbackQueryId) return;
  telegramApiCall_('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text: text || '',
    show_alert: false
  });
}

function editMessageText_(chatId, messageId, text, replyMarkup) {
  if (!chatId || !messageId) return;
  var payload = {
    chat_id: chatId,
    message_id: messageId,
    text: text,
    parse_mode: 'HTML'
  };
  if (replyMarkup) payload.reply_markup = JSON.stringify(replyMarkup);
  telegramApiCall_('editMessageText', payload);
}

function sendTelegramNotification_(sheet, row) {
  var token = getTelegramToken_();
  var chatId = PropertiesService.getScriptProperties().getProperty(PROP_TELEGRAM_CHAT_ID);
  if (!token || !chatId) return;

  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  var values = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];

  var fio = values[findHeaderIndex_(header, ['FIO', 'ФИО'])] || '';
  var cabinet = values[findHeaderIndex_(header, ['Cabinet', 'Кабинет'])] || '';
  var requestText = values[findHeaderIndex_(header, ['Request', 'Заявка'])] || '';

  var text = [
    'Новая заявка',
    'Строка: ' + row,
    'ФИО: ' + fio,
    'Кабинет: ' + cabinet,
    'Текст: ' + requestText
  ].join('\n');

  telegramApiCall_('sendMessage', {
    chat_id: chatId,
    text: text
  });
}

function getTelegramToken_() {
  return PropertiesService.getScriptProperties().getProperty(PROP_TELEGRAM_BOT_TOKEN) || '';
}

function telegramApiCall_(method, payload) {
  var token = getTelegramToken_();
  if (!token) return null;

  var url = 'https://api.telegram.org/bot' + token + '/' + method;
  var opts = {
    method: 'post',
    payload: payload,
    muteHttpExceptions: true
  };

  var resp = UrlFetchApp.fetch(url, opts);
  var code = resp.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Telegram API error: ' + code + ' ' + resp.getContentText());
  }

  return JSON.parse(resp.getContentText());
}
