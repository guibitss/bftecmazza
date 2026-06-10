/**
 * process-tratativas
 * ----------------------------------------------------------------
 * Disparado por pg_cron a cada minuto. Pega tratativas com status='pending'
 * e send_at <= NOW(), envia mensagem PRO PRÓPRIO USUÁRIO que cadastrou
 * (no WhatsApp dele) usando a sessão IA da loja.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);
const WAHA_API_KEY = Deno.env.get('WAHA_API_KEY')!;

Deno.serve(async () => {
  try {
    const { data: due, error } = await supabase
      .from('tratativas')
      .select('*, app_users!user_id(name, whatsapp_number), stores!store_id(waha_url, bot_session)')
      .eq('status', 'pending')
      .lte('send_at', new Date().toISOString())
      .limit(20);

    if (error) throw error;

    for (const t of due ?? []) {
      await dispatch(t);
    }
  } catch (err) {
    console.error('process-tratativas fatal:', err);
  }
  return new Response('OK');
});

interface TratativaRow {
  id: number;
  user_id: string;
  store_id: number;
  customer_name: string;
  customer_phone: string;
  notes: string | null;
  send_at: string;
  app_users: { name: string | null; whatsapp_number: string | null };
  stores: { waha_url: string; bot_session: string };
}

async function dispatch(t: TratativaRow) {
  const userPhone = (t.app_users?.whatsapp_number ?? '').replace(/\D/g, '');
  if (!userPhone) {
    await supabase.from('tratativas').update({
      status: 'failed',
      error_msg: 'usuário sem whatsapp_number cadastrado',
    }).eq('id', t.id);
    return;
  }

  const fmtDate = new Date(t.send_at).toLocaleString('pt-BR', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo',
  });

  const text =
`🔔 *Lembrete de tratativa*

📅 ${fmtDate}
👤 *Cliente:* ${t.customer_name}
📞 *Número:* ${t.customer_phone}

${t.notes ?? '_sem observações_'}`;

  // Tenta variações do número (com e sem "9 extra" típico do Brasil)
  const variations = brazilianPhoneVariations(userPhone);
  let lastErr = '';

  for (const phone of variations) {
    try {
      const res = await fetch(`${t.stores.waha_url}/api/sendText`, {
        method: 'POST',
        headers: { 'X-Api-Key': WAHA_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: `${phone}@c.us`,
          text,
          session: t.stores.bot_session,
          linkPreview: false,
        }),
      });
      if (res.ok) {
        await supabase.from('tratativas').update({
          status: 'sent', sent_at: new Date().toISOString(),
        }).eq('id', t.id);
        return;
      }
      const body = await res.text();
      lastErr = `WAHA ${res.status}: ${body.slice(0, 200)}`;
      // Se erro for "no LID found", tenta a próxima variação; senão para aqui
      if (!body.includes('no LID found') && !body.includes('UNKNOWN')) break;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }

  console.error(`tratativa ${t.id} falhou em todas variações:`, lastErr);
  await supabase.from('tratativas').update({
    status: 'failed', error_msg: lastErr,
  }).eq('id', t.id);
}

/**
 * Gera variações do número brasileiro com e sem o "9 extra".
 * Ex: 5541996920735 → [5541996920735, 554196920735]
 */
function brazilianPhoneVariations(phone: string): string[] {
  const variations = [phone];
  // Padrão BR: 55 + DDD(2) + 9 + 8 dígitos = 13 chars
  const m13 = phone.match(/^(55)(\d{2})9(\d{8})$/);
  if (m13) variations.push(`${m13[1]}${m13[2]}${m13[3]}`);  // remove o 9 extra
  // OU: 55 + DDD(2) + 8 dígitos = 12 chars
  const m12 = phone.match(/^(55)(\d{2})(\d{8})$/);
  if (m12 && !m12[3].startsWith('9')) variations.push(`${m12[1]}${m12[2]}9${m12[3]}`); // adiciona 9
  return variations;
}
