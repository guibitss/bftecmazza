const WAHA_API_KEY = Deno.env.get('WAHA_API_KEY')!;

function headers(): Record<string, string> {
  return {
    'X-Api-Key':    WAHA_API_KEY,
    'Content-Type': 'application/json',
  };
}

/**
 * Números brasileiros no formato 55 + DDD(2) + 9DIGITOS podem estar
 * cadastrados sem o 9 inicial (formato antigo de 8 dígitos).
 * Retorna a versão alternativa ou null se não aplicável.
 */
function alternativeBrChatId(chatId: string): string | null {
  const m = chatId.match(/^(\d+)(@.+)$/);
  if (!m) return null;
  const [, number, suffix] = m;
  // BR: 55 + 2 DDD + 9 dígitos (13 total) → tenta sem o primeiro 9
  if (number.startsWith('55') && number.length === 13) {
    const phone = number.slice(4);
    if (phone.startsWith('9')) {
      return `${number.slice(0, 4)}${phone.slice(1)}${suffix}`;
    }
  }
  return null;
}

function isNoLidError(errText: string): boolean {
  return errText.includes('no LID found') || errText.includes('463');
}

export async function sendText(
  chatId:  string,
  text:    string,
  session: string,
  wahaUrl: string,
  replyTo?: string
): Promise<void> {
  const body: Record<string, unknown> = {
    chatId,
    text,
    session,
    linkPreview:            true,
    linkPreviewHighQuality: false,
    reply_to:               replyTo ?? null,
  };

  const res = await fetch(`${wahaUrl}/api/sendText`, {
    method:  'POST',
    headers: headers(),
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    // Tenta sem o nono dígito se o GOWS não encontrou o LID
    if (isNoLidError(err)) {
      const alt = alternativeBrChatId(chatId);
      if (alt) {
        const res2 = await fetch(`${wahaUrl}/api/sendText`, {
          method:  'POST',
          headers: headers(),
          body:    JSON.stringify({ ...body, chatId: alt }),
        });
        if (res2.ok) return;
        const err2 = await res2.text().catch(() => '');
        throw new Error(`WAHA sendText ${res2.status}: ${err2}`);
      }
    }
    throw new Error(`WAHA sendText ${res.status}: ${err}`);
  }
}

export async function startTyping(chatId: string, session: string, wahaUrl: string): Promise<void> {
  await fetch(`${wahaUrl}/api/startTyping`, {
    method:  'POST',
    headers: headers(),
    body:    JSON.stringify({ chatId, session }),
  }).catch(() => {});
}

export async function stopTyping(chatId: string, session: string, wahaUrl: string): Promise<void> {
  await fetch(`${wahaUrl}/api/stopTyping`, {
    method:  'POST',
    headers: headers(),
    body:    JSON.stringify({ chatId, session }),
  }).catch(() => {});
}
