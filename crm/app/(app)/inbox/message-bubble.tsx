'use client';

import Image from 'next/image';
import { Check, CheckCheck, Sparkles, Headset, FileText, Play, Download } from 'lucide-react';
import { timeHHMM } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface MsgRow {
  id: number;
  conversation_id: number;
  direction: 'in' | 'out';
  author_type: 'customer' | 'ai' | 'vendor' | 'support';
  author_id: number | null;
  author_session: string | null;
  kind: 'text' | 'audio' | 'image' | 'video' | 'document' | 'location' | 'sticker' | 'reaction' | 'system';
  body: string | null;
  media_url: string | null;
  media_mime: string | null;
  media_filename: string | null;
  ack: number;
  created_at: string;
}

function AckIcon({ ack }: { ack: number }) {
  if (ack < 1) return null;
  if (ack >= 3) return <CheckCheck size={13} className="text-sky-400" strokeWidth={2.2} />;
  if (ack === 2) return <CheckCheck size={13} className="text-white/60" strokeWidth={2.2} />;
  return <Check size={13} className="text-white/60" strokeWidth={2.2} />;
}

function AuthorBadge({ msg }: { msg: MsgRow }) {
  if (msg.direction === 'in') return null;
  const Icon =
    msg.author_type === 'ai'      ? Sparkles :
    msg.author_type === 'support' ? Headset  : null;
  if (!Icon && msg.author_type === 'vendor') return null;
  if (!Icon) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider opacity-75">
      <Icon size={10} />
      {msg.author_type === 'ai' ? 'IA' : 'suporte'}
    </span>
  );
}

export function MessageBubble({ msg }: { msg: MsgRow }) {
  const isOut = msg.direction === 'out';

  return (
    <div className={cn('flex animate-fade-in', isOut ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[78%] sm:max-w-[68%] md:max-w-[60%] rounded-2xl px-3.5 py-2 text-[14px] leading-snug',
          'shadow-sm',
          isOut
            ? 'bg-ink-950 text-white rounded-br-md'
            : 'bg-surface text-fg border border-border rounded-bl-md',
        )}
      >
        {/* Mídia */}
        {msg.kind === 'image' && msg.media_url && (
          <a href={msg.media_url} target="_blank" rel="noopener" className="block -mx-2 -mt-1 mb-1.5">
            <Image
              src={msg.media_url}
              alt={msg.media_filename ?? 'imagem'}
              width={480} height={480}
              unoptimized
              className="rounded-xl max-h-[320px] w-auto object-contain"
            />
          </a>
        )}
        {msg.kind === 'video' && msg.media_url && (
          <video
            controls
            preload="metadata"
            src={msg.media_url}
            className="rounded-xl max-h-[320px] -mx-2 -mt-1 mb-1.5"
          />
        )}
        {msg.kind === 'audio' && msg.media_url && (
          <audio controls preload="metadata" src={msg.media_url} className="my-1 max-w-full" />
        )}
        {msg.kind === 'document' && msg.media_url && (
          <a
            href={msg.media_url}
            target="_blank"
            rel="noopener"
            className={cn(
              'flex items-center gap-2 rounded-lg px-2.5 py-2 mb-1',
              isOut ? 'bg-white/10 hover:bg-white/15' : 'bg-surface-muted hover:bg-border',
            )}
          >
            <FileText size={16} className="shrink-0" />
            <span className="truncate text-[12.5px] flex-1">{msg.media_filename ?? 'arquivo'}</span>
            <Download size={14} className="shrink-0 opacity-70" />
          </a>
        )}
        {msg.kind === 'sticker' && msg.media_url && (
          <Image src={msg.media_url} alt="sticker" width={120} height={120} unoptimized className="max-h-[120px] w-auto" />
        )}
        {msg.kind === 'location' && (
          <div className="text-[12.5px] italic opacity-80">📍 localização compartilhada</div>
        )}

        {/* Texto / caption */}
        {msg.body && (
          <div className="whitespace-pre-wrap break-words">{msg.body}</div>
        )}
        {!msg.body && !msg.media_url && msg.kind !== 'text' && (
          <div className={cn('text-[12.5px] italic', isOut ? 'opacity-70' : 'text-fg-muted')}>
            [{msg.kind}]
          </div>
        )}

        {/* Meta */}
        <div className={cn(
          'flex items-center gap-1.5 mt-1 text-[10.5px] num',
          isOut ? 'justify-end text-white/60' : 'justify-end text-fg-subtle',
        )}>
          <AuthorBadge msg={msg} />
          <span>{timeHHMM(msg.created_at)}</span>
          {isOut && <AckIcon ack={msg.ack} />}
        </div>
      </div>
    </div>
  );
}
