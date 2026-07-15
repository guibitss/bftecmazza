const CHATWOOT_URL   = Deno.env.get('CHATWOOT_URL')!;
const CHATWOOT_TOKEN = Deno.env.get('CHATWOOT_API_TOKEN')!;

function headers(): Record<string, string> {
  return {
    'api_access_token': CHATWOOT_TOKEN,
    'Content-Type':     'application/json',
  };
}

export async function getConversation(accountId: number, conversationId: number) {
  const res = await fetch(
    `${CHATWOOT_URL}/api/v1/accounts/${accountId}/conversations/${conversationId}`,
    { headers: headers() }
  );
  if (!res.ok) throw new Error(`Chatwoot getConversation ${res.status}`);
  return res.json();
}

export async function addLabels(
  accountId: number,
  conversationId: number,
  labels: string[]
) {
  const res = await fetch(
    `${CHATWOOT_URL}/api/v1/accounts/${accountId}/conversations/${conversationId}/labels`,
    { method: 'POST', headers: headers(), body: JSON.stringify({ labels }) }
  );
  if (!res.ok) throw new Error(`Chatwoot addLabels ${res.status}`);
  return res.json();
}

export async function downloadAttachment(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url, {
    headers: { 'api_access_token': CHATWOOT_TOKEN },
  });
  if (!res.ok) throw new Error(`Chatwoot downloadAttachment ${res.status}`);
  return res.arrayBuffer();
}

export async function getMessages(accountId: number, conversationId: number) {
  const res = await fetch(
    `${CHATWOOT_URL}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`,
    { headers: headers() }
  );
  if (!res.ok) throw new Error(`Chatwoot getMessages ${res.status}`);
  return res.json();
}
