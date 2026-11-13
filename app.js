function getApiUrl() {
  const url = (window.MS_CONFIG && window.MS_CONFIG.apiUrl) || window.API_URL || '';
  if (!url) throw new Error('Не настроен URL. Укажите window.MS_CONFIG.apiUrl в config.js');
  return url;
}

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

fioInput.addEventListener('blur', () => {
  const name = fioInput.value.trim();
  if (!name) return;
  const persons = loadPersons();
  if (persons[name]) cabinetInput.value = persons[name];
});

function validate() {
  submitBtn.disabled = !(
    fioInput.value.trim() &&
    cabinetInput.value.trim() &&
    requestInput.value.trim()
  );
}

[fioInput, cabinetInput, requestInput].forEach(el => el.addEventListener('input', validate));
validate();

submitBtn.addEventListener('click', async () => {
  const fio = fioInput.value.trim();
  const cabinet = cabinetInput.value.trim();
  const request = requestInput.value.trim();

  if (!fio || !cabinet || !request) return;

  submitBtn.disabled = true;
  submitBtn.textContent = 'Отправка...';

  const persons = loadPersons();
  persons[fio] = cabinet;
  savePersons(persons);
  
  const contentSig = fio + '\u0001' + cabinet + '\u0001' + request;
  let requestId = sessionStorage.getItem('ms_pending_request_id');
  const pendingTs  = Number(sessionStorage.getItem('ms_pending_request_ts') || 0);
  const pendingSig = sessionStorage.getItem('ms_pending_request_sig') || '';
  const FRESH_MS   = 10 * 60 * 1000; // 10 минут

  if (!requestId || pendingSig !== contentSig || (Date.now() - pendingTs) > FRESH_MS) {
    requestId = (crypto.randomUUID && crypto.randomUUID()) ||
      (Date.now().toString(36) + Math.random().toString(36).slice(2));
    sessionStorage.setItem('ms_pending_request_id', requestId);
    sessionStorage.setItem('ms_pending_request_ts', String(Date.now()));
    sessionStorage.setItem('ms_pending_request_sig', contentSig);
  }
  sessionStorage.setItem('ms_last_request_id', requestId);

  try {
    const response = await fetch(getApiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'submitRequest',
        fio,
        cabinet,
        request,
        requestId
      })
    });

    let data = {};
    try { data = await response.json(); } catch (e) {}

    if (!response.ok || (data && data.ok === false)) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Отправить';
      showToast((data && data.error) || 'Не удалось отправить заявку');
      return;
    }

    alert('Заявка принята');
    sessionStorage.removeItem('ms_pending_request_id');
    sessionStorage.removeItem('ms_pending_request_ts');
    sessionStorage.removeItem('ms_pending_request_sig');
    window.location.href = 'success.html';
  } catch (e) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Отправить';
    showToast('Ошибка отправки. Попробуйте ещё раз.');
  }
});

function showToast(text) {
  if (!toast) return;
  toast.textContent = text;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 3000);
}

let userEmail = '';
let userCredential = '';

window.onSignIn = async function (resp) {
  const loginMsg = document.getElementById('loginMsg');
  if (!loginMsg) return;

  if (!resp || !resp.credential) {
    loginMsg.textContent = 'Не удалось войти';
    return;
  }

  loginMsg.textContent = 'Проверяю доступ...';
  try {
    const part = resp.credential.split('.')[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const padded = part + '==='.slice((part.length + 3) % 4);
    const json = decodeURIComponent(
      atob(padded).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    );
    const payload = JSON.parse(json);
    userEmail = payload.email || '';
    userCredential = resp.credential;

    const r = await fetch(getApiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'checkAdmin', email: userEmail })
    });
    const d = await r.json();
    if (!d.ok) {
      loginMsg.textContent = 'Ошибка: ' + (d.error || '');
      return;
    }
    if (!d.isAdmin) {
      loginMsg.textContent = 'Нет доступа';
      return;
    }
    loginMsg.textContent = 'Доступ разрешён';
  } catch (err) {
    loginMsg.textContent = 'Ошибка проверки';
  }
};
