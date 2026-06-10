import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);
const WAHA_API_KEY = Deno.env.get('WAHA_API_KEY')!;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const storeId = Number(url.searchParams.get('store_id') ?? '3');

  const { data: store } = await supabase
    .from('stores')
    .select('waha_url')
    .eq('id', storeId)
    .single();

  if (!store) return new Response(JSON.stringify({ error: 'store not found' }), { status: 404 });

  const res = await fetch(`${store.waha_url}/api/sessions?all=true`, {
    headers: { 'X-Api-Key': WAHA_API_KEY },
  });
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
});
