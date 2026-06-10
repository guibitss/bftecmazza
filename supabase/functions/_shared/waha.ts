const WAHA_API_KEY = Deno.env.get('WAHA_API_KEY')!;

function headers(): Record<string, string> {
  return {
    'X-Api-Key':    WAHA_API_KEY,
    'Content-Type': 'application/json',
  };
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
