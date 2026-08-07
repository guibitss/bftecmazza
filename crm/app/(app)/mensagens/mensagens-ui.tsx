'use client';

import { useState, useTransition, useRef } from 'react';
import { Plus, Trash2, Pencil, Check, X, Paperclip, Image as ImageIcon, FileText, Film, Music, Loader2 } from 'lucide-react';
import { saveGreetings, addQuickReply, updateQuickReply, deleteQuickReply } from './actions';
import { createClient } from '@/lib/supabase/client';

function kindOf(mime: string): string {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

function IconOf({ kind, size = 15 }: { kind: string; size?: number }) {
  if (kind === 'image') return <ImageIcon size={size} />;
  if (kind === 'video') return <Film size={size} />;
  if (kind === 'audio') return <Music size={size} />;
  return <FileText size={size} />;
}

// ── Saudações por vendedora ──────────────────────────────────────────────────
export function GreetingForm({ vendorId, name, greeting, greetingOff }: {
  vendorId: number; name: string; greeting: string; greetingOff: string;
}) {
  const [g, setG] = useState(greeting);
  const [off, setOff] = useState(greetingOff);
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();
  const dirty = g !== greeting || off !== greetingOff;

  function save() {
    setMsg('');
    start(async () => {
      const r = await saveGreetings(vendorId, g, off);
      setMsg(r.ok ? 'Salvo!' : (r.error ?? 'Erro.'));
      setTimeout(() => setMsg(''), 2500);
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="text-[14px] font-semibold capitalize mb-3">{name}</div>
      <label className="block text-[11px] uppercase tracking-[0.12em] text-fg-subtle mb-1.5">
        Saudação (dentro do horário)
      </label>
      <textarea value={g} onChange={e => setG(e.target.value)} rows={2}
        className="w-full resize-y rounded-xl border border-border bg-surface-2 px-3 py-2 text-[13px] focus:outline-none focus:border-border-strong" />
      <label className="block text-[11px] uppercase tracking-[0.12em] text-fg-subtle mt-4 mb-1.5">
        Mensagem de fora do horário
      </label>
      <textarea value={off} onChange={e => setOff(e.target.value)} rows={3}
        className="w-full resize-y rounded-xl border border-border bg-surface-2 px-3 py-2 text-[13px] focus:outline-none focus:border-border-strong" />
      <div className="mt-3 flex items-center gap-3">
        <button onClick={save} disabled={pending || !dirty}
          className="h-9 px-4 rounded-lg bg-fg text-bg text-[13px] font-medium disabled:opacity-40 hover:opacity-80 transition-opacity">
          Salvar
        </button>
        {msg && <span className={`text-[12px] ${msg === 'Salvo!' ? 'text-green-500' : 'text-red-500'}`}>{msg}</span>}
      </div>
    </div>
  );
}

// ── Mensagens rápidas ────────────────────────────────────────────────────────
interface QR {
  id: string; title: string | null; body: string | null;
  media_url?: string | null; media_filename?: string | null; kind?: string | null;
}

export function QuickReplyManager({ initial }: { initial: QR[] }) {
  const [items, setItems] = useState<QR[]>(initial);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pending, start] = useTransition();
  const [media, setMedia] = useState<{ url: string; mime: string; filename: string; kind: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [erro, setErro] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setErro(''); setUploading(true);
    try {
      const supabase = createClient();
      const path = `quick-replies/${Date.now()}-${f.name}`;
      const { error } = await supabase.storage.from('media').upload(path, f, { contentType: f.type, upsert: false });
      if (error) throw new Error(error.message);
      const { data } = supabase.storage.from('media').getPublicUrl(path);
      setMedia({ url: data.publicUrl, mime: f.type, filename: f.name, kind: kindOf(f.type) });
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha no upload.');
    } finally {
      setUploading(false);
    }
  }

  function add() {
    if (!body.trim() && !media) return;
    start(async () => {
      const r = await addQuickReply(title, body, media);
      if (r.ok) { setTitle(''); setBody(''); setMedia(null); location.reload(); }
      else setErro(r.error ?? 'Erro ao salvar.');
    });
  }

  return (
    <div className="space-y-4">
      {/* Nova */}
      <div className="rounded-2xl border border-border bg-surface p-5 space-y-2.5">
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Título (opcional, ex: Saudação)"
          className="w-full h-9 px-3 rounded-lg border border-border bg-surface-2 text-[13px] focus:outline-none focus:border-border-strong" />
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={2} placeholder="Mensagem pronta pra enviar… (opcional se anexar arquivo)"
          className="w-full resize-y rounded-xl border border-border bg-surface-2 px-3 py-2 text-[13px] focus:outline-none focus:border-border-strong" />

        {/* Anexo */}
        {media && (
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-border bg-surface-2">
            {media.kind === 'image'
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={media.url} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
              : <span className="text-fg-muted shrink-0"><IconOf kind={media.kind} size={18} /></span>}
            <span className="text-[12.5px] flex-1 truncate">{media.filename}</span>
            <button onClick={() => setMedia(null)} className="p-1 rounded text-fg-subtle hover:text-fg" aria-label="Remover anexo">
              <X size={14} />
            </button>
          </div>
        )}

        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" className="hidden" onChange={onPick}
            accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip" />
          <button onClick={add} disabled={pending || uploading || (!body.trim() && !media)}
            className="h-9 px-4 rounded-lg bg-fg text-bg text-[13px] font-medium flex items-center gap-1.5 disabled:opacity-40 hover:opacity-80 transition-opacity">
            <Plus size={15} /> Adicionar
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="h-9 px-3 rounded-lg border border-border text-[13px] text-fg-muted hover:text-fg hover:border-border-strong transition-colors flex items-center gap-1.5 disabled:opacity-40">
            {uploading ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
            {uploading ? 'Enviando…' : 'Anexar'}
          </button>
          {erro && <span className="text-[12px] text-red-500">{erro}</span>}
        </div>
      </div>

      {/* Lista */}
      {items.length === 0 ? (
        <p className="text-[13px] text-fg-muted px-1">Nenhuma mensagem rápida ainda.</p>
      ) : (
        <ul className="space-y-2">
          {items.map(qr => (
            <QuickReplyRow key={qr.id} qr={qr} onDeleted={() => setItems(x => x.filter(i => i.id !== qr.id))} />
          ))}
        </ul>
      )}
    </div>
  );
}

function QuickReplyRow({ qr, onDeleted }: { qr: QR; onDeleted: () => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(qr.title ?? '');
  const [body, setBody] = useState(qr.body ?? '');
  const [pending, start] = useTransition();

  function save() {
    start(async () => {
      const r = await updateQuickReply(qr.id, title, body);
      if (r.ok) { qr.title = title || null; qr.body = body; setEditing(false); }
    });
  }
  function remove() {
    start(async () => { const r = await deleteQuickReply(qr.id); if (r.ok) onDeleted(); });
  }

  if (editing) {
    return (
      <li className="rounded-2xl border border-border bg-surface p-4 space-y-2">
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Título (opcional)"
          className="w-full h-8 px-3 rounded-lg border border-border bg-surface-2 text-[13px] focus:outline-none focus:border-border-strong" />
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={2}
          className="w-full resize-y rounded-xl border border-border bg-surface-2 px-3 py-2 text-[13px] focus:outline-none focus:border-border-strong" />
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={pending} className="h-8 px-3 rounded-lg bg-fg text-bg text-[12px] font-medium flex items-center gap-1 disabled:opacity-40"><Check size={13} /> Salvar</button>
          <button onClick={() => setEditing(false)} className="h-8 px-3 rounded-lg border border-border text-[12px] text-fg-muted hover:text-fg flex items-center gap-1"><X size={13} /> Cancelar</button>
        </div>
      </li>
    );
  }

  return (
    <li className="rounded-2xl border border-border bg-surface p-4 flex items-start justify-between gap-3">
      <div className="min-w-0 flex items-start gap-2.5">
        {qr.media_url && (
          qr.kind === 'image'
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={qr.media_url} alt="" className="w-11 h-11 rounded-lg object-cover shrink-0 border border-border" />
            : <span className="w-11 h-11 rounded-lg border border-border bg-surface-2 grid place-items-center text-fg-muted shrink-0">
                <IconOf kind={qr.kind ?? 'document'} size={17} />
              </span>
        )}
        <div className="min-w-0">
          {qr.title && <div className="text-[12.5px] font-semibold mb-0.5">{qr.title}</div>}
          {qr.body && <div className="text-[13px] text-fg-muted whitespace-pre-wrap leading-snug">{qr.body}</div>}
          {qr.media_url && !qr.body && (
            <div className="text-[12px] text-fg-subtle truncate">{qr.media_filename ?? 'anexo'}</div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={() => setEditing(true)} className="p-2 rounded-lg text-fg-subtle hover:text-fg hover:bg-surface-muted transition-colors" aria-label="Editar"><Pencil size={14} /></button>
        <button onClick={remove} disabled={pending} className="p-2 rounded-lg text-fg-subtle hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-40" aria-label="Remover"><Trash2 size={14} /></button>
      </div>
    </li>
  );
}
