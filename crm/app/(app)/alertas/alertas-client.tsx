'use client';

import { useState, useTransition } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, AlertCircle, Power } from 'lucide-react';
import { createMetricAlert, toggleAlert, deleteAlert } from './actions';

interface Store { id: number; slug: string }
interface Vendor { id: number; name: string; store_id: number }
interface Alert {
  id: number;
  storeId: number;
  storeSlug: string;
  vendorId: number | null;
  vendorName: string | null;
  metric: string;
  comparison: 'gt' | 'lt';
  threshold: number;
  whatsappNumber: string;
  frequency: string;
  enabled: boolean;
  lastTriggeredAt: string | null;
}

const METRIC_OPTIONS = [
  { value: 'avg_response_in_hours',  label: 'Tempo de resposta · horário comercial', unit: 'segundos' },
  { value: 'avg_response_off_hours', label: 'Tempo de resposta · fora do horário',   unit: 'segundos' },
  { value: 'contacts',               label: 'Quantidade de contatos atendidos',      unit: 'contatos' },
  { value: 'msgs_per_contact',       label: 'Mensagens por contato (média)',         unit: 'msgs' },
];

const FREQ_OPTIONS = [
  { value: 'once_per_hour', label: 'no máximo 1 vez por hora' },
  { value: 'once_per_day',  label: 'no máximo 1 vez por dia' },
  { value: 'always',        label: 'sempre que detectar' },
];

function metricLabel(m: string): string {
  return METRIC_OPTIONS.find(o => o.value === m)?.label ?? m;
}
function freqLabel(f: string): string {
  return FREQ_OPTIONS.find(o => o.value === f)?.label ?? f;
}

interface Props {
  stores: Store[];
  vendors: Vendor[];
  alerts: Alert[];
  defaultWhatsapp: string;
}

export default function AlertasClient({ stores, vendors, alerts, defaultWhatsapp }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [storeId, setStoreId] = useState<number>(stores[0]?.id ?? 0);
  const [vendorId, setVendorId] = useState<number | null>(null);
  const [metric, setMetric] = useState(METRIC_OPTIONS[0].value);
  const [comparison, setComparison] = useState<'gt' | 'lt'>('gt');
  const [threshold, setThreshold] = useState('');
  const [whatsapp, setWhatsapp] = useState(defaultWhatsapp);
  const [frequency, setFrequency] = useState<'once_per_hour' | 'once_per_day' | 'always'>('once_per_day');

  function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    const numThreshold = Number(threshold);
    if (isNaN(numThreshold)) { setError('Limite inválido'); return; }
    startTransition(async () => {
      const res = await createMetricAlert({
        storeId, vendorId, metric, comparison,
        threshold: numThreshold,
        whatsappNumber: whatsapp,
        frequency,
      });
      if (!res.ok) { setError(res.error ?? 'Erro'); return; }
      setThreshold('');
    });
  }
  function handleToggle(id: number, enabled: boolean) {
    startTransition(async () => { await toggleAlert(id, enabled); });
  }
  function handleDelete(id: number) {
    if (!confirm('Excluir alerta?')) return;
    startTransition(async () => { await deleteAlert(id); });
  }

  const vendorsOfStore = vendors.filter(v => v.store_id === storeId);
  const metricOpt = METRIC_OPTIONS.find(o => o.value === metric);

  return (
    <div className="space-y-8">
      {/* Form */}
      <Card className="p-6">
        <h3 className="text-[14px] font-semibold tracking-tight mb-1">Novo alerta</h3>
        <p className="text-[11.5px] text-fg-muted mb-4">Você é notificado quando a métrica passar do limite escolhido.</p>
        <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-[10.5px] font-medium text-fg-muted uppercase tracking-[0.12em]">Loja</label>
            {stores.length === 1 ? (
              <Input value={stores[0].slug} disabled />
            ) : (
              <select value={storeId} onChange={e => { setStoreId(Number(e.target.value)); setVendorId(null); }}
                className="h-12 w-full rounded-xl border border-border bg-surface px-4 text-[15px]">
                {stores.map(s => <option key={s.id} value={s.id}>{s.slug}</option>)}
              </select>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-[10.5px] font-medium text-fg-muted uppercase tracking-[0.12em]">Vendedora</label>
            <select value={vendorId ?? ''} onChange={e => setVendorId(e.target.value ? Number(e.target.value) : null)}
              className="h-12 w-full rounded-xl border border-border bg-surface px-4 text-[15px]">
              <option value="">— Todas (média da loja)</option>
              {vendorsOfStore.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-[10.5px] font-medium text-fg-muted uppercase tracking-[0.12em]">Métrica</label>
            <select value={metric} onChange={e => setMetric(e.target.value)}
              className="h-12 w-full rounded-xl border border-border bg-surface px-4 text-[15px]">
              {METRIC_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10.5px] font-medium text-fg-muted uppercase tracking-[0.12em]">Quando</label>
            <select value={comparison} onChange={e => setComparison(e.target.value as 'gt' | 'lt')}
              className="h-12 w-full rounded-xl border border-border bg-surface px-4 text-[15px]">
              <option value="gt">Ficar ACIMA de</option>
              <option value="lt">Ficar ABAIXO de</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10.5px] font-medium text-fg-muted uppercase tracking-[0.12em]">
              Limite <span className="text-fg-subtle normal-case">({metricOpt?.unit})</span>
            </label>
            <Input value={threshold} onChange={e => setThreshold(e.target.value)} required type="number" step="any" min="0" placeholder="ex: 300" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10.5px] font-medium text-fg-muted uppercase tracking-[0.12em]">Seu WhatsApp</label>
            <Input value={whatsapp} onChange={e => setWhatsapp(e.target.value)} required placeholder="554198765432" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10.5px] font-medium text-fg-muted uppercase tracking-[0.12em]">Frequência</label>
            <select value={frequency} onChange={e => setFrequency(e.target.value as typeof frequency)}
              className="h-12 w-full rounded-xl border border-border bg-surface px-4 text-[15px]">
              {FREQ_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {error && (
            <div className="sm:col-span-2 flex items-start gap-2 text-[13px] text-red-700 dark:text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-3.5 py-2.5">
              <AlertCircle size={15} className="mt-0.5 shrink-0" /><span>{error}</span>
            </div>
          )}
          <div className="sm:col-span-2 flex justify-end">
            <Button type="submit" disabled={pending}>
              <Plus size={14} /> {pending ? 'Criando…' : 'Criar alerta'}
            </Button>
          </div>
        </form>
      </Card>

      {/* Lista */}
      <div>
        <div className="flex items-center gap-4 mb-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-fg-subtle">Alertas ativos</div>
          <div className="flex-1 h-px bg-border" />
        </div>
        {alerts.length === 0 ? (
          <Card className="p-10 text-center"><p className="text-fg-muted text-[13px]">Nenhum alerta configurado.</p></Card>
        ) : (
          <ul className="space-y-3">
            {alerts.map(a => (
              <li key={a.id}>
                <Card className="p-5">
                  <div className="flex items-start gap-4">
                    <button type="button" onClick={() => handleToggle(a.id, !a.enabled)} disabled={pending}
                      title={a.enabled ? 'Pausar alerta' : 'Ativar alerta'}
                      className={`p-2 rounded-lg transition-colors ${
                        a.enabled
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20'
                          : 'bg-zinc-500/10 text-fg-subtle hover:bg-zinc-500/20'
                      }`}>
                      <Power size={14} />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-medium">
                        {metricLabel(a.metric)}
                        <span className="text-fg-muted font-normal"> {a.comparison === 'gt' ? 'acima de' : 'abaixo de'} </span>
                        <span className="num">{a.threshold}</span>
                      </div>
                      <div className="text-[11.5px] text-fg-muted mt-1 flex flex-wrap gap-x-3 gap-y-1">
                        <span>📍 {a.storeSlug}{a.vendorName ? ` · ${a.vendorName}` : ' (média da loja)'}</span>
                        <span>📞 +{a.whatsappNumber}</span>
                        <span>⏱ {freqLabel(a.frequency)}</span>
                        {a.lastTriggeredAt && (
                          <span>↗ último disparo {new Date(a.lastTriggeredAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                        )}
                      </div>
                    </div>
                    <button onClick={() => handleDelete(a.id)} disabled={pending}
                      className="p-2 rounded-lg text-fg-muted hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
