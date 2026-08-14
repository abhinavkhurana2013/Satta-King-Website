import {
  fetchMarkets,
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
let filteredMarkets = [];
let currentSearchQuery = '';
let activeChartMarket = null;
let isLoading = true;

let selectedUserDateIso = getTodayIsoDateStr();
let cachedDateResults = new Map(); // dateIso -> Map(market_name -> result_number)

async function getDateResults(dateIso) {
  if (cachedDateResults.has(dateIso)) {
    return cachedDateResults.get(dateIso);
  }
  const resultMap = await fetchDailyResultsForDate(dateIso);
  cachedDateResults.set(dateIso, resultMap);
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
  setupRecordChartModal();
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
      if (record && record.result_date && (record.market_name || record.market_id)) {
        const dateKey = extractIsoDate(record.result_date) || record.result_date;
        const marketName = record.market_name;
        const rawRes = (record.result !== undefined && record.result !== null) ? record.result : record.result_number;
        const resNum = extractResultString(rawRes) || 'XX';

        let dateMap = cachedDateResults.get(dateKey);
        if (!dateMap) {
          dateMap = new Map();
          cachedDateResults.set(dateKey, dateMap);
        }
        if (marketName) {
          dateMap.set(marketName, resNum);
        }
      }

      if (activeChartMarket) {
        const monthSelect = document.getElementById('chart-month-select');
        const selectedYearMonth = monthSelect ? monthSelect.value : 'ALL';
        renderRecordChartHistory(activeChartMarket, selectedYearMonth, false, selectedRecordChartDate);
      }

      applyFilterAndRender();
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

    // Refresh active record chart modal if open for this market
    if (activeChartMarket && (activeChartMarket.market_name === record.market_name || String(activeChartMarket.id) === String(record.id))) {
      activeChartMarket = record;
      const monthSelect = document.getElementById('chart-month-select');
      const selectedYearMonth = monthSelect ? monthSelect.value : 'ALL';
      renderRecordChartHistory(activeChartMarket, selectedYearMonth, false, selectedRecordChartDate);
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

  try {
    const markets = await fetchMarkets();
    allMarkets = markets || [];
    isLoading = false;

    // Apply search filter and render
    applyFilterAndRender();
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

// Helper: Sort active markets with 20-minute post-draw bottom movement rule
function sortMarketsByUpcoming(markets) {
  const { istMinutes: currentISTMinutes } = getISTDateTime();

  const normalMarkets = [];
  const bottomMarkets = [];

  markets.forEach(m => {
    const status = getMarketTimeStatus(m.draw_time, currentISTMinutes);
    if (status.isPassed20Min) {
      bottomMarkets.push({ market: m, status });
    } else {
      normalMarkets.push({ market: m, status });
    }
  });

  // 1. Sort Normal Markets (markets that have NOT reached 20m post-draw threshold)
  normalMarkets.sort((a, b) => {
    const statusA = a.status;
    const statusB = b.status;

    let priorityA = 0;
    if (statusA.timeSinceDraw < 20) {
      priorityA = statusA.timeSinceDraw; // 0..19 (active / just drawn)
    } else {
      priorityA = 20 + statusA.timeUntilDraw; // upcoming in future
    }

    let priorityB = 0;
    if (statusB.timeSinceDraw < 20) {
      priorityB = statusB.timeSinceDraw;
    } else {
      priorityB = 20 + statusB.timeUntilDraw;
    }

    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }

    return (a.market.market_name || '').localeCompare(b.market.market_name || '');
  });

  // 2. Sort Bottom Markets (markets that HAVE passed 20m post-draw threshold)
  // Rule 7: "If multiple markets have passed their 20-minute threshold, keep those markets at the bottom
  // and sort them consistently according to their upcoming draw time order (nearest upcoming first)."
  bottomMarkets.sort((a, b) => {
    if (a.status.timeUntilDraw !== b.status.timeUntilDraw) {
      return a.status.timeUntilDraw - b.status.timeUntilDraw;
    }
    return (a.market.market_name || '').localeCompare(b.market.market_name || '');
  });

  return [
    ...normalMarkets.map(item => item.market),
    ...bottomMarkets.map(item => item.market)
  ];
}

// ----------------------------------------------------
// Google AdSense Unit Helper Functions
// ----------------------------------------------------
function createAdSenseCard() {
  const wrapper = document.createElement('div');
  wrapper.className = 'adsense-card-container w-full my-3 sm:my-4 flex justify-center items-center overflow-hidden min-h-[50px] transition-all';
  
  const ins = document.createElement('ins');
  ins.className = 'adsbygoogle';
  ins.style.display = 'block';
  ins.style.width = '100%';
  ins.setAttribute('data-ad-format', 'fluid');
  ins.setAttribute('data-ad-layout-key', '-fb+5w+4e-db+86');
  ins.setAttribute('data-ad-client', 'ca-pub-2724281909345498');
  ins.setAttribute('data-ad-slot', '9637062261');
  
  wrapper.appendChild(ins);
  return wrapper;
}

function initializeAdSenseUnits(scope = document) {
  try {
    const uninitialized = scope.querySelectorAll('ins.adsbygoogle:not([data-adsbygoogle-status])');
    uninitialized.forEach(() => {
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch (pushErr) {
        console.debug('AdSense push notice:', pushErr);
      }
    });
  } catch (err) {
    console.debug('AdSense init notice:', err);
  }
}

// Render 🔥 Active Market Section
function renderActiveMarketCard(market, dateResultsMap, prevDateResultsMap) {
  const wrapper = document.getElementById('active-market-wrapper');
  if (!wrapper) return;

  if (!market) {
    wrapper.innerHTML = '';
    return;
  }

  const todayIso = getTodayIsoDateStr();
  const isSelectedToday = (selectedUserDateIso === todayIso);

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
  let shadowYesterdayVal = '--';
  if (prevDateResultsMap && prevDateResultsMap.has(market.market_name)) {
    shadowYesterdayVal = escapeHtml(formatDisplayNumber(prevDateResultsMap.get(market.market_name)));
  } else if (isSelectedToday) {
    shadowYesterdayVal = escapeHtml(
      formatYesterdayDisplayNumber(market.yesterday_number !== undefined ? market.yesterday_number : market.second_number)
    );
  } else {
    shadowYesterdayVal = '--';
  }

  const { istMinutes } = getISTDateTime();
  const timeStatus = getMarketTimeStatus(market.draw_time, istMinutes);
  let timeText = '';

  if (timeStatus.timeSinceDraw === 0) {
    timeText = 'Drawing Now!';
  } else if (timeStatus.timeSinceDraw < 20) {
    timeText = 'Drawing Now!';
  } else if (timeStatus.timeUntilDraw < 60) {
    timeText = `In ${timeStatus.timeUntilDraw} min${timeStatus.timeUntilDraw === 1 ? '' : 's'}`;
  } else {
    const hrs = Math.floor(timeStatus.timeUntilDraw / 60);
    const mins = timeStatus.timeUntilDraw % 60;
    timeText = `In ${hrs}h ${mins}m`;
  }

  const rightBoxLabel = isSelectedToday ? 'Today' : 'Result';

  wrapper.innerHTML = `
    <div class="bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 rounded-2xl p-0.5 shadow-sm relative overflow-hidden transition-all duration-300">
      <div class="bg-slate-900 text-white rounded-[14px] p-3 sm:p-4 relative z-10">
        <div class="flex items-center justify-between gap-2 mb-2">
          <div class="flex items-center gap-1.5">
            <span class="inline-flex items-center gap-1 bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider">
              <span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span>
              🔥 Active Market
            </span>
          </div>
          <span id="active-market-time-badge" class="text-[10px] font-black text-amber-300 bg-amber-950/80 px-2.5 py-0.5 rounded-md border border-amber-500/40 shadow-xs">
            ⏱️ ${timeText}
          </span>
        </div>

        <div class="space-y-3">
          <div class="flex items-center gap-2 flex-wrap">
            <h2 class="text-lg sm:text-2xl font-black text-white tracking-tight truncate">
              ${escapeHtml(market.market_name)}
            </h2>
          </div>

          <div class="flex items-center justify-between gap-3 flex-wrap">
            <!-- Left Column: Draw time & Record chart button -->
            <div class="flex flex-col items-start gap-1.5 text-xs text-slate-300">
              <span class="bg-slate-800/90 text-amber-300 px-1.5 py-0.5 text-[10px] rounded border border-slate-700 font-medium leading-none">
                Draw Time: <strong class="font-bold text-amber-400">${escapeHtml(market.draw_time || '')}</strong>
              </span>

              <button 
                data-id="${market.id}" 
                class="active-record-chart-btn inline-flex items-center gap-1 bg-amber-400 hover:bg-amber-300 text-slate-950 px-2 py-0.5 rounded text-[10px] font-black transition-all cursor-pointer shadow-xs"
              >
                <span>📊 Record Chart</span>
              </button>
            </div>

            <!-- Right Column (In side of draw time & record chart): Two Result Boxes -->
            <div class="flex items-center gap-2.5 shrink-0">
              <!-- Left Box: Yesterday -->
              <div class="flex flex-col items-center justify-center bg-slate-800/90 border border-slate-700 p-2 rounded-xl min-w-[68px] sm:min-w-[76px]">
                <span class="text-[9px] font-extrabold uppercase tracking-wider text-slate-400 mb-1">Yesterday</span>
                <div class="w-13 sm:w-15 h-11 sm:h-13 bg-slate-700/90 text-slate-100 border border-slate-600 rounded-lg flex items-center justify-center font-mono font-black text-lg sm:text-xl shadow-inner">
                  ${shadowYesterdayVal}
                </div>
              </div>

              <!-- Right Box: Today / Result -->
              <div class="flex flex-col items-center justify-center bg-amber-950/80 border border-amber-500/50 border p-2 rounded-xl min-w-[68px] sm:min-w-[76px]">
                <span class="text-[9px] font-black uppercase tracking-wider text-amber-400 mb-1">${rightBoxLabel}</span>
                <div class="w-13 sm:w-15 h-11 sm:h-13 bg-amber-400 text-slate-950 border-amber-300 rounded-lg flex items-center justify-center font-mono font-black text-xl sm:text-2xl shadow-inner border">
                  ${todayVal}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Append Google AdSense Ad directly below Active Market Card
  const adCard = createAdSenseCard();
  wrapper.appendChild(adCard);

  const chartBtn = wrapper.querySelector('.active-record-chart-btn');
  if (chartBtn) {
    chartBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openRecordChartModal(market);
    });
  }

  // Initialize AdSense unit for the active market card
  initializeAdSenseUnits(wrapper);
}

// Cache last rendered snapshot to prevent unnecessary DOM rebuilds & AdSense re-inits
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

  // Sort all visible markets by nearest upcoming draw time
  const sortedMarkets = sortMarketsByUpcoming(visibleMarkets);

  let activeMarket = null;
  let upcomingMarkets = [];

  if (query) {
    const matched = sortedMarkets.filter(item => {
      const name = (item.market_name || '').toLowerCase();
      return name.includes(query);
    });
    if (matched.length > 0) {
      activeMarket = matched[0];
      upcomingMarkets = matched.slice(1);
    } else {
      activeMarket = null;
      upcomingMarkets = [];
    }
  } else {
    if (sortedMarkets.length > 0) {
      activeMarket = sortedMarkets[0];
      upcomingMarkets = sortedMarkets.slice(1);
    }
  }

  // Generate current render snapshot
  const currentSnapshot = JSON.stringify({
    query,
    date: selectedUserDateIso,
    order: sortedMarkets.map(m => m.id),
    res: sortedMarkets.map(m => [
      m.id,
      m.today_number,
      m.yesterday_number,
      m.first_number,
      m.second_number,
      dateResultsMap ? dateResultsMap.get(m.market_name) : null,
      prevDateResultsMap ? prevDateResultsMap.get(m.market_name) : null
    ])
  });

  // If nothing changed structurally or in data, only update active market countdown badge without tearing down AdSense ads
  if (!force && currentSnapshot === lastRenderedSnapshot) {
    if (activeMarket) {
      const { istMinutes } = getISTDateTime();
      const timeStatus = getMarketTimeStatus(activeMarket.draw_time, istMinutes);
      let timeText = '';
      if (timeStatus.timeSinceDraw === 0 || timeStatus.timeSinceDraw < 20) {
        timeText = 'Drawing Now!';
      } else if (timeStatus.timeUntilDraw < 60) {
        timeText = `In ${timeStatus.timeUntilDraw} min${timeStatus.timeUntilDraw === 1 ? '' : 's'}`;
      } else {
        const hrs = Math.floor(timeStatus.timeUntilDraw / 60);
        const mins = timeStatus.timeUntilDraw % 60;
        timeText = `In ${hrs}h ${mins}m`;
      }
      const timeBadge = document.getElementById('active-market-time-badge');
      if (timeBadge) timeBadge.textContent = `⏱️ ${timeText}`;
    }
    return;
  }

  lastRenderedSnapshot = currentSnapshot;

  // Render top active market section
  renderActiveMarketCard(activeMarket, dateResultsMap, prevDateResultsMap);

  // Update statistic counts & badges
  const activeCountEl = document.getElementById('stat-total-markets');
  const activeMarketsCountEl = document.getElementById('active-markets-count');
  const latestTimeEl = document.getElementById('stat-latest-time');
  const upcomingCountBadge = document.getElementById('upcoming-count-badge');

  if (activeCountEl) activeCountEl.textContent = visibleMarkets.length;
  if (activeMarketsCountEl) activeMarketsCountEl.textContent = visibleMarkets.length;
  if (latestTimeEl) {
    latestTimeEl.textContent = activeMarket ? activeMarket.draw_time : '--';
  }
  if (upcomingCountBadge) {
    upcomingCountBadge.textContent = `${upcomingMarkets.length} Market${upcomingMarkets.length === 1 ? '' : 's'}`;
  }

  // Render upcoming market cards
  renderMarketCards(upcomingMarkets, dateResultsMap, prevDateResultsMap);
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
    const isYellow = Boolean(market.is_highlighted);

    const cardBgClass = isYellow
      ? 'bg-amber-50 border border-amber-200 shadow-sm hover:shadow-md'
      : 'bg-white border border-gray-200 shadow-sm hover:shadow-md';

    const headerTextClass = 'text-xl font-black text-slate-900';

    card.className = `market-card ${cardBgClass} rounded-2xl p-4 sm:p-5 transition-all duration-200 relative overflow-hidden shadow-xs hover:shadow-md`;
    card.style.animationDelay = `${index * 40}ms`;

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

    card.innerHTML = `
      ${!isYellow ? '<div class="absolute top-0 left-0 w-1.5 h-full bg-amber-400"></div>' : ''}
      ${isYellow ? '<div class="absolute top-0 right-0 bg-amber-400 text-black text-[10px] font-extrabold px-2.5 py-0.5 rounded-bl-lg uppercase tracking-wider shadow-2xs">FEATURED</div>' : ''}

      <div class="w-full ${!isYellow ? 'pl-2' : ''} space-y-3">
        <!-- Title row -->
        <div class="flex items-center gap-2 flex-wrap">
          <h2 class="${headerTextClass} truncate">
            ${escapeHtml(market.market_name)}
          </h2>
          ${market.status === 'Hidden' ? `<span class="px-2 py-0.5 text-[10px] uppercase font-extrabold bg-red-100 text-red-700 rounded-md">Hidden</span>` : ''}
        </div>

        <!-- Row with Draw Time + Record Chart on Left, and Two Number Boxes right beside it on the Right -->
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <!-- Left Column: Draw time & Record chart button -->
          <div class="flex flex-col items-start gap-1.5 text-xs font-medium text-slate-600">
            <span class="bg-slate-100/90 px-1.5 py-0.5 text-[10px] rounded border border-slate-200 leading-none">
              Draw Time: <strong class="text-slate-900 font-bold">${drawTime}</strong>
            </span>

            <button 
              data-id="${market.id}" 
              class="record-chart-link inline-flex items-center gap-1 text-[10px] font-bold text-blue-600 hover:text-blue-800 bg-blue-50/80 hover:bg-blue-100 px-2 py-0.5 rounded border border-blue-200/80 transition-colors cursor-pointer"
            >
              <span>📊 Record Chart</span>
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </button>
          </div>

          <!-- Right Side: Two Result Boxes -->
          <div class="flex items-center gap-2.5 shrink-0">
            <!-- Left Box: Yesterday's Number -->
            <div class="flex flex-col items-center justify-center bg-slate-100/90 p-2 sm:p-2.5 rounded-xl border border-slate-200 min-w-[68px] sm:min-w-[78px]">
              <span class="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 mb-1">Yesterday</span>
              <div class="w-13 sm:w-16 h-11 sm:h-14 bg-white border border-slate-300 text-slate-800 rounded-lg flex items-center justify-center font-mono font-black text-xl sm:text-2xl shadow-2xs">
                ${yesterdayVal}
              </div>
            </div>

            <!-- Right Box: Result for Selected Date -->
            <div class="flex flex-col items-center justify-center bg-amber-100/80 p-2 sm:p-2.5 rounded-xl border border-amber-300 min-w-[68px] sm:min-w-[78px]">
              <span class="text-[10px] font-black uppercase tracking-wider text-amber-950 mb-1">${rightBoxLabel}</span>
              <div class="w-13 sm:w-16 h-11 sm:h-14 ${isYellow ? 'bg-amber-400 border-amber-500 text-slate-950' : 'bg-slate-900 border-slate-800 text-amber-400'} rounded-lg flex items-center justify-center font-mono font-black text-2xl sm:text-3xl border shadow-xs">
                ${todayVal}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    container.appendChild(card);

    // Append Google AdSense Ad directly below each Market Card
    const adCard = createAdSenseCard();
    container.appendChild(adCard);
  });

  // Attach record chart link listeners
  const chartLinks = container.querySelectorAll('.record-chart-link');
  chartLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const id = link.getAttribute('data-id');
      const market = allMarkets.find(m => String(m.id) === String(id));
      if (market) {
        openRecordChartModal(market);
      }
    });
  });

  // Initialize all newly rendered AdSense units in the container
  initializeAdSenseUnits(container);
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
  home: 'Satta King – Latest Market Results & Updates',
  about: 'About Satta King – Live Market Results & Records Information',
  contact: 'Contact Us – Satta King Help & Support',
  privacy: 'Privacy Policy – Satta King',
  terms: 'Terms & Conditions – Satta King'
};

const PAGE_DESCRIPTIONS = {
  home: 'Satta King – Live market results and record charts updated in real time.',
  about: 'Learn about Satta King, our live market results platform, historical chart data, and market draw timing schedules.',
  contact: 'Get in touch with Satta King for technical support, feedback, and general inquiries.',
  privacy: 'Read the Satta King Privacy Policy regarding user privacy, cookies, data collection, and security.',
  terms: 'Read the Satta King Terms & Conditions governing website usage, disclaimer, and guidelines.'
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
  }

  function closeDrawer() {
    if (sideDrawer) sideDrawer.classList.add('-translate-x-full');
    if (drawerOverlay) drawerOverlay.classList.add('hidden');
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

// Record Chart Modal Viewer
function populateMonthDropdown() {
  const monthSelect = document.getElementById('chart-month-select');
  if (!monthSelect) return;

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  const previousVal = monthSelect.value;
  monthSelect.innerHTML = '';

  // 1. All History option
  const allOpt = document.createElement('option');
  allOpt.value = 'ALL';
  allOpt.textContent = '📜 All History';
  monthSelect.appendChild(allOpt);

  // 2. Month options for past 12 months
  for (let i = 0; i < 12; i++) {
    const d = new Date(currentYear, currentMonth - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth();
    const ym = `${y}-${String(m + 1).padStart(2, '0')}`;

    const opt = document.createElement('option');
    opt.value = ym;
    if (i === 0) {
      opt.textContent = `📅 This Month (${monthNames[m]} ${y})`;
    } else if (i === 1) {
      opt.textContent = `📅 Previous Month (${monthNames[m]} ${y})`;
    } else {
      opt.textContent = `${monthNames[m]} ${y}`;
    }
    monthSelect.appendChild(opt);
  }

  if (previousVal && Array.from(monthSelect.options).some(o => o.value === previousVal)) {
    monthSelect.value = previousVal;
  } else {
    monthSelect.value = 'ALL';
  }
}

let selectedRecordChartDate = getTodayIsoDateStr();

function setupRecordChartModal() {
  const modal = document.getElementById('record-chart-modal');
  const closeBtn = document.getElementById('close-chart-modal-btn');
  const monthSelect = document.getElementById('chart-month-select');
  const dateInput = document.getElementById('chart-date-input');

  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    });
  }

  if (dateInput) {
    dateInput.addEventListener('change', () => {
      if (!dateInput.value) return;
      selectedRecordChartDate = dateInput.value;
      const targetYm = selectedRecordChartDate.substring(0, 7);
      
      if (monthSelect) {
        populateMonthDropdown(targetYm);
        monthSelect.value = targetYm;
      }
      
      if (activeChartMarket) {
        renderRecordChartHistory(activeChartMarket, targetYm, false, selectedRecordChartDate);
      }
    });
  }

  if (monthSelect) {
    monthSelect.addEventListener('change', () => {
      const ym = monthSelect.value;
      if (ym !== 'ALL' && !selectedRecordChartDate.startsWith(ym)) {
        selectedRecordChartDate = `${ym}-01`;
        if (dateInput) dateInput.value = selectedRecordChartDate;
      }
      if (activeChartMarket) {
        renderRecordChartHistory(activeChartMarket, ym, false, selectedRecordChartDate);
      }
    });
  }
}

function openRecordChartModal(market) {
  activeChartMarket = market;
  const modal = document.getElementById('record-chart-modal');
  const titleEl = document.getElementById('chart-market-title');
  const timeEl = document.getElementById('chart-market-time');
  const numbersEl = document.getElementById('chart-latest-numbers');
  const externalLinkBtn = document.getElementById('chart-external-link');
  const monthSelect = document.getElementById('chart-month-select');
  const dateInput = document.getElementById('chart-date-input');

  if (!modal) return;

  if (!selectedRecordChartDate) {
    selectedRecordChartDate = getTodayIsoDateStr();
  }

  if (dateInput) {
    dateInput.value = selectedRecordChartDate;
  }

  if (titleEl) titleEl.textContent = `${market.market_name} Record Chart`;
  if (timeEl) timeEl.textContent = `Result Time: ${market.draw_time}`;

  const currentYm = selectedRecordChartDate ? selectedRecordChartDate.substring(0, 7) : getTodayIsoDateStr().substring(0, 7);

  populateMonthDropdown(currentYm);

  if (externalLinkBtn) {
    if (market.record_chart_url && market.record_chart_url !== '#') {
      externalLinkBtn.href = market.record_chart_url;
      externalLinkBtn.target = '_blank';
      externalLinkBtn.classList.remove('hidden');
    } else {
      externalLinkBtn.classList.add('hidden');
    }
  }

  const selectedYearMonth = monthSelect && monthSelect.value ? monthSelect.value : currentYm;

  renderRecordChartHistory(market, selectedYearMonth, false, selectedRecordChartDate);

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function formatDateWithDay(dateIso) {
  const cleanIso = extractIsoDate(dateIso);
  if (!cleanIso || !/^\d{4}-\d{2}-\d{2}$/.test(cleanIso)) return dateIso || '';
  const [y, m, d] = cleanIso.split('-');
  const dateObj = new Date(Number(y), Number(m) - 1, Number(d));
  const dayNamesShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayName = dayNamesShort[dateObj.getDay()] || '';

  return `${d}-${m}-${y}${dayName ? ` (${dayName})` : ''}`;
}

let visibleRecordCount = 30;

async function renderRecordChartHistory(market, yearMonth, isLoadMore = false, selectedDateIso = null) {
  const tbody = document.getElementById('chart-matrix-tbody');
  if (!tbody) return;

  const activeDateIso = extractIsoDate(selectedDateIso || selectedRecordChartDate || getTodayIsoDateStr());

  if (!isLoadMore) {
    visibleRecordCount = 30;
    tbody.innerHTML = `
      <tr>
        <td colspan="3" class="py-8 text-center text-xs font-semibold text-slate-400 animate-pulse">
          ⏳ Loading complete record chart history...
        </td>
      </tr>
    `;
  }

  try {
    if (!yearMonth) {
      yearMonth = 'ALL';
    }

    const todayIso = getTodayIsoDateStr();
    const yesterdayIso = getPreviousIsoDateStr(todayIso);

    const currentTodayVal = market.today_number !== undefined && market.today_number !== null ? market.today_number : market.first_number;
    const currentYesterdayVal = market.yesterday_number !== undefined && market.yesterday_number !== null ? market.yesterday_number : market.second_number;

    const numTodayVal = extractResultString(currentTodayVal);
    const numYesterdayVal = extractResultString(currentYesterdayVal);

    if (numTodayVal && numTodayVal !== 'XX') {
      try {
        await saveDailyResultRecord(market.market_name, todayIso, numTodayVal, market.id);
      } catch (err) {
        console.warn('Failed to save today daily result record:', err);
      }
    }
    if (numYesterdayVal && numYesterdayVal !== '--' && numYesterdayVal !== 'XX') {
      try {
        await saveDailyResultRecord(market.market_name, yesterdayIso, numYesterdayVal, market.id);
      } catch (err) {
        console.warn('Failed to save yesterday daily result record:', err);
      }
    }

    // Fetch full history records from Supabase public.all_results table
    const historyList = await fetchMarketHistory(market.market_name, yearMonth, market.id);

    // Map keyed strictly by date (YYYY-MM-DD) to ensure single result per date and zero duplicates
    const recordsByDate = new Map();
    if (Array.isArray(historyList)) {
      historyList.forEach(item => {
        const itemDate = extractIsoDate(item.result_date);
        const rawRes = (item.result !== undefined && item.result !== null) ? item.result : item.result_number;
        const resVal = extractResultString(rawRes);
        if (itemDate && resVal) {
          recordsByDate.set(itemDate, resVal);
        }
      });
    }

    // Include yesterday's number if valid and not already present
    if (numYesterdayVal && numYesterdayVal !== '--' && numYesterdayVal !== 'XX') {
      if (yearMonth === 'ALL' || yesterdayIso.startsWith(yearMonth)) {
        if (!recordsByDate.has(yesterdayIso)) {
          recordsByDate.set(yesterdayIso, numYesterdayVal);
        }
      }
    }

    // Include today's number if valid and not already present
    if (yearMonth === 'ALL' || todayIso.startsWith(yearMonth)) {
      if (numTodayVal && numTodayVal !== 'XX') {
        if (!recordsByDate.has(todayIso)) {
          recordsByDate.set(todayIso, numTodayVal);
        }
      } else if (!recordsByDate.has(todayIso)) {
        recordsByDate.set(todayIso, 'XX');
      }
    }

    // Update result badge in chart modal header for the active selected date (e.g. Result (10-08-2026): 60)
    const numbersEl = document.getElementById('chart-latest-numbers');
    const activeDateResult = recordsByDate.get(activeDateIso) || 'XX';
    const displayActiveDate = formatDbDateToDisplay(activeDateIso);
    if (numbersEl) {
      numbersEl.textContent = `Result (${displayActiveDate}): ${activeDateResult}`;
    }

    // Determine list of dates to render (sorted chronologically with newest date first)
    let datesToRender = [];

    if (yearMonth === 'ALL') {
      // Sort all available historical dates descending (newest first, e.g. 2026-08-14, 2026-08-13, 2026-08-12...)
      datesToRender = Array.from(recordsByDate.keys()).sort((a, b) => b.localeCompare(a));
    } else {
      // Single month: Generate dates from daysInMonth down to 1
      const [yearNum, monthNum] = yearMonth.split('-').map(Number);
      const daysInMonth = new Date(yearNum, monthNum, 0).getDate();
      for (let day = daysInMonth; day >= 1; day--) {
        const dayStr = String(day).padStart(2, '0');
        datesToRender.push(`${yearMonth}-${dayStr}`);
      }
    }

    if (!isLoadMore) {
      tbody.innerHTML = '';
    }

    if (datesToRender.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="3" class="py-8 text-center text-xs font-semibold text-slate-500">
            No historical records found for ${escapeHtml(market.market_name)}.
          </td>
        </tr>
      `;
      return;
    }

    const itemsToShow = datesToRender.slice(0, visibleRecordCount);

    tbody.innerHTML = '';

    itemsToShow.forEach((dateIso, idx) => {
      const isSelectedDate = (dateIso === activeDateIso);
      const isToday = (dateIso === todayIso);
      const resultVal = recordsByDate.get(dateIso) || 'XX';
      const displayDateStr = formatDateWithDay(dateIso);

      const tr = document.createElement('tr');
      tr.className = isSelectedDate
        ? 'bg-amber-100/95 font-black text-amber-950 border-2 border-amber-400 shadow-2xs'
        : (isToday ? 'bg-amber-50 font-bold text-amber-900 border-b border-amber-200' : (idx % 2 === 0 ? 'bg-slate-50 border-b border-slate-200' : 'bg-white border-b border-slate-200'));

      let resultHtml = '';
      if (resultVal === 'XX') {
        resultHtml = `<span class="font-mono font-bold text-slate-400">XX</span>`;
      } else {
        resultHtml = `<span class="inline-block bg-amber-400 text-slate-950 font-mono font-black px-3 py-0.5 rounded-lg border border-amber-500 shadow-2xs">${escapeHtml(String(resultVal))}</span>`;
      }

      let badgeHtml = '';
      if (isSelectedDate) {
        badgeHtml = `<span class="ml-1 text-[10px] text-amber-950 bg-amber-300 border border-amber-400 px-1.5 py-0.5 rounded font-black uppercase">Selected Date</span>`;
      } else if (isToday) {
        badgeHtml = `<span class="ml-1 text-[10px] text-amber-800 bg-amber-200 px-1.5 py-0.5 rounded font-black uppercase">Today</span>`;
      }

      tr.innerHTML = `
        <td class="py-2.5 px-3 font-bold text-slate-800 text-xs sm:text-sm whitespace-nowrap">
          ${displayDateStr} ${badgeHtml}
        </td>
        <td class="py-2.5 px-3 font-semibold text-slate-700 text-xs sm:text-sm whitespace-nowrap">
          ${escapeHtml(market.market_name)}
        </td>
        <td class="py-2.5 px-3 font-bold text-center text-xs sm:text-sm whitespace-nowrap">
          ${resultHtml}
        </td>
      `;

      tbody.appendChild(tr);
    });

    // Check if pagination "Load More" button is needed
    let loadMoreBtn = document.getElementById('chart-load-more-btn');
    let container = document.getElementById('chart-pagination-container');

    if (datesToRender.length > visibleRecordCount) {
      if (!container) {
        container = document.createElement('div');
        container.id = 'chart-pagination-container';
        container.className = 'mt-3 text-center py-2';
        container.innerHTML = `
          <button id="chart-load-more-btn" class="bg-slate-900 hover:bg-slate-800 text-amber-400 text-xs font-extrabold px-4 py-2 rounded-xl border border-slate-700 cursor-pointer transition-colors shadow-sm">
            👇 Load More Historical Records (${datesToRender.length - visibleRecordCount} remaining)
          </button>
        `;
        const modalBody = tbody.closest('.overflow-y-auto') || tbody.parentElement;
        if (modalBody) modalBody.appendChild(container);
        loadMoreBtn = document.getElementById('chart-load-more-btn');
      } else {
        container.classList.remove('hidden');
        if (loadMoreBtn) {
          loadMoreBtn.textContent = `👇 Load More Historical Records (${datesToRender.length - visibleRecordCount} remaining)`;
        }
      }

      if (loadMoreBtn) {
        loadMoreBtn.onclick = () => {
          visibleRecordCount += 30;
          renderRecordChartHistory(market, yearMonth, true, activeDateIso);
        };
      }
    } else {
      if (container) {
        container.classList.add('hidden');
      }
    }

  } catch (error) {
    console.error('Error rendering record chart history:', error);
    tbody.innerHTML = `
      <tr>
        <td colspan="3" class="py-6 text-center text-xs font-semibold text-rose-500">
          ⚠️ Unable to load history records. Please try again.
        </td>
      </tr>
    `;
  }
}

// ----------------------------------------------------
// IST AUTOMATIC DAILY SHIFT TICKER
// Exact rules:
// - Normal Markets: 12:00 AM IST
// - Gali: 12:20 AM IST
// - Disawer: 12:21 AM IST
// ----------------------------------------------------
// IST AUTOMATIC DISPLAY TICKER
// ----------------------------------------------------
let autoShiftTickerInterval = null;

function startAutoShiftTicker() {
  if (autoShiftTickerInterval) return;

  function checkAndRender() {
    if (!isLoading && allMarkets && allMarkets.length > 0) {
      applyFilterAndRender();
    }
  }

  // Periodically refresh sorting order as 20-min draw thresholds pass
  autoShiftTickerInterval = setInterval(checkAndRender, 10000);
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
