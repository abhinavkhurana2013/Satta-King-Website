import {
  getEffectiveConfig,
  isSupabaseConfigured,
  saveCustomConfig,
  addMarket,
  updateMarket,
  deleteMarket,
  saveDailyResultRecord,
  clearAllHistoricalAndMonthlyResults,
  getTodayIsoDateStr,
  getYesterdayIsoDateStr,
  getISTDateTime,
  formatTodayDisplayNumber
} from './supabase.js';

let isAdminLoggedIn = false;
let editingMarketId = null;
let currentMarketsList = [];
let onMarketsUpdatedCallback = null;
let showToastCallback = null;

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

// Helper: Check if a market is overdue (1 hour or more past draw time) and today's result is not updated
function isMarketNotUpdatedOverdue(market, currentISTMinutes) {
  if (!market || !market.draw_time) return false;

  const drawMinutes = parseTimeToMinutes(market.draw_time);
  const timeSinceDraw = (currentISTMinutes - drawMinutes + 1440) % 1440;
  const timeUntilDraw = (drawMinutes - currentISTMinutes + 1440) % 1440;

  // Has 1 hour (60 mins) passed since draw time?
  const isOneHourPassed = (timeSinceDraw >= 60 && timeSinceDraw < timeUntilDraw);
  if (!isOneHourPassed) return false;

  const rawToday = market.today_number !== undefined && market.today_number !== null
    ? market.today_number
    : market.first_number;

  const formattedVal = formatTodayDisplayNumber(rawToday);
  const isUpdated = (formattedVal && formattedVal !== 'XX');

  return !isUpdated;
}

export function initAdmin(options = {}) {
  onMarketsUpdatedCallback = options.onMarketsUpdated || null;
  showToastCallback = options.showToast || null;

  // Check if previously logged in this session
  if (sessionStorage.getItem('satta_admin_logged_in') === 'true') {
    isAdminLoggedIn = true;
    updateAdminStatusUI();
  }

  setupEventListeners();
}

export function getAdminState() {
  return { isAdminLoggedIn };
}

function notify(message, type = 'info') {
  if (showToastCallback) {
    showToastCallback(message, type);
  } else {
    alert(message);
  }
}

// Attach event listeners for Admin modal, login, form submit, etc.
function setupEventListeners() {
  // Admin Login Dialog Form Submit
  const loginForm = document.getElementById('admin-login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', handleAdminLogin);
  }

  // Close Login Modal
  const closeLoginBtn = document.getElementById('close-admin-login-btn');
  if (closeLoginBtn) {
    closeLoginBtn.addEventListener('click', closeAdminLoginModal);
  }

  // Close Dashboard Modal
  const closeDashBtn = document.getElementById('close-admin-dash-btn');
  if (closeDashBtn) {
    closeDashBtn.addEventListener('click', closeAdminDashboardModal);
  }

  // Add / Edit Market Form Submit
  const marketForm = document.getElementById('admin-market-form');
  if (marketForm) {
    marketForm.addEventListener('submit', handleMarketFormSubmit);
  }

  // Cancel Edit Mode Button
  const cancelEditBtn = document.getElementById('cancel-edit-btn');
  if (cancelEditBtn) {
    cancelEditBtn.addEventListener('click', resetMarketForm);
  }

  // Save Config Form
  const configForm = document.getElementById('supabase-config-form');
  if (configForm) {
    configForm.addEventListener('submit', handleConfigSave);
  }

  // Copy SQL script button
  const copySqlBtn = document.getElementById('copy-sql-btn');
  if (copySqlBtn) {
    copySqlBtn.addEventListener('click', copySqlToClipboard);
  }

  // Reset Monthly Results button
  const resetMonthlyBtn = document.getElementById('reset-monthly-results-btn');
  if (resetMonthlyBtn) {
    resetMonthlyBtn.addEventListener('click', handleResetMonthlyResults);
  }



  // Logout button
  const logoutBtn = document.getElementById('admin-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleAdminLogout);
  }

  // Preset markets slide-out drawer buttons
  const openPresetsBtn = document.getElementById('open-market-presets-btn');
  if (openPresetsBtn) {
    openPresetsBtn.addEventListener('click', openPresetsDrawer);
  }

  const closePresetsBtn = document.getElementById('close-presets-drawer-btn');
  if (closePresetsBtn) {
    closePresetsBtn.addEventListener('click', closePresetsDrawer);
  }

  const presetSearchInput = document.getElementById('preset-search-input');
  if (presetSearchInput) {
    presetSearchInput.addEventListener('input', (e) => {
      renderPresetMarketsList(e.target.value);
    });
  }

  const presetsDrawer = document.getElementById('market-presets-drawer');
  if (presetsDrawer) {
    presetsDrawer.addEventListener('click', (e) => {
      if (e.target === presetsDrawer) {
        closePresetsDrawer();
      }
    });
  }
}

// Open Login Modal
export function openAdminLoginModal() {
  if (isAdminLoggedIn) {
    openAdminDashboardModal();
    return;
  }

  const modal = document.getElementById('admin-login-modal');
  const pwdInput = document.getElementById('admin-password-input');
  const errorText = document.getElementById('login-error-text');

  if (modal) {
    if (errorText) errorText.classList.add('hidden');
    if (pwdInput) pwdInput.value = '';
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => {
      if (pwdInput) pwdInput.focus();
    }, 100);
  }
}

export function closeAdminLoginModal() {
  const modal = document.getElementById('admin-login-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

// Login Handler
function handleAdminLogin(e) {
  e.preventDefault();
  const pwdInput = document.getElementById('admin-password-input');
  const errorText = document.getElementById('login-error-text');
  const enterBtn = document.getElementById('admin-login-submit-btn');

  if (!pwdInput) return;

  const enteredPassword = pwdInput.value.trim();
  const config = getEffectiveConfig();

  if (enteredPassword === config.ADMIN_PASSWORD) {
    isAdminLoggedIn = true;
    sessionStorage.setItem('satta_admin_logged_in', 'true');
    closeAdminLoginModal();
    notify('Admin login successful!', 'success');
    updateAdminStatusUI();
    openAdminDashboardModal();
  } else {
    // Exact requirement: "If incorrect: Show: Incorrect Password"
    notify('Incorrect Password', 'error');
    if (errorText) {
      errorText.textContent = 'Incorrect Password';
      errorText.classList.remove('hidden');
    }
    
    // Add shake effect to login box
    const box = document.getElementById('login-modal-box');
    if (box) {
      box.classList.add('animate-shake');
      setTimeout(() => box.classList.remove('animate-shake'), 600);
    }
  }
}

export function handleAdminLogout() {
  isAdminLoggedIn = false;
  sessionStorage.removeItem('satta_admin_logged_in');
  updateAdminStatusUI();
  closeAdminDashboardModal();
  notify('Admin logged out', 'info');
}

function updateAdminStatusUI() {
  const adminBadge = document.getElementById('header-admin-badge');
  const sideAdminStatus = document.getElementById('side-admin-status');

  if (adminBadge) {
    if (isAdminLoggedIn) {
      adminBadge.classList.remove('hidden');
    } else {
      adminBadge.classList.add('hidden');
    }
  }

  if (sideAdminStatus) {
    sideAdminStatus.textContent = isAdminLoggedIn ? 'Admin Logged In' : 'Admin Area';
  }
}

// Open Admin Dashboard Modal/Panel
export function openAdminDashboardModal(markets = []) {
  if (!isAdminLoggedIn) {
    openAdminLoginModal();
    return;
  }

  if (markets && markets.length > 0) {
    currentMarketsList = markets;
  }

  const dateInput = document.getElementById('market-result-date-input');
  if (dateInput && !dateInput.value) {
    dateInput.value = getTodayIsoDateStr();
  }

  const modal = document.getElementById('admin-dashboard-modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    populateConfigFields();
    renderAdminMarketsTable(currentMarketsList);
  }
}

export function closeAdminDashboardModal() {
  const modal = document.getElementById('admin-dashboard-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

// Populate live list of markets inside Admin Dashboard
export function updateAdminMarketsList(markets) {
  currentMarketsList = markets;
  const dashModal = document.getElementById('admin-dashboard-modal');
  if (dashModal && !dashModal.classList.contains('hidden')) {
    renderAdminMarketsTable(currentMarketsList);
  }
}

function renderAdminMarketsTable(markets) {
  const tbody = document.getElementById('admin-markets-tbody');
  const emptyText = document.getElementById('admin-markets-empty');
  if (!tbody) return;

  tbody.innerHTML = '';

  const { istMinutes } = getISTDateTime();

  // Handle Admin Overdue Alert Banner
  const overdueAlertBanner = document.getElementById('admin-overdue-alert-banner');
  const overdueAlertList = document.getElementById('admin-overdue-alert-list');

  const overdueMarkets = (markets || []).filter(m => isMarketNotUpdatedOverdue(m, istMinutes));

  if (overdueAlertBanner && overdueAlertList) {
    if (overdueMarkets.length > 0) {
      overdueAlertList.innerHTML = overdueMarkets.map(m => 
        `<span class="bg-rose-100 text-rose-800 border border-rose-300 px-2.5 py-1 rounded-lg font-black text-xs">⚠️ (${escapeHtml(m.market_name)} has not updated)</span>`
      ).join(' ');
      overdueAlertBanner.classList.remove('hidden');
    } else {
      overdueAlertBanner.classList.add('hidden');
    }
  }

  if (!markets || markets.length === 0) {
    if (emptyText) emptyText.classList.remove('hidden');
    return;
  }

  if (emptyText) emptyText.classList.add('hidden');

  markets.forEach((item, index) => {
    const tr = document.createElement('tr');
    tr.className = 'border-b border-slate-200 hover:bg-amber-50/70 transition-colors text-sm cursor-pointer';

    const isHidden = item.status === 'Hidden';
    const statusBadge = isHidden
      ? `<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">Hidden</span>`
      : `<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">Active</span>`;

    const highlightBadge = (item.highlighted_yellow || item.highlight_yellow)
      ? `<span class="ml-1 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-200 text-amber-900 border border-amber-300">★ Yellow</span>`
      : '';

    const isOverdue = isMarketNotUpdatedOverdue(item, istMinutes);

    const overdueBadge = isOverdue
      ? `<div class="mt-1 text-xs font-black text-rose-600 animate-pulse">🚨 (${escapeHtml(item.market_name)} has not updated)</div>`
      : '';

    const todayDisplayVal = escapeHtml(item.today_number || item.first_number || 'XX');
    const todayCellClass = isOverdue
      ? 'py-3 px-4 text-rose-700 font-mono font-black text-base bg-rose-100/90 border border-rose-300'
      : 'py-3 px-4 text-amber-700 font-mono font-bold text-base bg-amber-50/50';

    tr.innerHTML = `
      <td class="py-3 px-4 font-bold text-slate-800">
        ${escapeHtml(item.market_name)}
        ${highlightBadge}
        ${overdueBadge}
      </td>
      <td class="${todayCellClass}">
        ${todayDisplayVal}
        ${isOverdue ? '<span class="text-[10px] uppercase font-sans font-extrabold block text-rose-600 leading-tight">Un-updated</span>' : ''}
      </td>
      <td class="py-3 px-4 text-slate-500 font-mono font-semibold">${escapeHtml(item.yesterday_number || item.second_number || 'XX')}</td>
      <td class="py-3 px-4 text-slate-600 whitespace-nowrap">${escapeHtml(item.draw_time || '')}</td>
      <td class="py-3 px-4">${statusBadge}</td>
      <td class="py-3 px-4 text-right whitespace-nowrap space-x-2">
        <button 
          data-id="${item.id}" 
          class="edit-market-btn inline-flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-xs font-medium transition-all shadow-sm active:scale-95 cursor-pointer"
        >
          ✏️ Edit
        </button>
        <button 
          data-id="${item.id}" 
          data-name="${escapeHtml(item.market_name)}" 
          class="delete-market-btn inline-flex items-center gap-1 bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded text-xs font-medium transition-all shadow-sm active:scale-95 cursor-pointer"
        >
          🗑️ Delete
        </button>
      </td>
    `;

    // When clicking anywhere on the market row, open Market Action Modal with Edit and Delete options
    tr.addEventListener('click', (e) => {
      // Don't trigger modal twice if user clicked directly on edit or delete button
      if (e.target.closest('.edit-market-btn') || e.target.closest('.delete-market-btn')) {
        return;
      }
      openMarketActionModal(item);
    });

    tbody.appendChild(tr);
  });

  // Attach button actions
  const editBtns = tbody.querySelectorAll('.edit-market-btn');
  editBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      startEditingMarket(id);
    });
  });

  const deleteBtns = tbody.querySelectorAll('.delete-market-btn');
  deleteBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      const name = btn.getAttribute('data-name');
      confirmDeleteMarket(id, name);
    });
  });
}

// Handle Form Submit (Add or Update Market)
async function handleMarketFormSubmit(e) {
  e.preventDefault();

  const nameInput = document.getElementById('market-name-input');
  const todayInput = document.getElementById('market-today-input') || document.getElementById('market-first-input');
  const dateInput = document.getElementById('market-result-date-input');
  const timeInput = document.getElementById('market-time-input');
  const chartInput = document.getElementById('market-chart-input');
  const statusSelect = document.getElementById('market-status-select');
  const highlightCheck = document.getElementById('market-highlight-check');
  const submitBtn = document.getElementById('market-form-submit-btn');
  const errorAlert = document.getElementById('admin-form-error-alert');

  if (errorAlert) {
    errorAlert.classList.add('hidden');
    errorAlert.textContent = '';
  }

  if (!nameInput || !timeInput) return;

  const selectedDate = (dateInput && dateInput.value) ? dateInput.value : getTodayIsoDateStr();
  const todayIso = getTodayIsoDateStr();
  const yesterdayIso = getYesterdayIsoDateStr();

  const enteredResult = todayInput ? todayInput.value.trim() : '';

  const existingItem = editingMarketId ? currentMarketsList.find(m => String(m.id) === String(editingMarketId)) : null;

  let todayNum = existingItem ? (existingItem.today_number || existingItem.first_number || '') : '';
  let yesterdayNum = existingItem ? (existingItem.yesterday_number || existingItem.second_number || '') : '';

  if (selectedDate === todayIso) {
    todayNum = enteredResult;
  } else if (selectedDate === yesterdayIso) {
    yesterdayNum = enteredResult;
  }

  const marketData = {
    market_name: nameInput.value.trim(),
    today_number: todayNum,
    yesterday_number: yesterdayNum,
    draw_time: timeInput.value.trim(),
    record_chart_url: chartInput ? chartInput.value.trim() : '#',
    status: statusSelect ? statusSelect.value : 'Active',
    highlighted_yellow: highlightCheck ? highlightCheck.checked : false,
    highlight_yellow: highlightCheck ? highlightCheck.checked : false,
    is_highlighted: highlightCheck ? highlightCheck.checked : false,
    last_shifted_date: existingItem ? (existingItem.last_shifted_date || '') : ''
  };

  if (!marketData.market_name) {
    notify('Please enter a Market Name', 'error');
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `⌛ Saving...`;
  }

  try {
    let savedMarket = null;
    if (editingMarketId) {
      // Update existing
      savedMarket = await updateMarket(editingMarketId, marketData);
    } else {
      // Add new
      savedMarket = await addMarket(marketData);
    }

    const targetMarketId = (savedMarket && savedMarket.id) ? savedMarket.id : editingMarketId;

    // Save record to all_results history table for selected date
    if (enteredResult) {
      await saveDailyResultRecord(marketData.market_name, selectedDate, enteredResult, targetMarketId);
    }

    notify(`Market "${marketData.market_name}" result saved for ${selectedDate}!`, 'success');

    resetMarketForm(selectedDate);

    if (onMarketsUpdatedCallback) {
      onMarketsUpdatedCallback();
    }
  } catch (err) {
    console.error('Error saving market to Supabase:', err);
    const fullErrText = err.message || 'Error saving market. Please check browser console and Supabase settings.';
    
    if (errorAlert) {
      errorAlert.textContent = `❌ ${fullErrText}`;
      errorAlert.classList.remove('hidden');
    }

    notify(fullErrText, 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = editingMarketId ? '🔄 Update Market' : '➕ Add Market';
    }
  }
}

// Populate form for Editing
function startEditingMarket(id) {
  const item = currentMarketsList.find(m => String(m.id) === String(id));
  if (!item) return;

  editingMarketId = item.id;

  const titleEl = document.getElementById('admin-form-title');
  const nameInput = document.getElementById('market-name-input');
  const todayInput = document.getElementById('market-today-input') || document.getElementById('market-first-input');
  const dateInput = document.getElementById('market-result-date-input');
  const timeInput = document.getElementById('market-time-input');
  const chartInput = document.getElementById('market-chart-input');
  const statusSelect = document.getElementById('market-status-select');
  const highlightCheck = document.getElementById('market-highlight-check');
  const submitBtn = document.getElementById('market-form-submit-btn');
  const cancelBtn = document.getElementById('cancel-edit-btn');

  if (dateInput && !dateInput.value) {
    dateInput.value = getTodayIsoDateStr();
  }

  if (titleEl) titleEl.textContent = '✏️ Edit Market Values';
  if (nameInput) nameInput.value = item.market_name || '';
  const numVal = (item.today_number && item.today_number !== 'XX') ? item.today_number : ((item.first_number && item.first_number !== 'XX') ? item.first_number : '');
  if (todayInput) todayInput.value = numVal;
  if (timeInput) timeInput.value = item.draw_time || '';
  if (chartInput) chartInput.value = item.record_chart_url || '';
  if (statusSelect) statusSelect.value = item.status || 'Active';
  if (highlightCheck) highlightCheck.checked = Boolean(item.highlighted_yellow !== undefined ? item.highlighted_yellow : (item.highlight_yellow !== undefined ? item.highlight_yellow : false));
  if (submitBtn) submitBtn.textContent = '🔄 Update Market';
  if (cancelBtn) cancelBtn.classList.remove('hidden');

  // Scroll form into view inside dashboard modal
  const formBox = document.getElementById('admin-market-form-box');
  if (formBox) {
    formBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function resetMarketForm(preserveDate) {
  editingMarketId = null;

  const titleEl = document.getElementById('admin-form-title');
  const form = document.getElementById('admin-market-form');
  const submitBtn = document.getElementById('market-form-submit-btn');
  const cancelBtn = document.getElementById('cancel-edit-btn');
  const errorAlert = document.getElementById('admin-form-error-alert');
  const dateInput = document.getElementById('market-result-date-input');

  const currentSelectedDate = preserveDate || (dateInput && dateInput.value ? dateInput.value : getTodayIsoDateStr());

  if (form) form.reset();
  if (dateInput) dateInput.value = currentSelectedDate;
  if (titleEl) titleEl.textContent = '➕ Add New Market';
  if (submitBtn) submitBtn.textContent = '➕ Add Market';
  if (cancelBtn) cancelBtn.classList.add('hidden');
  if (errorAlert) {
    errorAlert.classList.add('hidden');
    errorAlert.textContent = '';
  }
}

// Action Modal when clicking any market row in admin list
function openMarketActionModal(item) {
  const modal = document.getElementById('market-action-modal');
  const titleEl = document.getElementById('action-market-name');
  const detailsEl = document.getElementById('action-market-details');
  const editBtn = document.getElementById('action-edit-btn');
  const deleteBtn = document.getElementById('action-delete-btn');
  const cancelBtn = document.getElementById('action-cancel-btn');

  if (!modal) return;

  if (titleEl) titleEl.textContent = item.market_name || 'Market Actions';
  if (detailsEl) {
    const resultStr = item.today_number || item.first_number || 'XX';
    detailsEl.textContent = `Time: ${item.draw_time || 'N/A'} | Today Result: ${resultStr}`;
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');

  const handleEdit = () => {
    cleanup();
    startEditingMarket(item.id);
  };

  const handleDelete = () => {
    cleanup();
    confirmDeleteMarket(item.id, item.market_name);
  };

  const handleClose = () => {
    cleanup();
  };

  const handleOutsideClick = (e) => {
    if (e.target === modal) {
      cleanup();
    }
  };

  function cleanup() {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    if (editBtn) editBtn.removeEventListener('click', handleEdit);
    if (deleteBtn) deleteBtn.removeEventListener('click', handleDelete);
    if (cancelBtn) cancelBtn.removeEventListener('click', handleClose);
    modal.removeEventListener('click', handleOutsideClick);
  }

  if (editBtn) editBtn.addEventListener('click', handleEdit);
  if (deleteBtn) deleteBtn.addEventListener('click', handleDelete);
  if (cancelBtn) cancelBtn.addEventListener('click', handleClose);
  modal.addEventListener('click', handleOutsideClick);
}

// Confirmation Dialog before deleting
function confirmDeleteMarket(id, name) {
  const deleteModal = document.getElementById('delete-confirm-modal');
  const nameEl = document.getElementById('delete-market-name');
  const confirmBtn = document.getElementById('confirm-delete-btn');
  const cancelBtn = document.getElementById('cancel-delete-btn');

  if (!deleteModal) {
    if (confirm(`Are you sure you want to delete "${name}"?`)) {
      executeDeleteMarket(id, name);
    }
    return;
  }

  if (nameEl) nameEl.textContent = name;
  deleteModal.classList.remove('hidden');
  deleteModal.classList.add('flex');

  // Setup one-off event handlers for confirm & cancel
  const handleConfirm = async () => {
    deleteModal.classList.add('hidden');
    deleteModal.classList.remove('flex');
    cleanup();
    await executeDeleteMarket(id, name);
  };

  const handleCancel = () => {
    deleteModal.classList.add('hidden');
    deleteModal.classList.remove('flex');
    cleanup();
  };

  function cleanup() {
    confirmBtn.removeEventListener('click', handleConfirm);
    cancelBtn.removeEventListener('click', handleCancel);
  }

  confirmBtn.addEventListener('click', handleConfirm);
  cancelBtn.addEventListener('click', handleCancel);
}

async function executeDeleteMarket(id, name) {
  try {
    await deleteMarket(id);
    notify(`Market "${name}" permanently deleted!`, 'success');
    if (onMarketsUpdatedCallback) {
      onMarketsUpdatedCallback();
    }
  } catch (err) {
    console.error('Delete error:', err);
    notify(err.message || 'Failed to delete market', 'error');
  }
}

// Populate Supabase Config form fields
function populateConfigFields() {
  const cfg = getEffectiveConfig();
  const urlInput = document.getElementById('config-supabase-url');
  const keyInput = document.getElementById('config-supabase-key');
  const pwdInput = document.getElementById('config-admin-password');
  const statusBadge = document.getElementById('config-status-badge');

  if (urlInput) urlInput.value = cfg.SUPABASE_URL || '';
  if (keyInput) keyInput.value = cfg.SUPABASE_ANON_KEY || '';
  if (pwdInput) pwdInput.value = cfg.ADMIN_PASSWORD || '11092013';

  if (statusBadge) {
    if (isSupabaseConfigured()) {
      statusBadge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300';
      statusBadge.textContent = '⚡ Connected to Supabase Cloud';
    } else {
      statusBadge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300';
      statusBadge.textContent = '⚠️ Running in Local Storage Mode';
    }
  }
}

function handleConfigSave(e) {
  e.preventDefault();
  const urlInput = document.getElementById('config-supabase-url');
  const keyInput = document.getElementById('config-supabase-key');
  const pwdInput = document.getElementById('config-admin-password');

  const url = urlInput ? urlInput.value.trim() : '';
  const key = keyInput ? keyInput.value.trim() : '';
  const pwd = pwdInput ? pwdInput.value.trim() : '11092013';

  saveCustomConfig(url, key, pwd);
  populateConfigFields();
  notify('Configuration updated successfully!', 'success');

  if (onMarketsUpdatedCallback) {
    onMarketsUpdatedCallback();
  }
}

async function handleResetMonthlyResults() {
  const confirmed = confirm('⚠️ Are you sure you want to RESET & CLEAR all market monthly/historical results from the database?\n\nThis will empty the "all_results" and "daily_results" tables in Supabase and clear local cache.');
  if (!confirmed) return;

  try {
    notify('Resetting market monthly results in database...', 'info');
    await clearAllHistoricalAndMonthlyResults(false);
    notify('✅ All market monthly results have been reset in the database!', 'success');
    if (onMarketsUpdatedCallback) {
      onMarketsUpdatedCallback();
    }
  } catch (err) {
    console.error('Failed to reset monthly results:', err);
    notify('Failed to reset monthly results: ' + (err.message || err), 'error');
  }
}

function copySqlToClipboard() {
  const sqlText = `-- ========================================================
-- SATTA KING RESULTS SUPABASE DATABASE SCHEMA & IST CRON SHIFT
-- ========================================================

-- 1. Create 'results' table
CREATE TABLE IF NOT EXISTS results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  market_name TEXT NOT NULL,
  today_number INT DEFAULT NULL,
  yesterday_number INT DEFAULT NULL,
  first_number INT DEFAULT NULL,
  second_number INT DEFAULT NULL,
  draw_time TEXT NOT NULL,
  record_chart_url TEXT DEFAULT '#',
  status TEXT DEFAULT 'Active',
  is_highlighted BOOLEAN DEFAULT false,
  last_shifted_date DATE DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Ensure numeric and date columns exist if table was already created
ALTER TABLE results ADD COLUMN IF NOT EXISTS today_number INT DEFAULT NULL;
ALTER TABLE results ADD COLUMN IF NOT EXISTS yesterday_number INT DEFAULT NULL;
ALTER TABLE results ADD COLUMN IF NOT EXISTS first_number INT DEFAULT NULL;
ALTER TABLE results ADD COLUMN IF NOT EXISTS second_number INT DEFAULT NULL;
ALTER TABLE results ADD COLUMN IF NOT EXISTS last_shifted_date DATE DEFAULT NULL;

-- 2. Create 'all_results' and 'daily_results' table for record chart history
CREATE TABLE IF NOT EXISTS all_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  market_id UUID DEFAULT NULL,
  market_name TEXT NOT NULL,
  result_date DATE NOT NULL,
  result TEXT NOT NULL,
  result_number TEXT DEFAULT NULL,
  draw_time TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  market_name TEXT NOT NULL,
  result_date DATE NOT NULL,
  result_number INT DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_market_date UNIQUE(market_name, result_date)
);

-- 3. Enable RLS and public policies
ALTER TABLE results ENABLE ROW LEVEL SECURITY;
ALTER TABLE all_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow Public Access" ON results;
CREATE POLICY "Allow Public Access" ON results FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow Public Access All Results" ON all_results;
CREATE POLICY "Allow Public Access All Results" ON all_results FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow Public Access Daily" ON daily_results;
CREATE POLICY "Allow Public Access Daily" ON daily_results FOR ALL TO public USING (true) WITH CHECK (true);

-- 4. Enable Supabase Realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'results'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE results;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'all_results'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE all_results;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'daily_results'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE daily_results;
  END IF;
END $$;

-- 5. STORED PROCEDURE / RPC FOR IST TIMING SHIFT RULES:
-- Normal Markets at 12:00 AM IST (00:00)
-- Gali at 01:00 AM IST (01:00)
-- Disawer at 12:21 AM IST (00:21)
CREATE OR REPLACE FUNCTION perform_daily_market_shift()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now_ist TIMESTAMP;
  v_ist_date DATE;
  v_ist_time TIME;
  v_shifted_count INT := 0;
  r RECORD;
  v_new_yesterday INT;
BEGIN
  -- Get current timestamp in India Standard Time (Asia/Kolkata)
  v_now_ist := timezone('Asia/Kolkata', now());
  v_ist_date := v_now_ist::DATE;
  v_ist_time := v_now_ist::TIME;

  FOR r IN SELECT * FROM results LOOP
    IF LOWER(r.market_name) LIKE '%gali%' THEN
      -- GALI shifts at 01:00 AM IST
      IF v_ist_time >= TIME '01:00:00' AND (r.last_shifted_date IS NULL OR r.last_shifted_date < v_ist_date) THEN
        v_new_yesterday := COALESCE(r.today_number, r.yesterday_number);
        UPDATE results
        SET 
          yesterday_number = v_new_yesterday,
          second_number = v_new_yesterday,
          today_number = NULL,
          first_number = NULL,
          last_shifted_date = v_ist_date,
          updated_at = NOW()
        WHERE id = r.id;
        v_shifted_count := v_shifted_count + 1;
      END IF;

    ELSIF LOWER(r.market_name) LIKE '%disawer%' OR LOWER(r.market_name) LIKE '%desawar%' THEN
      -- DISAWER shifts at 12:21 AM IST
      IF v_ist_time >= TIME '00:21:00' AND (r.last_shifted_date IS NULL OR r.last_shifted_date < v_ist_date) THEN
        v_new_yesterday := COALESCE(r.today_number, r.yesterday_number);
        UPDATE results
        SET 
          yesterday_number = v_new_yesterday,
          second_number = v_new_yesterday,
          today_number = NULL,
          first_number = NULL,
          last_shifted_date = v_ist_date,
          updated_at = NOW()
        WHERE id = r.id;
        v_shifted_count := v_shifted_count + 1;
      END IF;

    ELSE
      -- NORMAL MARKETS shift at 12:00 AM IST (midnight)
      IF v_ist_time >= TIME '00:00:00' AND (r.last_shifted_date IS NULL OR r.last_shifted_date < v_ist_date) THEN
        v_new_yesterday := COALESCE(r.today_number, r.yesterday_number);
        UPDATE results
        SET 
          yesterday_number = v_new_yesterday,
          second_number = v_new_yesterday,
          today_number = NULL,
          first_number = NULL,
          last_shifted_date = v_ist_date,
          updated_at = NOW()
        WHERE id = r.id;
        v_shifted_count := v_shifted_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN json_build_object(
    'shifted_count', v_shifted_count,
    'ist_date', v_ist_date,
    'ist_time', v_ist_time
  );
END;
$$;

-- 6. Schedule automatic execution via pg_cron extension (runs every minute in Supabase)
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('auto-shift-results-ist', '* * * * *', $$ SELECT perform_daily_market_shift(); $$);`;

  navigator.clipboard.writeText(sqlText).then(() => {
    notify('SQL schema query copied to clipboard!', 'success');
  }).catch(() => {
    notify('Failed to copy. Please select and copy manually.', 'error');
  });
}

// ==========================================
// PRESET MARKETS SLIDE-OUT SELECTION LIST
// ==========================================
export const PRESET_MARKETS = [
  { name: 'Disawer', time: '05:15 AM', category: 'Main Market' },
  { name: 'Dehli Noon', time: '03:15 PM', category: 'Main Market' },
  { name: 'Punjab Day', time: '05:15 PM', category: 'Main Market' },
  { name: 'Faridabad', time: '06:15 PM', category: 'Main Market' },
  { name: 'New faridabad', time: '07:15 PM', category: 'Main Market' },
  { name: 'Gaziabad', time: '09:30 PM', category: 'Main Market' },
  { name: 'New gaziabad', time: '09:45 PM', category: 'Main Market' },
  { name: 'Gali', time: '11:30 PM', category: 'Main Market' }
];

export function openPresetsDrawer() {
  const drawer = document.getElementById('market-presets-drawer');
  const searchInput = document.getElementById('preset-search-input');
  if (!drawer) return;

  drawer.classList.remove('hidden');
  renderPresetMarketsList();

  if (searchInput) {
    searchInput.value = '';
    setTimeout(() => searchInput.focus(), 150);
  }
}

export function closePresetsDrawer() {
  const drawer = document.getElementById('market-presets-drawer');
  if (drawer) {
    drawer.classList.add('hidden');
  }
}

function selectPresetMarket(market) {
  const nameInput = document.getElementById('market-name-input');
  const timeInput = document.getElementById('market-time-input');

  if (nameInput) {
    nameInput.value = market.name;
    nameInput.classList.add('ring-2', 'ring-amber-500');
    setTimeout(() => nameInput.classList.remove('ring-2', 'ring-amber-500'), 1000);
  }

  if (timeInput) {
    timeInput.value = market.time;
    timeInput.classList.add('ring-2', 'ring-amber-500');
    setTimeout(() => timeInput.classList.remove('ring-2', 'ring-amber-500'), 1000);
  }

  closePresetsDrawer();
  notify(`Selected market: ${market.name} (${market.time})`, 'success');
}

function renderPresetMarketsList(query = '') {
  const container = document.getElementById('presets-list-container');
  if (!container) return;

  container.innerHTML = '';

  const filtered = PRESET_MARKETS.filter(m => {
    const q = query.toLowerCase().trim();
    if (!q) return true;
    return m.name.toLowerCase().includes(q) || m.time.toLowerCase().includes(q) || (m.category && m.category.toLowerCase().includes(q));
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-slate-400">
        <p class="text-2xl mb-1">🔍</p>
        <p class="text-xs font-semibold">No matching markets found</p>
      </div>
    `;
    return;
  }

  filtered.forEach(market => {
    const card = document.createElement('div');
    card.className = 'group p-3 bg-slate-50 hover:bg-amber-50 border border-slate-200 hover:border-amber-400 rounded-xl transition-all cursor-pointer flex items-center justify-between shadow-2xs active:scale-[0.98]';
    card.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-amber-100 group-hover:bg-amber-400 text-amber-900 group-hover:text-black font-black flex items-center justify-center text-sm transition-colors shadow-2xs shrink-0">
          ${market.name.charAt(0)}
        </div>
        <div>
          <div class="flex items-center gap-1.5">
            <h4 class="font-extrabold text-slate-900 group-hover:text-amber-950 text-sm">
              ${escapeHtml(market.name)}
            </h4>
            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 group-hover:bg-amber-200 text-slate-700 group-hover:text-amber-900">
              ${escapeHtml(market.category || 'Preset')}
            </span>
          </div>
          <div class="text-xs text-slate-500 font-semibold flex items-center gap-1 mt-0.5">
            <span>⏰ Draw Time:</span>
            <span class="text-amber-700 font-bold font-mono">${escapeHtml(market.time)}</span>
          </div>
        </div>
      </div>
      <button 
        type="button"
        class="bg-amber-500 hover:bg-amber-600 text-slate-950 font-black px-3 py-1.5 rounded-lg text-xs uppercase transition-transform group-hover:scale-105 cursor-pointer shadow-2xs"
      >
        Select
      </button>
    `;

    card.addEventListener('click', () => {
      selectPresetMarket(market);
    });

    container.appendChild(card);
  });
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
