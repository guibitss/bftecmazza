-- Fixar conversa: sobe pro topo da lista e fica marcada com um pin, igual
-- WhatsApp. Arrastar pra DIREITA fixa/desafixa (a esquerda já arquiva).
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS pinned_at timestamptz;
CREATE INDEX IF NOT EXISTS conversations_pinned_idx
  ON public.conversations (inbox_id, pinned_at DESC NULLS LAST, last_message_at DESC);

ALTER TABLE demo.conversations ADD COLUMN IF NOT EXISTS pinned_at timestamptz;

SELECT 'ok' AS r;
