import { createBrowserClient } from '@supabase/ssr';
import { dbSchemaOption } from './schema';

// Singleton no browser: o createBrowserClient do @supabase/ssr é feito pra
// ser instanciado uma vez. Recriar a cada render fazia efeitos com o client
// nas deps reexecutarem em loop (cancelando fetches antes de resolverem).
let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
  if (browserClient) return browserClient;
  browserClient = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    dbSchemaOption(),
  );
  return browserClient;
}
