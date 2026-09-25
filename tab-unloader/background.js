const DEFAULTS = {
  enabled: true,
  thresholdMb: 1000, // выгружать, когда свободно меньше стольких МБ
  idleMinutes: 10, // не трогать вкладки, открытые недавно
  maxPerCheck: 3, // сколько вкладок выгружать за одну проверку
  protectPinned: true,
  whitelist: [], // домены, которые никогда не выгружаются
};

const ALARM = 'check-memory';
const MB = 1024 * 1024;

chrome.alarms.get(ALARM).then((alarm) => {
  if (!alarm) chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) check();
});

chrome.runtime.onStartup.addListener(check);
chrome.runtime.onInstalled.addListener(check);
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') check();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'status') {
    status().then(sendResponse);
    return true;
  }
  if (msg.type === 'discardNow') {
    getSettings()
      .then((settings) => discardTabs(settings, Infinity, { ignoreIdle: true }))
      .then(async (count) => {
        await check();
        sendResponse({ count });
      });
    return true;
  }
});

function getSettings() {
  return chrome.storage.local.get(DEFAULTS);
}

async function getMemory() {
  const info = await chrome.system.memory.getInfo();
  return { freeMb: info.availableCapacity / MB, totalMb: info.capacity / MB };
}

async function status() {
  const [settings, memory, session] = await Promise.all([
    getSettings(),
    getMemory(),
    chrome.storage.session.get({ discardedCount: 0 }),
  ]);
  return { settings, memory, discardedCount: session.discardedCount };
}

async function check() {
  const settings = await getSettings();
  const { freeMb } = await getMemory();
  if (settings.enabled && freeMb < settings.thresholdMb) {
    await discardTabs(settings, settings.maxPerCheck);
  }
  await updateBadge(settings);
}

function isWhitelisted(url, whitelist) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return whitelist.some((domain) => host === domain || host.endsWith('.' + domain));
}

function canDiscard(tab, settings, now, ignoreIdle) {
  if (tab.active || tab.discarded || tab.audible) return false;
  if (tab.autoDiscardable === false) return false;
  if (tab.pinned && settings.protectPinned) return false;
  if (!tab.url || !/^https?:/.test(tab.url)) return false;
  if (!ignoreIdle && now - (tab.lastAccessed ?? now) < settings.idleMinutes * 60000) return false;
  return !isWhitelisted(tab.url, settings.whitelist);
}

// Выгружает до `limit` вкладок, начиная с тех, где пользователь был давнее всего.
async function discardTabs(settings, limit, { ignoreIdle = false } = {}) {
  const now = Date.now();
  const tabs = (await chrome.tabs.query({}))
    .filter((tab) => canDiscard(tab, settings, now, ignoreIdle))
    .sort((a, b) => (a.lastAccessed ?? now) - (b.lastAccessed ?? now));

  let count = 0;
  for (const tab of tabs) {
    if (count >= limit) break;
    try {
      await chrome.tabs.discard(tab.id);
      count++;
    } catch {
      // вкладка закрылась или Chrome отказался её выгружать
    }
  }

  if (count > 0) {
    const { discardedCount } = await chrome.storage.session.get({ discardedCount: 0 });
    await chrome.storage.session.set({ discardedCount: discardedCount + count });
  }
  return count;
}

async function updateBadge(settings) {
  const { freeMb } = await getMemory();
  const low = freeMb < settings.thresholdMb;
  await chrome.action.setBadgeText({ text: (freeMb / 1024).toFixed(1) });
  await chrome.action.setBadgeBackgroundColor({ color: low ? '#d93025' : '#5f6368' });
  await chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
}
