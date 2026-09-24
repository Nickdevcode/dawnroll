/// <reference types="vite/client" />

/** Variáveis de ambiente do jogo (Vite só expõe as que começam com VITE_). */
interface ImportMetaEnv {
  /** URL do projeto no Supabase (https://<ref>.supabase.co). Sem ela, o jogo roda só local. */
  readonly VITE_SUPABASE_URL?: string;
  /** Chave publicável do Supabase (pública por design: quem protege os dados é o RLS). */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
