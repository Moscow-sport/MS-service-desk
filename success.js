function getApiUrl() {
  const url = (window.MS_CONFIG && window.MS_CONFIG.apiUrl) || window.API_URL || '';
  if (!url) throw new Error('Не настроен URL. Укажите window.MS_CONFIG.apiUrl в config.js');
  return url;
}

const requestId = String(sessionStorage.getItem('ms_last_request_id') || '').trim();

const feedbackBlock  = document.getElementById('feedbackBlock');
const waitingMessage = document.getElementById('waitingMessage');
const commentInput   = document.getElementById('commentInput');
const sendComment    = document.getElementById('sendComment');
const doneMsg        = document.getElementById('doneMsg');
const backBtn        = document.getElementById('backBtn');

if (backBtn) backBtn.style.display = 'block';

let feedbackShown = false;
let pollTimer     = null;

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function checkStatus() {
  if (!requestId || feedbackShown) return;
  try {
    const res = await fetch(getApiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'checkStatus', requestId })
    });
    const data = await res.json();
    if (!data.ok) return;

    const display = String(data.display || '').trim();

    if (display === 'Отказано') {
      feedbackShown = true;
      waitingMessage.textContent = 'Заявка отклонена. Вы можете оставить комментарий.';
      waitingMessage.style.color = '#c62828';
      waitingMessage.style.background = '#fdecea';
      feedbackBlock.classList.add('visible');
      commentInput.focus();
      stopPolling();
      return;
    }

    if (data.done) {
      feedbackShown = true;
      waitingMessage.textContent = 'Вы можете оставить комментарий по заявке.';
      feedbackBlock.classList.add('visible');
      commentInput.focus();
      stopPolling();
      return;
    }
  } catch (e) { console.error(e); }
}

sendComment.addEventListener('click', async () => {
  const comment = commentInput.value.trim();
  if (!comment) return;
  sendComment.disabled = true;
  try {
    const res = await fetch(getApiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'addFeedback', requestId, comment })
    });
    const data = await res.json();
    if (data.ok) {
      doneMsg.classList.add('visible');
      commentInput.disabled = true;
    } else {
      sendComment.disabled = false;
      alert('Ошибка: ' + (data.error || 'неизвестно'));
    }
  } catch (e) {
    console.error(e);
    sendComment.disabled = false;
  }
});

checkStatus();
pollTimer = setInterval(checkStatus, 5000);
