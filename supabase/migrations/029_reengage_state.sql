-- Opção C: cliente etiquetado ('equipe') que volta a chamar no número
-- principal → avisa o responsável na hora; se ninguém responder em 3h,
-- a IA remove a etiqueta e reassume o atendimento.
CREATE TABLE IF NOT EXISTS reengage_state (
  account_id          int  NOT NULL,
  conversation_id     int  NOT NULL,          -- id da conversa no Chatwoot
  store_id            int,
  phone               text,
  waha_id             text,
  last_msg            text,
  ctx                 jsonb,                  -- contexto pra reinjetar no buffer da IA
  first_unanswered_at timestamptz NOT NULL DEFAULT now(),
  last_notified_at    timestamptz,
  taken_over_at       timestamptz,
  resolved_at         timestamptz,
  PRIMARY KEY (account_id, conversation_id)
);
ALTER TABLE reengage_state ENABLE ROW LEVEL SECURITY;
