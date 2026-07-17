// Resolve o período selecionado (?p=hoje|7|30|custom&from&to) em datas concretas
export interface Period {
  from: Date;
  to: Date;
  label: string;
  isDefault30: boolean;
}

export function resolvePeriod(sp: { p?: string; from?: string; to?: string }): Period {
  const now = new Date();
  const p = sp.p ?? '30';

  if (p === 'custom' && sp.from && sp.to) {
    const from = new Date(`${sp.from}T00:00:00-03:00`);
    const to = new Date(`${sp.to}T23:59:59-03:00`);
    if (!isNaN(from.getTime()) && !isNaN(to.getTime()) && from <= to) {
      const fmt = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      return { from, to, label: `${fmt(from)} – ${fmt(to)}`, isDefault30: false };
    }
  }
  if (p === 'hoje') {
    const from = new Date(now); from.setHours(0, 0, 0, 0);
    return { from, to: now, label: 'hoje', isDefault30: false };
  }
  if (p === '7') {
    return { from: new Date(now.getTime() - 7 * 86400_000), to: now, label: 'últimos 7 dias', isDefault30: false };
  }
  return { from: new Date(now.getTime() - 30 * 86400_000), to: now, label: 'últimos 30 dias', isDefault30: true };
}
