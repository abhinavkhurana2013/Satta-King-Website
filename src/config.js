/**
 * Satta King Application Configuration
 */

export const APP_CONFIG = window.APP_CONFIG || {
  SUPABASE_URL: "https://jdwnfnrtpuugulimqvcw.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_QVKbeLspLbiKBWPdndKNlA_rO-5BxNf",
  ADMIN_PASSWORD: "11092013",
  APP_TITLE: "Satta King"
};

export function getAppConfig() {
  if (window.APP_CONFIG) {
    return window.APP_CONFIG;
  }
  return APP_CONFIG;
}
