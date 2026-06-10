import type { ChatMessage, SecretariaOutput } from './types.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!;

async function callOpenAI(
  messages: Array<{ role: string; content: string }>,
  model = 'gpt-4o-mini',
  jsonMode = false
) {
  const body: Record<string, unknown> = { model, messages };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices[0].message.content as string;
}

// Strings que indicam que o modelo copiou um placeholder do prompt em vez de gerar mensagem real.
const PLACEHOLDER_PATTERNS = [
  /texto que ser[áa] enviado ao cliente/i,
  /<\s*mensagem[_\s]*aqui\s*>/i,
  /\[\s*mensagem\s*\]/i,
];

function isPlaceholder(msg: string): boolean {
  const t = msg.trim();
  if (!t) return true;
  return PLACEHOLDER_PATTERNS.some(p => p.test(t));
}

function parseOutput(raw: string): SecretariaOutput {
  try {
    return JSON.parse(raw) as SecretariaOutput;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as SecretariaOutput;
    throw new Error(`Falha ao parsear output da Secretária: ${raw}`);
  }
}

function safeFallback(out: SecretariaOutput): string {
  if (out.transferir) return 'Vou te encaminhar para um vendedor que vai te atender agora 😊';
  if (out.suporte)    return 'Vou te encaminhar para o nosso suporte agora 😊';
  return 'Olá! Tudo bem? Como posso te ajudar hoje? 😊';
}

export async function runSecretaria(
  mensagem:     string,
  history:      ChatMessage[],
  systemPrompt: string
): Promise<SecretariaOutput> {
  const messages = [
    { role: 'system',    content: systemPrompt },
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user',      content: mensagem },
  ];

  let raw = await callOpenAI(messages, 'gpt-4o-mini', true);
  let out = parseOutput(raw);

  // Defesa contra vazamento de placeholder do prompt
  if (isPlaceholder(out.mensagem)) {
    console.error(`runSecretaria placeholder leak detected, retrying: ${JSON.stringify(out).slice(0,200)}`);
    const retryMessages = [
      ...messages,
      {
        role: 'system',
        content:
          'ATENÇÃO: sua última resposta continha o placeholder do template em vez de uma mensagem real. ' +
          'Gere AGORA uma mensagem natural e específica para o cliente, NUNCA copie literalmente trechos do template ' +
          'como "Texto que será enviado ao cliente", "<mensagem>", "[mensagem]" ou similares.',
      },
    ];
    raw = await callOpenAI(retryMessages, 'gpt-4o-mini', true);
    out = parseOutput(raw);

    // Se ainda assim veio placeholder, força mensagem segura coerente com o JSON
    if (isPlaceholder(out.mensagem)) {
      console.error(`runSecretaria placeholder leak persisted after retry, using safe fallback`);
      out.mensagem = safeFallback(out);
    }
  }

  return out;
}

export async function summarizeForVendor(history: ChatMessage[]): Promise<string> {
  const conversationText = history
    .map(m => `${m.role === 'user' ? 'Cliente' : 'Atendente'}: ${m.content}`)
    .join('\n');

  return callOpenAI([
    {
      role:    'system',
      content: 'Resuma as informações para enviar ao vendedor! Analise as mensagens que o cliente enviou e crie um relatório pequeno informando o que o cliente tem interesse, para que o vendedor possa entrar em contato sabendo a necessidade do cliente. No output deixe apenas o interesse do cliente.',
    },
    { role: 'user', content: conversationText },
  ]);
}

export async function transcribeAudio(audioBuffer: ArrayBuffer): Promise<string> {
  const formData = new FormData();
  formData.append(
    'file',
    new Blob([audioBuffer], { type: 'audio/ogg' }),
    'audio.ogg'
  );
  formData.append('model', 'whisper-1');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body:    formData,
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`OpenAI transcribe ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.text as string;
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function describeImage(imageBuffer: ArrayBuffer, mimeType = 'image/jpeg'): Promise<string> {
  const base64 = toBase64(imageBuffer);

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: [
          {
            type:      'image_url',
            image_url: { url: `data:${mimeType};base64,${base64}` },
          },
          {
            type: 'text',
            text: 'Descreva em uma frase curta o que aparece nesta imagem, como se fosse uma mensagem de texto que um cliente enviou para uma loja de iPhone e acessórios Apple.',
          },
        ],
      }],
      max_tokens: 150,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`OpenAI vision ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices[0].message.content as string;
}
