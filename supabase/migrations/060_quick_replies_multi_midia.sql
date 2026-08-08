-- Mensagem rápida com VÁRIAS mídias (ex: 3 fotos do aparelho de uma vez).
-- media_items: [{url, mime, filename, kind}, ...]. As colunas antigas (media_url
-- etc.) continuam pra não quebrar o que já existe — na leitura, quem tiver
-- media_items usa a lista; senão cai no anexo único.
ALTER TABLE public.quick_replies ADD COLUMN IF NOT EXISTS media_items jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE demo.quick_replies   ADD COLUMN IF NOT EXISTS media_items jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Migra o anexo único que já existir para a lista
UPDATE public.quick_replies
SET media_items = jsonb_build_array(jsonb_build_object(
      'url', media_url, 'mime', media_mime, 'filename', media_filename, 'kind', kind))
WHERE media_url IS NOT NULL AND jsonb_array_length(media_items) = 0;

SELECT count(*) AS migradas FROM public.quick_replies WHERE jsonb_array_length(media_items) > 0;
