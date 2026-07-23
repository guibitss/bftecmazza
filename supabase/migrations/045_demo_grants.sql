-- Acesso do PostgREST ao schema demo (é tudo dado fictício)
GRANT USAGE ON SCHEMA demo TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA demo TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA demo TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA demo TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA demo GRANT ALL ON TABLES TO anon, authenticated, service_role;

-- RLS: no demo tudo é aberto pra quem está logado (dados fake, sem privacidade)
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'demo'
  LOOP
    EXECUTE format('ALTER TABLE demo.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS demo_all ON demo.%I', t);
    EXECUTE format('CREATE POLICY demo_all ON demo.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
