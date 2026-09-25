const form = document.getElementById('settings');

function gb(mb) {
  return (mb / 1024).toFixed(1);
}

async function refresh() {
  const { settings, memory, discardedCount } = await chrome.runtime.sendMessage({ type: 'status' });
  const low = memory.freeMb < settings.thresholdMb;

  const free = document.getElementById('free');
  free.textContent = gb(memory.freeMb);
  free.parentElement.classList.toggle('low', low);
  document.getElementById('total').textContent = gb(memory.totalMb);
  document.getElementById('count').textContent = discardedCount;

  const fill = document.getElementById('bar-fill');
  fill.style.width = `${Math.min(100, (memory.freeMb / memory.totalMb) * 100)}%`;
  fill.classList.toggle('low', low);

  return settings;
}

function fillForm(settings) {
  form.enabled.checked = settings.enabled;
  form.thresholdMb.value = settings.thresholdMb;
  form.idleMinutes.value = settings.idleMinutes;
  form.protectPinned.checked = settings.protectPinned;
  form.whitelist.value = settings.whitelist.join('\n');
}

async function save() {
  const whitelist = form.whitelist.value
    .split('\n')
    .map((line) => line.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter(Boolean);
  const thresholdMb = Number(form.thresholdMb.value);
  const idleMinutes = Number(form.idleMinutes.value);
  if (!form.thresholdMb.checkValidity() || !form.idleMinutes.checkValidity()) return;

  await chrome.storage.local.set({
    enabled: form.enabled.checked,
    thresholdMb,
    idleMinutes,
    protectPinned: form.protectPinned.checked,
    whitelist,
  });
  document.getElementById('saved').textContent = 'Сохранено';
  refresh();
}

form.addEventListener('change', save);

document.getElementById('discard-now').addEventListener('click', async () => {
  const { count } = await chrome.runtime.sendMessage({ type: 'discardNow' });
  document.getElementById('discard-result').textContent =
    count > 0 ? `Выгружено вкладок: ${count}` : 'Нечего выгружать';
  refresh();
});

refresh().then(fillForm);
setInterval(refresh, 2000);
