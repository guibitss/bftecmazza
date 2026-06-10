/**
 * validate-whatsapp
 * ----------------------------------------------------------------
 * Recebe um número e devolve a variação que existe no WhatsApp,
 * testando com/sem o "9 extra" típico brasileiro.
 *
 * POST { phone: "5541996920735" } → { valid: true, normalized: "554196920735" }
 *                                  | { valid: false, error: "..." }
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);
const WAHA_API_KEY = Deno.env.get('WAHA_API_KEY')!;

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST')    return json({ valid: false, error: 'POST only' }, 405);

  let body: { phone?: string };
  try { body = await req.json(); } catch { return json({ valid: false, error: 'bad json' }, 400); }

  const raw = String(body.phone ?? '').replace(/\D/g, '');
  if (raw.length < 10) return json({ valid: false, error: 'Número curto demais' }, 400);

  // Pega URL de qualquer loja ativa (vamos usar a primeira)
  const { data: stores } = await supabase
    .from('stores').select('waha_url, bot_session').eq('active', true).order('id').limit(1);
  const store = stores?.[0];
  if (!store) return json({ valid: false, error: 'Nenhuma loja configurada' }, 500);

  const variations = brazilianPhoneVariations(raw);

  for (const phone of variations) {
    try {
      const url = `${store.waha_url}/api/contacts/check-exists?session=${encodeURIComponent(store.bot_session)}&phone=${phone}`;
      const r = await fetch(url, { headers: { 'X-Api-Key': WAHA_API_KEY } });
      if (!r.ok) continue;
      const data = await r.json();
      if (data?.numberExists === true) {
        // WAHA já normaliza no chatId — extrai os dígitos dele
        const chatId = String(data.chatId ?? '');
        const normalized = chatId.replace(/@.*/, '').replace(/\D/g, '') || phone;
        return json({ valid: true, normalized });
      }
    } catch (err) {
      console.error('checkExists fetch:', err);
    }
  }

  return json({ valid: false, error: 'Esse número não tem WhatsApp ativo' });
});

function brazilianPhoneVariations(phone: string): string[] {
  const variations = [phone];
  const m13 = phone.match(/^(55)(\d{2})9(\d{8})$/);
  if (m13) variations.push(`${m13[1]}${m13[2]}${m13[3]}`);
  const m12 = phone.match(/^(55)(\d{2})(\d{8})$/);
  if (m12 && !m12[3].startsWith('9')) variations.push(`${m12[1]}${m12[2]}9${m12[3]}`);
  // adiciona DDI 55 se faltar
  if (!phone.startsWith('55') && phone.length >= 10) {
    variations.push('55' + phone);
  }
  return variations;
}

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
