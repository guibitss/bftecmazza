'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { initials } from '@/lib/format';

interface Props {
  src?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
}

/**
 * Avatar circular — usa foto se disponível, fallback iniciais sobre fundo preto.
 * Se a foto falhar ao carregar, cai pra iniciais automaticamente.
 */
export function Avatar({ src, name, size = 40, className }: Props) {
  const [failed, setFailed] = useState(false);

  // Reseta o "failed" quando a src muda (ex: trocar de conversa)
  useEffect(() => { setFailed(false); }, [src]);

  const showImg = !!src && !failed;
  const ini = initials(name);
  const fontSize = Math.round(size * 0.36);

  return (
    <div
      className={cn(
        'relative shrink-0 rounded-full overflow-hidden bg-ink-950 text-white grid place-items-center font-semibold tracking-tight',
        className,
      )}
      style={{ width: size, height: size, fontSize }}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src!}
          alt={name ?? 'avatar'}
          width={size}
          height={size}
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{ini}</span>
      )}
    </div>
  );
}
