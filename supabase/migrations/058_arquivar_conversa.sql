-- Arquivar conversa: some da lista principal sem apagar nada. A vendedora
-- arrasta o item pro lado (igual WhatsApp) e ele sai da caixa; dá pra ver e
-- restaurar em "Arquivadas".
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS conversations_archived_idx
  ON public.conversations (inbox_id, archived_at, last_message_at DESC);

ALTER TABLE demo.conversations ADD COLUMN IF NOT EXISTS archived_at timestamptz;

SELECT 'ok' as r;
