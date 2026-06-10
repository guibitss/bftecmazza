'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Send, Paperclip, Mic, Clock, Lock, ChevronDown, Sparkles, Headset,
  User as UserIcon, Check, AlertCircle, X, Square, Image as ImageIcon,
  FileText, Film, Music,
} from 'lucide-react';
import type { InboxAccess } from '@/lib/auth';
import { createClient } from '@/lib/supabase/client';
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

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
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

    recorder.onstop = () => {
      const chunks = recChunksRef.current;
      recChunksRef.current = [];
      recorderRef.current = null;
      setRecording(false);
      setRecSeconds(0);
      if (chunks.length === 0) return;
      const mime = chunks[0].type || 'audio/webm';
      const blob = new Blob(chunks, { type: mime });
      const ext  = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'mp4' : 'webm';
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

        <div className="flex-1 min-w-0">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              pendingFile
                ? 'Legenda (opcional)…'
                : recording
                ? 'Gravando áudio…'
                : 'Mensagem… (Enter envia, Shift+Enter quebra linha)'
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
