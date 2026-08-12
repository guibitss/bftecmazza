-- Mescla conversas duplicadas do mesmo contato (efeito da migração pra @lid).
-- Move tudo da secundária pra principal e remove a secundária. Atômico.
CREATE OR REPLACE FUNCTION merge_conversas(p_principal int, p_secundaria int)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_principal = p_secundaria THEN RETURN; END IF;

  -- mensagens
  UPDATE messages SET conversation_id = p_principal WHERE conversation_id = p_secundaria;

  -- etiquetas (sem duplicar as que a principal já tem)
  INSERT INTO conversation_labels (conversation_id, label_id, assigned_by, assigned_at)
  SELECT p_principal, label_id, assigned_by, assigned_at
  FROM conversation_labels WHERE conversation_id = p_secundaria
  ON CONFLICT DO NOTHING;
  DELETE FROM conversation_labels WHERE conversation_id = p_secundaria;

  -- agendamentos
  UPDATE scheduled_messages SET conversation_id = p_principal WHERE conversation_id = p_secundaria;

  -- completa dados que faltarem na principal (nome, telefone, foto, origem do anúncio)
  UPDATE conversations pr SET
    customer_name  = COALESCE(NULLIF(pr.customer_name, ''), NULLIF(se.customer_name, '')),
    customer_phone = COALESCE(pr.customer_phone, se.customer_phone),
    avatar_url     = COALESCE(pr.avatar_url, se.avatar_url),
    ad_ctwa_clid   = COALESCE(pr.ad_ctwa_clid, se.ad_ctwa_clid),
    ad_source_id   = COALESCE(pr.ad_source_id, se.ad_source_id),
    ad_source_url  = COALESCE(pr.ad_source_url, se.ad_source_url),
    ad_headline    = COALESCE(pr.ad_headline, se.ad_headline),
    first_message_at = LEAST(COALESCE(pr.first_message_at, se.first_message_at), COALESCE(se.first_message_at, pr.first_message_at)),
    last_message_at  = GREATEST(pr.last_message_at, se.last_message_at),
    unread_count   = pr.unread_count + COALESCE(se.unread_count, 0)
  FROM conversations se
  WHERE pr.id = p_principal AND se.id = p_secundaria;

  -- a análise da secundária perde sentido; a principal será reanalisada
  DELETE FROM conversation_analysis WHERE conversation_id = p_secundaria;
  UPDATE conversation_analysis SET analyzed_at = '1970-01-01'::timestamptz
  WHERE conversation_id = p_principal;

  DELETE FROM conversations WHERE id = p_secundaria;
END;
$$;
SELECT 'função criada' as r;
