import { Card } from '@/components/ui/card';
import { Clock, MessageCircle, Sun, Moon, Users as UsersIcon } from 'lucide-react';

export interface VendorMetric {
  vendor_id: number;
  vendor_name: string;
  in_hours_avg_secs: number | null;
  in_hours_count: number;
  off_hours_avg_secs: number | null;
  off_hours_count: number;
  contacts: number;
  msgs_per_contact: number | null;
}

function fmtSecs(n: number | null): string {
  if (!n) return '—';
  if (n < 60) return `${Math.round(n)}s`;
  if (n < 3600) return `${Math.round(n / 60)}min`;
  const h = Math.floor(n / 3600);
  const m = Math.round((n % 3600) / 60);
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

interface Props {
  rows: VendorMetric[];
  title?: string;
  subtitle?: string;
}

export function VendorMetricsTable({ rows, title, subtitle }: Props) {
  return (
    <Card className="overflow-hidden p-0">
      {(title || subtitle) && (
        <div className="px-6 py-4 hairline-b">
          {title && <h3 className="text-[14px] font-semibold tracking-tight">{title}</h3>}
          {subtitle && <p className="text-[11.5px] text-fg-muted mt-0.5">{subtitle}</p>}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-fg-subtle">
              <th className="px-6 py-3 font-medium">Vendedora</th>
              <th className="px-3 py-3 font-medium">
                <span className="inline-flex items-center gap-1"><Sun size={11} /> Resp. comercial</span>
              </th>
              <th className="px-3 py-3 font-medium">
                <span className="inline-flex items-center gap-1"><Moon size={11} /> Resp. fora hor.</span>
              </th>
              <th className="px-3 py-3 font-medium">
                <span className="inline-flex items-center gap-1"><UsersIcon size={11} /> Contatos</span>
              </th>
              <th className="px-3 py-3 font-medium">
                <span className="inline-flex items-center gap-1"><MessageCircle size={11} /> Msgs/contato</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-[12.5px] text-fg-muted">Sem dados no período.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.vendor_id} className="border-t border-border hover:bg-surface-muted/50 transition-colors">
                <td className="px-6 py-3">
                  <span className="text-[13.5px] font-medium capitalize">{r.vendor_name}</span>
                </td>
                <td className="px-3 py-3 text-[12.5px] num">
                  {fmtSecs(r.in_hours_avg_secs)}
                  <span className="text-fg-subtle ml-1">({r.in_hours_count})</span>
                </td>
                <td className="px-3 py-3 text-[12.5px] num">
                  {fmtSecs(r.off_hours_avg_secs)}
                  <span className="text-fg-subtle ml-1">({r.off_hours_count})</span>
                </td>
                <td className="px-3 py-3 text-[12.5px] num">{r.contacts}</td>
                <td className="px-3 py-3 text-[12.5px] num">{r.msgs_per_contact ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function VendorMetricsHero({ metric }: { metric: VendorMetric }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="text-[10px] uppercase tracking-[0.14em] text-fg-subtle flex items-center gap-1.5">
          <Sun size={11} /> Resp. comercial
        </div>
        <div className="mt-2 text-[26px] font-semibold tracking-[-0.03em] num leading-none">
          {fmtSecs(metric.in_hours_avg_secs)}
        </div>
        <div className="text-[11px] text-fg-muted mt-1.5">{metric.in_hours_count} resp.</div>
      </div>
      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="text-[10px] uppercase tracking-[0.14em] text-fg-subtle flex items-center gap-1.5">
          <Moon size={11} /> Resp. fora hor.
        </div>
        <div className="mt-2 text-[26px] font-semibold tracking-[-0.03em] num leading-none">
          {fmtSecs(metric.off_hours_avg_secs)}
        </div>
        <div className="text-[11px] text-fg-muted mt-1.5">{metric.off_hours_count} resp.</div>
      </div>
      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="text-[10px] uppercase tracking-[0.14em] text-fg-subtle flex items-center gap-1.5">
          <UsersIcon size={11} /> Contatos
        </div>
        <div className="mt-2 text-[26px] font-semibold tracking-[-0.03em] num leading-none">{metric.contacts}</div>
        <div className="text-[11px] text-fg-muted mt-1.5">últimos 30 dias</div>
      </div>
      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="text-[10px] uppercase tracking-[0.14em] text-fg-subtle flex items-center gap-1.5">
          <MessageCircle size={11} /> Msgs/contato
        </div>
        <div className="mt-2 text-[26px] font-semibold tracking-[-0.03em] num leading-none">
          {metric.msgs_per_contact ?? '—'}
        </div>
        <div className="text-[11px] text-fg-muted mt-1.5">média do período</div>
      </div>
    </div>
  );
}
