-- Contatos internos (funcionários, sócios, parceiros) que conversam pelo
-- WhatsApp das vendedoras. Não são clientes: ficam fora da análise de
-- atendimento. O agente não tem como adivinhar isso — é cadastro.
CREATE TABLE IF NOT EXISTS internal_contacts (
  phone_norm text PRIMARY KEY,          -- só dígitos, sem o 9º dígito
  nome       text,
  motivo     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE internal_contacts ENABLE ROW LEVEL SECURITY;

-- Normaliza telefone: só dígitos e remove o nono dígito brasileiro
CREATE OR REPLACE FUNCTION phone_norm(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(
           regexp_replace(COALESCE(p, ''), '\D', '', 'g'),
           '^(55)(\d{2})9(\d{8})$', '\1\2\3');
$$;

INSERT INTO internal_contacts (phone_norm, nome, motivo)
VALUES (phone_norm('+554498513941'), 'Jeferson Nogueira', 'funcionário da loja')
ON CONFLICT (phone_norm) DO NOTHING;

-- Marca as análises existentes desses contatos como não-atendimento
UPDATE conversation_analysis ca
SET eh_atendimento = false
FROM conversations c
WHERE c.id = ca.conversation_id
  AND phone_norm(c.customer_phone) IN (SELECT phone_norm FROM internal_contacts);

-- Fila de análise passa a ignorar contatos internos (e vendedoras entre si)
CREATE OR REPLACE FUNCTION conversations_to_analyze(p_since timestamptz, p_limit int DEFAULT 60)
RETURNS TABLE(id int, store_id int, vendor_id int, last_message_at timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT c.id, c.store_id, i.vendor_id, c.last_message_at
  FROM conversations c
  JOIN inboxes i ON i.id = c.inbox_id AND i.kind = 'vendor' AND i.vendor_id IS NOT NULL
  LEFT JOIN conversation_analysis ca ON ca.conversation_id = c.id
  WHERE c.last_message_at >= p_since
    AND (ca.conversation_id IS NULL OR ca.analyzed_at < c.last_message_at)
    AND phone_norm(c.customer_phone) NOT IN (SELECT phone_norm FROM internal_contacts)
    AND phone_norm(c.customer_phone) NOT IN (
      SELECT phone_norm(summary_chat) FROM vendors WHERE summary_chat IS NOT NULL
    )
  ORDER BY c.last_message_at DESC
  LIMIT p_limit;
$$;
