"use client";

import { loadClientConfig } from "@rwa-yield-router/config";
import { createBrowserClient } from "@supabase/ssr";

export const createClient = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  const config = loadClientConfig({
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    NEXT_PUBLIC_SUPABASE_URL: url
  });
  return createBrowserClient(config.supabaseUrl, config.supabaseAnonKey);
};
