/**
 * Schema do banco que o app usa. Produção não define nada → 'public'
 * (comportamento inalterado). A instância de DEMO define
 * NEXT_PUBLIC_SUPABASE_SCHEMA=demo para ler de um schema isolado com
 * dados 100% fictícios, sem tocar na produção.
 */
export function dbSchema(): string | undefined {
  const s = process.env.NEXT_PUBLIC_SUPABASE_SCHEMA?.trim();
  return s && s !== 'public' ? s : undefined;
}

export function isDemo(): boolean {
  return dbSchema() === 'demo';
}

// Opção `db.schema` só quando um schema não-public está configurado
export function dbSchemaOption(): { db?: { schema: string } } {
  const s = dbSchema();
  return s ? { db: { schema: s } } : {};
}
