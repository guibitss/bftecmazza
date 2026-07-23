-- Schema DEMO isolado — dados 100% fictícios, zero contato com produção.
-- Os crons (análise, telemetria) e fluxos de WhatsApp só olham public,
-- então nunca tocam aqui.
DROP SCHEMA IF EXISTS demo CASCADE;
CREATE SCHEMA demo;

-- Tabelas com a MESMA estrutura de public (sem FKs cross-schema; demo é
-- autocontido). LIKE copia colunas, defaults e constraints CHECK.
CREATE TABLE demo.stores                (LIKE public.stores INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
CREATE TABLE demo.vendors               (LIKE public.vendors INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
CREATE TABLE demo.inboxes               (LIKE public.inboxes INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
CREATE TABLE demo.app_users             (LIKE public.app_users INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
CREATE TABLE demo.user_inboxes          (LIKE public.user_inboxes INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
CREATE TABLE demo.conversations         (LIKE public.conversations INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
CREATE TABLE demo.messages              (LIKE public.messages INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
CREATE TABLE demo.conversation_memory   (LIKE public.conversation_memory INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
CREATE TABLE demo.transfer_flow_audit   (LIKE public.transfer_flow_audit INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
CREATE TABLE demo.labels                (LIKE public.labels INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
CREATE TABLE demo.conversation_labels   (LIKE public.conversation_labels INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
CREATE TABLE demo.conversation_analysis (LIKE public.conversation_analysis INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
CREATE TABLE demo.ad_campaign_spend     (LIKE public.ad_campaign_spend INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
CREATE TABLE demo.vendor_queue          (LIKE public.vendor_queue INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
CREATE TABLE demo.internal_contacts     (LIKE public.internal_contacts INCLUDING DEFAULTS INCLUDING CONSTRAINTS);

-- PKs mínimas que o app usa em joins/upserts
ALTER TABLE demo.stores                ADD PRIMARY KEY (id);
ALTER TABLE demo.vendors               ADD PRIMARY KEY (id);
ALTER TABLE demo.inboxes               ADD PRIMARY KEY (id);
ALTER TABLE demo.app_users             ADD PRIMARY KEY (id);
ALTER TABLE demo.conversations         ADD PRIMARY KEY (id);
ALTER TABLE demo.messages              ADD PRIMARY KEY (id);
ALTER TABLE demo.conversation_analysis ADD PRIMARY KEY (conversation_id);
