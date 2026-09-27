import './index.css';
import {
  fetchMarkets,
  fetchAllResults,
  onRealtimeChange,
  extractIsoDate,
  extractResultString,
  getTodayIsoDateStr,
  getPreviousIsoDateStr,
  formatDisplayNumber,
  formatTodayDisplayNumber,
  formatYesterdayDisplayNumber,
  formatDbDateToDisplay,
  onServerStatusChange,
  setServerStatus
} from './supabase.js';
import {
  checkAndNotifyResultUpdate,
  isSubscribedToMarket,
  toggleMarketSubscription,
  onNotificationChange
} from './notifications.js';
import {
  initNotificationUI,
  updateKnownMarkets,
  setNotificationToastHandler,
  updateAlertsBadge
} from './notifications-ui.js';

// Month names and Day names
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function isNewGhaziabadMarket(name) {
  if (!name) return false;
  const n = String(name).trim().toLowerCase();
  return (n.includes('new') && (n.includes('gaziabad') || n.includes('ghaziabad')));
}

let allMarkets = [];
let allResults = [];
let ngMarket = null;
let ngResults = []; // Filtered for New Ghaziabad
let selectedMonthYM = 'ALL';
let selectedSpecificDate = getTodayIsoDateStr();
let currentSearchTerm = '';
let visibleRecordLimit = 50;

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getDayNameForDate(dateIso) {
  const cleanIso = extractIsoDate(dateIso);
  if (!cleanIso || !/^\d{4}-\d{2}-\d{2}$/.test(cleanIso)) return '';
  const [y, m, d] = cleanIso.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  return DAY_NAMES[dateObj.getDay()] || '';
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const bgClass = type === 'error' ? 'bg-rose-900 border-rose-700 text-rose-100' :
                  type === 'success' ? 'bg-emerald-900 border-emerald-700 text-emerald-100' :
                  'bg-slate-900 border-slate-700 text-slate-100';

  toast.className = `p-3 rounded-xl shadow-xl border text-xs font-bold pointer-events-auto transition-all transform duration-200 flex items-center justify-between gap-2 ${bgClass}`;
  toast.innerHTML = `
    <span>${escapeHtml(message)}</span>
    <button class="text-slate-400 hover:text-white font-bold ml-2 cursor-pointer">&times;</button>
  `;

  toast.querySelector('button').onclick = () => toast.remove();
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Build map of Date -> Result String specifically for New Ghaziabad
function buildNgDateMap() {
  const map = new Map();
  if (Array.isArray(ngResults)) {
    ngResults.forEach(item => {
      const d = extractIsoDate(item.result_date);
      const rawRes = (item.result !== undefined && item.result !== null) ? item.result : item.result_number;
      const resStr = extractResultString(rawRes);
      if (d && resStr) {
        map.set(d, resStr);
      }
    });
  }
  return map;
}

// 1. RENDER TODAY'S LIVE RESULT CARD
function renderTodayLiveCard() {
  const todayNumEl = document.getElementById('ng-live-today-num');
  const yestNumEl = document.getElementById('ng-live-yesterday-num');
  const drawTimeEl = document.getElementById('ng-live-draw-time');
  const statusBadgeEl = document.getElementById('ng-live-status-badge');
  const dateIndicatorEl = document.getElementById('ng-today-date-indicator');

  const todayIso = getTodayIsoDateStr();
  const yestIso = getPreviousIsoDateStr(todayIso);

  if (dateIndicatorEl) {
    dateIndicatorEl.textContent = `${formatDbDateToDisplay(todayIso)} (${getDayNameForDate(todayIso)})`;
  }

  const dateMap = buildNgDateMap();

  let todayVal = '--';
  if (dateMap.has(todayIso)) {
    todayVal = formatDisplayNumber(dateMap.get(todayIso));
  } else if (ngMarket && ngMarket.today_number !== undefined && ngMarket.today_number !== null) {
    todayVal = formatTodayDisplayNumber(ngMarket.today_number);
  }

  let yestVal = '--';
  if (dateMap.has(yestIso)) {
    yestVal = formatDisplayNumber(dateMap.get(yestIso));
  } else if (ngMarket && ngMarket.yesterday_number !== undefined && ngMarket.yesterday_number !== null) {
    yestVal = formatYesterdayDisplayNumber(ngMarket.yesterday_number);
  }

  if (todayNumEl) todayNumEl.textContent = todayVal;
  if (yestNumEl) yestNumEl.textContent = yestVal;

  const drawTime = ngMarket?.draw_time || '09:45 PM';
  if (drawTimeEl) drawTimeEl.textContent = drawTime;

  // Update New Ghaziabad alert button state
  const alertBtn = document.getElementById('ng-alert-optin-btn');
  const alertBtnText = document.getElementById('ng-alert-optin-text');
  if (alertBtn && alertBtnText) {
    const isSub = isSubscribedToMarket('New Ghaziabad') || isSubscribedToMarket('New Gaziabad');
    if (isSub) {
      alertBtn.className = 'inline-flex items-center gap-1.5 text-xs font-black uppercase px-3 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-500 text-slate-950 border border-amber-500 shadow-sm transition-all cursor-pointer';
      alertBtnText.textContent = 'Alert ON';
    } else {
      alertBtn.className = 'inline-flex items-center gap-1.5 text-xs font-black uppercase px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-amber-300 border border-slate-700 shadow-sm transition-all cursor-pointer';
      alertBtnText.textContent = 'Get Result Alert';
    }

    if (!alertBtn.dataset.listenerAttached) {
      alertBtn.dataset.listenerAttached = 'true';
      alertBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        alertBtn.disabled = true;
        const res = await toggleMarketSubscription('New Ghaziabad');
        showToast(res.message, res.success ? (res.subscribed ? 'success' : 'info') : 'error');
        updateAlertsBadge();
        renderTodayLiveCard();
        alertBtn.disabled = false;
      });
    }
  }

  if (statusBadgeEl) {
    if (todayVal && todayVal !== 'XX' && todayVal !== '--') {
      statusBadgeEl.textContent = '🟢 Result Announced';
      statusBadgeEl.className = 'text-[11px] font-black uppercase px-2.5 py-1 rounded-full bg-emerald-500 text-slate-950 border border-emerald-400 shadow-xs inline-flex items-center gap-1';
    } else {
      statusBadgeEl.textContent = '⏳ Result Expected at ' + drawTime;
      statusBadgeEl.className = 'text-[11px] font-black uppercase px-2.5 py-1 rounded-full bg-amber-400 text-slate-950 border border-amber-300 shadow-xs inline-flex items-center gap-1';
    }
  }
}

// 2. RENDER DATE-WISE RESULT LOOKUP
function renderDateChecker() {
  const resultBox = document.getElementById('ng-date-lookup-result');
  const inputEl = document.getElementById('ng-date-lookup-input');
  if (!resultBox || !inputEl) return;

  const dateIso = selectedSpecificDate;
  inputEl.value = dateIso;

  const dateMap = buildNgDateMap();
  const todayIso = getTodayIsoDateStr();
  const yestIso = getPreviousIsoDateStr(todayIso);

  let numVal = '--';
  if (dateMap.has(dateIso)) {
    numVal = formatDisplayNumber(dateMap.get(dateIso));
  } else if (dateIso === todayIso && ngMarket && ngMarket.today_number !== undefined) {
    numVal = formatTodayDisplayNumber(ngMarket.today_number);
  } else if (dateIso === yestIso && ngMarket && ngMarket.yesterday_number !== undefined) {
    numVal = formatYesterdayDisplayNumber(ngMarket.yesterday_number);
  }

  const isToday = dateIso === todayIso;
  const isYest = dateIso === yestIso;
  const tag = isToday ? ' (Today)' : isYest ? ' (Yesterday)' : '';

  resultBox.innerHTML = `
    <div class="flex items-center justify-between p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
      <div>
        <span class="text-xs text-slate-400 font-bold block">${formatDbDateToDisplay(dateIso)}${tag} • ${getDayNameForDate(dateIso)}</span>
        <span class="text-sm font-black text-amber-400">New Ghaziabad Result</span>
      </div>
      <div class="w-14 h-12 bg-slate-950 border border-amber-400/60 rounded-xl flex items-center justify-center font-mono font-black text-2xl text-amber-400 shadow-inner">
        ${escapeHtml(numVal)}
      </div>
    </div>
  `;
}

// 3. RENDER RECENT PREVIOUS RESULTS (LAST 10-14 DAYS)
function renderRecentPreviousResults() {
  const container = document.getElementById('ng-recent-results-list');
  if (!container) return;

  const dateMap = buildNgDateMap();
  const todayIso = getTodayIsoDateStr();

  // Generate last 14 dates backwards
  const recentDates = [];
  let cur = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(cur);
    d.setDate(cur.getDate() - i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    recentDates.push(iso);
  }

  let html = '';
  recentDates.forEach(dateIso => {
    let num = dateMap.get(dateIso);
    if (!num) {
      if (dateIso === todayIso && ngMarket?.today_number) {
        num = formatTodayDisplayNumber(ngMarket.today_number);
      } else if (dateIso === getPreviousIsoDateStr(todayIso) && ngMarket?.yesterday_number) {
        num = formatYesterdayDisplayNumber(ngMarket.yesterday_number);
      } else {
        num = '--';
      }
    }

    const isToday = dateIso === todayIso;
    const isYest = dateIso === getPreviousIsoDateStr(todayIso);
    const badgeText = isToday ? 'Today' : isYest ? 'Yesterday' : getDayNameForDate(dateIso).substring(0, 3);

    html += `
      <div class="bg-slate-900/90 border border-slate-800 rounded-xl p-3 flex items-center justify-between hover:border-slate-700 transition-colors">
        <div class="space-y-0.5">
          <div class="flex items-center gap-1.5">
            <span class="text-xs font-bold text-slate-200">${formatDbDateToDisplay(dateIso)}</span>
            <span class="text-[10px] font-black uppercase px-1.5 py-0.5 rounded ${isToday ? 'bg-amber-400 text-slate-950 font-black' : 'bg-slate-800 text-slate-400'}">${badgeText}</span>
          </div>
          <span class="text-[11px] text-slate-400">${getDayNameForDate(dateIso)}</span>
        </div>
        <div class="w-12 h-10 bg-slate-950 border border-amber-400/40 rounded-lg flex items-center justify-center font-mono font-black text-lg text-amber-300 shadow-inner">
          ${escapeHtml(num || '--')}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

// 4. POPULATE & RENDER MONTHLY CHART (NEW GHAZIABAD CHART)
function populateMonthDropdown() {
  const monthSelect = document.getElementById('ng-month-select');
  if (!monthSelect) return;

  const uniqueMonths = new Set();
  const now = new Date();
  const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  uniqueMonths.add(curYM);

  if (Array.isArray(ngResults)) {
    ngResults.forEach(item => {
      const d = extractIsoDate(item.result_date);
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
        uniqueMonths.add(d.substring(0, 7));
      }
    });
  }

  const sorted = Array.from(uniqueMonths).sort((a, b) => b.localeCompare(a));
  monthSelect.innerHTML = '';

  const allOpt = document.createElement('option');
  allOpt.value = 'ALL';
  allOpt.textContent = '🌟 All Months (Full View)';
  monthSelect.appendChild(allOpt);

  sorted.forEach(ym => {
    const [yStr, mStr] = ym.split('-');
    const mNum = parseInt(mStr, 10) - 1;
    const opt = document.createElement('option');
    opt.value = ym;
    opt.textContent = `📅 ${MONTH_NAMES[mNum] || mStr} ${yStr}`;
    monthSelect.appendChild(opt);
  });

  // Default to current month if ALL is not chosen
  if (selectedMonthYM === 'ALL') {
    monthSelect.value = curYM;
    selectedMonthYM = curYM;
  } else {
    monthSelect.value = selectedMonthYM;
  }
}

function renderMonthlyChartGrid() {
  const container = document.getElementById('ng-monthly-grid-container');
  const titleEl = document.getElementById('ng-monthly-chart-title');
  if (!container) return;

  const dateMap = buildNgDateMap();
  const now = new Date();
  const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const ymToRender = selectedMonthYM === 'ALL' ? curYM : selectedMonthYM;

  const [yStr, mStr] = ymToRender.split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  const totalDays = new Date(y, m, 0).getDate();
  const monthName = MONTH_NAMES[m - 1] || mStr;

  if (titleEl) {
    titleEl.textContent = `New Ghaziabad Chart – ${monthName} ${y}`;
  }

  let cellsHtml = '';
  for (let d = 1; d <= totalDays; d++) {
    const dStr = String(d).padStart(2, '0');
    const fullIso = `${ymToRender}-${dStr}`;
    const dayOfWeek = getDayNameForDate(fullIso);
    let num = dateMap.get(fullIso);

    if (!num) {
      if (fullIso === getTodayIsoDateStr() && ngMarket?.today_number) {
        num = formatTodayDisplayNumber(ngMarket.today_number);
      } else if (fullIso === getPreviousIsoDateStr(getTodayIsoDateStr()) && ngMarket?.yesterday_number) {
        num = formatYesterdayDisplayNumber(ngMarket.yesterday_number);
      } else {
        num = '--';
      }
    }

    const isToday = fullIso === getTodayIsoDateStr();

    cellsHtml += `
      <div class="flex flex-col items-center justify-between p-2 rounded-xl border ${isToday ? 'bg-amber-400/20 border-amber-400' : 'bg-slate-900 border-slate-800'} text-center shadow-xs">
        <span class="text-[10px] font-black uppercase ${isToday ? 'text-amber-300' : 'text-slate-400'}">${dStr} ${dayOfWeek.substring(0, 3)}</span>
        <div class="my-1 w-full py-1 text-center font-mono font-black text-base sm:text-lg ${num !== '--' && num !== 'XX' ? 'text-amber-400' : 'text-slate-500'}">
          ${escapeHtml(num || '--')}
        </div>
        <span class="text-[9px] text-slate-500 font-semibold">${dStr}/${mStr}</span>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="grid grid-cols-4 sm:grid-cols-7 gap-2">
      ${cellsHtml}
    </div>
  `;
}

// 5. RENDER COMPLETE RECORD CHART TABLE (NEW GHAZIABAD RECORD CHART)
function renderRecordChartTable() {
  const tbody = document.getElementById('ng-record-table-body');
  const countBadge = document.getElementById('ng-record-count-badge');
  const loadMoreBtn = document.getElementById('ng-load-more-btn');
  if (!tbody) return;

  const dateMap = buildNgDateMap();
  const query = currentSearchTerm.trim().toLowerCase();

  // Collect all unique sorted dates from db
  const dateSet = new Set();
  ngResults.forEach(r => {
    const d = extractIsoDate(r.result_date);
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) dateSet.add(d);
  });

  // Ensure today and yesterday are also included
  dateSet.add(getTodayIsoDateStr());
  dateSet.add(getPreviousIsoDateStr(getTodayIsoDateStr()));

  let sortedDates = Array.from(dateSet).sort((a, b) => b.localeCompare(a)); // Descending by date

  if (query) {
    sortedDates = sortedDates.filter(d => {
      const num = dateMap.get(d) || '';
      return d.includes(query) || num.includes(query) || getDayNameForDate(d).toLowerCase().includes(query);
    });
  }

  if (countBadge) {
    countBadge.textContent = `${sortedDates.length} Records Found`;
  }

  if (sortedDates.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="py-8 text-center text-slate-400 text-xs font-bold">
          No New Ghaziabad records found matching your filter.
        </td>
      </tr>
    `;
    if (loadMoreBtn) loadMoreBtn.classList.add('hidden');
    return;
  }

  const pagedDates = sortedDates.slice(0, visibleRecordLimit);
  const todayIso = getTodayIsoDateStr();
  const yestIso = getPreviousIsoDateStr(todayIso);

  let rowsHtml = '';
  pagedDates.forEach(dateIso => {
    let num = dateMap.get(dateIso);
    if (!num) {
      if (dateIso === todayIso && ngMarket?.today_number) {
        num = formatTodayDisplayNumber(ngMarket.today_number);
      } else if (dateIso === yestIso && ngMarket?.yesterday_number) {
        num = formatYesterdayDisplayNumber(ngMarket.yesterday_number);
      } else {
        num = '--';
      }
    }

    const isToday = dateIso === todayIso;
    const isYest = dateIso === yestIso;
    const dateLabel = isToday ? `${formatDbDateToDisplay(dateIso)} (Today)` : isYest ? `${formatDbDateToDisplay(dateIso)} (Yesterday)` : formatDbDateToDisplay(dateIso);

    rowsHtml += `
      <tr class="hover:bg-slate-800/60 transition-colors">
        <td class="py-2.5 px-3 sm:px-4 text-xs font-bold text-slate-200">
          ${escapeHtml(dateLabel)}
        </td>
        <td class="py-2.5 px-3 sm:px-4 text-xs text-slate-400 hidden sm:table-cell">
          ${escapeHtml(getDayNameForDate(dateIso))}
        </td>
        <td class="py-2.5 px-3 sm:px-4 text-xs font-bold text-amber-400">
          New Ghaziabad
        </td>
        <td class="py-2.5 px-3 sm:px-4 text-center">
          <span class="inline-block px-3 py-1 rounded-lg font-mono font-black text-sm ${num !== '--' && num !== 'XX' ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40' : 'bg-slate-800 text-slate-400'}">
            ${escapeHtml(num || '--')}
          </span>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = rowsHtml;

  if (loadMoreBtn) {
    if (sortedDates.length > visibleRecordLimit) {
      loadMoreBtn.classList.remove('hidden');
    } else {
      loadMoreBtn.classList.add('hidden');
    }
  }
}

// Full Render Pipeline
function renderAllSections() {
  renderTodayLiveCard();
  renderDateChecker();
  renderRecentPreviousResults();
  renderMonthlyChartGrid();
  renderRecordChartTable();
}

// Event Listeners setup
function setupEvents() {
  // Refresh button
  const refreshBtn = document.getElementById('ng-refresh-btn');
  const refreshIcon = document.getElementById('ng-refresh-icon');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      if (refreshIcon) refreshIcon.classList.add('animate-spin');
      refreshBtn.disabled = true;
      try {
        await loadData();
        showToast('⚡ New Ghaziabad Results refreshed!', 'success');
      } catch (err) {
        showToast('⚠️ Refresh failed', 'error');
      } finally {
        setTimeout(() => {
          if (refreshIcon) refreshIcon.classList.remove('animate-spin');
          refreshBtn.disabled = false;
        }, 500);
      }
    });
  }

  // Month selector for Monthly Chart
  const monthSelect = document.getElementById('ng-month-select');
  if (monthSelect) {
    monthSelect.addEventListener('change', (e) => {
      selectedMonthYM = e.target.value;
      renderMonthlyChartGrid();
    });
  }

  // Date Checker picker & shortcuts
  const dateInput = document.getElementById('ng-date-lookup-input');
  if (dateInput) {
    dateInput.addEventListener('change', (e) => {
      if (e.target.value) {
        selectedSpecificDate = e.target.value;
        renderDateChecker();
      }
    });
  }

  const btnToday = document.getElementById('ng-shortcut-today');
  if (btnToday) {
    btnToday.addEventListener('click', () => {
      selectedSpecificDate = getTodayIsoDateStr();
      renderDateChecker();
    });
  }

  const btnYest = document.getElementById('ng-shortcut-yesterday');
  if (btnYest) {
    btnYest.addEventListener('click', () => {
      selectedSpecificDate = getPreviousIsoDateStr(getTodayIsoDateStr());
      renderDateChecker();
    });
  }

  // Search input in record table
  const searchInput = document.getElementById('ng-record-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      currentSearchTerm = e.target.value;
      renderRecordChartTable();
    });
  }

  // Load More button in record chart table
  const loadMoreBtn = document.getElementById('ng-load-more-btn');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      visibleRecordLimit += 50;
      renderRecordChartTable();
    });
  }
}

// Data Loader
async function loadData() {
  try {
    const [markets, results] = await Promise.all([
      fetchMarkets(),
      fetchAllResults()
    ]);

    allMarkets = markets || [];
    allResults = results || [];

    // Match New Ghaziabad in markets
    ngMarket = allMarkets.find(m => isNewGhaziabadMarket(m.market_name)) || null;

    // Filter results for New Ghaziabad
    ngResults = allResults.filter(r => isNewGhaziabadMarket(r.market_name));

    updateKnownMarkets(allMarkets);
    populateMonthDropdown();
    renderAllSections();
    setServerStatus('online');
  } catch (err) {
    console.error('Error loading New Ghaziabad data:', err);
    showToast('Failed to load live database data.', 'error');
  }
}

// Initialize Realtime Listeners
function setupRealtime() {
  onRealtimeChange((payload) => {
    const { eventType, record, table } = payload || {};

    if (table === 'results' || table === 'all_results' || table === 'daily_results') {
      if (record && isNewGhaziabadMarket(record.market_name)) {
        if (eventType === 'DELETE') {
          ngResults = ngResults.filter(r => String(r.id) !== String(record.id));
        } else {
          const normDate = extractIsoDate(record.result_date);
          const rawRes = (record.result !== undefined && record.result !== null) ? record.result : record.result_number;
          const resStr = extractResultString(rawRes) || 'XX';
          const item = {
            ...record,
            result_date: normDate,
            result: resStr,
            result_number: resStr
          };
          const idx = ngResults.findIndex(r => String(r.id) === String(record.id) || (extractIsoDate(r.result_date) === normDate));
          if (idx !== -1) {
            ngResults[idx] = item;
          } else {
            ngResults.unshift(item);
          }

          if (resStr && resStr !== 'XX' && resStr !== '--') {
            checkAndNotifyResultUpdate(record.market_name || 'New Ghaziabad', resStr, ngMarket?.draw_time, normDate);
          }
        }
        renderAllSections();
        showToast('⚡ Live update: New Ghaziabad result updated!', 'success');
      } else if (table === 'results' && record && isNewGhaziabadMarket(record.market_name)) {
        ngMarket = record;
        const todayStr = extractResultString(record.today_number);
        if (todayStr && todayStr !== 'XX' && todayStr !== '--') {
          checkAndNotifyResultUpdate(record.market_name || 'New Ghaziabad', todayStr, record.draw_time, getTodayIsoDateStr());
        }
        renderAllSections();
      }
    }
  });
}

export async function initNewGhaziabadPage() {
  setNotificationToastHandler((msg, type) => showToast(msg, type));
  initNotificationUI(allMarkets);
  onNotificationChange(() => {
    renderTodayLiveCard();
    updateAlertsBadge();
  });
  setupEvents();
  setupRealtime();
  await loadData();
}

document.addEventListener('DOMContentLoaded', () => {
  initNewGhaziabadPage();
});

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  initNewGhaziabadPage();
}
