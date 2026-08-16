/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BRIDGE_HTTP_URL?: string;
  readonly VITE_BRIDGE_WS_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
