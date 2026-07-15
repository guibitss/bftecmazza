-- Atribuição de origem de anúncio (Click-to-WhatsApp Ads da Meta)
-- Capturado do referral/externalAdReply da PRIMEIRA mensagem do lead;
-- campanha/conjunto/anúncio resolvidos depois via Graph API.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ad_ctwa_clid    text;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ad_source_id    text;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ad_source_url   text;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ad_headline     text;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ad_campaign_id  text;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ad_campaign_name text;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ad_adset_name   text;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ad_name         text;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ad_resolved_at  timestamptz;

-- Consultas da página de métricas de campanhas
CREATE INDEX IF NOT EXISTS conv_ad_campaign_idx
  ON conversations (ad_campaign_id) WHERE ad_campaign_id IS NOT NULL;
