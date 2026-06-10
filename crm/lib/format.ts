/**
 * Tempo relativo curto, estilo WhatsApp.
 * agora · 5min · 14:32 (mesmo dia) · ontem · 3/jun
 */
export function timeRelative(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const sec = Math.floor(diffMs / 1000);
  const min = Math.floor(sec / 60);
  const hr  = Math.floor(min / 60);
  const day = Math.floor(hr / 24);

  if (sec < 30)  return 'agora';
  if (min < 1)   return `${sec}s`;
  if (min < 60)  return `${min}min`;
  // mesmo dia: hora:min
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  // ontem
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'ontem';
  // dentro de 7 dias: dia da semana
  if (day < 7) {
    return d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
  }
  // mesmo ano: 3/jun
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '');
  }
  // outro ano: 3/jun/24
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: '2-digit' }).replace('.', '');
}

/** 14:32 — pra timestamp dentro do bubble */
export function timeHHMM(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** Iniciais pra avatar */
export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name.trim().split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase();
}

/** Formata telefone PT-BR */
export function formatPhone(phone: string | null): string {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  // BR fixo: +55 11 9999-9999 (10) ou móvel: +55 11 99999-9999 (11)
  const m = digits.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  if (m) {
    return `+55 (${m[1]}) ${m[2]}-${m[3]}`;
  }
  return phone;
}

/** Bytes legíveis */
export function formatBytes(n?: number | null): string {
  if (!n || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
