/**
 * SATTA KING FAST - Real-time Web Notification System
 * Uses the Browser's Notification API for instant alerts when market results are published.
 */

const STORAGE_KEY_SUBS = 'satta_king_market_alerts';
const STORAGE_KEY_SETTINGS = 'satta_king_alert_settings';
const NOTIFIED_CACHE_SESSION = 'satta_king_notified_cache';

let listeners = [];
let audioCtx = null;

/**
 * Check if running inside an iframe (e.g. AI Studio dev preview)
 */
export function isInsideIframe() {
  try {
    return window.self !== window.top;
  } catch (e) {
    return true;
  }
}

/**
 * Check if the browser supports the Notification API
 */
export function isNotificationSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/**
 * Get current browser notification permission
 * @returns {'granted' | 'denied' | 'default' | 'unsupported'}
 */
export function getNotificationPermission() {
  if (!isNotificationSupported()) {
    return 'unsupported';
  }
  return Notification.permission;
}

/**
 * Default popular markets for automatic subscription upon permission granted
 */
export const DEFAULT_ALERT_MARKETS = [
  'Disawer',
  'Faridabad',
  'Gaziabad',
  'Gali',
  'New Ghaziabad',
  'Delhi Noon',
  'Punjab Day',
  'New Faridabad'
];

/**
 * Automatically subscribe user to default markets if currently empty
 * @param {Array} availableMarkets
 * @returns {string[]}
 */
export function enableDefaultAlertSubscriptions(availableMarkets = []) {
  const currentSubs = getSubscribedMarkets();
  if (currentSubs.length > 0) return currentSubs;

  const namesToSub = [];
  if (Array.isArray(availableMarkets) && availableMarkets.length > 0) {
    availableMarkets.forEach(m => {
      if (m && m.market_name) namesToSub.push(m.market_name.trim());
    });
  } else {
    namesToSub.push(...DEFAULT_ALERT_MARKETS);
  }

  saveSubscribedMarkets(namesToSub);
  return namesToSub;
}

/**
 * Request notification permission from the user
 * Triggers the browser's native permission pop-up dialog.
 * @returns {Promise<'granted' | 'denied' | 'default' | 'unsupported'>}
 */
export async function requestNotificationPermission() {
  if (!isNotificationSupported()) {
    return 'unsupported';
  }

  try {
    // If already granted, no need to ask
    if (Notification.permission === 'granted') {
      notifyListeners();
      return 'granted';
    }

    let permission;
    // Modern Promise-based API (Chrome, Edge, Firefox, Safari 15+)
    const promise = Notification.requestPermission();
    if (promise && typeof promise.then === 'function') {
      permission = await promise;
    } else {
      // Legacy callback API (old Safari)
      permission = await new Promise((resolve) => {
        Notification.requestPermission(resolve);
      });
    }

    const finalPerm = permission || Notification.permission;
    notifyListeners();
    return finalPerm;
  } catch (err) {
    console.warn('Notification permission request notice:', err);
    notifyListeners();
    return Notification.permission || 'denied';
  }
}

/**
 * Normalize market name for consistent lookup
 */
export function normalizeMarketKey(marketName) {
  if (!marketName) return '';
  return String(marketName).trim().toLowerCase();
}

/**
 * Get list of subscribed market names
 * @returns {string[]}
 */
export function getSubscribedMarkets() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SUBS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('Failed to parse subscribed markets:', e);
    return [];
  }
}

/**
 * Check if user is subscribed to a specific market
 * @param {string} marketName
 * @returns {boolean}
 */
export function isSubscribedToMarket(marketName) {
  if (!marketName) return false;
  const subs = getSubscribedMarkets();
  const targetKey = normalizeMarketKey(marketName);
  return subs.some(item => normalizeMarketKey(item) === targetKey);
}

/**
 * Save subscribed markets array to localStorage
 */
function saveSubscribedMarkets(list) {
  try {
    localStorage.setItem(STORAGE_KEY_SUBS, JSON.stringify(list));
    notifyListeners();
  } catch (e) {
    console.warn('Failed to save subscribed markets:', e);
  }
}

/**
 * Toggle subscription for a specific market.
 * If turning ON and permission is default, requests permission first.
 * @param {string} marketName
 * @returns {Promise<{ success: boolean, subscribed: boolean, status: string, message: string }>}
 */
export async function toggleMarketSubscription(marketName) {
  if (!marketName) {
    return { success: false, subscribed: false, status: 'error', message: 'Invalid market name' };
  }

  if (!isNotificationSupported()) {
    return {
      success: false,
      subscribed: false,
      status: 'unsupported',
      message: 'Browser Notifications are not supported on this browser/device.'
    };
  }

  let permission = getNotificationPermission();

  if (isSubscribedToMarket(marketName)) {
    // Unsubscribe
    const targetKey = normalizeMarketKey(marketName);
    const updated = getSubscribedMarkets().filter(m => normalizeMarketKey(m) !== targetKey);
    saveSubscribedMarkets(updated);
    return {
      success: true,
      subscribed: false,
      status: permission,
      message: `🔕 Alerts turned OFF for ${marketName}.`
    };
  }

  // User wants to subscribe - check permission
  if (permission === 'default') {
    permission = await requestNotificationPermission();
  }

  if (permission === 'denied') {
    return {
      success: false,
      subscribed: false,
      status: 'denied',
      message: '⚠️ Notifications are blocked in your browser. Please allow notifications in site settings to receive alerts.'
    };
  }

  if (permission === 'granted') {
    const subs = getSubscribedMarkets();
    const targetKey = normalizeMarketKey(marketName);
    if (!subs.some(m => normalizeMarketKey(m) === targetKey)) {
      subs.push(marketName.trim());
      saveSubscribedMarkets(subs);
    }
    return {
      success: true,
      subscribed: true,
      status: 'granted',
      message: `🔔 Alerts enabled for ${marketName}! You'll be notified immediately when today's result is declared.`
    };
  }

  return {
    success: false,
    subscribed: false,
    status: permission,
    message: 'Notification permission was not granted.'
  };
}

/**
 * Subscribe to all provided markets
 */
export async function subscribeAllMarkets(marketNames) {
  if (!isNotificationSupported()) return false;

  let permission = getNotificationPermission();
  if (permission === 'default') {
    permission = await requestNotificationPermission();
  }

  if (permission !== 'granted') return false;

  const validNames = (marketNames || [])
    .map(n => String(n).trim())
    .filter(Boolean);

  const current = getSubscribedMarkets();
  const currentKeys = new Set(current.map(normalizeMarketKey));

  validNames.forEach(name => {
    if (!currentKeys.has(normalizeMarketKey(name))) {
      current.push(name);
      currentKeys.add(normalizeMarketKey(name));
    }
  });

  saveSubscribedMarkets(current);
  return true;
}

/**
 * Unsubscribe from all markets
 */
export function unsubscribeAllMarkets() {
  saveSubscribedMarkets([]);
}

/**
 * Notification Settings (sound, vibration)
 */
export function getNotificationSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (raw) {
      return { sound: true, vibrate: true, ...JSON.parse(raw) };
    }
  } catch (e) {
    // fallback
  }
  return { sound: true, vibrate: true };
}

export function updateNotificationSettings(newSettings) {
  try {
    const current = getNotificationSettings();
    const merged = { ...current, ...newSettings };
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(merged));
    notifyListeners();
  } catch (e) {
    console.warn('Failed to update alert settings:', e);
  }
}

/**
 * Play a synthesized chime using Web Audio API
 */
export function playAlertChime() {
  const settings = getNotificationSettings();
  if (!settings.sound) return;

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    if (!audioCtx || audioCtx.state === 'closed') {
      audioCtx = new AudioContextClass();
    }

    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const now = audioCtx.currentTime;

    // First note: 587.33 Hz (D5)
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.001, now);
    gain1.gain.exponentialRampToValueAtTime(0.3, now + 0.04);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    osc1.start(now);
    osc1.stop(now + 0.18);

    // Second note: 880 Hz (A5) - Bright & festive
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(880, now + 0.12);
    gain2.gain.setValueAtTime(0.001, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.4, now + 0.16);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.52);
  } catch (err) {
    console.warn('Web Audio chime not permitted yet:', err);
  }
}

/**
 * In-memory / session de-duplication cache
 */
function getNotifiedCache() {
  try {
    const raw = sessionStorage.getItem(NOTIFIED_CACHE_SESSION);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    // fallback
  }
  return {};
}

function markAsNotified(key) {
  try {
    const cache = getNotifiedCache();
    cache[key] = Date.now();
    sessionStorage.setItem(NOTIFIED_CACHE_SESSION, JSON.stringify(cache));
  } catch (e) {
    // ignore
  }
}

function hasBeenNotified(key) {
  const cache = getNotifiedCache();
  return Boolean(cache[key]);
}

/**
 * Dispatch Browser Web Notification
 * @param {Object} options
 * @param {string} options.marketName - Market name
 * @param {string} options.resultNumber - Declared winning number (e.g., "42", "09")
 * @param {string} [options.drawTime] - Draw time
 * @param {string} [options.dateStr] - Result date (YYYY-MM-DD)
 * @param {boolean} [options.isTest] - Is test notification
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 */
export async function sendResultNotification({ marketName, resultNumber, drawTime, dateStr, isTest = false }) {
  if (!isNotificationSupported()) {
    return { sent: false, reason: 'unsupported' };
  }

  const permission = getNotificationPermission();
  if (permission !== 'granted') {
    return { sent: false, reason: 'not_granted' };
  }

  // De-duplication check (unless test)
  const todayDate = dateStr || new Date().toISOString().slice(0, 10);
  const cacheKey = `${normalizeMarketKey(marketName)}_${todayDate}_${resultNumber}`;

  if (!isTest && hasBeenNotified(cacheKey)) {
    return { sent: false, reason: 'already_notified' };
  }

  const title = isTest
    ? `🔔 SATTA KING FAST: Test Alert`
    : `👑 SATTA KING FAST: ${marketName} Result Out!`;

  const body = isTest
    ? `Alerts are working perfectly! You will receive instant notifications when ${marketName} results are declared.`
    : `🎯 ${marketName} Winning Number: [ ${resultNumber} ] has just been declared!${drawTime ? ` (Scheduled: ${drawTime})` : ''} Click to check full chart.`;

  const slug = String(marketName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const targetUrl = slug ? `/${slug}` : '/#home';

  const notificationOptions = {
    body,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: isTest ? 'test-notification' : `result-${normalizeMarketKey(marketName)}-${todayDate}`,
    renotify: true,
    requireInteraction: false,
    silent: false,
    data: {
      url: targetUrl,
      marketName,
      resultNumber,
      timestamp: Date.now()
    }
  };

  // Add vibration if supported & enabled
  const settings = getNotificationSettings();
  if (settings.vibrate && 'vibrate' in navigator) {
    notificationOptions.vibrate = [200, 100, 200];
  }

  playAlertChime();

  let notificationInstance = null;

  // Try standard Notification API
  try {
    notificationInstance = new Notification(title, notificationOptions);

    notificationInstance.onclick = function (event) {
      event.preventDefault();
      try {
        window.focus();
      } catch (e) {
        // ignore
      }
      if (window.location.pathname !== targetUrl) {
        window.location.href = targetUrl;
      }
      notificationInstance.close();
    };

    if (!isTest) {
      markAsNotified(cacheKey);
    }

    return { sent: true };
  } catch (err) {
    console.warn('Standard new Notification constructor failed, attempting ServiceWorker:', err);

    // Fallback to ServiceWorkerRegistration.showNotification if available
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.ready;
        if (registration && registration.showNotification) {
          await registration.showNotification(title, notificationOptions);
          if (!isTest) {
            markAsNotified(cacheKey);
          }
          return { sent: true };
        }
      } catch (swErr) {
        console.error('ServiceWorker showNotification failed:', swErr);
      }
    }

    return { sent: false, reason: err.message };
  }
}

/**
 * Handle new result announced event and notify if user subscribed
 * @param {string} marketName
 * @param {string} newResult
 * @param {string} [drawTime]
 * @param {string} [dateStr]
 */
export async function checkAndNotifyResultUpdate(marketName, newResult, drawTime, dateStr) {
  if (!marketName || !newResult) return;
  const str = String(newResult).trim();
  if (str === '' || str.toUpperCase() === 'XX' || str === '--') return;

  // Check if user is subscribed to this market
  if (!isSubscribedToMarket(marketName)) return;

  console.log(`⚡ [Notification Alert Triggered] New result for ${marketName}: ${str}`);
  await sendResultNotification({
    marketName,
    resultNumber: str,
    drawTime,
    dateStr
  });
}

/**
 * Listener registration for subscription/permission changes
 */
export function onNotificationChange(callback) {
  if (typeof callback === 'function') {
    listeners.push(callback);
  }
  return () => {
    listeners = listeners.filter(cb => cb !== callback);
  };
}

function notifyListeners() {
  const currentSubs = getSubscribedMarkets();
  const perm = getNotificationPermission();
  listeners.forEach(cb => {
    try {
      cb({
        permission: perm,
        subscribedMarkets: currentSubs,
        settings: getNotificationSettings()
      });
    } catch (e) {
      console.error('Error in notification listener:', e);
    }
  });
}
