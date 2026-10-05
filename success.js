function getApiUrl() {
  const url = (window.MS_CONFIG && window.MS_CONFIG.apiUrl) || window.API_URL || '';
  if (!url) throw new Error('Не настроен URL. Укажите window.MS_CONFIG.apiUrl в config.js');
  return url;
}

const row = Number(sessionStorage.getItem('ms_last_row') || 0);

const feedbackBlock  = document.getElementById('feedbackBlock');
const waitingMessage = document.getElementById('waitingMessage');
const commentInput   = document.getElementById('commentInput');
const sendComment    = document.getElementById('sendComment');
const doneMsg        = document.getElementById('doneMsg');
const backBtn        = document.getElementById('backBtn');

let feedbackShown = false;
let pollTimer     = null;

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function checkStatus() {
  if (!row || feedbackShown) return;

  try {
    const res = await fetch(getApiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'checkStatus', row })
    });
    const data = await res.json();
    if (!data.ok) return;

    const display = String(data.display || data.status || '').trim();

    // 1) Отказано — «Отказано» + форма комментария
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

    // 2) Выполнено — форма комментария
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
      body: JSON.stringify({ action: 'addFeedback', row, comment })
    });
    const data = await res.json();
    if (data.ok) {
      doneMsg.classList.add('visible');
      commentInput.disabled = true;
      backBtn.style.display = 'block';
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
