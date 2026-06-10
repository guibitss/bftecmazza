'use server';

// NOTA: adicione WAHA_API_KEY ao .env.local do CRM (mesma chave usada nas Edge Functions)

const WAHA_KEY = process.env.WAHA_API_KEY ?? '';

function wahaHeaders() {
  return { 'X-Api-Key': WAHA_KEY, 'Content-Type': 'application/json' };
}

export type SessionStatus =
  | 'WORKING'
  | 'SCAN_QR_CODE'
  | 'STARTING'
  | 'FAILED'
  | 'STOPPED'
  | 'LOGOUT'
  | 'UNKNOWN';

export interface SessionInfo {
  session: string;
  status: SessionStatus;
  /** número conectado, se disponível */
  phone: string | null;
}

/** Busca status de uma sessão específica via API de conexão */
export async function fetchSessionStatus(
  wahaUrl: string,
  session: string,
): Promise<SessionInfo> {
  try {
    const res = await fetch(`${wahaUrl}/api/sessions/${session}`, {
      headers: wahaHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      // Sessão pode não existir ainda
      return { session, status: 'STOPPED', phone: null };
    }

    const data = await res.json();
    return {
      session,
      status: (data.status ?? 'UNKNOWN') as SessionStatus,
      phone: data.me?.id?.replace('@c.us', '') ?? null,
    };
  } catch {
    return { session, status: 'UNKNOWN', phone: null };
  }
}

/** Busca QR code como data-URL PNG (para exibir em <img>) */
export async function fetchQrCode(
  wahaUrl: string,
  session: string,
): Promise<string | null> {
  try {
    // Endpoint v1/v2: GET /api/{session}/auth/qr  →  PNG binário
    const res = await fetch(`${wahaUrl}/api/${session}/auth/qr`, {
      headers: { 'X-Api-Key': WAHA_KEY, Accept: 'image/png' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const b64 = Buffer.from(buf).toString('base64');
    return `data:image/png;base64,${b64}`;
  } catch {
    return null;
  }
}

/** Reinicia uma sessão */
export async function restartSession(
  wahaUrl: string,
  session: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${wahaUrl}/api/sessions/${session}/restart`, {
      method: 'POST',
      headers: wahaHeaders(),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false, error: txt || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Inicia uma sessão que nunca foi criada */
export async function startSession(
  wahaUrl: string,
  session: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${wahaUrl}/api/sessions/start`, {
      method: 'POST',
      headers: wahaHeaders(),
      body: JSON.stringify({ name: session }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false, error: txt || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
