-- Mensagens rápidas (respostas prontas) por LOGIN. Cada usuário tem as suas;
-- aparecem num seletor no composer do inbox pra inserir com um clique.
-- RLS: cada um só vê/gerencia as próprias (o browser client usa auth.uid()).

CREATE TABLE IF NOT EXISTS public.quick_replies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  title         text,
  body          text NOT NULL,
  sort          int  NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.quick_replies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quick_replies_own ON public.quick_replies;
CREATE POLICY quick_replies_own ON public.quick_replies
  FOR ALL USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());
CREATE INDEX IF NOT EXISTS quick_replies_owner_idx ON public.quick_replies (owner_user_id, sort);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quick_replies TO authenticated;

-- Espelho no schema demo (dados fictícios isolados)
CREATE TABLE IF NOT EXISTS demo.quick_replies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  title         text,
  body          text NOT NULL,
  sort          int  NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE demo.quick_replies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quick_replies_own ON demo.quick_replies;
CREATE POLICY quick_replies_own ON demo.quick_replies
  FOR ALL USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());
CREATE INDEX IF NOT EXISTS quick_replies_owner_idx_demo ON demo.quick_replies (owner_user_id, sort);
GRANT SELECT, INSERT, UPDATE, DELETE ON demo.quick_replies TO authenticated;
