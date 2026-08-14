/**
 * Satta King Application Configuration
 * 
 * Paste your Supabase credentials and custom Admin password below.
 * Once you paste these values, the application will automatically connect to your Supabase cloud database!
 */

window.APP_CONFIG = {
  // Your Supabase Project URL
  SUPABASE_URL: "https://jdwnfnrtpuugulimqvcw.supabase.co",

  // Your Supabase Anon / Public API Key
  SUPABASE_ANON_KEY: "sb_publishable_QVKbeLspLbiKBWPdndKNlA_rO-5BxNf",

  // Admin Dashboard Login Password
  ADMIN_PASSWORD: "11092013",

  // Default App Title
  APP_TITLE: "Satta King",

  /**
   * SUPABASE SQL SETUP SCRIPT
   * Run this in your Supabase SQL Editor to create the 'results' table and enable Realtime:
   * 
   * -- 1. Create the 'results' table
   * CREATE TABLE IF NOT EXISTS results (
   *   id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
   *   market_name TEXT NOT NULL,
   *   first_number TEXT DEFAULT 'XX',
   *   second_number TEXT DEFAULT 'XX',
   *   draw_time TEXT NOT NULL,
   *   record_chart_url TEXT DEFAULT '#',
   *   status TEXT DEFAULT 'Active',
   *   is_highlighted BOOLEAN DEFAULT false,
   *   created_at TIMESTAMPTZ DEFAULT now(),
   *   updated_at TIMESTAMPTZ DEFAULT now()
   * );
   * 
   * -- 2. Enable public read & write access (Row Level Security policy)
   * ALTER TABLE results ENABLE ROW LEVEL SECURITY;
   * DROP POLICY IF EXISTS "Allow Public Access" ON results;
   * CREATE POLICY "Allow Public Access" ON results FOR ALL TO public USING (true) WITH CHECK (true);
   * 
   * -- 3. Enable Supabase Realtime safely without throwing errors:
   * DO $$
   * BEGIN
   *   IF NOT EXISTS (
   *     SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'results'
   *   ) THEN
   *     ALTER PUBLICATION supabase_realtime ADD TABLE results;
   *   END IF;
   * END $$;
   */
};
