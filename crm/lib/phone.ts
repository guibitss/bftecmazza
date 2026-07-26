/**
 * Normaliza telefone brasileiro do mesmo jeito que a função SQL phone_norm()
 * (migration 042): só dígitos e remove o nono dígito de celular.
 * Precisa bater EXATAMENTE com a SQL — é a chave de internal_contacts.
 */
export function phoneNorm(p: string | null | undefined): string {
  const digits = (p ?? '').replace(/\D/g, '');
  const m = digits.match(/^(55)(\d{2})9(\d{8})$/);
  return m ? m[1] + m[2] + m[3] : digits;
}

/** Formata pra exibição: +55 (44) 9xxxx-xxxx quando reconhece o padrão. */
export function phoneDisplay(p: string | null | undefined): string {
  const d = (p ?? '').replace(/\D/g, '');
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  if (!m) return p ?? '—';
  return `+55 (${m[1]}) ${m[2]}-${m[3]}`;
}
