import { createClient } from '@supabase/supabase-js';
import { getAppConfig } from './config.js';

// Default initial demo seed data if Supabase database is not connected yet
const SEED_MARKETS = [
  {
    id: 'm-1',
    market_name: 'Disawer',
    today_number: 'XX',
    yesterday_number: 'XX',
    draw_time: '05:15 AM',
    record_chart_url: '#',
    status: 'Active',
    is_highlighted: true,
    last_shifted_date: '',
    created_at: new Date(Date.now() - 80000).toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: 'm-2',
    market_name: 'Dehli Noon',
    today_number: 'XX',
    yesterday_number: 'XX',
    draw_time: '03:15 PM',
    record_chart_url: '#',
    status: 'Active',
    is_highlighted: false,
    last_shifted_date: '',
    created_at: new Date(Date.now() - 70000).toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: 'm-3',
    market_name: 'Punjab Day',
    today_number: 'XX',
    yesterday_number: 'XX',
    draw_time: '05:15 PM',
    record_chart_url: '#',
    status: 'Active',
    is_highlighted: false,
    last_shifted_date: '',
    created_at: new Date(Date.now() - 60000).toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: 'm-4',
    market_name: 'Faridabad',
    today_number: 'XX',
    yesterday_number: 'XX',
    draw_time: '06:15 PM',
    record_chart_url: '#',
    status: 'Active',
    is_highlighted: true,
    last_shifted_date: '',
    created_at: new Date(Date.now() - 50000).toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: 'm-5',
    market_name: 'New faridabad',
    today_number: 'XX',
    yesterday_number: 'XX',
    draw_time: '07:15 PM',
    record_chart_url: '#',
    status: 'Active',
    is_highlighted: false,
    last_shifted_date: '',
    created_at: new Date(Date.now() - 40000).toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: 'm-6',
    market_name: 'Gaziabad',
    today_number: 'XX',
    yesterday_number: 'XX',
    draw_time: '09:30 PM',
    record_chart_url: '#',
    status: 'Active',
    is_highlighted: true,
    last_shifted_date: '',
    created_at: new Date(Date.now() - 30000).toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: 'm-7',
    market_name: 'New gaziabad',
    today_number: 'XX',
    yesterday_number: 'XX',
    draw_time: '09:45 PM',
    record_chart_url: '#',
    status: 'Active',
    is_highlighted: false,
    last_shifted_date: '',
    created_at: new Date(Date.now() - 20000).toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: 'm-8',
    market_name: 'Gali',
    today_number: 'XX',
    yesterday_number: 'XX',
    draw_time: '11:30 PM',
    record_chart_url: '#',
    status: 'Active',
    is_highlighted: true,
    last_shifted_date: '',
    created_at: new Date(Date.now() - 10000).toISOString(),
    updated_at: new Date().toISOString()
  }
];

let supabaseClient = null;
let realtimeChannel = null;
let realtimeCallbacks = [];
let currentServerStatus = 'online'; // 'online' | 'reconnecting' | 'offline'
let serverStatusListeners = [];

export function getCurServerStatus() {
  return currentServerStatus;
}

export function setServerStatus(status) {
  if (currentServerStatus !== status) {
    currentServerStatus = status;
    serverStatusListeners.forEach(cb => {
      try { cb(status); } catch (e) { console.error('Status listener error:', e); }
    });
  }
}

export function onServerStatusChange(callback) {
  if (typeof callback === 'function') {
    serverStatusListeners.push(callback);
    callback(currentServerStatus);
  }
  return () => {
    serverStatusListeners = serverStatusListeners.filter(cb => cb !== callback);
  };
}

// Local storage keys
const LOCAL_STORAGE_KEY = 'satta_king_results_db';
const LOCAL_CONFIG_KEY = 'satta_king_custom_config';

// Broadcast Channel for multi-tab real-time sync when offline / unconfigured
let broadcastChannel = null;
try {
  if (typeof BroadcastChannel !== 'undefined') {
    broadcastChannel = new BroadcastChannel('satta_king_realtime');
    broadcastChannel.onmessage = (event) => {
      if (event.data && event.data.type === 'DATA_CHANGED') {
        notifyRealtimeListeners({ eventType: event.data.action, record: event.data.record });
      }
    };
  }
} catch (e) {
  console.warn('BroadcastChannel not supported:', e);
}

/**
 * Helper to sanitize Supabase URL and remove trailing paths or slashes that cause PostgREST PGRST125 errors
 */
export function sanitizeSupabaseUrl(url) {
  if (!url) return '';
  let cleaned = String(url).trim();
  // Strip enclosing quotes
  cleaned = cleaned.replace(/^["']|["']$/g, '').trim();

  if (cleaned.includes('.supabase.co')) {
    const match = cleaned.match(/https?:\/\/[a-zA-Z0-9_-]+\.supabase\.co/i);
    if (match) {
      return match[0];
    }
  }

  // Remove trailing path suffixes like /rest/v1 or /results or trailing slashes
  cleaned = cleaned.replace(/\/rest\/v1.*$/i, '');
  cleaned = cleaned.replace(/\/results.*$/i, '');
  cleaned = cleaned.replace(/\/+$/, '');

  return cleaned;
}

// Get effective configuration (merged from config.js and localStorage settings)
export function getEffectiveConfig() {
  const fileConfig = getAppConfig();
  const savedConfigStr = localStorage.getItem(LOCAL_CONFIG_KEY);
  let savedConfig = {};
  if (savedConfigStr) {
    try {
      savedConfig = JSON.parse(savedConfigStr);
    } catch (err) {
      console.error('Failed to parse saved config:', err);
    }
  }

  const rawUrl = savedConfig.SUPABASE_URL || fileConfig.SUPABASE_URL || '';
  const rawKey = savedConfig.SUPABASE_ANON_KEY || fileConfig.SUPABASE_ANON_KEY || '';

  return {
    SUPABASE_URL: sanitizeSupabaseUrl(rawUrl),
    SUPABASE_ANON_KEY: String(rawKey).trim().replace(/^["']|["']$/g, ''),
    ADMIN_PASSWORD: savedConfig.ADMIN_PASSWORD || fileConfig.ADMIN_PASSWORD || '11092013'
  };
}

// Check if Supabase credentials are setup
export function isSupabaseConfigured() {
  const cfg = getEffectiveConfig();
  return Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && cfg.SUPABASE_URL.startsWith('http'));
}

// Save custom credentials to browser storage
export function saveCustomConfig(url, key, password) {
  const current = getEffectiveConfig();
  const updated = {
    SUPABASE_URL: url ? sanitizeSupabaseUrl(url) : current.SUPABASE_URL,
    SUPABASE_ANON_KEY: key ? key.trim().replace(/^["']|["']$/g, '') : current.SUPABASE_ANON_KEY,
    ADMIN_PASSWORD: password ? password.trim() : current.ADMIN_PASSWORD
  };
  localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(updated));
  // Reset client so it reconnects
  supabaseClient = null;
  initSupabaseClient();
  return updated;
}

// Initialize Supabase client
export function initSupabaseClient() {
  const cfg = getEffectiveConfig();
  console.log('[Supabase Init] Attempting connection...');
  console.log('[Supabase Init] URL:', cfg.SUPABASE_URL || '(Empty)');
  console.log('[Supabase Init] Anon Key (Length):', cfg.SUPABASE_ANON_KEY ? cfg.SUPABASE_ANON_KEY.length : 0);

  if (isSupabaseConfigured()) {
    try {
      supabaseClient = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
      console.log('[Supabase Init] Client created successfully');
      setupSupabaseRealtime();
      return supabaseClient;
    } catch (err) {
      console.error('[Supabase Init] Failed to initialize Supabase client:', err);
      supabaseClient = null;
    }
  } else {
    console.warn('[Supabase Init] Supabase credentials not configured or invalid URL.');
  }
  return null;
}

/**
 * Get active Supabase client instance
 */
export function getSupabaseClient() {
  if (!supabaseClient) {
    initSupabaseClient();
  }
  return supabaseClient;
}

// Subscribe to Supabase Realtime channel
function setupSupabaseRealtime() {
  if (!supabaseClient) return;

  if (realtimeChannel) {
    try {
      supabaseClient.removeChannel(realtimeChannel);
    } catch (e) {
      // ignore
    }
  }

  try {
    realtimeChannel = supabaseClient
      .channel('public:db_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'all_results' },
        (payload) => {
          console.log('⚡ Supabase Realtime Change received for all_results:', payload);
          notifyRealtimeListeners({
            eventType: payload.eventType, // INSERT, UPDATE, DELETE
            record: payload.new || payload.old,
            table: 'all_results'
          });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'results' },
        (payload) => {
          console.log('⚡ Supabase Realtime Change received for results:', payload);
          notifyRealtimeListeners({
            eventType: payload.eventType, // INSERT, UPDATE, DELETE
            record: payload.new || payload.old,
            table: 'results'
          });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'daily_results' },
        (payload) => {
          console.log('⚡ Supabase Realtime Change received for daily_results:', payload);
          notifyRealtimeListeners({
            eventType: payload.eventType, // INSERT, UPDATE, DELETE
            record: payload.new || payload.old,
            table: 'daily_results'
          });
        }
      )
      .subscribe((status) => {
        console.log('Supabase Realtime subscription status:', status);
        if (status === 'SUBSCRIBED') {
          setServerStatus('online');
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          setServerStatus(navigator.onLine ? 'reconnecting' : 'offline');
        } else if (status === 'TIMED_OUT') {
          setServerStatus('reconnecting');
        }
      });
  } catch (err) {
    console.warn('Realtime channel setup warning:', err);
  }
}

// Register realtime callback listener
export function onRealtimeChange(callback) {
  if (typeof callback === 'function') {
    realtimeCallbacks.push(callback);
  }
  return () => {
    realtimeCallbacks = realtimeCallbacks.filter(cb => cb !== callback);
  };
}

function notifyRealtimeListeners(payload) {
  realtimeCallbacks.forEach(cb => {
    try {
      cb(payload);
    } catch (err) {
      console.error('Error in realtime listener:', err);
    }
  });
}

// Seed local storage if empty or outdated
function getLocalData() {
  const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (!raw) {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(SEED_MARKETS));
    return SEED_MARKETS;
  }
  try {
    const parsed = JSON.parse(raw);
    // If local data has old legacy seed markets (e.g., Shalimar or old list length), refresh with new defaults
    if (Array.isArray(parsed)) {
      const hasOldMarket = parsed.some(m => ['Shalimar', 'Jaisalmer', 'Nepal', 'Noida King'].includes(m.market_name));
      if (hasOldMarket) {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(SEED_MARKETS));
        return SEED_MARKETS;
      }
      return parsed;
    }
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(SEED_MARKETS));
    return SEED_MARKETS;
  } catch (e) {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(SEED_MARKETS));
    return SEED_MARKETS;
  }
}

function setLocalData(data) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
}

/**
 * Helper to ensure date values sent to Supabase are valid YYYY-MM-DD or null (never empty string "")
 */
export function formatShiftedDate(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '' || trimmed === 'null' || trimmed === 'undefined') return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
  }
  return null;
}

/**
 * Helper to convert inputs ("XX", "", undefined, null, non-numeric) to null,
 * or return the raw result string preserving leading zeros (e.g. "09", "00", "25", "60").
 * Strictly does NOT use parseInt, Number, or parseFloat.
 */
export function toNumericOrNull(val) {
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  if (str === '' || str.toUpperCase() === 'XX' || str.toLowerCase() === 'null' || str.toLowerCase() === 'undefined') {
    return null;
  }
  return str;
}

/**
 * Extract raw result string preserving exact text representation (e.g. "00", "09", "60").
 * Strictly avoids Number(), parseInt(), parseFloat().
 */
export function extractResultString(val) {
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  if (str === '' || str.toUpperCase() === 'XX' || str.toLowerCase() === 'null' || str.toLowerCase() === 'undefined' || str === '--') {
    return null;
  }
  return str;
}

/**
 * Extract clean YYYY-MM-DD date string without timezone conversions that could shift the calendar date.
 */
export function extractIsoDate(rawDate) {
  if (!rawDate) return null;
  const str = String(rawDate).trim();
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }
  return str;
}

/**
 * Format a DB date (2026-08-10) to DD-MM-YYYY (10-08-2026)
 */
export function formatDbDateToDisplay(dateIso) {
  if (!dateIso) return '';
  const cleanIso = extractIsoDate(dateIso) || String(dateIso).substring(0, 10);
  const parts = cleanIso.split('-');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return dateIso;
}

/**
 * Helper to format Today's number (returns 'XX' if null or unavailable).
 * Preserves two-digit strings like "09", "00", "05", "25", "99", "60".
 */
export function formatTodayDisplayNumber(val) {
  if (val === null || val === undefined) return 'XX';
  const str = String(val).trim();
  if (str === '' || str.toUpperCase() === 'XX' || str.toLowerCase() === 'null' || str.toLowerCase() === 'undefined') {
    return 'XX';
  }
  return str;
}

/**
 * Helper to format Yesterday's number (returns '--' if null or unavailable).
 * Preserves two-digit strings like "09", "00", "05", "25", "99", "60".
 */
export function formatYesterdayDisplayNumber(val) {
  if (val === null || val === undefined) return '--';
  const str = String(val).trim();
  if (str === '' || str === '--' || str.toUpperCase() === 'XX' || str.toLowerCase() === 'null' || str.toLowerCase() === 'undefined') {
    return '--';
  }
  return str;
}

/**
 * Helper to format DB values or null/XX for display on website/admin.
 */
export function formatDisplayNumber(val) {
  return formatTodayDisplayNumber(val);
}

/**
 * Helper to normalize market object fields
 */
function normalizeMarketRecord(record) {
  if (!record) return record;
  const rawToday = record.today_number !== undefined && record.today_number !== null ? record.today_number : record.first_number;
  const rawYesterday = record.yesterday_number !== undefined && record.yesterday_number !== null ? record.yesterday_number : record.second_number;

  const todayVal = formatTodayDisplayNumber(rawToday);
  const yesterdayVal = formatYesterdayDisplayNumber(rawYesterday);
  const normDate = formatShiftedDate(record.last_shifted_date);

  return {
    ...record,
    today_number: todayVal,
    yesterday_number: yesterdayVal,
    first_number: todayVal,
    second_number: yesterdayVal,
    last_shifted_date: normDate || ''
  };
}

/**
 * Fetch all markets from Supabase (or Local DB fallback if unconfigured)
 */
export async function fetchMarkets() {
  if (isSupabaseConfigured()) {
    if (!supabaseClient) initSupabaseClient();
    if (supabaseClient) {
      try {
        console.log('[Supabase Fetch] Querying "results" table...');
        const { data, error, status, statusText } = await supabaseClient
          .from('results')
          .select('*')
          .order('draw_time', { ascending: true });

        console.log('[Supabase Fetch] HTTP Status:', status, statusText);

        if (error) {
          console.error('[Supabase Fetch Error Response]:', error);
          console.error('Full Supabase Fetch Error Message:', error.message, '| Code:', error.code, '| Details:', error.details, '| Hint:', error.hint);
          setServerStatus(navigator.onLine ? 'reconnecting' : 'offline');
        } else if (data) {
          console.log('[Supabase Fetch Success Response]: Retrieved', data.length, 'records');
          setServerStatus('online');
          return data.map(normalizeMarketRecord);
        }
      } catch (err) {
        console.error('[Supabase Fetch Exception]:', err);
        setServerStatus(navigator.onLine ? 'reconnecting' : 'offline');
      }
    }
  } else {
    console.warn('[Supabase Fetch] Supabase not configured, returning local storage records.');
  }

  // Fallback to local storage data only if unconfigured
  const localList = getLocalData();
  return localList.map(normalizeMarketRecord);
}

async function syncMarketToDailyHistory(marketName, todayNum, yesterdayNum) {
  if (!marketName) return;
  const todayIso = getTodayIsoDateStr();
  
  if (todayNum !== null && todayNum !== undefined) {
    const numStr = formatDisplayNumber(todayNum);
    if (numStr && numStr !== 'XX') {
      await saveDailyResultRecord(marketName, todayIso, numStr);
    }
  }
  
  if (yesterdayNum !== null && yesterdayNum !== undefined) {
    const numStr = formatDisplayNumber(yesterdayNum);
    if (numStr && numStr !== '--' && numStr !== 'XX') {
      const todayDateObj = new Date(todayIso + 'T00:00:00');
      todayDateObj.setDate(todayDateObj.getDate() - 1);
      const yyyy = todayDateObj.getFullYear();
      const mm = String(todayDateObj.getMonth() + 1).padStart(2, '0');
      const dd = String(todayDateObj.getDate()).padStart(2, '0');
      const prevIstDateStr = `${yyyy}-${mm}-${dd}`;
      await saveDailyResultRecord(marketName, prevIstDateStr, numStr);
    }
  }
}

/**
 * Add a new market
 */
export async function addMarket(market) {
  const rawToday = market.today_number !== undefined ? market.today_number : market.first_number;
  const rawYesterday = market.yesterday_number !== undefined ? market.yesterday_number : market.second_number;

  const todayNum = toNumericOrNull(rawToday);
  const yesterdayNum = toNumericOrNull(rawYesterday);
  const formattedDate = formatShiftedDate(market.last_shifted_date);

  if (!isSupabaseConfigured()) {
    const errorMsg = 'Supabase is not configured. Please enter a valid SUPABASE_URL and SUPABASE_ANON_KEY in settings.';
    console.error('[Supabase Add Error]', errorMsg);
    throw new Error(errorMsg);
  }

  if (!supabaseClient) {
    initSupabaseClient();
  }

  if (!supabaseClient) {
    const errorMsg = 'Failed to initialize Supabase client. Please check your configuration.';
    console.error('[Supabase Add Error]', errorMsg);
    throw new Error(errorMsg);
  }

  // Exact column names for Supabase "results" table.
  // Send NULL instead of "XX" for numeric columns when number is unavailable.
  const payload = {
    market_name: market.market_name.trim(),
    today_number: todayNum,
    yesterday_number: yesterdayNum,
    first_number: todayNum,
    second_number: yesterdayNum,
    draw_time: market.draw_time ? String(market.draw_time).trim() : '12:00 PM',
    record_chart_url: market.record_chart_url ? String(market.record_chart_url).trim() : '#',
    status: market.status || 'Active',
    is_highlighted: Boolean(market.is_highlighted),
    last_shifted_date: formattedDate // null if empty string, YYYY-MM-DD string otherwise
  };

  // Requirement 4: Log object being sent to Supabase before inserting
  console.log('Sending insert payload to Supabase "results" table:', payload);

  // Requirement 5: Log HTTP status, success response, error response, full error message
  const { data, error, status, statusText } = await supabaseClient
    .from('results')
    .insert([payload])
    .select();

  console.log('Supabase Insert Response HTTP Status:', status, statusText);

  if (error) {
    console.error('Supabase Insert Error Response:', error);
    console.error('Full Supabase Error Message:', error.message, '| Code:', error.code, '| Details:', error.details, '| Hint:', error.hint);

    // If column mismatch error (e.g. schema doesn't have today_number or last_shifted_date), attempt fallback insert
    if (error.message && (error.message.includes('column') || error.code === 'PGRST204')) {
      console.warn('Attempting insert with legacy column set...');
      const fallbackPayload = {
        market_name: payload.market_name,
        first_number: payload.first_number,
        second_number: payload.second_number,
        draw_time: payload.draw_time,
        record_chart_url: payload.record_chart_url,
        status: payload.status,
        is_highlighted: payload.is_highlighted
      };

      console.log('Sending fallback insert payload to Supabase "results" table:', fallbackPayload);
      const fallbackRes = await supabaseClient
        .from('results')
        .insert([fallbackPayload])
        .select();

      console.log('Fallback Supabase Insert Response Status:', fallbackRes.status, fallbackRes.statusText);

      if (!fallbackRes.error && fallbackRes.data && fallbackRes.data[0]) {
        console.log('Fallback Supabase Insert Success Response:', fallbackRes.data);
        return normalizeMarketRecord(fallbackRes.data[0]);
      } else if (fallbackRes.error) {
        console.error('Fallback Supabase Insert Error Response:', fallbackRes.error);
        console.error('Full Fallback Supabase Error Message:', fallbackRes.error.message, '| Code:', fallbackRes.error.code, '| Details:', fallbackRes.error.details, '| Hint:', fallbackRes.error.hint);
      }
    }

    // Construct full detailed error message (Requirement 6 & 9)
    const errDetails = [
      error.message,
      error.details ? `Details: ${error.details}` : '',
      error.hint ? `Hint: ${error.hint}` : '',
      error.code ? `(Code: ${error.code}, Status: ${status})` : ''
    ].filter(Boolean).join(' ');

    const fullErrorStr = `Supabase Insert Failed: ${errDetails}`;
    console.error(fullErrorStr);
    throw new Error(fullErrorStr);
  }

  if (data && data[0]) {
    console.log('Supabase Insert Success Response:', data);
    const rec = normalizeMarketRecord(data[0]);
    syncMarketToDailyHistory(rec.market_name, todayNum, yesterdayNum).catch(e => console.warn('Sync daily history failed:', e));
    return rec;
  }

  const noDataErr = `Supabase Insert completed with status ${status}, but returned no rows. Please check table Row Level Security (RLS) policies in Supabase.`;
  console.error(noDataErr);
  throw new Error(noDataErr);
}

/**
 * Update an existing market
 */
export async function updateMarket(id, market) {
  const rawToday = market.today_number !== undefined ? market.today_number : market.first_number;
  const rawYesterday = market.yesterday_number !== undefined ? market.yesterday_number : market.second_number;

  const todayNum = toNumericOrNull(rawToday);
  const yesterdayNum = toNumericOrNull(rawYesterday);
  const formattedDate = formatShiftedDate(market.last_shifted_date);

  if (!isSupabaseConfigured()) {
    const errorMsg = 'Supabase is not configured. Please enter a valid SUPABASE_URL and SUPABASE_ANON_KEY in settings.';
    console.error('[Supabase Update Error]', errorMsg);
    throw new Error(errorMsg);
  }

  if (!supabaseClient) {
    initSupabaseClient();
  }

  if (!supabaseClient) {
    const errorMsg = 'Failed to initialize Supabase client.';
    console.error('[Supabase Update Error]', errorMsg);
    throw new Error(errorMsg);
  }

  const payload = {
    market_name: market.market_name.trim(),
    today_number: todayNum,
    yesterday_number: yesterdayNum,
    first_number: todayNum,
    second_number: yesterdayNum,
    draw_time: market.draw_time ? String(market.draw_time).trim() : '12:00 PM',
    record_chart_url: market.record_chart_url ? String(market.record_chart_url).trim() : '#',
    status: market.status || 'Active',
    is_highlighted: Boolean(market.is_highlighted),
    last_shifted_date: formattedDate,
    updated_at: new Date().toISOString()
  };

  console.log('Sending update payload to Supabase "results" table for ID:', id, payload);

  const { data, error, status, statusText } = await supabaseClient
    .from('results')
    .update(payload)
    .eq('id', id)
    .select();

  console.log('Supabase Update Response HTTP Status:', status, statusText);

  if (error) {
    console.error('Supabase Update Error Response:', error);
    console.error('Full Supabase Error Message:', error.message, '| Code:', error.code, '| Details:', error.details, '| Hint:', error.hint);

    if (error.message && (error.message.includes('column') || error.code === 'PGRST204')) {
      const fallbackPayload = {
        market_name: payload.market_name,
        first_number: payload.first_number,
        second_number: payload.second_number,
        draw_time: payload.draw_time,
        record_chart_url: payload.record_chart_url,
        status: payload.status,
        is_highlighted: payload.is_highlighted,
        updated_at: payload.updated_at
      };

      console.log('Sending fallback update payload:', fallbackPayload);
      const fallbackRes = await supabaseClient
        .from('results')
        .update(fallbackPayload)
        .eq('id', id)
        .select();

      if (!fallbackRes.error && fallbackRes.data && fallbackRes.data[0]) {
        console.log('Fallback Supabase Update Success Response:', fallbackRes.data);
        return normalizeMarketRecord(fallbackRes.data[0]);
      }
    }

    const errDetails = [
      error.message,
      error.details ? `Details: ${error.details}` : '',
      error.hint ? `Hint: ${error.hint}` : '',
      error.code ? `(Code: ${error.code}, Status: ${status})` : ''
    ].filter(Boolean).join(' ');

    const fullErrorStr = `Supabase Update Failed: ${errDetails}`;
    console.error(fullErrorStr);
    throw new Error(fullErrorStr);
  }

  if (data && data[0]) {
    console.log('Supabase Update Success Response:', data);
    const rec = normalizeMarketRecord(data[0]);
    syncMarketToDailyHistory(rec.market_name, todayNum, yesterdayNum).catch(e => console.warn('Sync daily history failed:', e));
    return rec;
  }

  const noDataErr = `Supabase Update completed with status ${status}, but updated 0 rows. Check if record ID '${id}' exists in database.`;
  console.error(noDataErr);
  throw new Error(noDataErr);
}

/**
 * Delete a market
 */
export async function deleteMarket(id) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured. Please enter SUPABASE_URL and SUPABASE_ANON_KEY in settings.');
  }

  if (!supabaseClient) {
    initSupabaseClient();
  }

  if (!supabaseClient) {
    throw new Error('Failed to initialize Supabase client.');
  }

  console.log('Deleting record from Supabase "results" table for ID:', id);

  const { error, status, statusText } = await supabaseClient
    .from('results')
    .delete()
    .eq('id', id);

  console.log('Supabase Delete Response HTTP Status:', status, statusText);

  if (error) {
    console.error('Supabase Delete Error Response:', error);
    console.error('Full Supabase Error Message:', error.message, '| Code:', error.code, '| Details:', error.details, '| Hint:', error.hint);
    throw new Error(`Supabase Delete Failed: ${error.message} (Code: ${error.code})`);
  }

  console.log('Supabase Delete Success for ID:', id);
  return true;
}

// Local Storage key for daily results history
const LOCAL_HISTORY_KEY = 'satta_king_daily_history_db';

/**
 * Get current date string (YYYY-MM-DD) in India Standard Time (IST / Asia-Kolkata)
 */
export function getTodayIsoDateStr() {
  const now = new Date();
  const formatterDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatterDate.format(now); // Produces "YYYY-MM-DD"
}

/**
 * Get yesterday's date string (YYYY-MM-DD) in India Standard Time
 */
export function getYesterdayIsoDateStr() {
  const todayIso = getTodayIsoDateStr();
  const d = new Date(todayIso + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Calculate the previous calendar date string (YYYY-MM-DD) for a given dateIso
 */
export function getPreviousIsoDateStr(dateIso) {
  if (!dateIso || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return dateIso;
  const [y, m, d] = dateIso.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  dateObj.setDate(dateObj.getDate() - 1);
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Fetch results for all markets on a specific date (YYYY-MM-DD) from Supabase public.all_results table
 */
export async function fetchDailyResultsForDate(dateIso) {
  const normDate = extractIsoDate(dateIso) || formatShiftedDate(dateIso) || dateIso;
  const resultMap = new Map();

  if (!normDate) return resultMap;

  // 1. Query Supabase public.all_results table for exact result_date
  if (isSupabaseConfigured()) {
    if (!supabaseClient) initSupabaseClient();
    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient
          .from('all_results')
          .select('*')
          .eq('result_date', normDate);

        if (!error && data && Array.isArray(data)) {
          data.forEach(item => {
            const rawRes = (item.result !== undefined && item.result !== null) ? item.result : item.result_number;
            const resStr = extractResultString(rawRes);
            if (item.market_name && resStr) {
              resultMap.set(item.market_name, resStr);
            }
          });
        } else if (error) {
          console.warn(`[Supabase all_results Query Error for ${normDate}]:`, error.message);
          // Graceful fallback to daily_results if all_results returned an error
          try {
            const fbRes = await supabaseClient
              .from('daily_results')
              .select('market_name, result_date, result_number')
              .eq('result_date', normDate);
            if (!fbRes.error && fbRes.data && Array.isArray(fbRes.data)) {
              fbRes.data.forEach(item => {
                const resStr = extractResultString(item.result_number);
                if (item.market_name && resStr && !resultMap.has(item.market_name)) {
                  resultMap.set(item.market_name, resStr);
                }
              });
            }
          } catch (e) {
            // ignore
          }
        }
      } catch (err) {
        console.warn(`[Supabase all_results Query Exception for ${normDate}]:`, err);
      }
    }
  }

  // 2. Merge local storage history if available
  try {
    const rawLocal = localStorage.getItem(LOCAL_HISTORY_KEY);
    if (rawLocal) {
      const localList = JSON.parse(rawLocal);
      if (Array.isArray(localList)) {
        localList.forEach(item => {
          const itemNormDate = extractIsoDate(item.result_date) || item.result_date;
          if (itemNormDate === normDate && item.market_name) {
            const rawRes = (item.result !== undefined && item.result !== null) ? item.result : item.result_number;
            const resStr = extractResultString(rawRes);
            if (resStr && !resultMap.has(item.market_name)) {
              resultMap.set(item.market_name, resStr);
            }
          }
        });
      }
    }
  } catch (e) {
    console.warn('Failed to parse local history for date:', e);
  }

  return resultMap;
}

/**
 * Get detailed date and time info in IST (Asia/Kolkata)
 */
export function getISTDateTime() {
  const now = new Date();
  // IST is UTC + 5 hours 30 minutes
  const istOffsetMs = (5 * 60 + 30) * 60 * 1000;
  const istDateObj = new Date(now.getTime() + istOffsetMs);

  const yyyy = istDateObj.getUTCFullYear();
  const mm = String(istDateObj.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(istDateObj.getUTCDate()).padStart(2, '0');
  const istDateStr = `${yyyy}-${mm}-${dd}`;

  const hour = istDateObj.getUTCHours();
  const minute = istDateObj.getUTCMinutes();
  const istMinutes = hour * 60 + minute;

  return { istDateStr, hour, minute, istMinutes };
}

/**
 * Trigger stored procedure / RPC perform_daily_market_shift on Supabase if connected
 */
export async function triggerDailyShiftRPC() {
  if (isSupabaseConfigured()) {
    if (!supabaseClient) initSupabaseClient();
    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient.rpc('perform_daily_market_shift');
        if (!error && data) {
          console.log('⚡ [Supabase RPC Shift Success]:', data);
          return data;
        } else if (error) {
          console.warn('[Supabase RPC Shift Notice]: Stored procedure not invoked or not created yet:', error.message);
        }
      } catch (err) {
        console.warn('[Supabase RPC Shift Exception]:', err);
      }
    }
  }
  return null;
}

/**
 * Execute IST-based Today's -> Yesterday's Automatic Shift
 * Timing Rules:
 * 1. Normal Markets: 12:00 AM IST (00:00)
 * 2. Gali: 12:20 AM IST (00:20)
 * 3. Disawer: 12:21 AM IST (00:21)
 * Safe: Reads today_number, copies to yesterday_number, sets today_number to NULL.
 * Idempotent: Stores last_shifted_date (IST date YYYY-MM-DD), runs only once per day.
 */
export async function executeAutoShiftIST(allMarkets) {
  if (!allMarkets || !Array.isArray(allMarkets) || allMarkets.length === 0) return false;

  // First try running database RPC on Supabase server side
  await triggerDailyShiftRPC();

  const { istDateStr, istMinutes } = getISTDateTime();
  let updatedAny = false;

  // Calculate previous date string (yesterday in IST relative to istDateStr)
  const todayDateObj = new Date(istDateStr + 'T00:00:00');
  todayDateObj.setDate(todayDateObj.getDate() - 1);
  const yyyy = todayDateObj.getFullYear();
  const mm = String(todayDateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(todayDateObj.getDate()).padStart(2, '0');
  const prevIstDateStr = `${yyyy}-${mm}-${dd}`;

  for (const market of allMarkets) {
    const nameLower = (market.market_name || '').toLowerCase();
    const isGali = nameLower.includes('gali');
    const isDisawer = nameLower.includes('disawer') || nameLower.includes('desawar') || nameLower.includes('deshawar');

    let targetShiftMinutes = 0; // 12:00 AM IST for Normal markets
    if (isGali) {
      targetShiftMinutes = 20; // 12:20 AM IST
    } else if (isDisawer) {
      targetShiftMinutes = 21; // 12:21 AM IST
    }

    const lastShifted = formatShiftedDate(market.last_shifted_date);

    // If current IST time is past/at target shift time AND market hasn't been shifted for today's IST date yet
    if (istMinutes >= targetShiftMinutes && lastShifted !== istDateStr) {
      const rawToday = market.today_number !== undefined ? market.today_number : market.first_number;
      const rawYesterday = market.yesterday_number !== undefined ? market.yesterday_number : market.second_number;

      const numToday = toNumericOrNull(rawToday);
      const numYesterday = toNumericOrNull(rawYesterday);

      // SAFETY RULE: Read today_number. Copy today's number into yesterday_number. Set today's number to NULL.
      // If today's result was available (numToday !== null), yesterday becomes today's result.
      // If today's result was unavailable (NULL), yesterday remains existing yesterday number.
      const newYesterdayNum = (numToday !== null) ? numToday : numYesterday;

      // Save today's result into record chart history (daily_results) for yesterday's date if it existed
      if (numToday !== null) {
        await saveDailyResultRecord(market.market_name, prevIstDateStr, numToday);
      }

      const updatedMarket = {
        ...market,
        yesterday_number: newYesterdayNum,
        second_number: newYesterdayNum,
        today_number: null,
        first_number: null,
        last_shifted_date: istDateStr
      };

      try {
        await updateMarket(market.id, updatedMarket);
        updatedAny = true;
        console.log(`[IST Shift Executed] ${market.market_name}: Yesterday = ${newYesterdayNum}, Today = NULL, ShiftDate = ${istDateStr}`);
      } catch (err) {
        console.error(`[IST Shift Failed] ${market.market_name}:`, err);
      }
    }
  }

  return updatedAny;
}

/**
 * Fetch all historical records from Supabase public.all_results table
 */
export async function fetchAllResults() {
  if (isSupabaseConfigured()) {
    if (!supabaseClient) initSupabaseClient();
    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient
          .from('all_results')
          .select('*')
          .order('result_date', { ascending: false });

        console.log('ALL RESULTS FROM SUPABASE:', data);
        console.log('ALL RESULTS ERROR:', error);

        if (error) {
          console.error('ALL_RESULTS READ ERROR:', error);
        } else if (data && Array.isArray(data)) {
          return data;
        }
      } catch (err) {
        console.error('ALL_RESULTS READ ERROR:', err);
      }
    }
  }

  // Fallback to local storage history
  try {
    const rawLocal = localStorage.getItem(LOCAL_HISTORY_KEY);
    if (rawLocal) {
      const localList = JSON.parse(rawLocal);
      if (Array.isArray(localList)) {
        return localList;
      }
    }
  } catch (e) {
    console.warn('Failed to parse local history:', e);
  }

  return [];
}

/**
 * Fetch full historical records for a market and month (YYYY-MM or "ALL") from Supabase public.all_results table
 * Loads complete history, preserving exact text format (e.g., "00", "09", "60") and exact dates without timezone conversion.
 */
export async function fetchMarketHistory(marketName, yearMonth = 'ALL', marketId = null) {
  const historyMap = new Map();

  if (!yearMonth) {
    yearMonth = 'ALL';
  }

  // 1. Fetch from Supabase public.all_results table
  if (isSupabaseConfigured()) {
    if (!supabaseClient) initSupabaseClient();
    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient
          .from('all_results')
          .select('*')
          .order('result_date', { ascending: false });

        console.log('ALL RESULTS FROM SUPABASE:', data);
        console.log('ALL RESULTS ERROR:', error);

        if (error) {
          console.error('ALL_RESULTS READ ERROR:', error);
        } else if (data && Array.isArray(data)) {
          const marketHistory = data
            .filter(row => {
              if (!row) return false;
              // Primary key match: market.id === row.market_id
              const idMatch = (marketId !== null && marketId !== undefined && row.market_id !== null && row.market_id !== undefined && String(row.market_id) === String(marketId));
              // Fallback match by market_name if market_id is null/missing
              const nameMatch = (marketName && row.market_name && row.market_name.trim().toLowerCase() === marketName.trim().toLowerCase());
              return idMatch || nameMatch;
            })
            .sort((a, b) => {
              const dateA = extractIsoDate(a.result_date) || String(a.result_date);
              const dateB = extractIsoDate(b.result_date) || String(b.result_date);
              return dateA.localeCompare(dateB);
            });

          console.log('MARKET HISTORY:', marketHistory);

          marketHistory.forEach(item => {
            const normDate = extractIsoDate(item.result_date);
            const rawRes = (item.result !== undefined && item.result !== null) ? item.result : item.result_number;
            const resStr = extractResultString(rawRes);
            if (normDate && resStr) {
              if (yearMonth === 'ALL' || normDate.startsWith(yearMonth)) {
                historyMap.set(normDate, {
                  id: item.id,
                  market_id: item.market_id,
                  market_name: item.market_name || marketName,
                  result_date: normDate,
                  result: resStr,
                  result_number: resStr,
                  draw_time: item.draw_time
                });
              }
            }
          });
        }
      } catch (err) {
        console.error('ALL_RESULTS READ ERROR (EXCEPTION):', err);
      }
    }
  }

  // 2. Merge local storage history if available
  try {
    const rawLocal = localStorage.getItem(LOCAL_HISTORY_KEY);
    if (rawLocal) {
      const localList = JSON.parse(rawLocal);
      if (Array.isArray(localList)) {
        localList.forEach(item => {
          const normDate = extractIsoDate(item.result_date);
          if (normDate && (yearMonth === 'ALL' || normDate.startsWith(yearMonth))) {
            const matchesMarket = (marketId && item.market_id && String(item.market_id) === String(marketId)) ||
                                  (!marketName || (item.market_name && item.market_name.trim().toLowerCase() === marketName.trim().toLowerCase()));
            if (matchesMarket) {
              const rawRes = (item.result !== undefined && item.result !== null) ? item.result : item.result_number;
              const resStr = extractResultString(rawRes);
              if (resStr && !historyMap.has(normDate)) {
                historyMap.set(normDate, {
                  market_id: item.market_id,
                  market_name: item.market_name || marketName,
                  result_date: normDate,
                  result: resStr,
                  result_number: resStr
                });
              }
            }
          }
        });
      }
    }
  } catch (e) {
    console.warn('Failed to parse local history:', e);
  }

  // Chronological order (newest date first)
  return Array.from(historyMap.values()).sort((a, b) => b.result_date.localeCompare(a.result_date));
}

/**
 * Save or update a single daily result for a market on a date in public.all_results
 * Updates existing record without creating duplicates.
 */
export async function saveDailyResultRecord(marketName, resultDate, resultNumber, marketId = null) {
  if (!marketName || !resultDate) return;
  const numVal = extractResultString(resultNumber);
  if (!numVal || numVal === 'XX' || numVal === '--') return;
  const normDate = extractIsoDate(resultDate) || resultDate;

  // 1. Save to local storage (preventing duplicates for same date)
  try {
    const rawLocal = localStorage.getItem(LOCAL_HISTORY_KEY);
    let localList = rawLocal ? JSON.parse(rawLocal) : [];
    if (!Array.isArray(localList)) localList = [];

    localList = localList.filter(item => !(item.market_name === marketName && item.result_date === normDate));
    localList.push({
      market_id: marketId || undefined,
      market_name: marketName,
      result_date: normDate,
      result: numVal,
      result_number: numVal,
      updated_at: new Date().toISOString()
    });
    localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(localList));
  } catch (e) {
    console.warn('Failed to save local history:', e);
  }

  // 2. Upsert/Insert to Supabase public.all_results table if configured
  if (isSupabaseConfigured()) {
    if (!supabaseClient) initSupabaseClient();
    if (supabaseClient) {
      try {
        const payload = {
          market_name: marketName,
          result_date: normDate,
          result: numVal,
          result_number: numVal,
          updated_at: new Date().toISOString()
        };
        if (marketId) {
          payload.market_id = marketId;
        }

        // Check if record exists in all_results for this market & date
        let checkQuery = supabaseClient
          .from('all_results')
          .select('id')
          .eq('result_date', normDate);

        if (marketId) {
          checkQuery = checkQuery.or(`market_id.eq.${marketId},market_name.eq.${marketName}`);
        } else {
          checkQuery = checkQuery.eq('market_name', marketName);
        }

        const { data: existingAll } = await checkQuery.limit(1);

        if (existingAll && existingAll.length > 0) {
          await supabaseClient
            .from('all_results')
            .update(payload)
            .eq('id', existingAll[0].id);
        } else {
          await supabaseClient
            .from('all_results')
            .insert([payload]);
        }

        // Also update daily_results table for backwards compatibility
        try {
          const { data: existingDaily } = await supabaseClient
            .from('daily_results')
            .select('id')
            .eq('market_name', marketName)
            .eq('result_date', normDate)
            .limit(1);

          if (existingDaily && existingDaily.length > 0) {
            await supabaseClient
              .from('daily_results')
              .update(payload)
              .eq('id', existingDaily[0].id);
          } else {
            await supabaseClient
              .from('daily_results')
              .insert([payload]);
          }
        } catch (dailyErr) {
          // ignore
        }
      } catch (err) {
        console.warn('Supabase all_results save exception:', err);
      }
    }
  }
}

/**
 * Reset / Clear all website market monthly results from Supabase database tables
 * (all_results, daily_results, and local storage cache)
 */
export async function clearAllHistoricalAndMonthlyResults(resetMarketCurrentNumbers = false) {
  const results = {
    allResultsCleared: false,
    dailyResultsCleared: false,
    localCacheCleared: false,
    marketsReset: false
  };

  // 1. Clear local storage history
  try {
    localStorage.removeItem(LOCAL_HISTORY_KEY);
    results.localCacheCleared = true;
  } catch (e) {
    console.warn('Failed to clear local history:', e);
  }

  // 2. Clear from Supabase public.all_results and public.daily_results
  if (isSupabaseConfigured()) {
    if (!supabaseClient) initSupabaseClient();
    if (supabaseClient) {
      try {
        const { error } = await supabaseClient
          .from('all_results')
          .delete()
          .not('id', 'is', null);

        if (!error) {
          results.allResultsCleared = true;
        } else {
          console.error('Failed to delete from all_results:', error);
        }
      } catch (err) {
        console.error('Exception clearing all_results:', err);
      }

      try {
        const { error } = await supabaseClient
          .from('daily_results')
          .delete()
          .not('id', 'is', null);

        if (!error) {
          results.dailyResultsCleared = true;
        } else {
          console.error('Failed to delete from daily_results:', error);
        }
      } catch (err) {
        console.error('Exception clearing daily_results:', err);
      }

      if (resetMarketCurrentNumbers) {
        try {
          const { error } = await supabaseClient
            .from('results')
            .update({
              today_number: null,
              yesterday_number: null,
              first_number: null,
              second_number: null,
              updated_at: new Date().toISOString()
            })
            .not('id', 'is', null);

          if (!error) {
            results.marketsReset = true;
          }
        } catch (err) {
          console.error('Exception resetting market numbers in results table:', err);
        }
      }
    }
  }

  return results;
}

// Auto init on import
initSupabaseClient();
