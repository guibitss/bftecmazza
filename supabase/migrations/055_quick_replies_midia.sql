-- Mensagem rápida com mídia: a vendedora salva uma foto/vídeo/arquivo junto do
-- texto (ex: tabela de preços, foto do modelo) e envia com um clique.
-- A mídia fica no Storage (mesmo bucket do composer) e é enviada por URL.

ALTER TABLE public.quick_replies
  ADD COLUMN IF NOT EXISTS media_url      text,
  ADD COLUMN IF NOT EXISTS media_mime     text,
  ADD COLUMN IF NOT EXISTS media_filename text,
  ADD COLUMN IF NOT EXISTS kind           text NOT NULL DEFAULT 'text';

ALTER TABLE demo.quick_replies
  ADD COLUMN IF NOT EXISTS media_url      text,
  ADD COLUMN IF NOT EXISTS media_mime     text,
  ADD COLUMN IF NOT EXISTS media_filename text,
  ADD COLUMN IF NOT EXISTS kind           text NOT NULL DEFAULT 'text';

-- body deixa de ser obrigatório: mensagem só com mídia é válida (a legenda é opcional)
ALTER TABLE public.quick_replies ALTER COLUMN body DROP NOT NULL;
ALTER TABLE demo.quick_replies   ALTER COLUMN body DROP NOT NULL;
