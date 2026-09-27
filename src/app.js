import {
  fetchMarkets,
  fetchAllResults,
  updateMarket,
  onRealtimeChange,
  isSupabaseConfigured,
  getEffectiveConfig,
  fetchMarketHistory,
  saveDailyResultRecord,
  getTodayIsoDateStr,
  getPreviousIsoDateStr,
  fetchDailyResultsForDate,
  getISTDateTime,
  executeAutoShiftIST,
  onServerStatusChange,
  setServerStatus,
  formatTodayDisplayNumber,
  formatYesterdayDisplayNumber,
  formatDisplayNumber,
  extractResultString,
  extractIsoDate,
  formatDbDateToDisplay
} from './supabase.js';

let allMarkets = [];
let allResults = [];
let filteredMarkets = [];
let currentSearchQuery = '';
let isLoading = true;

let selectedUserDateIso = getTodayIsoDateStr();
let cachedDateResults = new Map(); // dateIso -> Map(market_name -> result_number)

async function getDateResults(dateIso) {
  const normDate = extractIsoDate(dateIso) || dateIso;
  const resultMap = new Map();

  if (!normDate) return resultMap;

  // First populate from allResults cache
  if (Array.isArray(allResults) && allResults.length > 0) {
    allResults.forEach(item => {
      const itemDate = extractIsoDate(item.result_date);
      if (itemDate === normDate) {
        const rawRes = (item.result !== undefined && item.result !== null) ? item.result : item.result_number;
        const resStr = extractResultString(rawRes);
        if (item.market_name && resStr) {
          resultMap.set(item.market_name, resStr);
        }
      }
    });
  }

  if (cachedDateResults.has(normDate)) {
    const cached = cachedDateResults.get(normDate);
    cached.forEach((val, name) => {
      if (!resultMap.has(name)) resultMap.set(name, val);
    });
    return resultMap;
  }

  const dbMap = await fetchDailyResultsForDate(normDate);
  dbMap.forEach((val, name) => {
    if (!resultMap.has(name)) resultMap.set(name, val);
  });
  cachedDateResults.set(normDate, resultMap);
  return resultMap;
}

function setupUserDatePicker() {
  const datePicker = document.getElementById('home-date-picker');
  const todayBtn = document.getElementById('home-today-date-btn');

  if (datePicker) {
    datePicker.value = selectedUserDateIso;
    datePicker.addEventListener('change', () => {
      if (datePicker.value) {
        selectedUserDateIso = datePicker.value;
        applyFilterAndRender();
      }
    });
  }

  if (todayBtn) {
    todayBtn.addEventListener('click', () => {
      selectedUserDateIso = getTodayIsoDateStr();
      if (datePicker) datePicker.value = selectedUserDateIso;
      applyFilterAndRender();
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

export async function initApp() {
  // Ensure dark class is removed if leftover
  document.documentElement.classList.remove('dark');
  setupNavigation();
  setupContactForm();
  setupSearch();
  setupRefreshButton();
  setupNetworkListeners();
  setupToastSystem();
  setupUserDatePicker();

  // Listen to Server Status changes
  onServerStatusChange((status) => {
    updateServerStatusBanner(status);
  });

  // Subscribe to Realtime DB updates
  onRealtimeChange((payload) => {
    console.log('⚡ Realtime event received in App UI:', payload);
    const { eventType, record, table } = payload || {};

    if (table === 'all_results' || table === 'daily_results') {
      if (record) {
        const normDate = extractIsoDate(record.result_date);
        const rawRes = (record.result !== undefined && record.result !== null) ? record.result : record.result_number;
        const resStr = extractResultString(rawRes) || 'XX';
        const recordId = record.id;

        if (eventType === 'DELETE') {
          allResults = allResults.filter(r => String(r.id) !== String(recordId));
        } else {
          const itemNormalized = {
            id: record.id,
            market_id: record.market_id,
            market_name: record.market_name,
            result_date: normDate,
            result: resStr,
            result_number: resStr,
            draw_time: record.draw_time,
            created_at: record.created_at,
            updated_at: record.updated_at
          };

          const existingIdx = allResults.findIndex(r =>
            (recordId && String(r.id) === String(recordId)) ||
            (record.market_id && r.market_id && String(r.market_id) === String(record.market_id) && extractIsoDate(r.result_date) === normDate) ||
            (r.market_name === record.market_name && extractIsoDate(r.result_date) === normDate)
          );

          if (existingIdx !== -1) {
            allResults[existingIdx] = { ...allResults[existingIdx], ...itemNormalized };
          } else {
            allResults.unshift(itemNormalized);
          }
        }

        if (normDate) {
          let dateMap = cachedDateResults.get(normDate);
          if (!dateMap) {
            dateMap = new Map();
            cachedDateResults.set(normDate, dateMap);
          }
          if (record.market_name) {
            dateMap.set(record.market_name, resStr);
          }
        }
      }

      applyFilterAndRender(true);
      return;
    }

    if (!record) return;

    if (eventType === 'INSERT') {
      const idx = allMarkets.findIndex(m => String(m.id) === String(record.id));
      if (idx !== -1) {
        allMarkets[idx] = record;
      } else {
        allMarkets.push(record);
      }
      showToast(`⚡ Live: New market "${record.market_name}" added!`, 'info');
    } else if (eventType === 'UPDATE') {
      const idx = allMarkets.findIndex(m => String(m.id) === String(record.id));
      if (idx !== -1) {
        allMarkets[idx] = record;
      } else {
        allMarkets.push(record);
      }
      showToast(`⚡ Live: Market "${record.market_name}" updated!`, 'info');
    } else if (eventType === 'DELETE') {
      allMarkets = allMarkets.filter(m => String(m.id) !== String(record.id));
      showToast('⚡ Live: Market removed!', 'info');
    }

    // Re-render affected cards with updated sorting
    applyFilterAndRender(true);
    updateActiveMarketsCount();
  });

  // Initial data load
  await loadMarketsData(true);
}

// Fetch and render markets
async function loadMarketsData(showLoader = true) {
  if (!navigator.onLine) {
    showErrorState('No Internet Connection');
    showToast('No Internet Connection', 'error');
    isLoading = false;
    setServerStatus('offline');
    return;
  }

  if (showLoader) {
    isLoading = true;
    renderSkeletonLoaders();
  }

  const errorBox = document.getElementById('error-container');
  if (errorBox) errorBox.classList.add('hidden');

  const emptyBox = document.getElementById('empty-container');
  if (emptyBox) emptyBox.classList.add('hidden');

  try {
    // Clear caches on explicit reload to guarantee fresh data
    cachedDateResults.clear();
    lastRenderedSnapshot = '';

    const [markets, historicalResults] = await Promise.all([
      fetchMarkets(),
      fetchAllResults()
    ]);
    allMarkets = markets || [];
    allResults = historicalResults || [];

    // Evaluate IST daily auto-shifts (Gali at 1:00 AM IST, Disawer at 12:21 AM IST, Others at 12:00 AM IST)
    try {
      const shifted = await executeAutoShiftIST(allMarkets);
      if (shifted) {
        const [freshMarkets, freshResults] = await Promise.all([
          fetchMarkets(),
          fetchAllResults()
        ]);
        allMarkets = freshMarkets || [];
        allResults = freshResults || [];
      }
    } catch (shiftErr) {
      console.warn('Auto-shift check notice:', shiftErr);
    }

    isLoading = false;

    // Apply search filter and force re-render
    await applyFilterAndRender(true);
    updateConnectionBanner();
    updateActiveMarketsCount();
    startFooterClock();
    startAutoShiftTicker();
    setServerStatus('online');
  } catch (err) {
    console.error('Failed to load markets:', err);
    isLoading = false;
    showErrorState('Unable to connect to database.');
    showToast('Unable to connect to database.', 'error');
    setServerStatus(navigator.onLine ? 'reconnecting' : 'offline');
  }
}

// Helper: Parse time string into minutes past midnight (0-1439)
function parseTimeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const str = String(timeStr).trim().toUpperCase();
  const match = str.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!match) return 0;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const ampm = match[3];

  if (ampm) {
    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;
  }
  return hours * 60 + minutes;
}

// Helper: Calculate time status for a market based on draw_time and current IST time
function getMarketTimeStatus(drawTimeStr, currentISTMinutes) {
  const drawMinutes = parseTimeToMinutes(drawTimeStr);

  // Minutes elapsed since scheduled draw time (0 to 1439)
  const timeSinceDraw = (currentISTMinutes - drawMinutes + 1440) % 1440;

  // Minutes until next scheduled draw time (0 to 1439)
  const timeUntilDraw = (drawMinutes - currentISTMinutes + 1440) % 1440;

  // A market moves to the bottom if exactly 20 minutes have passed since its draw time
  // and it has not entered the upcoming window for its next cycle.
  const isPassed20Min = (timeSinceDraw >= 20 && timeSinceDraw < 1420);

  return {
    drawMinutes,
    timeSinceDraw,
    timeUntilDraw,
    isPassed20Min
  };
}

// Helper: Calculate minutes until next draw time
function getUpcomingDiffMinutes(drawTimeStr) {
  const { istMinutes } = getISTDateTime();
  const status = getMarketTimeStatus(drawTimeStr, istMinutes);
  return status.timeUntilDraw;
}

// Canonical display order requested by user for line-wise market list:
// 1. Disawer (moved from last to top under highlighted market card)
// 2. Delhi noon
// 3. Punjab day
// 4. Faridabad
// 5. New faridabad
// 6. Gaziabad
// 7. New gaziabad
// 8. Gali
// Helper: Canonical line-wise order
function getCanonicalMarketRank(marketName) {
  if (!marketName) return 999;
  const name = marketName.trim().toLowerCase();

  // 1. Disawer / Disawar (Moved from last to top under highlighted card)
  if (name.includes('disawar') || name.includes('disawer')) return 1;

  // 2. Delhi noon
  if (name.includes('delhi noon') || name.includes('dehli noon') || name === 'delhi' || name.includes('delhi')) return 2;

  // 3. Punjab day
  if (name.includes('punjab day') || name.includes('punjab')) return 3;

  // 5. New Faridabad (checked before Faridabad)
  if (name.includes('new faridabad') || name.includes('new-faridabad')) return 5;

  // 4. Faridabad
  if (name.includes('faridabad')) return 4;

  // 7. New Gaziabad / New Ghaziabad (checked before Gaziabad)
  if (name.includes('new gaziabad') || name.includes('new ghaziabad') || name.includes('new-gaziabad')) return 7;

  // 6. Gaziabad / Ghaziabad
  if (name.includes('gaziabad') || name.includes('ghaziabad')) return 6;

  // 8. Gali
  if (name.includes('gali')) return 8;

  return 100;
}

// Sort all markets in the exact requested line-wise canonical order:
// 1. Disawer
// 2. Delhi noon
// 3. Punjab day
// 4. Faridabad
// 5. New faridabad
// 6. Gaziabad
// 7. New gaziabad
// 8. Gali
function sortMarketsInCanonicalOrder(markets) {
  const list = [...markets];
  list.sort((a, b) => {
    const rankA = getCanonicalMarketRank(a.market_name);
    const rankB = getCanonicalMarketRank(b.market_name);

    if (rankA !== rankB) {
      return rankA - rankB;
    }

    // Fallback by draw time or alphabetical
    const drawA = parseTimeToMinutes(a.draw_time);
    const drawB = parseTimeToMinutes(b.draw_time);
    if (drawA !== drawB) {
      return drawA - drawB;
    }

    return (a.market_name || '').localeCompare(b.market_name || '');
  });
  return list;
}

// ----------------------------------------------------
// Market Render Helpers
// ----------------------------------------------------

// Cache last rendered snapshot to prevent unnecessary DOM rebuilds
let lastRenderedSnapshot = '';

// Filter & Sort markets based on status, upcoming time & search query
async function applyFilterAndRender(force = false) {
  const query = currentSearchQuery.trim().toLowerCase();

  // Ensure date picker value matches selectedUserDateIso
  const datePicker = document.getElementById('home-date-picker');
  if (datePicker && datePicker.value !== selectedUserDateIso) {
    datePicker.value = selectedUserDateIso;
  }

  const prevUserDateIso = getPreviousIsoDateStr(selectedUserDateIso);

  // Fetch results for selectedUserDateIso and prevUserDateIso
  const [dateResultsMap, prevDateResultsMap] = await Promise.all([
    getDateResults(selectedUserDateIso),
    getDateResults(prevUserDateIso)
  ]);

  // Filter out hidden status markets for public users
  const visibleMarkets = allMarkets.filter(item => item.status !== 'Hidden');

  // Line-wise sorted list for cards (Disawer at top, Delhi noon, Punjab day, Faridabad, New faridabad, Gaziabad, New gaziabad, Gali)
  const canonicalMarkets = sortMarketsInCanonicalOrder(visibleMarkets);
  let displayMarkets = canonicalMarkets;

  if (query) {
    displayMarkets = canonicalMarkets.filter(item => {
      const name = (item.market_name || '').toLowerCase();
      return name.includes(query);
    });
  }

  // Generate current render snapshot
  const currentSnapshot = JSON.stringify({
    query,
    date: selectedUserDateIso,
    order: displayMarkets.map(m => m.id),
    res: displayMarkets.map(m => [
      m.id,
      m.today_number,
      m.yesterday_number,
      m.first_number,
      m.second_number,
      dateResultsMap ? dateResultsMap.get(m.market_name) : null,
      prevDateResultsMap ? prevDateResultsMap.get(m.market_name) : null
    ])
  });

  if (!force && currentSnapshot === lastRenderedSnapshot) {
    return;
  }

  lastRenderedSnapshot = currentSnapshot;

  // Ensure active market wrapper is cleared if leftover in DOM
  const activeWrapper = document.getElementById('active-market-wrapper');
  if (activeWrapper) activeWrapper.innerHTML = '';

  // Update statistic counts & badges
  const activeCountEl = document.getElementById('stat-total-markets');
  const activeMarketsCountEl = document.getElementById('active-markets-count');
  const upcomingCountBadge = document.getElementById('upcoming-count-badge');

  if (activeCountEl) activeCountEl.textContent = visibleMarkets.length;
  if (activeMarketsCountEl) activeMarketsCountEl.textContent = visibleMarkets.length;
  if (upcomingCountBadge) {
    upcomingCountBadge.textContent = `${displayMarkets.length} Market${displayMarkets.length === 1 ? '' : 's'}`;
  }

  // Render line-wise market cards in white (includes all markets)
  renderMarketCards(displayMarkets, dateResultsMap, prevDateResultsMap);

  // Update dedicated New Ghaziabad spotlight widget on homepage
  updateNewGhaziabadHomeWidget(dateResultsMap, prevDateResultsMap);
}

// Render vertical stacked cards
function renderMarketCards(markets, dateResultsMap, prevDateResultsMap) {
  const container = document.getElementById('markets-container');
  const emptyBox = document.getElementById('empty-container');
  if (!container) return;

  container.innerHTML = '';

  if (isLoading) {
    renderSkeletonLoaders();
    return;
  }

  if (!markets || markets.length === 0) {
    if (emptyBox) {
      emptyBox.classList.remove('hidden');
      const emptyMsg = document.getElementById('empty-message');
      if (emptyMsg) {
        emptyMsg.textContent = currentSearchQuery
          ? `No markets matching "${currentSearchQuery}"`
          : 'No Results Available';
      }
    }
    return;
  }

  if (emptyBox) emptyBox.classList.add('hidden');

  const todayIso = getTodayIsoDateStr();
  const isSelectedToday = (selectedUserDateIso === todayIso);
  const rightBoxLabel = isSelectedToday ? 'Today' : 'Result';

  markets.forEach((market, index) => {
    const card = document.createElement('div');
    const isYellow = Boolean(market.highlighted_yellow || market.highlight_yellow);

    // If highlighted_yellow is true in DB, render highlighted yellow card. Otherwise render standard white card.
    const cardBgClass = isYellow
      ? 'bg-amber-300 border-2 border-amber-500 shadow-md ring-1 ring-amber-400/60 hover:shadow-lg'
      : 'bg-white border border-slate-200/90 shadow-xs hover:shadow-md';
    const headerTextClass = 'text-lg sm:text-xl font-black text-slate-950';

    card.className = `market-card ${cardBgClass} rounded-2xl p-4 sm:p-5 transition-all duration-200 relative overflow-hidden`;
    card.style.animationDelay = `${index * 40}ms`;

    const prevUserDateIso = getPreviousIsoDateStr(selectedUserDateIso);

    // Result for selectedUserDateIso
    let todayVal = '--';
    if (dateResultsMap && dateResultsMap.has(market.market_name)) {
      todayVal = escapeHtml(formatDisplayNumber(dateResultsMap.get(market.market_name)));
    } else if (isSelectedToday) {
      todayVal = escapeHtml(
        formatTodayDisplayNumber(market.today_number !== undefined ? market.today_number : market.first_number)
      );
    } else {
      todayVal = 'XX';
    }

    // Result for prevUserDateIso
    let yesterdayVal = '--';
    if (prevDateResultsMap && prevDateResultsMap.has(market.market_name)) {
      yesterdayVal = escapeHtml(formatDisplayNumber(prevDateResultsMap.get(market.market_name)));
    } else if (isSelectedToday) {
      yesterdayVal = escapeHtml(
        formatYesterdayDisplayNumber(market.yesterday_number !== undefined ? market.yesterday_number : market.second_number)
      );
    } else {
      yesterdayVal = '--';
    }

    const drawTime = escapeHtml(market.draw_time || '');
    const stripColorClass = isYellow ? 'bg-amber-600' : 'bg-amber-400';
    const drawTimeBadgeClass = isYellow
      ? 'bg-amber-400/90 text-slate-950 px-1.5 py-0.5 text-[10px] rounded border border-amber-500 font-bold leading-none'
      : 'bg-slate-100/90 px-1.5 py-0.5 text-[10px] rounded border border-slate-200 leading-none';
    const chartBtnClass = isYellow
      ? 'record-chart-link no-pop no-popunder no-ad no-click-ad monetag-ignore inline-flex items-center gap-1 text-[10px] font-black text-slate-950 hover:text-black bg-amber-200/90 hover:bg-amber-100 px-2 py-0.5 rounded border border-amber-500 transition-colors cursor-pointer'
      : 'record-chart-link no-pop no-popunder no-ad no-click-ad monetag-ignore inline-flex items-center gap-1 text-[10px] font-bold text-blue-600 hover:text-blue-800 bg-blue-50/80 hover:bg-blue-100 px-2 py-0.5 rounded border border-blue-200/80 transition-colors cursor-pointer';

    const yesterdayBoxClass = isYellow
      ? 'flex flex-col items-center justify-center bg-amber-200/90 p-2 sm:p-2.5 rounded-xl border border-amber-400 min-w-[68px] sm:min-w-[78px]'
      : 'flex flex-col items-center justify-center bg-slate-100/90 p-2 sm:p-2.5 rounded-xl border border-slate-200 min-w-[68px] sm:min-w-[78px]';
    const yesterdayNumBoxClass = isYellow
      ? 'w-13 sm:w-16 h-11 sm:h-14 bg-white border border-amber-400 text-slate-900 rounded-lg flex items-center justify-center font-mono font-black text-xl sm:text-2xl shadow-2xs'
      : 'w-13 sm:w-16 h-11 sm:h-14 bg-white border border-slate-300 text-slate-800 rounded-lg flex items-center justify-center font-mono font-black text-xl sm:text-2xl shadow-2xs';

    const todayBoxClass = isYellow
      ? 'flex flex-col items-center justify-center bg-slate-950 p-2 sm:p-2.5 rounded-xl border border-amber-400 min-w-[68px] sm:min-w-[78px] shadow-xs'
      : 'flex flex-col items-center justify-center bg-amber-100/80 p-2 sm:p-2.5 rounded-xl border border-amber-300 min-w-[68px] sm:min-w-[78px]';
    const todayLabelClass = isYellow
      ? 'text-[10px] font-black uppercase tracking-wider text-amber-300 mb-1'
      : 'text-[10px] font-black uppercase tracking-wider text-amber-950 mb-1';
    const todayNumBoxClass = isYellow
      ? 'w-13 sm:w-16 h-11 sm:h-14 bg-slate-900 border border-slate-800 text-amber-300 rounded-lg flex items-center justify-center font-mono font-black text-2xl sm:text-3xl shadow-xs'
      : 'w-13 sm:w-16 h-11 sm:h-14 bg-slate-900 border border-slate-800 text-amber-400 rounded-lg flex items-center justify-center font-mono font-black text-2xl sm:text-3xl border shadow-xs';

    card.innerHTML = `
      <div class="absolute top-0 left-0 w-1.5 h-full ${stripColorClass}"></div>

      <div class="w-full pl-2 space-y-3">
        <!-- Title row -->
        <div class="flex items-center gap-2 flex-wrap">
          <h2 class="${headerTextClass} truncate">
            ${escapeHtml(market.market_name)}
          </h2>
          ${isYellow ? `<span class="px-1.5 py-0.5 text-[9px] uppercase font-black bg-amber-400 text-slate-950 rounded-md border border-amber-500 shadow-xs">★ Highlighted</span>` : ''}
          ${market.status === 'Hidden' ? `<span class="px-2 py-0.5 text-[10px] uppercase font-extrabold bg-red-100 text-red-700 rounded-md">Hidden</span>` : ''}
        </div>

        <!-- Row with Draw Time + Record Chart on Left, and Two Number Boxes on the Right -->
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <!-- Left Column: Draw time & Record chart button -->
          <div class="flex flex-col items-start gap-1.5 text-xs font-medium text-slate-600">
            <span class="${drawTimeBadgeClass}">
              Draw Time: <strong class="text-slate-950 font-bold">${drawTime}</strong>
            </span>

            <a 
              href="${getRecordChartUrl(market)}" 
              data-record-chart="true"
              class="${chartBtnClass}"
            >
              <span>📊 Record Chart</span>
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>

          <!-- Right Side: Two Result Boxes -->
          <div class="flex items-center gap-2.5 shrink-0">
            <!-- Left Box: Yesterday's Number -->
            <div class="${yesterdayBoxClass}">
              <span class="text-[10px] font-extrabold uppercase tracking-wider ${isYellow ? 'text-slate-800' : 'text-slate-500'} mb-1">Yesterday</span>
              <div class="${yesterdayNumBoxClass}">
                ${yesterdayVal}
              </div>
            </div>

            <!-- Right Box: Result for Selected Date -->
            <div class="${todayBoxClass}">
              <span class="${todayLabelClass}">${rightBoxLabel}</span>
              <div class="${todayNumBoxClass}">
                ${todayVal}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

// Helper: Check if a market name corresponds to New Ghaziabad
export function isNewGhaziabadMarket(name) {
  if (!name) return false;
  const n = String(name).trim().toLowerCase();
  return (n.includes('new') && (n.includes('gaziabad') || n.includes('ghaziabad')));
}

// Update the homepage dedicated New Ghaziabad result section dynamically from Supabase data
function updateNewGhaziabadHomeWidget(dateResultsMap, prevDateResultsMap) {
  const todayBox = document.getElementById('home-ng-today-num');
  const yestBox = document.getElementById('home-ng-yesterday-num');
  const timeBadge = document.getElementById('home-ng-draw-time');
  const statusBadge = document.getElementById('home-ng-status-badge');

  if (!todayBox || !yestBox) return;

  const ngMarket = allMarkets.find(m => isNewGhaziabadMarket(m.market_name));

  if (ngMarket) {
    if (timeBadge && ngMarket.draw_time) {
      timeBadge.textContent = ngMarket.draw_time;
    }

    const todayIso = getTodayIsoDateStr();
    const prevIso = getPreviousIsoDateStr(todayIso);

    let todayVal = '--';
    if (dateResultsMap && dateResultsMap.has(ngMarket.market_name)) {
      todayVal = formatDisplayNumber(dateResultsMap.get(ngMarket.market_name));
    } else if (ngMarket.today_number !== undefined && ngMarket.today_number !== null) {
      todayVal = formatTodayDisplayNumber(ngMarket.today_number);
    }

    let yestVal = '--';
    if (prevDateResultsMap && prevDateResultsMap.has(ngMarket.market_name)) {
      yestVal = formatDisplayNumber(prevDateResultsMap.get(ngMarket.market_name));
    } else if (ngMarket.yesterday_number !== undefined && ngMarket.yesterday_number !== null) {
      yestVal = formatYesterdayDisplayNumber(ngMarket.yesterday_number);
    }

    todayBox.textContent = todayVal;
    yestBox.textContent = yestVal;

    if (statusBadge) {
      if (todayVal && todayVal !== 'XX' && todayVal !== '--') {
        statusBadge.textContent = '🟢 Result Announced';
        statusBadge.className = 'text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300';
      } else {
        statusBadge.textContent = '⏳ Result Expected at ' + (ngMarket.draw_time || '09:45 PM');
        statusBadge.className = 'text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300';
      }
    }
  }
}

// Render Skeleton Loading Placeholders
function renderSkeletonLoaders() {
  const container = document.getElementById('markets-container');
  if (!container) return;

  container.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const skeleton = document.createElement('div');
    skeleton.className = 'bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex items-center justify-between gap-4 animate-pulse mb-3.5';
    skeleton.innerHTML = `
      <div class="space-y-2.5 flex-1">
        <div class="h-6 bg-slate-200 rounded-md w-3/5"></div>
        <div class="h-4 bg-slate-100 rounded-md w-2/5"></div>
        <div class="h-4 bg-blue-100 rounded-md w-1/4 mt-2"></div>
      </div>
      <div class="flex gap-2">
        <div class="w-14 h-14 bg-slate-200 rounded-xl"></div>
        <div class="w-14 h-14 bg-slate-200 rounded-xl"></div>
      </div>
    `;
    container.appendChild(skeleton);
  }
}

// Search Setup
function setupSearch() {
  const searchInput = document.getElementById('market-search-input');
  const clearBtn = document.getElementById('clear-search-btn');
  const searchSubmitBtn = document.getElementById('search-submit-btn');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      currentSearchQuery = e.target.value;
      if (clearBtn) {
        if (currentSearchQuery) {
          clearBtn.classList.remove('hidden');
        } else {
          clearBtn.classList.add('hidden');
        }
      }
      applyFilterAndRender(true);
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        currentSearchQuery = searchInput.value;
        applyFilterAndRender(true);
      }
    });
  }

  if (searchSubmitBtn && searchInput) {
    searchSubmitBtn.addEventListener('click', () => {
      currentSearchQuery = searchInput.value;
      applyFilterAndRender(true);
      searchInput.focus();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      currentSearchQuery = '';
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
      }
      clearBtn.classList.add('hidden');
      applyFilterAndRender(true);
    });
  }

  const resetSearchBtn = document.getElementById('reset-search-btn');
  if (resetSearchBtn) {
    resetSearchBtn.addEventListener('click', () => {
      currentSearchQuery = '';
      if (searchInput) searchInput.value = '';
      if (clearBtn) clearBtn.classList.add('hidden');
      applyFilterAndRender(true);
    });
  }
}

// Floating Refresh Button Setup
function setupRefreshButton() {
  const refreshBtn = document.getElementById('floating-refresh-btn');
  const refreshIcon = document.getElementById('refresh-icon');

  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      if (refreshIcon) refreshIcon.classList.add('animate-spin');
      refreshBtn.disabled = true;

      try {
        await loadMarketsData(true);
        showToast('🔄 App & Live Markets refreshed!', 'success');
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
}

const PAGE_TITLES = {
  home: 'SATTA KING FAST',
  about: 'About – SATTA KING FAST Live Market Results & Records Information',
  contact: 'Contact Us – SATTA KING FAST Help & Support',
  privacy: 'Privacy Policy – SATTA KING FAST',
  terms: 'Terms & Conditions – SATTA KING FAST'
};

const PAGE_DESCRIPTIONS = {
  home: 'SATTA KING FAST - Live Satta King results, fast result charts, New Ghaziabad, Disawer, Faridabad, Gaziabad, Gali record charts updated in real-time.',
  about: 'Learn about SATTA KING FAST, our live market results platform, historical chart data, and market draw timing schedules.',
  contact: 'Get in touch with SATTA KING FAST for technical support, feedback, and general inquiries.',
  privacy: 'Read the SATTA KING FAST Privacy Policy regarding user privacy, cookies, data collection, and security.',
  terms: 'Read the SATTA KING FAST Terms & Conditions governing website usage, disclaimer, and guidelines.'
};

// Page Navigation & Contact Form
function setupNavigation() {
  const hamburgerBtn = document.getElementById('hamburger-btn');
  const closeDrawerBtn = document.getElementById('close-drawer-btn');
  const sideDrawer = document.getElementById('side-drawer');
  const drawerOverlay = document.getElementById('drawer-overlay');

  function openDrawer() {
    if (sideDrawer) sideDrawer.classList.remove('-translate-x-full');
    if (drawerOverlay) drawerOverlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    if (sideDrawer) sideDrawer.classList.add('-translate-x-full');
    if (drawerOverlay) drawerOverlay.classList.add('hidden');
    document.body.style.overflow = '';
  }

  if (hamburgerBtn) hamburgerBtn.addEventListener('click', openDrawer);
  if (closeDrawerBtn) closeDrawerBtn.addEventListener('click', closeDrawer);
  if (drawerOverlay) drawerOverlay.addEventListener('click', closeDrawer);

  // Attach navigation listeners to all nav-btn elements
  const navBtns = document.querySelectorAll('.nav-btn');
  navBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const target = btn.getAttribute('data-target') || 'home';
      const section = btn.getAttribute('data-section');
      if (target) {
        closeDrawer();
        switchPage(target);
        if (section) {
          setTimeout(() => {
            const secEl = document.getElementById(section);
            if (secEl) {
              secEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }, 80);
        }
      }
    });
  });

  // Handle initial URL hash if present (e.g. #about, #contact, #privacy, #terms)
  const hash = (window.location.hash || '').replace('#', '');
  if (['about', 'contact', 'privacy', 'terms', 'home'].includes(hash)) {
    switchPage(hash);
  }
}

export function switchPage(targetPageId) {
  const pageViews = document.querySelectorAll('.page-view');
  pageViews.forEach(view => {
    if (view.id === `view-${targetPageId}`) {
      view.classList.remove('hidden');
    } else {
      view.classList.add('hidden');
    }
  });

  // Dynamic title & meta description update for SEO
  if (PAGE_TITLES[targetPageId]) {
    document.title = PAGE_TITLES[targetPageId];
  }
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc && PAGE_DESCRIPTIONS[targetPageId]) {
    metaDesc.setAttribute('content', PAGE_DESCRIPTIONS[targetPageId]);
  }

  // Hash state update
  if (targetPageId !== 'home') {
    window.location.hash = targetPageId;
  } else if (window.location.hash && window.location.hash !== '#home') {
    history.replaceState(null, '', window.location.pathname);
  }

  // Update active styling in header navigation
  const headerNavLinks = document.querySelectorAll('header .nav-btn');
  headerNavLinks.forEach(link => {
    const target = link.getAttribute('data-target');
    if (target === targetPageId) {
      link.classList.add('active-nav-link', 'bg-amber-500/80');
    } else {
      link.classList.remove('active-nav-link', 'bg-amber-500/80');
    }
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setupContactForm() {
  const form = document.getElementById('contact-form');
  const successAlert = document.getElementById('contact-success-alert');
  const errorAlert = document.getElementById('contact-error-alert');
  const errorMsg = document.getElementById('contact-error-msg');

  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const nameInput = document.getElementById('contact-name');
    const emailInput = document.getElementById('contact-email');
    const messageInput = document.getElementById('contact-message');

    const name = (nameInput?.value || '').trim();
    const email = (emailInput?.value || '').trim();
    const message = (messageInput?.value || '').trim();

    if (successAlert) successAlert.classList.add('hidden');
    if (errorAlert) errorAlert.classList.add('hidden');

    if (!name || !email || !message) {
      if (errorMsg) errorMsg.textContent = 'Please fill in all required fields.';
      if (errorAlert) errorAlert.classList.remove('hidden');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      if (errorMsg) errorMsg.textContent = 'Please enter a valid email address.';
      if (errorAlert) errorAlert.classList.remove('hidden');
      return;
    }

    if (successAlert) successAlert.classList.remove('hidden');
    form.reset();
    showToast('✉️ Message sent successfully!', 'success');
  });
}

// Network status / Offline warning
function setupNetworkListeners() {
  const offlineBanner = document.getElementById('offline-banner');
  const retryBtn = document.getElementById('retry-connection-btn');

  function checkOnlineStatus() {
    if (!navigator.onLine) {
      if (offlineBanner) offlineBanner.classList.remove('hidden');
      showToast('No Internet Connection', 'error');
      setServerStatus('offline');
    } else {
      if (offlineBanner) offlineBanner.classList.add('hidden');
    }
  }

  window.addEventListener('online', () => {
    checkOnlineStatus();
    showToast('Internet reconnected!', 'success');
    setServerStatus('online');
    loadMarketsData(false);
  });

  window.addEventListener('offline', checkOnlineStatus);

  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      if (navigator.onLine) {
        if (offlineBanner) offlineBanner.classList.add('hidden');
        setServerStatus('online');
        loadMarketsData(true);
        showToast('Connection restored!', 'success');
      } else {
        setServerStatus('offline');
        showToast('Still offline. Please check network.', 'error');
      }
    });
  }

  checkOnlineStatus();
}

function updateServerStatusBanner(status) {
  const banner = document.getElementById('server-status-banner');
  const icon = document.getElementById('server-status-icon');
  const text = document.getElementById('server-status-text');
  if (!banner || !icon || !text) return;

  if (status === 'online') {
    banner.className = 'w-full py-2.5 px-4 text-center text-xs sm:text-sm font-extrabold shadow-xs transition-colors duration-300 ease-in-out flex items-center justify-center gap-2 bg-emerald-600 text-white shrink-0';
    icon.textContent = '🟢';
    text.textContent = 'Server Status: Online';
  } else if (status === 'reconnecting') {
    banner.className = 'w-full py-2.5 px-4 text-center text-xs sm:text-sm font-extrabold shadow-xs transition-colors duration-300 ease-in-out flex items-center justify-center gap-2 bg-amber-500 text-slate-950 shrink-0';
    icon.textContent = '🟡';
    text.textContent = 'Server Status: Reconnecting...';
  } else if (status === 'offline') {
    banner.className = 'w-full py-2.5 px-4 text-center text-xs sm:text-sm font-extrabold shadow-xs transition-colors duration-300 ease-in-out flex items-center justify-center gap-2 bg-rose-600 text-white shrink-0';
    icon.textContent = '🔴';
    text.textContent = 'Server Status: Offline';
  }
}

function updateConnectionBanner() {
  const dbStatusEl = document.getElementById('db-connection-status');
  if (dbStatusEl) {
    if (isSupabaseConfigured()) {
      dbStatusEl.innerHTML = `<span class="inline-flex items-center gap-1.5 text-xs text-emerald-600 font-bold bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200"><span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>Supabase Live Cloud</span>`;
    } else {
      dbStatusEl.innerHTML = `<span class="inline-flex items-center gap-1.5 text-xs text-amber-700 font-bold bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200"><span class="w-2 h-2 rounded-full bg-amber-500"></span>Local Mode</span>`;
    }
  }
}

// Helper: Generate clean URL slug for a market (e.g. "DEHLI NOON" -> "dehli-noon")
export function getMarketSlug(marketName) {
  if (!marketName) return '';
  return String(marketName)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Helper: Get record chart redirection URL for a market
export function getRecordChartUrl(market) {
  if (market) {
    const slug = getMarketSlug(market.market_name);
    if (slug) {
      return `/${slug}`;
    }
    if (market.id) {
      return `/chart?id=${encodeURIComponent(market.id)}`;
    }
  }
  return '/chart';
}

// ----------------------------------------------------
// IST AUTOMATIC DAILY SHIFT TICKER
// Exact rules:
// - Normal Markets: 12:00 AM IST
// - Gali: 01:00 AM IST
// - Disawer: 12:21 AM IST
// ----------------------------------------------------
// IST AUTOMATIC DISPLAY TICKER
// ----------------------------------------------------
let autoShiftTickerInterval = null;

function startAutoShiftTicker() {
  if (autoShiftTickerInterval) return;

  async function checkAndRender() {
    if (!isLoading && allMarkets && allMarkets.length > 0) {
      try {
        const shifted = await executeAutoShiftIST(allMarkets);
        if (shifted) {
          const [freshMarkets, freshResults] = await Promise.all([
            fetchMarkets(),
            fetchAllResults()
          ]);
          allMarkets = freshMarkets || [];
          allResults = freshResults || [];
        }
      } catch (e) {
        // ignore
      }
      applyFilterAndRender();
    }
  }

  // Periodically refresh sorting order as 20-min draw thresholds pass and evaluate daily shifts
  autoShiftTickerInterval = setInterval(checkAndRender, 15000);
}

// Toast Notifications System
function setupToastSystem() {
  // Toast container is present in index.html
}

export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');

  let typeClasses = 'bg-slate-900 text-white border-slate-700';
  let icon = 'ℹ️';

  if (type === 'success') {
    typeClasses = 'bg-emerald-800 text-emerald-50 border-emerald-600';
    icon = '✅';
  } else if (type === 'error') {
    typeClasses = 'bg-rose-800 text-rose-50 border-rose-600';
    icon = '❌';
  } else if (type === 'info') {
    typeClasses = 'bg-blue-900 text-blue-50 border-blue-700';
    icon = '⚡';
  }

  toast.className = `flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-lg text-sm font-semibold transform transition-all duration-300 animate-slide-up pointer-events-auto ${typeClasses}`;
  toast.innerHTML = `
    <span>${icon}</span>
    <span>${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3500);
}

function showErrorState(message) {
  const errorBox = document.getElementById('error-container');
  const errorMsg = document.getElementById('error-message');
  if (errorBox) {
    errorBox.classList.remove('hidden');
    if (errorMsg) errorMsg.textContent = message;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function updateActiveMarketsCount() {
  const countEl = document.getElementById('active-markets-count');
  if (countEl) {
    const activeCount = allMarkets.filter(m => m.status !== 'Hidden').length;
    countEl.textContent = activeCount || '0';
  }
}

let footerClockInterval = null;
function startFooterClock() {
  if (footerClockInterval) return;
  const clockEl = document.getElementById('footer-local-time');
  
  function tick() {
    if (!clockEl) return;
    const now = new Date();
    clockEl.textContent = `Local Time: ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  }
  
  tick();
  footerClockInterval = setInterval(tick, 1000);
}
