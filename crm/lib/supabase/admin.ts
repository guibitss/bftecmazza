import { createClient } from '@supabase/supabase-js';

/**
 * Cliente Supabase com SERVICE ROLE — bypassa RLS.
 * Usar APENAS em Server Components / Server Actions / API routes.
 * NUNCA exportar pro client.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}
