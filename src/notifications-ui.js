/**
 * NEW GAZIABAD - Notification UI & Preferences Modal
 */

import {
  isNotificationSupported,
  getNotificationPermission,
  requestNotificationPermission,
  getSubscribedMarkets,
  isSubscribedToMarket,
  toggleMarketSubscription,
  subscribeAllMarkets,
  unsubscribeAllMarkets,
  getNotificationSettings,
  updateNotificationSettings,
  sendResultNotification,
  playAlertChime,
  onNotificationChange,
  enableDefaultAlertSubscriptions,
  isInsideIframe
} from './notifications.js';

let allKnownMarkets = [];
let modalContainer = null;
let toastHandler = null;

/**
 * Register toast handler from app
 */
export function setNotificationToastHandler(handler) {
  toastHandler = handler;
}

function showToast(message, type = 'info') {
  if (typeof toastHandler === 'function') {
    toastHandler(message, type);
  } else {
    console.log(`[Toast ${type}]:`, message);
  }
}

/**
 * Initialize Notification UI
 * @param {Array} markets - List of available market objects
 */
export function initNotificationUI(markets = []) {
  if (Array.isArray(markets) && markets.length > 0) {
    allKnownMarkets = markets;
  }

  setupHeaderAlertsButton();
  injectAlertsModal();
  updateAlertsBadge();
  removeTopNotificationBox();

  // Listen for changes
  onNotificationChange(() => {
    updateAlertsBadge();
    renderModalMarketList();
    updateModalPermissionStatus();
  });
}

/**
 * Update available markets list
 */
export function updateKnownMarkets(markets) {
  if (Array.isArray(markets) && markets.length > 0) {
    allKnownMarkets = markets;
    renderModalMarketList();
  }
}

/**
 * Header Alerts button setup
 */
function setupHeaderAlertsButton() {
  const btn = document.getElementById('open-alerts-btn');
  if (btn) {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      openAlertsModal();
    });
  }

  // Also side drawer alerts button if present
  const drawerBtn = document.getElementById('drawer-alerts-btn');
  if (drawerBtn) {
    drawerBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const closeDrawerBtn = document.getElementById('close-drawer-btn');
      if (closeDrawerBtn) closeDrawerBtn.click();
      openAlertsModal();
    });
  }
}

/**
 * Update badge count in header
 */
export function updateAlertsBadge() {
  const badge = document.getElementById('alerts-badge');
  const drawerBadge = document.getElementById('drawer-alerts-badge');
  const subs = getSubscribedMarkets();
  const count = subs.length;

  [badge, drawerBadge].forEach(el => {
    if (!el) return;
    if (count > 0) {
      el.textContent = count > 99 ? '99+' : count;
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });
}

/**
 * Inject the Alert Center Modal into the document body
 */
function injectAlertsModal() {
  if (document.getElementById('alerts-modal-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'alerts-modal-overlay';
  overlay.className = 'hidden fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-fade-in';

  overlay.innerHTML = `
    <div 
      id="alerts-modal-content"
      role="dialog"
      aria-modal="true"
      aria-labelledby="alerts-modal-title"
      class="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] my-auto"
    >
      <!-- Modal Header -->
      <div class="p-4 sm:p-5 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-400 text-slate-950 flex items-center justify-between border-b border-amber-500/50">
        <div class="flex items-center gap-2.5">
          <div class="w-10 h-10 rounded-xl bg-slate-950 text-amber-400 flex items-center justify-center text-xl shadow-xs">
            🔔
          </div>
          <div>
            <h2 id="alerts-modal-title" class="text-base sm:text-lg font-black uppercase tracking-wide">
              Market Result Alerts
            </h2>
            <p class="text-xs font-semibold text-slate-900/80">
              Instant web notifications when results are declared
            </p>
          </div>
        </div>
        <button 
          id="close-alerts-modal-btn" 
          aria-label="Close Alerts"
          class="w-8 h-8 rounded-full bg-slate-950/10 hover:bg-slate-950/20 text-slate-950 flex items-center justify-center font-bold text-lg cursor-pointer transition-colors"
        >
          ✕
        </button>
      </div>

      <!-- Permission Status Banner -->
      <div id="modal-permission-banner" class="p-3.5 border-b text-xs flex items-center justify-between gap-3">
        <!-- Injected dynamically -->
      </div>

      <!-- Modal Body -->
      <div class="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4">
        
        <!-- Quick Actions & Settings -->
        <div class="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
          <div class="flex items-center gap-1.5">
            <button 
              id="alert-select-all-btn" 
              class="text-[11px] font-extrabold px-2.5 py-1 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 cursor-pointer transition-colors"
            >
              Select All
            </button>
            <button 
              id="alert-clear-all-btn" 
              class="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 cursor-pointer transition-colors"
            >
              Deselect All
            </button>
          </div>

          <!-- Sound Chime Toggle -->
          <label class="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none">
            <input 
              type="checkbox" 
              id="alert-sound-toggle" 
              class="rounded text-amber-500 focus:ring-amber-400 w-4 h-4 cursor-pointer"
            />
            <span>🔊 Sound chime</span>
          </label>
        </div>

        <!-- Explanatory note -->
        <div class="bg-amber-50 rounded-xl p-3 border border-amber-200 text-xs text-amber-950 flex items-start gap-2.5">
          <span class="text-base shrink-0">💡</span>
          <p class="leading-relaxed">
            Select the specific game markets you want alerts for. The browser will notify you with the winning number as soon as the result is published, even if this website tab is running in the background.
          </p>
        </div>

        <!-- Market List With Toggles -->
        <div>
          <h3 class="text-xs font-black uppercase tracking-wider text-slate-500 mb-2.5 flex items-center justify-between">
            <span>Select Markets to Follow:</span>
            <span id="modal-sub-count" class="text-amber-600 font-extrabold">0 selected</span>
          </h3>

          <div id="modal-markets-list" class="space-y-2 max-h-64 overflow-y-auto pr-1">
            <!-- Dynamic list of markets -->
          </div>
        </div>

        <!-- Test Notification Action -->
        <div class="pt-2 border-t border-slate-100 flex items-center justify-between flex-wrap gap-2">
          <span class="text-xs text-slate-500 font-medium">Verify alert sounds & popups:</span>
          <button 
            id="test-notification-btn" 
            class="text-xs font-black uppercase px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-amber-300 border border-slate-700 cursor-pointer transition-colors flex items-center gap-1.5 shadow-2xs"
          >
            <span>⚡</span> Send Test Alert
          </button>
        </div>

      </div>

      <!-- Modal Footer -->
      <div class="p-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs">
        <span class="text-slate-500 font-medium">Auto-synced with live database</span>
        <button 
          id="close-alerts-modal-done-btn"
          class="font-black px-4 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-500 text-slate-950 border border-amber-500 cursor-pointer transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  modalContainer = overlay;

  // Event Listeners
  const closeBtns = [
    document.getElementById('close-alerts-modal-btn'),
    document.getElementById('close-alerts-modal-done-btn')
  ];
  closeBtns.forEach(b => {
    if (b) b.addEventListener('click', closeAlertsModal);
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeAlertsModal();
    }
  });

  // Sound toggle
  const soundToggle = document.getElementById('alert-sound-toggle');
  if (soundToggle) {
    const settings = getNotificationSettings();
    soundToggle.checked = Boolean(settings.sound);
    soundToggle.addEventListener('change', () => {
      updateNotificationSettings({ sound: soundToggle.checked });
      showToast(soundToggle.checked ? '🔊 Alert sound chime enabled.' : '🔇 Alert sound chime muted.', 'info');
    });
  }

  // Select all / Deselect all
  const selectAllBtn = document.getElementById('alert-select-all-btn');
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', async () => {
      const names = allKnownMarkets.map(m => m.market_name).filter(Boolean);
      const perm = getNotificationPermission();
      if (perm === 'default') {
        const res = await requestNotificationPermission();
        if (res !== 'granted') {
          showToast('⚠️ Notifications must be allowed to enable alerts.', 'error');
          return;
        }
      } else if (perm === 'denied') {
        showToast('⚠️ Notifications are blocked in your browser settings.', 'error');
        return;
      }

      await subscribeAllMarkets(names);
      showToast('🔔 All market alerts enabled!', 'success');
      renderModalMarketList();
      updateAlertsBadge();
    });
  }

  const clearAllBtn = document.getElementById('alert-clear-all-btn');
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', () => {
      unsubscribeAllMarkets();
      showToast('🔕 All market alerts cleared.', 'info');
      renderModalMarketList();
      updateAlertsBadge();
    });
  }

  // Test Notification
  const testBtn = document.getElementById('test-notification-btn');
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      let perm = getNotificationPermission();
      if (perm === 'default') {
        perm = await requestNotificationPermission();
      }

      if (perm === 'denied') {
        showToast('⚠️ Notifications are blocked in browser settings. Please allow notifications.', 'error');
        return;
      }

      if (perm === 'unsupported') {
        showToast('Browser notifications not supported.', 'error');
        return;
      }

      const sampleMarket = allKnownMarkets[0]?.market_name || 'Disawer';
      const sampleNumber = '78';

      const res = await sendResultNotification({
        marketName: sampleMarket,
        resultNumber: sampleNumber,
        drawTime: '05:15 AM',
        dateStr: new Date().toISOString().slice(0, 10),
        isTest: true
      });

      if (res.sent) {
        showToast('🔔 Test notification sent! Check your screen.', 'success');
      } else {
        showToast(`Test notification issue: ${res.reason || 'permission pending'}`, 'error');
      }
    });
  }
}

/**
 * Open the modal
 */
export function openAlertsModal() {
  injectAlertsModal();
  updateModalPermissionStatus();
  renderModalMarketList();
  if (modalContainer) {
    modalContainer.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  // If permission is still default, request browser permission upon opening alerts
  if (isNotificationSupported() && getNotificationPermission() === 'default') {
    promptBrowserNotificationPermission().then(() => {
      updateModalPermissionStatus();
    }).catch(() => {});
  }
}

/**
 * Close the modal
 */
export function closeAlertsModal() {
  if (modalContainer) {
    modalContainer.classList.add('hidden');
    document.body.style.overflow = '';
  }
}

/**
 * Update permission banner state in modal
 */
function updateModalPermissionStatus() {
  const banner = document.getElementById('modal-permission-banner');
  if (!banner) return;

  const perm = getNotificationPermission();

  if (!isNotificationSupported()) {
    banner.className = 'p-3.5 bg-rose-50 border-b border-rose-200 text-xs text-rose-800 flex items-center gap-2';
    banner.innerHTML = `
      <span>⚠️</span>
      <span class="font-medium">The Notification API is not supported in this browser mode. Alerts will display as in-app popups.</span>
    `;
    return;
  }

  if (perm === 'granted') {
    banner.className = 'p-3.5 bg-emerald-50 border-b border-emerald-200 text-xs text-emerald-900 flex items-center justify-between gap-2';
    banner.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
        <span class="font-bold">Browser Notifications: Active &amp; Allowed</span>
      </div>
      <span class="text-[11px] font-extrabold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-md border border-emerald-300">
        Ready
      </span>
    `;
  } else if (perm === 'denied') {
    const inIframe = isInsideIframe();
    banner.className = 'p-3.5 bg-rose-50 border-b border-rose-200 text-xs text-rose-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5';
    banner.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="text-base">🚫</span>
        <div>
          <strong class="font-black text-rose-950">Browser Notifications Blocked:</strong>
          <span class="block text-[11px] text-rose-700">Click the 🔒 lock icon in your browser address bar → Set Notifications to Allow → Reload.</span>
        </div>
      </div>
      <div class="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
        ${inIframe ? `
          <a href="${window.location.href}" target="_blank" rel="noopener noreferrer" class="text-[11px] font-black uppercase bg-amber-400 hover:bg-amber-300 text-slate-950 px-2.5 py-1 rounded-lg border border-amber-500 shadow-2xs">
            Open Full Tab
          </a>
        ` : ''}
        <button id="modal-recheck-perm-btn" class="text-[11px] font-bold bg-white hover:bg-rose-100 text-rose-800 px-2.5 py-1 rounded-lg border border-rose-300 cursor-pointer">
          Re-check
        </button>
      </div>
    `;

    const recheckBtn = document.getElementById('modal-recheck-perm-btn');
    if (recheckBtn) {
      recheckBtn.addEventListener('click', () => {
        updateModalPermissionStatus();
      });
    }
  } else {
    // Default / Not yet asked
    const inIframe = isInsideIframe();
    banner.className = 'p-3.5 bg-amber-50 border-b border-amber-200 text-xs text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5';
    banner.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="text-base animate-pulse">🔔</span>
        <div>
          <strong class="font-bold text-amber-950">Allow Browser Notifications:</strong>
          <span class="block text-[11px] text-amber-800">Receive instant browser pop-ups the second winning numbers are announced.</span>
        </div>
      </div>
      <div class="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
        <button 
          id="modal-request-perm-btn"
          class="text-[11px] font-black uppercase tracking-wider bg-amber-400 hover:bg-amber-500 text-slate-950 px-3 py-1.5 rounded-lg border border-amber-500 shadow-xs cursor-pointer transition-colors"
        >
          Allow Pop-up
        </button>
        ${inIframe ? `
          <a 
            href="${window.location.href}" 
            target="_blank" 
            rel="noopener noreferrer" 
            class="text-[11px] font-bold text-slate-700 bg-white hover:bg-amber-100 px-2 py-1.5 rounded-lg border border-amber-300 shadow-2xs"
            title="Open in full browser window to trigger native permission pop-up"
          >
            Launch Tab ↗
          </a>
        ` : ''}
      </div>
    `;

    const reqBtn = document.getElementById('modal-request-perm-btn');
    if (reqBtn) {
      reqBtn.addEventListener('click', async () => {
        reqBtn.disabled = true;
        await promptBrowserNotificationPermission();
        updateModalPermissionStatus();
      });
    }
  }
}

/**
 * Render the market list with toggle buttons inside the modal
 */
function renderModalMarketList() {
  const container = document.getElementById('modal-markets-list');
  const countEl = document.getElementById('modal-sub-count');
  if (!container) return;

  const subs = getSubscribedMarkets();
  if (countEl) {
    countEl.textContent = `${subs.length} of ${allKnownMarkets.length} selected`;
  }

  container.innerHTML = '';

  if (allKnownMarkets.length === 0) {
    container.innerHTML = `
      <div class="text-xs text-slate-400 text-center py-4">
        Loading game markets...
      </div>
    `;
    return;
  }

  allKnownMarkets.forEach(market => {
    const isSub = isSubscribedToMarket(market.market_name);
    const item = document.createElement('div');
    item.className = `flex items-center justify-between p-2.5 rounded-xl border transition-all ${
      isSub
        ? 'bg-amber-50/80 border-amber-300 shadow-2xs'
        : 'bg-slate-50 border-slate-200 hover:bg-slate-100/80'
    }`;

    item.innerHTML = `
      <div class="flex items-center gap-2.5">
        <span class="text-sm">${isSub ? '🔔' : '🔕'}</span>
        <div>
          <span class="text-xs font-black text-slate-900 block">
            ${market.market_name}
          </span>
          <span class="text-[10px] text-slate-500 font-semibold">
            Draw Time: <strong class="text-slate-800">${market.draw_time || '12:00 PM'}</strong>
          </span>
        </div>
      </div>

      <button 
        data-market-name="${market.market_name}" 
        class="market-alert-toggle-btn text-[11px] font-black uppercase px-2.5 py-1 rounded-lg border transition-colors cursor-pointer flex items-center gap-1 ${
          isSub
            ? 'bg-amber-400 hover:bg-amber-500 text-slate-950 border-amber-500 shadow-2xs'
            : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
        }"
      >
        <span>${isSub ? 'Alert ON' : 'Alert OFF'}</span>
      </button>
    `;

    const toggleBtn = item.querySelector('.market-alert-toggle-btn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        toggleBtn.disabled = true;
        const res = await toggleMarketSubscription(market.market_name);
        showToast(res.message, res.success ? (res.subscribed ? 'success' : 'info') : 'error');
        renderModalMarketList();
        updateAlertsBadge();
        toggleBtn.disabled = false;
      });
    }

    container.appendChild(item);
  });
}

/**
 * Create a Market Card Alert Button element or HTML
 * @param {string} marketName
 * @returns {string} HTML string
 */
export function getCardAlertButtonHtml(marketName) {
  const isSub = isSubscribedToMarket(marketName);
  const escapedName = String(marketName || '').replace(/"/g, '&quot;');

  if (isSub) {
    return `
      <button 
        type="button"
        data-action="toggle-alert"
        data-market-name="${escapedName}"
        title="Alerts enabled for ${escapedName}. Click to turn off."
        aria-label="Alerts enabled for ${escapedName}"
        class="market-card-alert-btn inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider bg-amber-400 hover:bg-amber-500 text-slate-950 px-2 py-0.5 rounded-md border border-amber-500 shadow-2xs transition-colors cursor-pointer"
      >
        <span>🔔</span>
        <span>Alert ON</span>
      </button>
    `;
  }

  return `
    <button 
      type="button"
      data-action="toggle-alert"
      data-market-name="${escapedName}"
      title="Turn on live alerts for ${escapedName}"
      aria-label="Turn on live alerts for ${escapedName}"
      class="market-card-alert-btn inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-slate-100 hover:bg-amber-100 text-slate-700 hover:text-slate-950 px-2 py-0.5 rounded-md border border-slate-300 hover:border-amber-400 transition-colors cursor-pointer"
    >
      <span>🔔</span>
      <span>Get Alert</span>
    </button>
  `;
}

/**
 * Attach click listener for all card alert buttons on the page
 */
export function attachCardAlertListeners(containerEl, onToggledCallback) {
  if (!containerEl) return;

  const btns = containerEl.querySelectorAll('.market-card-alert-btn');
  btns.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const marketName = btn.getAttribute('data-market-name');
      if (!marketName) return;

      btn.disabled = true;
      const res = await toggleMarketSubscription(marketName);

      showToast(res.message, res.success ? (res.subscribed ? 'success' : 'info') : 'error');
      updateAlertsBadge();

      if (typeof onToggledCallback === 'function') {
        onToggledCallback(marketName, res.subscribed);
      }

      btn.disabled = false;
    });
  });
}

/**
 * Remove any top notification box or banner from the DOM
 */
export function removeTopNotificationBox() {
  const container = document.getElementById('browser-notification-banner');
  if (container && container.parentNode) {
    container.parentNode.removeChild(container);
  }
  const promptEl = document.getElementById('notification-permission-prompt');
  if (promptEl && promptEl.parentNode) {
    promptEl.parentNode.removeChild(promptEl);
  }
}

/**
 * Render in-page Notification Status & Request Bar
 * Note: Top notification box removed as requested by user. Ensures DOM is cleaned up.
 */
export function renderNotificationBanner() {
  removeTopNotificationBox();
}

/**
 * Storage key to track if user dismissed the permission prompt in this session
 */
const PROMPT_SESSION_KEY = 'satta_king_perm_prompt_dismissed';

/**
 * Dismiss and remove the permission prompt banner from DOM
 */
export function dismissNotificationPermissionPrompt() {
  const el = document.getElementById('notification-permission-prompt');
  if (el) {
    el.style.opacity = '0';
    el.style.transform = 'translate(-50%, -20px)';
    setTimeout(() => {
      if (el && el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }, 300);
  }
}

/**
 * Request notification permission from the browser directly and setup default alerts.
 * Triggers the browser's native popup dialog.
 * @returns {Promise<string>} Permission status
 */
export async function promptBrowserNotificationPermission() {
  if (!isNotificationSupported()) {
    showToast('Browser notifications are not supported on this device/browser.', 'error');
    return 'unsupported';
  }

  const currentPerm = getNotificationPermission();
  if (currentPerm === 'granted') {
    showToast('🔔 Notifications are already enabled! Live alerts active.', 'success');
    dismissNotificationPermissionPrompt();
    return 'granted';
  }

  // If in an iframe, warn that the browser might require a direct top-level tab
  const inIframe = isInsideIframe();

  try {
    const permission = await requestNotificationPermission();

    if (permission === 'granted') {
      // Auto-subscribe default primary markets if user has no subscriptions
      enableDefaultAlertSubscriptions(allKnownMarkets);
      playAlertChime();

      // Dispatch welcome test alert so the user immediately sees it works
      await sendResultNotification({
        marketName: 'NEW GAZIABAD',
        resultNumber: 'LIVE',
        isTest: true
      });

      showToast('🔔 Notifications allowed! You will receive instant live result alerts.', 'success');
      updateAlertsBadge();
      dismissNotificationPermissionPrompt();
    } else if (permission === 'denied') {
      if (inIframe) {
        showToast('⚠️ Browser blocked notifications in preview frame. Click "Launch in Full Tab" to allow.', 'error');
      } else {
        showToast('⚠️ Notifications are blocked in your browser. Click the lock 🔒 icon in address bar to Allow.', 'error');
      }
      // Re-render prompt with blocked guidance
      setupNotificationPermissionPrompt(true);
    } else {
      // Still default (dismissed or ignored)
      if (inIframe) {
        showToast('💡 Tip: In embedded preview, open site in a full browser tab to show the browser pop-up.', 'info');
      }
    }

    return permission;
  } catch (err) {
    console.error('Error requesting notification permission:', err);
    return getNotificationPermission();
  }
}

/**
 * Force display the notification request banner / dialog
 */
export function showNotificationPermissionDialog() {
  removeTopNotificationBox();
  openAlertsModal();
}

/**
 * Setup and display notification permission prompt.
 * Note: Top notification boxes are removed; opening alert modal is used instead.
 * @param {boolean} force - If true, opens the alert center modal
 */
export function setupNotificationPermissionPrompt(force = false) {
  removeTopNotificationBox();
  if (force) {
    openAlertsModal();
  }
}
