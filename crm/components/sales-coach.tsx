'use client';

import { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Bot, X, Send, Mic, ImagePlus, Maximize2, Minimize2, Square, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

interface Msg { role: 'user' | 'assistant'; content: string; image?: string; }

const COACH_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/sales-coach`;

const SUGESTOES = [
  'Como está meu atendimento?',
  'Onde eu perco vendas?',
  'Me dá um script de fechamento',
];

export function SalesCoach() {
  const pathname = usePathname();
  // No inbox o composer ocupa o canto inferior direito — sobe o botão pra não
  // cobrir o "enviar".
  const onInbox = pathname?.startsWith('/inbox') ?? false;
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [pendingImg, setPendingImg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Botão flutuante arrastável — posição livre (persistida). null = canto padrão.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, loading]);

  // Carrega a posição salva do botão
  useEffect(() => {
    try {
      const s = localStorage.getItem('coach-fab-pos');
      if (s) setPos(JSON.parse(s));
    } catch { /* ignora */ }
  }, []);

  const FAB = 56; // 14 * 4px
  function onFabPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onFabPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    d.moved = true;
    const x = Math.min(Math.max(8, d.ox + dx), window.innerWidth - FAB - 8);
    const y = Math.min(Math.max(8, d.oy + dy), window.innerHeight - FAB - 8);
    setPos({ x, y });
  }
  function onFabPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    const d = dragRef.current;
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ok */ }
    if (d?.moved) {
      setPos(p => {
        if (p) { try { localStorage.setItem('coach-fab-pos', JSON.stringify(p)); } catch { /* ok */ } }
        return p;
      });
    } else {
      setOpen(true); // clique simples abre o painel
    }
  }

  async function send(text: string, imageB64?: string, audioB64?: string) {
    const userMsg: Msg = { role: 'user', content: text || (imageB64 ? '[imagem]' : '[áudio]'), image: imageB64 ?? undefined };
    const nextMsgs = [...msgs, userMsg];
    setMsgs(nextMsgs);
    setInput(''); setPendingImg(null); setLoading(true);
    try {
      // Identidade vai pelo token de login — o servidor decide o escopo
      // (a vendedora só vê os próprios atendimentos). Nunca mandamos vendor_id.
      const { data: { session } } = await createClient().auth.getSession();
      const res = await fetch(COACH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          'Authorization': `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({
          messages: nextMsgs.map(m => ({ role: m.role, content: m.content })),
          image_b64: imageB64, audio_b64: audioB64,
        }),
      });
      const data = await res.json();
      // se transcreveu áudio, mostra o que foi entendido
      if (data.transcript) {
        setMsgs(m => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], content: data.transcript }; return c; });
      }
      setMsgs(m => [...m, { role: 'assistant', content: data.reply ?? data.error ?? 'Não consegui responder.' }]);
    } catch {
      setMsgs(m => [...m, { role: 'assistant', content: 'Falha de conexão. Tenta de novo.' }]);
    } finally {
      setLoading(false);
    }
  }

  function submit() {
    if (loading) return;
    if (!input.trim() && !pendingImg) return;
    send(input.trim(), pendingImg ?? undefined);
  }

  function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setPendingImg(reader.result as string);
    reader.readAsDataURL(f);
    e.target.value = '';
  }

  async function toggleRec() {
    if (recording) {
      recRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = e => chunksRef.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => send('', undefined, reader.result as string);
        reader.readAsDataURL(blob);
        setRecording(false);
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setMsgs(m => [...m, { role: 'assistant', content: 'Não consegui acessar o microfone.' }]);
    }
  }

  return (
    <>
      {/* Botão flutuante */}
      {!open && (
        <button
          type="button"
          onPointerDown={onFabPointerDown}
          onPointerMove={onFabPointerMove}
          onPointerUp={onFabPointerUp}
          style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined}
          className={cn(
            'fixed z-50 w-14 h-14 rounded-full bg-ink-950 dark:bg-white text-white dark:text-ink-950 shadow-lg grid place-items-center hover:scale-105 transition-transform touch-none cursor-grab active:cursor-grabbing',
            !pos && 'right-5',
            !pos && (onInbox ? 'bottom-28' : 'bottom-5'),
          )}
          aria-label="Abrir coach de vendas (arraste para mover)"
          title="Arraste para mover"
        >
          <Bot size={24} strokeWidth={1.75} />
        </button>
      )}

      {/* Painel */}
      {open && (
        <div className={cn(
          'fixed z-50 flex flex-col bg-white dark:bg-zinc-950 border border-border shadow-2xl',
          full
            ? 'inset-2 sm:inset-6 rounded-2xl'
            : 'bottom-5 right-5 w-[min(420px,calc(100vw-2.5rem))] h-[min(600px,calc(100dvh-2.5rem))] rounded-2xl',
        )}>
          {/* Header */}
          <div className="shrink-0 flex items-center gap-2.5 px-4 h-14 hairline-b">
            <div className="w-8 h-8 rounded-lg bg-ink-950 dark:bg-white text-white dark:text-ink-950 grid place-items-center">
              <Bot size={17} strokeWidth={1.75} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13.5px] font-semibold tracking-tight leading-tight">Coach de Vendas</div>
              <div className="text-[10.5px] text-fg-subtle">especialista · com base nas suas métricas</div>
            </div>
            <button type="button" onClick={() => setFull(f => !f)} className="p-2 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-muted transition-colors" aria-label="Expandir">
              {full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="p-2 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-muted transition-colors" aria-label="Fechar">
              <X size={16} />
            </button>
          </div>

          {/* Mensagens */}
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
            {msgs.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center gap-4 px-4">
                <div className="w-12 h-12 rounded-2xl bg-surface-muted grid place-items-center text-fg-subtle">
                  <Bot size={24} strokeWidth={1.5} />
                </div>
                <p className="text-[13px] text-fg-muted max-w-[260px]">
                  Sou seu coach de vendas. Pergunte como melhorar, mande um print de conversa pra eu analisar, ou grave um áudio.
                </p>
                <div className="flex flex-col gap-1.5 w-full max-w-[280px]">
                  {SUGESTOES.map(s => (
                    <button key={s} type="button" onClick={() => send(s)}
                      className="text-[12.5px] text-fg-muted hover:text-fg border border-border rounded-xl px-3 py-2 hover:border-border-strong transition-colors text-left">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
                {m.image && (
                  <img src={m.image} alt="anexo" className="inline-block max-w-[70%] rounded-xl mb-1 border border-border" />
                )}
                <div className={cn(
                  'inline-block max-w-[85%] px-3.5 py-2.5 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap text-left',
                  m.role === 'user'
                    ? 'bg-ink-950 dark:bg-white text-white dark:text-ink-950'
                    : 'bg-surface-muted text-fg',
                )}>
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-[12px] text-fg-subtle">
                <Loader2 size={14} className="animate-spin" /> pensando…
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="shrink-0 border-t border-border p-3">
            {pendingImg && (
              <div className="mb-2 relative inline-block">
                <img src={pendingImg} alt="anexo" className="h-16 rounded-lg border border-border" />
                <button type="button" onClick={() => setPendingImg(null)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-ink-950 dark:bg-white text-white dark:text-ink-950 grid place-items-center">
                  <X size={11} />
                </button>
              </div>
            )}
            <div className="flex items-end gap-1.5">
              <input ref={fileRef} type="file" accept="image/*" onChange={onPickImage} className="hidden" />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={loading}
                className="p-2 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-muted transition-colors disabled:opacity-40" aria-label="Foto">
                <ImagePlus size={18} strokeWidth={1.75} />
              </button>
              <button type="button" onClick={toggleRec} disabled={loading}
                className={cn('p-2 rounded-lg transition-colors disabled:opacity-40',
                  recording ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30' : 'text-fg-muted hover:text-fg hover:bg-surface-muted')}
                aria-label={recording ? 'Parar' : 'Gravar áudio'}>
                {recording ? <Square size={18} strokeWidth={2} /> : <Mic size={18} strokeWidth={1.75} />}
              </button>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
                placeholder={recording ? 'Gravando…' : 'Pergunte ao coach…'}
                rows={1}
                disabled={recording}
                className="flex-1 resize-none max-h-28 px-3 py-2 rounded-xl border border-border bg-surface text-[13px] placeholder:text-fg-subtle focus:outline-none focus:border-border-strong"
              />
              <button type="button" onClick={submit} disabled={loading || (!input.trim() && !pendingImg)}
                className="p-2 rounded-xl bg-ink-950 dark:bg-white text-white dark:text-ink-950 disabled:opacity-40 transition-opacity" aria-label="Enviar">
                <Send size={16} strokeWidth={2} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
