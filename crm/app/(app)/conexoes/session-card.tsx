'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Wifi, WifiOff, Loader2, QrCode, RefreshCw, Phone,
  CheckCircle2, XCircle, AlertCircle, Clock,
} from 'lucide-react';
import {
  fetchSessionStatus, fetchQrCode, restartSession, startSession,
  type SessionInfo, type SessionStatus,
} from './actions';
import { cn } from '@/lib/utils';

/* ─── Tipos ─────────────────────────────────────────────────── */
export interface SessionDef {
  session: string;       // nome interno da sessão
  label: string;         // nome de exibição (ex: "Secretária IA")
  role: 'bot' | 'support' | 'vendor';
  wahaUrl: string;
}

interface Props {
  def: SessionDef;
  storeSlug: string;
}

/* ─── Helpers ───────────────────────────────────────────────── */
function statusLabel(s: SessionStatus) {
  const map: Record<SessionStatus, string> = {
    WORKING:       'Conectado',
    SCAN_QR_CODE:  'Aguardando QR code',
    STARTING:      'Iniciando…',
    FAILED:        'Falha na conexão',
    STOPPED:       'Desconectado',
    LOGOUT:        'Sessão encerrada',
    UNKNOWN:       'Status desconhecido',
  };
  return map[s] ?? s;
}

function StatusDot({ status }: { status: SessionStatus }) {
  const color = {
    WORKING:       'bg-emerald-500',
    SCAN_QR_CODE:  'bg-amber-400 animate-pulse',
    STARTING:      'bg-amber-400 animate-pulse',
    FAILED:        'bg-red-500',
    STOPPED:       'bg-zinc-400',
    LOGOUT:        'bg-red-500',
    UNKNOWN:       'bg-zinc-400',
  }[status] ?? 'bg-zinc-400';

  return <span className={cn('inline-block w-2 h-2 rounded-full shrink-0', color)} />;
}

function StatusIcon({ status }: { status: SessionStatus }) {
  if (status === 'WORKING')
    return <CheckCircle2 size={15} className="text-emerald-500" />;
  if (status === 'SCAN_QR_CODE' || status === 'STARTING')
    return <Clock size={15} className="text-amber-500 animate-pulse" />;
  if (status === 'FAILED' || status === 'LOGOUT')
    return <XCircle size={15} className="text-red-500" />;
  return <AlertCircle size={15} className="text-zinc-400" />;
}

const POLL_MS = 12_000; // polling de status a cada 12s

/* ─── Componente ─────────────────────────────────────────────── */
export function SessionCard({ def, storeSlug }: Props) {
  const [info, setInfo]     = useState<SessionInfo | null>(null);
  const [qr, setQr]         = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadStatus = useCallback(async () => {
    const data = await fetchSessionStatus(def.wahaUrl, def.session);
    setInfo(data);
    // Se está esperando QR e o painel já está aberto, atualiza o QR
    if (data.status === 'SCAN_QR_CODE' && showQr) {
      const qrData = await fetchQrCode(def.wahaUrl, def.session);
      setQr(qrData);
    }
    if (data.status === 'WORKING') {
      setShowQr(false);
      setQr(null);
    }
  }, [def.wahaUrl, def.session, showQr]);

  // Poll inicial + intervalo
  useEffect(() => {
    loadStatus();
    pollRef.current = setInterval(loadStatus, POLL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.session, def.wahaUrl]);

  async function handleShowQr() {
    setActing(true);
    setError(null);
    const qrData = await fetchQrCode(def.wahaUrl, def.session);
    setQr(qrData);
    setShowQr(true);
    setActing(false);
  }

  async function handleReconnect() {
    setActing(true);
    setError(null);
    setShowQr(false);
    setQr(null);

    const status = info?.status;
    let res: { ok: boolean; error?: string };

    if (status === 'STOPPED' || status === 'UNKNOWN') {
      res = await startSession(def.wahaUrl, def.session);
      if (!res.ok) res = await restartSession(def.wahaUrl, def.session);
    } else {
      res = await restartSession(def.wahaUrl, def.session);
    }

    if (!res.ok) {
      setError(res.error ?? 'Erro ao reconectar');
    } else {
      // Aguarda um momento e atualiza status
      await new Promise(r => setTimeout(r, 2000));
      await loadStatus();
    }
    setActing(false);
  }

  const status = info?.status ?? 'UNKNOWN';
  const needsQr = status === 'SCAN_QR_CODE';
  const needsReconnect = status === 'FAILED' || status === 'STOPPED' || status === 'LOGOUT';
  const isWorking = status === 'WORKING';
  const isLoading = info === null;

  return (
    <div className={cn(
      'rounded-2xl border bg-surface p-4 flex flex-col gap-3 transition-all duration-300',
      isWorking  ? 'border-emerald-200 dark:border-emerald-800/60' :
      needsQr    ? 'border-amber-200 dark:border-amber-800/60' :
      needsReconnect ? 'border-red-200 dark:border-red-800/60' :
      'border-border',
    )}>
      {/* Header do card */}
      <div className="flex items-center gap-2.5">
        {isLoading
          ? <Loader2 size={15} className="animate-spin text-fg-subtle" />
          : <StatusIcon status={status} />
        }
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-semibold tracking-tight truncate">{def.label}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            {!isLoading && <StatusDot status={status} />}
            <span className="text-[11px] text-fg-subtle">
              {isLoading ? 'Verificando…' : statusLabel(status)}
            </span>
          </div>
        </div>

        {/* Refresh manual */}
        <button
          type="button"
          onClick={loadStatus}
          title="Atualizar status"
          className="p-1.5 rounded-lg text-fg-subtle hover:text-fg hover:bg-surface-muted transition-colors"
        >
          <RefreshCw size={13} strokeWidth={1.75} />
        </button>
      </div>

      {/* Número conectado (quando working) */}
      {isWorking && info?.phone && (
        <div className="flex items-center gap-1.5 text-[11.5px] text-fg-muted px-0.5">
          <Phone size={11} strokeWidth={1.75} />
          <span className="num">{info.phone}</span>
        </div>
      )}

      {/* Erro de ação */}
      {error && (
        <div className="text-[11.5px] text-red-600 dark:text-red-400 px-0.5">{error}</div>
      )}

      {/* Botões de ação */}
      {!isLoading && (
        <div className="flex flex-wrap gap-2">
          {needsQr && (
            <button
              type="button"
              onClick={handleShowQr}
              disabled={acting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-[12.5px] font-medium hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors disabled:opacity-50"
            >
              {acting
                ? <Loader2 size={12} className="animate-spin" />
                : <QrCode size={12} />}
              Ver QR code
            </button>
          )}

          {(needsReconnect || needsQr) && (
            <button
              type="button"
              onClick={handleReconnect}
              disabled={acting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-muted border border-border text-fg-muted text-[12.5px] font-medium hover:text-fg hover:border-border-strong transition-colors disabled:opacity-50"
            >
              {acting
                ? <Loader2 size={12} className="animate-spin" />
                : <RefreshCw size={12} />}
              Reconectar
            </button>
          )}
        </div>
      )}

      {/* QR code */}
      {showQr && (
        <div className="mt-1 animate-fade-in">
          {qr ? (
            <div className="flex flex-col items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qr}
                alt="QR code para conectar"
                className="w-52 h-52 rounded-xl border border-border object-contain bg-white"
              />
              <p className="text-[11px] text-fg-subtle text-center max-w-[13rem]">
                Abra o WhatsApp → Aparelhos conectados → Conectar aparelho → aponte para o QR
              </p>
              <button
                type="button"
                onClick={handleShowQr}
                className="text-[11.5px] text-fg-muted hover:text-fg underline-offset-2 hover:underline"
              >
                Atualizar QR
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[12px] text-fg-subtle">
              <Loader2 size={13} className="animate-spin" />
              Carregando QR code…
            </div>
          )}
        </div>
      )}
    </div>
  );
}
