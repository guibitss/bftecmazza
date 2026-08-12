'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Send, Paperclip, Mic, Clock, Lock, ChevronDown, Sparkles, Headset,
  User as UserIcon, Check, AlertCircle, X, Square, Image as ImageIcon,
  FileText, Film, Music, MessageSquareText,
} from 'lucide-react';
import type { InboxAccess } from '@/lib/auth';
import { createClient } from '@/lib/supabase/client';
import { dbSchema } from '@/lib/supabase/schema';
import { webmParaOgg } from '@/lib/webm-to-ogg';
import { cn } from '@/lib/utils';

interface Props {
  convId: number;
  inbox: InboxAccess;
  sendableInboxes: InboxAccess[];
  canSend: boolean;
}

function iconForKind(kind: InboxAccess['kind']) {
  if (kind === 'ai')      return Sparkles;
  if (kind === 'support') return Headset;
  return UserIcon;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

type MsgKind = 'text' | 'image' | 'video' | 'audio' | 'document';

function mimeToKind(mime: string): MsgKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

function kindIcon(kind: MsgKind) {
  if (kind === 'image')    return ImageIcon;
  if (kind === 'video')    return Film;
  if (kind === 'audio')    return Music;
  return FileText;
}

function formatSeconds(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// ─── Upload de arquivo para o Supabase Storage ───────────────────────────────
async function uploadToStorage(
  supabase: ReturnType<typeof createClient>,
  file: File | Blob,
  convId: number,
  filename: string,
): Promise<{ url: string; mime: string; filename: string }> {
  const mime = file instanceof File ? file.type : (file as Blob).type;
  const ext  = filename.split('.').pop() ?? 'bin';
  const path = `crm-uploads/${convId}/${Date.now()}-${filename}`;

  const { error } = await supabase.storage
    .from('media')
    .upload(path, file, { contentType: mime, upsert: false });

  if (error) throw new Error(`Upload falhou: ${error.message}`);

  const { data } = supabase.storage.from('media').getPublicUrl(path);
  return { url: data.publicUrl, mime, filename };
}

export function Composer({ convId, inbox, sendableInboxes, canSend }: Props) {
  const supabase = createClient();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  // Sugestão de resposta da IA (balão)
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [sugErr, setSugErr] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Mensagens rápidas (respostas prontas do login)
  interface QuickMediaItem { url: string; mime?: string | null; filename?: string | null; kind?: string | null }
  interface QuickReply {
    id: string; title: string | null; body: string | null;
    media_url: string | null; media_mime: string | null; media_filename: string | null; kind: string | null;
    media_items: QuickMediaItem[] | null;
  }
  /** Anexos: usa a lista nova; cai no anexo único do formato antigo. */
  function anexosDe(qr: QuickReply): QuickMediaItem[] {
    if (qr.media_items?.length) return qr.media_items;
    if (qr.media_url) return [{ url: qr.media_url, mime: qr.media_mime, filename: qr.media_filename, kind: qr.kind }];
    return [];
  }
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [showQR, setShowQR] = useState(false);
  const qrRef = useRef<HTMLDivElement>(null);
  // Atalho "/" — igual WhatsApp: digitou "/" no começo, abre a lista e filtra
  const [slashTerm, setSlashTerm] = useState<string | null>(null);
  const [qrIndex, setQrIndex] = useState(0);


  // Arquivo pendente de envio (depois de selecionar, antes de confirmar)
  const [pendingFile, setPendingFile] = useState<{
    file: File; kind: MsgKind; preview?: string;
  } | null>(null);

  // Gravação de áudio
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const recorderRef    = useRef<MediaRecorder | null>(null);
  const recChunksRef   = useRef<Blob[]>([]);
  const recTimerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  // Ref para sempre ter o sendMedia mais recente dentro de stopRecording
  const sendMediaRef   = useRef<(file: File | Blob, filename: string, kind: MsgKind, caption?: string) => Promise<void>>(async () => {});

  const fileInputRef = useRef<HTMLInputElement>(null);

  // sessão selecionada
  const defaultSession = inbox.canSend ? inbox.wahaSession : (sendableInboxes[0]?.wahaSession ?? '');
  const [viaSession, setViaSession] = useState<string>(defaultSession);
  const selectedInbox = sendableInboxes.find(i => i.wahaSession === viaSession) ?? sendableInboxes[0];

  // reset ao trocar de conversa
  useEffect(() => {
    setText('');
    setError(null);
    setPendingFile(null);
    setViaSession(defaultSession);
    setSuggestion(null);
    setSugErr(null);
    setSuggesting(false);
    setShowQR(false);
    setSlashTerm(null);
    setQrIndex(0);
    // Para gravação em andamento ao trocar de conversa
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.ondataavailable = null;
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
      recorderRef.current = null;
    }
    recChunksRef.current = [];
    setRecording(false);
    setRecSeconds(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId]);

  // fecha o picker ao clicar fora
  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showPicker) return;
    function onDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showPicker]);

  // ─── Envio de texto ─────────────────────────────────────────────────────────
  async function sendText() {
    if (!text.trim() || sending || !viaSession) return;
    setSending(true);
    setError(null);
    try {
      await callSendMessage({
        kind: 'text',
        body: text.trim(),
      });
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  // ─── Envio de mídia (arquivo ou áudio gravado) ───────────────────────────────
  async function sendMedia(file: File | Blob, filename: string, kind: MsgKind, caption?: string): Promise<void> {
    setUploading(true);
    setError(null);
    try {
      const { url, mime } = await uploadToStorage(supabase, file, convId, filename);
      await callSendMessage({
        kind,
        body: caption ?? undefined,
        media_url: url,
        media_mime: mime,
        media_filename: filename,
      });
      setPendingFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  // Mantém ref sempre atualizada (evita closure stale em stopRecording)
  sendMediaRef.current = sendMedia;

  // ─── Chama a Edge Function ─────────────────────────────────────────────────
  async function callSendMessage(payload: {
    kind: MsgKind;
    body?: string;
    media_url?: string;
    media_mime?: string;
    media_filename?: string;
  }) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('sessão expirada');

    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        conversation_id: convId,
        via_session: viaSession,
        ...payload,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  }

  // ─── Sugestão de resposta da IA ─────────────────────────────────────────────
  async function fetchSuggestion() {
    if (suggesting) return;
    setSuggesting(true);
    setSugErr(null);
    setSuggestion(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('sessão expirada');
      const res = await fetch(`${SUPABASE_URL}/functions/v1/suggest-reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          ...(dbSchema() ? { 'x-app-schema': dbSchema()! } : {}),
        },
        body: JSON.stringify({ conversation_id: convId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSuggestion(data.suggestion as string);
    } catch (err) {
      setSugErr(err instanceof Error ? err.message : String(err));
    } finally {
      setSuggesting(false);
    }
  }

  function useSuggestion() {
    if (!suggestion) return;
    setText(suggestion);
    setSuggestion(null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  // Reajusta a altura do textarea quando o texto muda (inclui preencher via sugestão)
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 128) + 'px';
  }, [text]);

  // Carrega mensagens rápidas do login (RLS filtra pras próprias)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('quick_replies')
        .select('id, title, body, media_url, media_mime, media_filename, kind, media_items')
        .order('sort').order('created_at');
      if (!cancelled) setQuickReplies((data ?? []) as QuickReply[]);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // Fecha o seletor de mensagens rápidas ao clicar fora
  useEffect(() => {
    if (!showQR) return;
    function onDown(e: MouseEvent) {
      if (qrRef.current && !qrRef.current.contains(e.target as Node)) setShowQR(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showQR]);

  /**
   * Usa uma mensagem rápida. Só texto → preenche o campo (a vendedora revisa e
   * envia). Com mídia → envia direto (a mídia já está no Storage; vai por URL,
   * com o texto como legenda).
   */
  async function useQuickReply(qr: QuickReply) {
    setShowQR(false);
    setSlashTerm(null);

    const anexos = anexosDe(qr);
    if (anexos.length === 0) {
      const corpo = qr.body ?? '';
      // Se veio pelo "/", troca o comando; senão concatena
      setText(t => (slashTerm !== null || !t.trim() ? corpo : `${t}${t.endsWith('\n') ? '' : '\n'}${corpo}`));
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }

    setSending(true);
    setError(null);
    try {
      // Envia na ordem; o texto vai como legenda do primeiro
      for (let i = 0; i < anexos.length; i++) {
        const m = anexos[i];
        await callSendMessage({
          kind:           (m.kind ?? 'document') as MsgKind,
          body:           i === 0 ? (qr.body ?? undefined) : undefined,
          media_url:      m.url,
          media_mime:     m.mime ?? undefined,
          media_filename: m.filename ?? undefined,
        });
      }
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  // Lista filtrada pelo termo digitado após a "/"
  const qrFiltered = slashTerm === null
    ? quickReplies
    : quickReplies.filter(q => {
        const t = slashTerm.toLowerCase();
        return !t || (q.title ?? '').toLowerCase().includes(t) || (q.body ?? '').toLowerCase().includes(t);
      });

  /** Detecta o comando "/" no início do campo (igual WhatsApp). */
  function onTextChange(v: string) {
    setText(v);
    if (v.startsWith('/') && !pendingFile) {
      setSlashTerm(v.slice(1));
      setShowQR(true);
      setQrIndex(0);
    } else if (slashTerm !== null) {
      setSlashTerm(null);
      setShowQR(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Navegação na lista de mensagens rápidas aberta pelo "/"
    if (slashTerm !== null && showQR && qrFiltered.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setQrIndex(i => (i + 1) % qrFiltered.length); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setQrIndex(i => (i - 1 + qrFiltered.length) % qrFiltered.length); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        useQuickReply(qrFiltered[qrIndex]);
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); setSlashTerm(null); setShowQR(false); return; }
    }

    // Enter SEMPRE quebra linha (é o que a vendedora espera ao escrever).
    // O envio é pelo botão — ou por Ctrl/Cmd+Enter, pra quem prefere teclado.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (pendingFile) {
        sendMedia(pendingFile.file, pendingFile.file.name, pendingFile.kind, text.trim() || undefined);
        setText('');
      } else {
        sendText();
      }
    }
  }

  // ─── Seleção de arquivo ───────────────────────────────────────────────────
  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!fileInputRef.current) fileInputRef.current = e.target;
    if (!file) return;
    e.target.value = '';
    const kind = mimeToKind(file.type);
    const preview = kind === 'image' ? URL.createObjectURL(file) : undefined;
    setPendingFile({ file, kind, preview });
    setError(null);
  }

  // ─── Gravação de áudio ────────────────────────────────────────────────────
  function stopRecording(send: boolean) {
    if (recTimerRef.current) {
      clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      setRecording(false);
      setRecSeconds(0);
      return;
    }

    if (!send) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.stop();
      recorderRef.current = null;
      recChunksRef.current = [];
      setRecording(false);
      setRecSeconds(0);
      return;
    }

    recorder.onstop = async () => {
      const chunks = recChunksRef.current;
      recChunksRef.current = [];
      recorderRef.current = null;
      setRecording(false);
      setRecSeconds(0);
      if (chunks.length === 0) return;

      const mime = chunks[0].type || 'audio/webm';
      let blob = new Blob(chunks, { type: mime });
      let ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'mp4' : 'webm';

      // O WhatsApp só entrega nota de voz em Ogg/Opus — WebM fica preso em
      // "enviado" e nunca chega. O Chrome só grava WebM, então trocamos o
      // recipiente aqui (o áudio já é Opus nos dois; não há recodificação).
      if (ext === 'webm') {
        const ogg = await webmParaOgg(blob);
        if (ogg) { blob = ogg; ext = 'ogg'; }
        else console.warn('Não consegui converter o áudio para Ogg; enviando como está.');
      }

      sendMediaRef.current(blob, `audio-${Date.now()}.${ext}`, 'audio');
    };
    recorder.stop();
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType =
        MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' :
        MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' :
        '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      recorderRef.current = recorder;
      recChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recChunksRef.current.push(e.data);
      };
      recorder.start(250); // coleta chunks a cada 250ms

      setRecording(true);
      setRecSeconds(0);
      recTimerRef.current = setInterval(() => setRecSeconds(s => s + 1), 1000);

      // Para os tracks do microfone quando o recorder parar
      recorder.addEventListener('stop', () => {
        stream.getTracks().forEach(t => t.stop());
      }, { once: true });
    } catch (err) {
      setError('Microfone não permitido. Habilite o acesso nas configurações do navegador.');
    }
  }

  // ─── Bloqueia se sem permissão ────────────────────────────────────────────
  if (!canSend && sendableInboxes.length === 0) {
    return (
      <div className="shrink-0 hairline-t bg-white dark:bg-zinc-900 px-4 py-3 text-center text-[12px] text-fg-muted flex items-center justify-center gap-1.5">
        <Lock size={12} /> Você não tem permissão para enviar nesta loja.
      </div>
    );
  }

  const SelectedIcon = selectedInbox ? iconForKind(selectedInbox.kind) : Sparkles;
  const hasMultipleSessions = sendableInboxes.length > 1;
  const isBusy = sending || uploading;

  return (
    <div className="shrink-0 hairline-t bg-white dark:bg-zinc-900">
      {/* Input de arquivo (oculto) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip"
        className="hidden"
        onChange={onFileChange}
      />

      {/* Barra "enviar como" */}
      {selectedInbox && (
        <div className="px-3 sm:px-4 pt-2.5 pb-1.5 flex items-center gap-2 text-[11px]">
          <span className="text-fg-subtle uppercase tracking-[0.12em] text-[10px]">enviar como</span>
          <div className="relative" ref={pickerRef}>
            <button
              type="button"
              onClick={() => hasMultipleSessions && setShowPicker(v => !v)}
              disabled={!hasMultipleSessions}
              className={cn(
                'inline-flex items-center gap-1.5 px-2 py-1 rounded-md',
                'text-[11.5px] font-medium',
                hasMultipleSessions
                  ? 'border border-border bg-surface hover:border-border-strong cursor-pointer'
                  : 'border border-transparent',
              )}
            >
              <SelectedIcon size={11} strokeWidth={1.75} />
              <span>{selectedInbox.displayName}</span>
              {hasMultipleSessions && <ChevronDown size={11} className="text-fg-subtle" />}
            </button>

            {showPicker && hasMultipleSessions && (
              <div className="absolute bottom-full left-0 mb-2 z-20 w-60 rounded-xl border border-border bg-surface shadow-lg overflow-hidden animate-fade-in">
                <div className="px-3 py-2 hairline-b text-[10px] uppercase tracking-[0.14em] text-fg-subtle">
                  Sessões da loja
                </div>
                <ul className="py-1">
                  {sendableInboxes.map(i => {
                    const Icon = iconForKind(i.kind);
                    const active = i.wahaSession === viaSession;
                    return (
                      <li key={i.inboxId}>
                        <button
                          type="button"
                          onClick={() => { setViaSession(i.wahaSession); setShowPicker(false); }}
                          className={cn(
                            'w-full flex items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors',
                            active ? 'bg-surface-muted' : 'hover:bg-surface-muted/60',
                          )}
                        >
                          <Icon size={13} strokeWidth={1.75} className="text-fg-muted" />
                          <span className="flex-1">{i.displayName}</span>
                          {active && <Check size={13} />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
          <span className="text-fg-subtle">·</span>
          <span className="text-fg-subtle truncate">{selectedInbox.wahaSession}</span>
        </div>
      )}

      {/* Preview de arquivo selecionado */}
      {pendingFile && (
        <div className="mx-3 mb-2 flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-surface animate-fade-in">
          {pendingFile.preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pendingFile.preview} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
          ) : (
            (() => { const KIcon = kindIcon(pendingFile.kind); return <KIcon size={20} className="text-fg-muted shrink-0" />; })()
          )}
          <div className="flex-1 min-w-0">
            <div className="text-[12.5px] font-medium truncate">{pendingFile.file.name}</div>
            <div className="text-[11px] text-fg-subtle">{(pendingFile.file.size / 1024).toFixed(0)} KB · {pendingFile.kind}</div>
          </div>
          <button
            type="button"
            onClick={() => setPendingFile(null)}
            className="p-1.5 rounded-lg text-fg-subtle hover:text-fg hover:bg-surface-muted transition-colors shrink-0"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Gravação de áudio */}
      {recording && (
        <div className="mx-3 mb-2 flex items-center gap-3 px-3 py-2 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 animate-fade-in">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
          <span className="text-[13px] text-red-700 dark:text-red-300 font-medium num flex-1">
            Gravando… {formatSeconds(recSeconds)}
          </span>
          <button
            type="button"
            onClick={() => stopRecording(false)}
            className="p-1.5 rounded-lg text-red-600 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
            title="Cancelar gravação"
          >
            <X size={14} />
          </button>
          <button
            type="button"
            onClick={() => stopRecording(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-[12px] font-medium hover:bg-red-700 transition-colors"
            title="Parar e enviar"
          >
            <Square size={11} strokeWidth={2.5} />
            Enviar
          </button>
        </div>
      )}

      {/* Erro */}
      {error && (
        <div className="px-3 sm:px-4 pb-2 flex items-start gap-1.5 text-[11.5px] text-red-700 dark:text-red-300 animate-fade-in">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Sugestão de resposta da IA — chip discreto que vira balão ao clicar */}
      {(suggesting || suggestion || sugErr) ? (
        <div className="mx-3 mb-2 rounded-xl border border-border bg-surface overflow-hidden animate-fade-in">
          <div className="px-3 py-1.5 hairline-b flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-fg-subtle">
            <Sparkles size={11} /> Sugestão da IA
            <button
              type="button"
              onClick={() => { setSuggestion(null); setSugErr(null); }}
              className="ml-auto p-0.5 rounded text-fg-subtle hover:text-fg transition-colors"
              title="Dispensar"
            >
              <X size={12} />
            </button>
          </div>
          <div className="px-3 py-2.5">
            {suggesting ? (
              <div className="text-[12.5px] text-fg-subtle flex items-center gap-2">
                <svg className="animate-spin" width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                </svg>
                escrevendo uma sugestão…
              </div>
            ) : sugErr ? (
              <div className="text-[12.5px] text-red-700 dark:text-red-300">Não consegui sugerir: {sugErr}</div>
            ) : (
              <>
                <div className="text-[13px] whitespace-pre-wrap leading-snug text-fg">{suggestion}</div>
                <div className="mt-2.5 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={useSuggestion}
                    className="h-7 px-3 rounded-lg bg-ink-950 dark:bg-white text-white dark:text-ink-950 text-[12px] font-medium hover:opacity-80 transition-opacity"
                  >
                    Usar
                  </button>
                  <button
                    type="button"
                    onClick={fetchSuggestion}
                    className="h-7 px-3 rounded-lg border border-border text-[12px] text-fg-muted hover:text-fg hover:border-border-strong transition-colors"
                  >
                    Refazer
                  </button>
                  <span className="text-[10.5px] text-fg-subtle">revise antes de enviar</span>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={fetchSuggestion}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-border bg-surface text-[11.5px] text-fg-muted hover:text-fg hover:border-border-strong transition-colors"
          >
            <Sparkles size={12} /> Sugerir resposta
          </button>
        </div>
      )}

      {/* Linha do composer */}
      <div className="px-3 pb-3 flex items-end gap-2">
        {/* Paperclip — abre seletor de arquivo */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isBusy || recording}
          title="Anexar arquivo"
          className="p-2 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-muted transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <Paperclip size={18} strokeWidth={1.75} />
        </button>

        {/* Mensagens rápidas */}
        {quickReplies.length > 0 && (
          <div className="relative" ref={qrRef}>
            <button
              type="button"
              onClick={() => setShowQR(v => !v)}
              disabled={isBusy || recording}
              title="Mensagens rápidas"
              className="p-2 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-muted transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <MessageSquareText size={18} strokeWidth={1.75} />
            </button>
            {showQR && (
              <div className="absolute bottom-full left-0 mb-2 z-30 w-80 max-h-72 overflow-y-auto rounded-xl border border-border bg-surface shadow-lg animate-fade-in">
                <div className="px-3 py-2 hairline-b flex items-center justify-between sticky top-0 bg-surface">
                  <span className="text-[10px] uppercase tracking-[0.14em] text-fg-subtle">Mensagens rápidas</span>
                  {slashTerm !== null && (
                    <span className="text-[10px] text-fg-subtle">↑↓ e Enter</span>
                  )}
                </div>
                {qrFiltered.length === 0 ? (
                  <div className="px-3 py-4 text-[12.5px] text-fg-muted text-center">Nenhuma encontrada.</div>
                ) : (
                  <ul className="py-1">
                    {qrFiltered.map((qr, i) => {
                      const anexos = anexosDe(qr);
                      const capa = anexos[0];
                      return (
                      <li key={qr.id}>
                        <button
                          type="button"
                          onClick={() => useQuickReply(qr)}
                          onMouseEnter={() => setQrIndex(i)}
                          className={cn(
                            'w-full text-left px-3 py-2 transition-colors flex items-start gap-2.5',
                            slashTerm !== null && i === qrIndex ? 'bg-surface-muted' : 'hover:bg-surface-muted',
                          )}
                        >
                          {capa && (
                            <span className="relative shrink-0">
                              {capa.kind === 'image'
                                // eslint-disable-next-line @next/next/no-img-element
                                ? <img src={capa.url} alt="" className="w-9 h-9 rounded-md object-cover border border-border" />
                                : <span className="w-9 h-9 rounded-md border border-border bg-surface-2 grid place-items-center text-fg-muted">
                                    {(() => { const I = kindIcon((capa.kind ?? 'document') as MsgKind); return <I size={15} />; })()}
                                  </span>}
                              {anexos.length > 1 && (
                                <span className="absolute -bottom-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-ink-950 dark:bg-white text-white dark:text-ink-950 text-[9px] font-semibold grid place-items-center num">
                                  {anexos.length}
                                </span>
                              )}
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            {qr.title && <span className="block text-[12px] font-semibold truncate">{qr.title}</span>}
                            {qr.body && <span className="block text-[12.5px] text-fg-muted line-clamp-2 leading-snug">{qr.body}</span>}
                            {anexos.length > 0 && !qr.body && (
                              <span className="block text-[12px] text-fg-subtle truncate">
                                {anexos.length === 1 ? (capa?.filename ?? 'anexo') : `${anexos.length} anexos`}
                              </span>
                            )}
                            {anexos.length > 0 && (
                              <span className="block text-[10px] text-fg-subtle mt-0.5">
                                envia direto{anexos.length > 1 ? ` (${anexos.length} arquivos)` : ''}
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              pendingFile
                ? 'Legenda (opcional)…'
                : recording
                ? 'Gravando áudio…'
                : quickReplies.length > 0
                ? 'Mensagem… ("/" abre as mensagens rápidas)'
                : 'Mensagem…'
            }
            rows={1}
            disabled={isBusy || recording}
            className={cn(
              'w-full resize-none rounded-xl border border-border bg-surface px-3.5 py-2.5',
              'text-[14px] leading-snug placeholder:text-fg-subtle',
              'focus:outline-none focus:border-border-strong',
              'max-h-32 min-h-[40px]',
              (isBusy || recording) && 'opacity-50',
            )}
            onInput={(e) => {
              const ta = e.currentTarget;
              ta.style.height = 'auto';
              ta.style.height = Math.min(ta.scrollHeight, 128) + 'px';
            }}
          />
        </div>

        <button
          type="button"
          disabled
          title="Agendar (em breve)"
          className="p-2 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-muted transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <Clock size={18} strokeWidth={1.75} />
        </button>

        {/* Botão direito: Send / Mic / Upload indicator */}
        {isBusy ? (
          <div className="p-2.5 rounded-full bg-ink-950 dark:bg-white text-white dark:text-ink-950 shadow-sm opacity-60">
            <svg className="animate-spin" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
          </div>
        ) : pendingFile ? (
          <button
            type="button"
            onClick={() => {
              sendMedia(pendingFile.file, pendingFile.file.name, pendingFile.kind, text.trim() || undefined);
              setText('');
            }}
            disabled={!viaSession}
            title="Enviar arquivo"
            className="p-2.5 rounded-full bg-ink-950 dark:bg-white text-white dark:text-ink-950 shadow-sm hover:shadow-md hover:-translate-y-px transition-all disabled:opacity-50 disabled:hover:translate-y-0"
          >
            <Send size={16} strokeWidth={2} />
          </button>
        ) : text.trim() ? (
          <button
            type="button"
            onClick={sendText}
            disabled={!viaSession}
            title="Enviar (Enter)"
            className="p-2.5 rounded-full bg-ink-950 dark:bg-white text-white dark:text-ink-950 shadow-sm hover:shadow-md hover:-translate-y-px transition-all disabled:opacity-50 disabled:hover:translate-y-0"
          >
            <Send size={16} strokeWidth={2} />
          </button>
        ) : (
          <button
            type="button"
            onClick={startRecording}
            disabled={recording || !viaSession}
            title="Gravar áudio"
            className="p-2.5 rounded-full bg-ink-950 dark:bg-white text-white dark:text-ink-950 shadow-sm hover:shadow-md hover:-translate-y-px transition-all disabled:opacity-50 disabled:hover:translate-y-0"
          >
            <Mic size={16} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
}
