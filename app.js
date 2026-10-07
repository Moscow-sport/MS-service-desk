function getApiUrl() {
  const url = (window.MS_CONFIG && window.MS_CONFIG.apiUrl) || window.API_URL || '';
  if (!url) throw new Error('Не настроен URL. Укажите window.MS_CONFIG.apiUrl в config.js');
  return url;
}

// ===== ФОРМА ЗАЯВКИ =====
// Храним ФИО→кабинет только в sessionStorage — при закрытии вкладки всё удаляется
const LS_PERSONS = 'ms_persons';
const loadPersons = () => {
  try { return JSON.parse(sessionStorage.getItem(LS_PERSONS) || '{}'); }
  catch { return {}; }
};
const savePersons = o => sessionStorage.setItem(LS_PERSONS, JSON.stringify(o));

const fioInput = document.getElementById('fio');
const cabinetInput = document.getElementById('cabinet');
const requestInput = document.getElementById('request');
const submitBtn = document.getElementById('submit');
const toast = document.getElementById('toast');

// Автоподстановка кабинета из sessionStorage (только в рамках текущей вкладки)
fioInput.addEventListener('blur', () => {
  const name = fioInput.value.trim();
  if (!name) return;
  const persons = loadPersons();
  if (persons[name]) cabinetInput.value = persons[name];
});

function validate() {
  const ok = fioInput.value.trim()
          && cabinetInput.value.trim()
          && requestInput.value.trim();
  submitBtn.disabled = !ok;
}
[fioInput, cabinetInput, requestInput].forEach(el => el.addEventListener('input', validate));
validate();

submitBtn.addEventListener('click', async () => {
  const fio = fioInput.value.trim();
  const cabinet = cabinetInput.value.trim();
  const request = requestInput.value.trim();
  submitBtn.disabled = true;
  submitBtn.textContent = 'Отправка...';
  try {
    const res = await fetch(getApiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'submitRequest', fio, cabinet, request })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Ошибка');
    const persons = loadPersons();
    persons[fio] = cabinet;
    savePersons(persons);
    if (data.requestId) sessionStorage.setItem('ms_last_request_id', String(data.requestId));
    if (data.row) sessionStorage.setItem('ms_last_row', String(data.row));
    window.location.href = 'success.html';
  } catch (err) {
    console.error(err);
    showToast('Ошибка: ' + err.message);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Отправить';
  }
});

function showToast(text) {
  toast.textContent = text;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 3000);
}

// ===== АДМИН-ЧАСТЬ =====
let userEmail = '';
let userCredential = '';

window.onSignIn = async function (resp) {
  const loginMsg = document.getElementById('loginMsg');
  loginMsg.textContent = 'Проверяю доступ...';

  try {
    const part = resp.credential.split('.')[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const padded = part + '==='.slice((part.length + 3) % 4);
    const json = decodeURIComponent(
      atob(padded).split('').map(c =>
        '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
      ).join('')
    );
    const payload = JSON.parse(json);
    userEmail = payload.email || '';
    userCredential = resp.credential;

    const r = await fetch(getApiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'checkAdmin', idToken: userCredential })
    });
    const d = await r.json();

    if (!d.ok)      { loginMsg.textContent = 'Ошибка: ' + (d.error || ''); return; }
    if (!d.isAdmin) { loginMsg.textContent = 'Доступ запрещён: ' + userEmail; return; }

    document.getElementById('adminGate').style.display = 'none';
    document.getElementById('adminPanel').style.display = 'block';
    document.getElementById('adminEmail').textContent = userEmail;

    loadAdmins();
  } catch (e) {
    loginMsg.textContent = 'Ошибка: ' + e.message;
  }
};

const adminsList   = document.getElementById('adminsList');
const adminMgmtMsg = document.getElementById('adminMgmtMsg');

async function loadAdmins() {
  adminMgmtMsg.textContent = 'Загружаю список...';
  try {
    const res = await fetch(getApiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'getAdmins', idToken: userCredential })
    });
    const data = await res.json();
    if (!data.ok) { adminMgmtMsg.textContent = 'Ошибка: ' + data.error; return; }

    adminsList.innerHTML = '';
    data.admins.forEach(a => {
      const li = document.createElement('li');
      li.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid #eee';

      const roleLabel = a.role === 'owner' ? 'Владелец' : 'Редактор';
      const left = document.createElement('span');
      left.innerHTML = esc(a.email) + ' <span style="color:#888;font-size:12px">— ' + roleLabel + '</span>';
      li.appendChild(left);

      if (a.role !== 'owner') {
        const btn = document.createElement('button');
        btn.textContent = 'Убрать';
        btn.style.cssText = 'width:auto;margin:0;padding:6px 12px;background:#c62828;font-size:13px';
        btn.onclick = () => removeAdmin(a.email);
        li.appendChild(btn);
      }
      adminsList.appendChild(li);
    });
    adminMgmtMsg.textContent = '';
  } catch (e) {
    adminMgmtMsg.textContent = 'Ошибка: ' + e.message;
  }
}

async function removeAdmin(email) {
  if (!confirm('Убрать доступ для ' + email + '?')) return;
  adminMgmtMsg.textContent = 'Убираю...';
  const res = await fetch(getApiUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'removeAdmin', idToken: userCredential, targetEmail: email })
  });
  const data = await res.json();
  adminMgmtMsg.textContent = data.ok ? 'Убрано' : 'Ошибка: ' + data.error;
  if (data.ok) loadAdmins();
}

document.getElementById('addAdminBtn').addEventListener('click', async () => {
  const input = document.getElementById('newAdminEmail');
  const newEmail = input.value.trim();
  if (!newEmail) return;
  adminMgmtMsg.textContent = 'Добавляю...';
  const res = await fetch(getApiUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'addAdmin', idToken: userCredential, newEmail })
  });
  const data = await res.json();
  if (data.ok) {
    adminMgmtMsg.textContent = data.already ? 'Уже админ' : 'Добавлено';
    input.value = '';
    loadAdmins();
  } else {
    adminMgmtMsg.textContent = 'Ошибка: ' + data.error;
  }
});

// ===== СПРАВОЧНИК (таблица) =====
const statusMsg = document.getElementById('statusMsg');
const tableEl   = document.getElementById('employeesTable');
const theadEl   = tableEl.querySelector('thead');
const tbodyEl   = tableEl.querySelector('tbody');

function renderTable(codes, rows) {
  theadEl.innerHTML = '';
  tbodyEl.innerHTML = '';

  const trh = document.createElement('tr');
  codes.forEach(code => {
    const th = document.createElement('th');
    const inp = document.createElement('input');
    inp.value = code || '';
    inp.placeholder = 'Код отдела';
    th.appendChild(inp);
    trh.appendChild(th);
  });
  const thDel = document.createElement('th');
  thDel.style.minWidth = '28px';
  thDel.style.width = '28px';
  trh.appendChild(thDel);
  theadEl.appendChild(trh);

  rows.forEach(row => {
    const tr = document.createElement('tr');
    codes.forEach((_, cIdx) => {
      const td = document.createElement('td');
      const inp = document.createElement('input');
      inp.value = row[cIdx] || '';
      inp.placeholder = 'ФИО';
      td.appendChild(inp);
      tr.appendChild(td);
    });

    const tdDel = document.createElement('td');
    const btn = document.createElement('button');
    btn.className = 'row-del';
    btn.textContent = '×';
    btn.title = 'Удалить строку';
    btn.onclick = () => tr.remove();
    tdDel.appendChild(btn);
    tr.appendChild(tdDel);

    tbodyEl.appendChild(tr);
  });
}

function collectTable() {
  const codes = [];
  theadEl.querySelectorAll('input').forEach(inp => codes.push(inp.value.trim()));

  const rows = [];
  tbodyEl.querySelectorAll('tr').forEach(tr => {
    const row = [];
    tr.querySelectorAll('input').forEach(inp => row.push(inp.value));
    rows.push(row);
  });

  return { codes, rows };
}

document.getElementById('loadCurrentBtn').addEventListener('click', async () => {
  statusMsg.textContent = 'Загружаю...';
  try {
    const res = await fetch(getApiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'getEmployees', idToken: userCredential })
    });
    const data = await res.json();
    if (!data.ok) { statusMsg.textContent = 'Ошибка: ' + data.error; return; }

    const codes = data.codes || [];
    const rows = (data.rows || []).map(r =>
      codes.map((_, i) => String(r[i] == null ? '' : r[i]))
    );
    renderTable(codes, rows);
    statusMsg.textContent = `Загружено: ${codes.length} отделов, ${rows.length} строк.`;
  } catch (e) {
    statusMsg.textContent = 'Ошибка: ' + e.message;
  }
});

function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

document.getElementById('uploadPptxBtn').addEventListener('click', async () => {
  const f = document.getElementById('pptxFile').files[0];
  if (!f) { statusMsg.textContent = 'Выберите файл PPTX'; return; }

  statusMsg.textContent = 'Читаю файл...';
  try {
    const buf = await f.arrayBuffer();
    const b64 = bufToBase64(buf);

    statusMsg.textContent = 'Парсинг...';
    const res = await fetch(getApiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'parsePptxPreview', idToken: userCredential, fileBase64: b64 })
    });
    const data = await res.json();
    if (!data.ok) { statusMsg.textContent = 'Ошибка: ' + data.error; return; }

    const byDept = data.byDept || {};
    const codes = Object.keys(byDept);
    const maxLen = Math.max(0, ...codes.map(c => byDept[c].length));
    const rows = [];
    for (let i = 0; i < maxLen; i++) {
      rows.push(codes.map(c => byDept[c][i] || ''));
    }
    renderTable(codes, rows);

    const total = codes.reduce((s, c) => s + byDept[c].length, 0);
    statusMsg.textContent = `Распознано: ${codes.length} отделов, ${total} человек. Проверьте и нажмите «Сохранить».`;
  } catch (e) {
    statusMsg.textContent = 'Ошибка: ' + e.message;
  }
});

document.getElementById('addColBtn').addEventListener('click', () => {
  const codes = [];
  theadEl.querySelectorAll('input').forEach(inp => codes.push(inp.value));
  codes.push('');
  const rows = [];
  tbodyEl.querySelectorAll('tr').forEach(tr => {
    const row = [];
    tr.querySelectorAll('input').forEach(inp => row.push(inp.value));
    row.push('');
    rows.push(row);
  });
  renderTable(codes, rows);
});

document.getElementById('addRowBtn').addEventListener('click', () => {
  const codes = [];
  theadEl.querySelectorAll('input').forEach(inp => codes.push(inp.value));
  if (!codes.length) { statusMsg.textContent = 'Сначала загрузите справочник.'; return; }

  const tr = document.createElement('tr');
  codes.forEach(() => {
    const td = document.createElement('td');
    const inp = document.createElement('input');
    inp.value = '';
    inp.placeholder = 'ФИО';
    td.appendChild(inp);
    tr.appendChild(td);
  });
  const tdDel = document.createElement('td');
  const btn = document.createElement('button');
  btn.className = 'row-del';
  btn.textContent = '×';
  btn.onclick = () => tr.remove();
  tdDel.appendChild(btn);
  tr.appendChild(tdDel);
  tbodyEl.appendChild(tr);
});

document.getElementById('saveBtn').addEventListener('click', async () => {
  const payload = collectTable();
  if (!payload.codes.length) { statusMsg.textContent = 'Нечего сохранять.'; return; }

  statusMsg.textContent = 'Сохраняю...';
  try {
    const res = await fetch(getApiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'saveEmployees', idToken: userCredential, data: payload })
    });
    const data = await res.json();
    statusMsg.textContent = data.ok
      ? `Сохранено: ${data.codes} отделов, ${data.rows} строк.`
      : 'Ошибка: ' + data.error;
  } catch (e) {
    statusMsg.textContent = 'Ошибка: ' + e.message;
  }
});

// ===== ОТЧЁТ =====
async function generateReport(mode) {
  const area = document.getElementById('reportArea');
  const month = document.getElementById('reportMonth').value;
  if (!month) { area.textContent = 'Выберите месяц.'; return; }

  area.textContent = mode === 'download'
    ? 'Формирую Excel...'
    : 'Формирую и отправляю в Telegram...';

  try {
    const res = await fetch(getApiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'generateMonthlyReport', month, idToken: userCredential, mode })
    });
    const data = await res.json();
    if (!data.ok) { area.textContent = 'Ошибка: ' + data.error; return; }

    if (mode === 'download') {
      downloadXlsx(data.base64, data.filename);
      area.innerHTML = '<b style="color:#2e7d32">Готово!</b> Файл скачивается (' + data.rows + ' заявок за ' + data.month + ').';
    } else {
      area.innerHTML = '<b style="color:#2e7d32">Отправлено!</b> Отчёт за ' + data.month +
                       ' (' + data.rows + ' заявок) — в Telegram-беседе.';
    }
  } catch (e) {
    area.textContent = 'Ошибка: ' + e.message;
  }
}

function downloadXlsx(base64, filename) {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const blob = new Blob([arr], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

document.getElementById('reportDownloadBtn').addEventListener('click', function() { generateReport('download'); });
document.getElementById('reportTelegramBtn').addEventListener('click', function() { generateReport('telegram'); });

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ===== Скрытая активация One Tap (3 клика по логотипу) =====
(function () {
  const logo = document.getElementById('siteLogo');
  if (!logo) return;

  let clicks = 0;
  let resetTimer = null;

  logo.addEventListener('click', () => {
    clicks++;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => { clicks = 0; }, 1500);

    if (clicks >= 3) {
      clicks = 0;
      clearTimeout(resetTimer);

      if (window.google && google.accounts && google.accounts.id) {
        google.accounts.id.prompt();
      }

      logo.style.transition = 'opacity .15s';
      logo.style.opacity = '0.4';
      setTimeout(() => { logo.style.opacity = '1'; }, 200);
    }
  });
})();
