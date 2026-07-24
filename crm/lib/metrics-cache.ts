/**
 * Cache em memória das métricas (processo único no VPS → sobrevive entre
 * requests). As análises só mudam a cada 4h (cron), então servir com alguns
 * minutos de defasagem é seguro e elimina a recomputação pesada por request
 * (vendor_quality_metrics leva ~3s frio). Chave estável por período.
 */
type Entry = { at: number; value: unknown };
const store = new Map<string, Entry>();
const TTL_MS = 5 * 60 * 1000;

export async function cachedMetric<T>(key: string, producer: () => Promise<T>, ttl = TTL_MS): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  const value = await producer();
  // Não cacheia vazio/erro (evita prender a tela num estado ruim)
  if (value != null && !(Array.isArray(value) && value.length === 0)) {
    store.set(key, { at: Date.now(), value });
  }
  return value;
}
