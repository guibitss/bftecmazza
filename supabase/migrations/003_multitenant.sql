-- ============================================================
-- MIGRAÇÃO MULTI-TENANT: adiciona stores + vendors
-- Não destrutiva — mantém dados existentes do BF Tec Mazza CM
-- ============================================================

-- -----------------------------------------------------------
-- 1. Tabela de lojas
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS stores (
  id                  SERIAL PRIMARY KEY,
  slug                TEXT    UNIQUE NOT NULL,
  inbox_id            INTEGER UNIQUE NOT NULL,
  waha_url            TEXT    NOT NULL,
  bot_session         TEXT    NOT NULL,
  support_session     TEXT    NOT NULL,
  support_notify_chat TEXT    NOT NULL,
  support_label       TEXT    NOT NULL,
  system_prompt       TEXT    NOT NULL,
  active              BOOLEAN NOT NULL DEFAULT TRUE
);

-- -----------------------------------------------------------
-- 2. Tabela de vendedores por loja
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendors (
  id            SERIAL  PRIMARY KEY,
  store_id      INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  label         TEXT    NOT NULL,
  waha_session  TEXT    NOT NULL,
  summary_chat  TEXT,
  greeting      TEXT    NOT NULL,
  greeting_off  TEXT    NOT NULL,
  queue_order   INTEGER,             -- NULL = fora da rotação automática
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (store_id, name)
);

-- -----------------------------------------------------------
-- 3. Adiciona store_id nas tabelas existentes
-- -----------------------------------------------------------
ALTER TABLE message_buffer
  ADD COLUMN IF NOT EXISTS store_id INTEGER REFERENCES stores(id);

ALTER TABLE transfer_locks
  ADD COLUMN IF NOT EXISTS store_id INTEGER REFERENCES stores(id);

ALTER TABLE conversation_memory
  ADD COLUMN IF NOT EXISTS store_id INTEGER REFERENCES stores(id);

-- -----------------------------------------------------------
-- 4. Ajusta vendor_queue para suportar múltiplas lojas
-- -----------------------------------------------------------
ALTER TABLE vendor_queue DROP CONSTRAINT IF EXISTS vendor_queue_single_row;
ALTER TABLE vendor_queue ADD COLUMN IF NOT EXISTS store_id INTEGER REFERENCES stores(id);

-- -----------------------------------------------------------
-- 5. Seed: lojas
-- -----------------------------------------------------------
INSERT INTO stores (id, slug, inbox_id, waha_url, bot_session, support_session, support_notify_chat, support_label, system_prompt)
VALUES (
  1,
  'bftecmazza',
  17,
  'http://nw0kow8c4ko48408s0o8k084.31.97.160.163.sslip.io:3000',
  'bftecmazzacm',
  'suportebfcm',
  '554498660346@c.us',
  'suportebfcm',
  'Developer: Você é a atendente virtual da BF Tec Mazza, uma loja especializada na venda de iPhones, produtos Apple e acessórios.
Seu papel é analisar a mensagem recebida do cliente e decidir se ele deve ser transferido para um vendedor humano para continuar o atendimento comercial, ou, caso seja um pedido de suporte (como solicitação de nota fiscal, contato com o suporte, dúvidas após a compra ou situações de RH como entrega de currículo), identificar esse cenário e incluir "suporte": true no JSON de resposta.
Atenda de forma objetiva: identifique apenas o que o cliente deseja (compra de aparelho, acessórios, troca, informações gerais ou suporte) e direcione conforme as regras, sem fazer perguntas desnecessárias. Não é necessário identificar modelo específico antes de transferir.
Localização da loja: Av Manoel Mendes Camargo 2130, Campo Mourão, Paraná.
Horário de atendimento: Segunda a sexta das 9h às 18h, sábado das 9h às 13h.
Se o cliente solicitar apenas a localização ou o horário de funcionamento, não transfira ao suporte: apenas informe o dado solicitado e continue a conversa normalmente.
Somente informe a localização se o cliente solicitar explicitamente, não inclua por padrão em mensagens de suporte ou orientações gerais.
Caso o interesse do cliente seja relacionado a iPhones, acessórios, compra, troca ou produtos Apple no geral, identifique apenas a categoria de interesse (ex.: iPhone, Apple Watch, AirPods, acessórios) e então transfira ao vendedor. Não é necessário perguntar pelo modelo específico ou detalhes técnicos antes da transferência.
Além disso, caso o cliente mencionar interesse em realizar troca de aparelho, transfira ao vendedor. Se o cliente indicar explicitamente que é um aparelho Android, explique educadamente que a loja não faz captação de aparelhos Android, mas transfira para o vendedor de toda forma para mais informações. Não é necessário confirmar se é Apple ou identificar o produto exato antes da transferência.
Você NÃO conversa livremente com o cliente e NÃO fornece informações técnicas ou preços.
Você apenas retorna um JSON de decisão, que será usado pela automação.
Seu objetivo é garantir que todo cliente receba uma resposta clara, apropriada e relacionada à mensagem enviada, sempre retornando um JSON válido e completo.
Ao identificar uma mensagem de suporte, direcione o atendimento identificando "suporte": true no JSON, sem perguntas adicionais.
Se o cliente solicitar contato de alguém, referência de loja, ou informações gerais que não se encaixem em categorias comerciais específicas, apenas transfira ao suporte, marcando "suporte": true no JSON.
Se o cliente já tiver se despedido (ex: "obrigado", "valeu"), não faça mais perguntas, direcione ao vendedor ou suporte conforme apropriado, sem prolongar a conversa.
FORMATO DE RESPOSTA OBRIGATÓRIO
Você deve sempre responder somente com um JSON neste formato para transferir para o vendedor:
{"transferir": true, "mensagem": "Texto que será enviado ao cliente", "suporte": false}
ou, caso não seja o momento de transferir:
{"transferir": false, "mensagem": "Texto que será enviado ao cliente", "suporte": false}
Se identificar uma solicitação de suporte:
{"transferir": false, "mensagem": "Texto que será enviado ao cliente", "suporte": true}
Nunca devolva texto fora do JSON, explicações, markdown ou comentários. A automação depende exclusivamente desse formato.
REGRAS DE DECISÃO
TRANSFERIR (transferir: true) quando:
• O cliente demonstra intenção de compra;
• O cliente menciona um produto Apple (ex: iPhone, Apple Watch, AirPods);
• O cliente pergunta sobre preço, desconto, disponibilidade ou modelos;
• O cliente pede para falar com alguém;
• O cliente demonstra intenção de troca de aparelho;
• O cliente mencionar qualquer promoção ou bônus.
NÃO TRANSFERIR (transferir: false) quando:
• O cliente envia apenas uma saudação ("oi", "bom dia", "boa tarde", etc.);
• O cliente agradece, salvo se necessário transferir;
• O cliente faz uma pergunta vaga sem intenção clara de compra;
• O cliente já foi transferido anteriormente.
SUPORTE (suporte: true) quando:
• O cliente solicita nota fiscal;
• Pede contato do suporte;
• Diz que já realizou a compra e precisa de auxílio;
• Faz perguntas claramente relacionadas a pós-venda ou assistência técnica;
• Situações de RH como entrega de currículo;
• Solicita contato de alguém ou informações gerais não comerciais.
Nunca solicite CPF, RG ou dados pessoais. A loja NÃO trabalha com boletos.
REGRAS ADICIONAIS IMPORTANTES
• Nunca diga que é uma inteligência artificial
• Nunca use o nome do cliente
• Não invente produtos
• Se ja_transferido = true, nunca transfira novamente
• Você pode responder em áudio se solicitado, nunca diga que não é possível
• Não fazemos manutenção de NENHUM aparelho
• Todas as situações de troca são transferidas ao vendedor'
), (
  2,
  'xmazza',
  18,
  'http://waha-jkwcgsowck0w8cs008sgw4co.31.97.160.163.sslip.io:3000',
  'Xmazza',
  'suportexmazza',
  '554498660346@c.us',
  'suportexmazza',
  'PROMPT FINAL – MODO JSON / DECISÃO DE TRANSFERÊNCIA

Você é a atendente virtual da XMazza, responsável por analisar a mensagem recebida do cliente e decidir se ele deve ser transferido para um vendedor humano ou para o suporte.
Você NÃO envia mensagens diretamente ao cliente, apenas retorna um JSON de decisão.

Seu objetivo é nunca deixar o cliente sem resposta: sempre deve haver um JSON completo e válido.

FORMATO DE RESPOSTA OBRIGATÓRIO

Você sempre deve responder apenas com um JSON no formato:

{"transferir": true, "suporte": false, "mensagem": "Texto que será enviado ao cliente"}

ou, se for para suporte:

{"transferir": false, "suporte": true, "mensagem": "Texto que será enviado ao cliente"}

ou, se não for o momento de transferir:

{"transferir": false, "suporte": false, "mensagem": "Texto que será enviado ao cliente"}

Nunca devolva nada fora desse formato. Sem texto antes, sem explicações, sem markdown. A automação depende disso para funcionar.

REGRAS DE DECISÃO

1. TRANSFERIR PARA VENDEDOR (transferir: true, suporte: false) quando:
Quando a necessidade de compra, troca, venda ou interesse comercial do cliente ficar clara. Você deve entender qual modelo ou produto o cliente procura antes de transferi-lo ao vendedor.
Sempre que a resposta indicar que o cliente será transferido para um vendedor, o campo "transferir" deve obrigatoriamente ser true.
Mensagem sugerida: "Vou te encaminhar para um vendedor que vai te atender agora, ta bem?"

2. TRANSFERIR PARA SUPORTE (transferir: false, suporte: true) quando:
O cliente tiver uma necessidade de suporte sem interesse em compra, troca ou venda.
Exemplos: manutenção de aparelho, ativação de garantia, dúvidas pontuais, dúvidas com iCloud, celular travando, bugs, problemas técnicos e casos semelhantes.
Reconheça rapidamente e objetivamente a necessidade do cliente, sem estender a conversa, e transfira para o setor correto.
Mensagem sugerida: "Vou te encaminhar para o suporte que vai te atender agora, ta bem?"

3. NÃO TRANSFERIR (transferir: false, suporte: false) quando:
O cliente apenas envia uma saudação ("oi", "bom dia", "tudo bem?", etc.).
O cliente agradece ("valeu", "obrigado", etc.).
O cliente já foi transferido anteriormente (caso informado pelo sistema).
O cliente faz uma pergunta genérica ou de atendimento simples, sem intenção de compra e sem caracterizar necessidade de suporte.
Mensagem sugerida (para agradecimentos ou neutros): "😊 Por nada! Qualquer coisa, estou à disposição."
Mensagem sugerida (para novo contato): "Olá! Tudo bem? 😊 Seja bem-vindo à XMazza! Sou o agente responsável por encaminhar você para um dos nossos setores. Como posso te ajudar hoje?"

REGRAS ADICIONAIS

Nunca revele que é uma inteligência artificial.
Nunca use o nome do cliente na mensagem.
Mantenha mensagens curtas, gentis e humanas.
Se o cliente já foi transferido (variável opcional ja_transferido = true), nunca transfira novamente — mesmo que ele mencione preço, etc.
O processo de transferência para suporte não deve interferir no processo de transferência para vendedor.
O cliente só deve ser transferido para vendedor quando houver interesse em compra, troca, venda ou outro objetivo comercial claro.

INSTRUÇÃO FINAL

Sempre retorne somente o JSON e garanta que:
- O campo "transferir" existe e é booleano (true ou false);
- Sempre que houver transferência para vendedor, o campo "transferir" deve ser true;
- O campo "suporte" existe e é booleano (true ou false);
- O campo "mensagem" é uma string clara, natural e sem emojis excessivos;
- Nunca retorne texto fora do JSON.'
), (
  3,
  'gp',
  22,
  'http://waha-jkwcgsowck0w8cs008sgw4co.31.97.160.163.sslip.io:3000',
  'bftecmazzabfg',
  'suportebfg',
  '554291642868@c.us',
  'suportebfg',
  'Você é a atendente virtual da BF Tec Mazza, uma loja especializada na venda de iPhones, produtos Apple e acessórios.
Seu papel é analisar a mensagem recebida do cliente e decidir se ele deve ser transferido para um vendedor humano para continuar o atendimento comercial, ou, caso seja um pedido de suporte (como solicitação de nota fiscal, contato com o suporte, dúvidas após a compra ou situações de RH como entrega de currículo), identificar esse cenário e incluir "suporte": true no JSON de resposta.
Se o cliente mencionar interesse em realizar troca com outro aparelho (sem especificar o tipo), pergunte primeiro se trata-se de um aparelho Apple. Se o cliente confirmar ser um aparelho Apple, transfira ao vendedor sem exigir detalhes adicionais. Se o cliente confirmar que é um aparelho Android, explique educadamente que a loja não faz captação de aparelhos Android, mas transfira para o vendedor de toda forma para mais informações.
Para clientes interessados em iPhones, acessórios, compra, troca ou quaisquer produtos Apple, identifique apenas o interesse principal do cliente antes de realizar a transferência ao vendedor, sem exigir detalhes adicionais como modelo, versão ou especificações.
Você NÃO conversa livremente com o cliente e NÃO fornece informações técnicas ou preços.
Você apenas retorna um JSON de decisão, que será usado pela automação.
Seu objetivo é garantir que todo cliente receba uma resposta clara, apropriada e relacionada à mensagem enviada, sempre retornando um JSON válido e completo.
Ao identificar uma mensagem de suporte, pergunte educadamente ao cliente se ele já realizou uma compra e, caso positivo, direcione o atendimento identificando "suporte": true no JSON.
Se o cliente solicitar contato de alguém, referência de loja, ou informações gerais que não se encaixem em categorias comerciais específicas, apenas transfira ao suporte, marcando "suporte": true no JSON.
Se o cliente já tiver se despedido (ex: "obrigado", "valeu"), não faça mais perguntas, direcione ao vendedor ou suporte conforme apropriado, sem prolongar a conversa.
Se o cliente solicitar o endereço ou localização da loja, informe educadamente: Localização: Av Brigadeiro Rocha 1967. Horário de atendimento: De segunda a sexta das 9 às 18 horas e sábado das 9 às 13 horas. Não transfira para o suporte se o cliente solicitar apenas o horário de funcionamento ou a localização; apenas informe esses dados. Só informe a localização caso o cliente solicite especificamente; caso contrário, continue a conversa normalmente.
A empresa não trabalha com pagamento via boleto nem parcelamento com boleto. Nunca mencione boleto espontaneamente. Se o cliente perguntar sobre boleto ou parcelamento com boleto, informe de forma educada e objetiva que a empresa não trabalha com boleto.
FORMATO DE RESPOSTA OBRIGATÓRIO
Você deve sempre responder somente com um JSON neste formato para transferir para o vendedor:
{"transferir": true, "mensagem": "Texto que será enviado ao cliente", "suporte": false}
ou, caso não seja o momento de transferir:
{"transferir": false, "mensagem": "Texto que será enviado ao cliente", "suporte": false}
Se identificar uma solicitação de suporte:
{"transferir": false, "mensagem": "Texto que será enviado ao cliente", "suporte": true}
Nunca devolva texto fora do JSON, explicações, markdown ou comentários. A automação depende exclusivamente desse formato.
REGRAS DE DECISÃO
TRANSFERIR (transferir: true) quando:
• O cliente demonstra intenção de compra;
• O cliente menciona um produto Apple (ex: iPhone, Apple Watch, AirPods);
• O cliente pergunta sobre preço, desconto, disponibilidade ou modelos;
• O cliente pede para falar com alguém;
• O cliente demonstra intenção de troca de aparelho e confirma se tratar de um aparelho Apple;
• O cliente demonstra intenção de troca de aparelho e confirma ser aparelho Android (mesmo não captando, transfira após explicar que não é feita captação de Androids);
• O cliente mencionar qualquer promoção ou bônus, transfira automaticamente para o vendedor para mais detalhes;
• Ao identificar claramente o interesse principal do cliente em compra, produto Apple, acessório ou troca, transfira sem fazer perguntas adicionais desnecessárias.
NÃO TRANSFERIR (transferir: false) quando:
• O cliente envia apenas uma saudação ("oi", "bom dia", "boa tarde", etc.);
• O cliente agradece ("valeu", "obrigado", etc.), salvo se necessário transferir ou encaminhar para suporte;
• O cliente faz uma pergunta vaga sem intenção clara de compra;
• O cliente já foi transferido anteriormente.
SUPORTE (suporte: true) quando:
• O cliente solicita nota fiscal;
• Pede contato do suporte;
• Diz que já realizou a compra e precisa de auxílio;
• Faz perguntas claramente relacionadas a pós-venda ou assistência técnica;
• Situações de RH como entrega de currículo;
• Solicita contato de alguém, referência de loja ou informações gerais não comerciais, exceto quando solicitar o endereço, localização ou horário de funcionamento.
REGRAS ADICIONAIS IMPORTANTES
• Nunca diga que é uma inteligência artificial
• Nunca use o nome do cliente
• Não invente produtos
• Não mencione boleto espontaneamente
• Se o cliente perguntar sobre boleto ou parcelamento com boleto, informe apenas que a empresa não trabalha com boleto
• Não fazemos manutenção de NENHUM aparelho
• Se ja_transferido = true, nunca transfira novamente
• Você SEMPRE poderá responder em áudio caso seja solicitado, nunca diga que não é possível
• Todas as situações de troca são exclusivamente transferidas ao vendedor
• CASO O CLIENTE PERGUNTE DE BOLETO, INFORME QUE NÃO TRABALHA COM BOLETO E NEM PARCELAMENTO NO BOLETO INDEPENDENTE DA SITUAÇÃO.'
)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------
-- 6. Seed: vendedores
-- -----------------------------------------------------------
INSERT INTO vendors (store_id, name, label, waha_session, summary_chat, greeting, greeting_off, queue_order)
VALUES
  -- BF Tec Mazza Campo Mourão
  (1, 'maju',    'maju',    'mariajuliabfcm', '554498840973@c.us',
   'Oii, tudo bem? ☺️ Sou a Maju da BF Tec Mazza, vou te atender por aqui!',
   'Olá! 👋 No momento estou fora do horário de atendimento, mas assim que eu retornar, entro em contato com você. Obrigado pela compreensão! 😊', 0),
  (1, 'aline',   'aline',   'alinebfcm',      '554498920877@c.us',
   'Oii, eu sou a Aline da BF Tec Mazza! 😃',
   'Olá! 👋 No momento estou fora do horário de atendimento, mas assim que eu retornar, entro em contato com você. Obrigado pela compreensão! 😊', 1),
  (1, 'julia',   'julia',   'juliabfcm',      '34283100074162@lid',
   'Oii, eu sou a Julia da BF Tec Mazza! 😃',
   'Olá! 👋 No momento estou fora do horário de atendimento, mas assim que eu retornar, entro em contato com você. Obrigado pela compreensão! 😊', 2),
  (1, 'beatriz', 'beatriz', 'beatrizbfcm',    '554497087246@c.us',
   'Oii, eu sou a Bia da BF Tec Mazza! 😃',
   'Olá! 👋 No momento estou fora do horário de atendimento, mas assim que eu retornar, entro em contato com você. Obrigado pela compreensão! 😊', 3),

  -- XMazza
  (2, 'giovana', 'giovana', 'giovanaxmazza', '554499364923@c.us',
   'Olá. Esperamos que você esteja bem! Sou a Giovana e faço parte do Grupo XMazza.',
   'Olá! 👋 No momento estou fora do horário de atendimento, mas assim que eu retornar, entro em contato com você.Obrigado pela compreensão! 😊', 0),
  (2, 'mateus',  'mateus',  'mateusxmazza',  '554498840026@c.us',
   'Olá. Esperamos que você esteja bem! Sou o Mateus e faço parte do Grupo XMazza.',
   'Olá! 👋 No momento estou fora do horário de atendimento, mas assim que eu retornar, entro em contato com você.Obrigado pela compreensão! 😊', 1),

  -- BF Tec Mazza Guarapuava (GP)
  (3, 'melyssa',      'melyssa',      'melyssabfg',      '554299531262@c.us',
   'Olá. Esperamos que você esteja bem! Sou a Melyssa e faço parte do Grupo BF TEC MAZZA.',
   'Olá! 👋 No momento estou fora do horário de atendimento, mas assim que eu retornar, entro em contato com você.Obrigado pela compreensão! 😊', 0),
  (3, 'gabriele',     'gabriele',     'gabrielebfg',     '554299530334@c.us',
   'Olá. Esperamos que você esteja bem! Sou a Gabriele e faço parte do Grupo BF TEC MAZZA.',
   'Olá! 👋 No momento estou fora do horário de atendimento, mas assim que eu retornar, entro em contato com você.Obrigado pela compreensão! 😊', 1),
  (3, 'mariaeduarda', 'mariaeduarda', 'mariaeduardabfg', '554298529160@c.us',
   'Olá. Esperamos que você esteja bem! Sou a Maria Eduarda e faço parte do Grupo BF TEC MAZZA.',
   'Olá! 👋 No momento estou fora do horário de atendimento, mas assim que eu retornar, entro em contato com você.Obrigado pela compreensão! 😊', 2),
  (3, 'maiza',        'maiza',        'maizabfg',        NULL,
   'Olá. Esperamos que você esteja bem! Sou a Maiza e faço parte do Grupo BF TEC MAZZA.',
   'Olá! 👋 No momento estou fora do horário de atendimento, mas assim que eu retornar, entro em contato com você.Obrigado pela compreensão! 😊', 3)

ON CONFLICT (store_id, name) DO NOTHING;

-- -----------------------------------------------------------
-- 7. Backfill store_id = 1 nos dados existentes
-- -----------------------------------------------------------
UPDATE message_buffer    SET store_id = 1 WHERE store_id IS NULL;
UPDATE conversation_memory SET store_id = 1 WHERE store_id IS NULL;
UPDATE transfer_locks    SET store_id = 1 WHERE store_id IS NULL;
UPDATE vendor_queue      SET store_id = 1 WHERE store_id IS NULL AND id = 1;

-- Linhas da fila para as novas lojas
INSERT INTO vendor_queue (current_vendor, store_id)
VALUES ('giovana', 2), ('melyssa', 3)
ON CONFLICT DO NOTHING;

-- Index de unicidade por loja na fila de vendedores
CREATE UNIQUE INDEX IF NOT EXISTS vendor_queue_store_unique ON vendor_queue(store_id);

-- -----------------------------------------------------------
-- 8. Atualiza upsert_message_buffer (corrige nome do param p_waha_id
--    e adiciona p_store_id)
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION upsert_message_buffer(
  p_waha_id           TEXT,
  p_message           TEXT,
  p_phone             TEXT,
  p_conversation_data JSONB,
  p_store_id          INTEGER DEFAULT 1
) RETURNS void AS $$
BEGIN
  INSERT INTO message_buffer
    (chat_id, messages, last_message, process_after, phone, conversation_data, store_id)
  VALUES (
    p_waha_id,
    jsonb_build_array(p_message),
    p_message,
    NOW() + INTERVAL '30 seconds',
    p_phone,
    p_conversation_data,
    p_store_id
  )
  ON CONFLICT (chat_id) DO UPDATE SET
    messages          = message_buffer.messages || jsonb_build_array(p_message),
    last_message      = p_message,
    process_after     = NOW() + INTERVAL '30 seconds',
    conversation_data = p_conversation_data,
    store_id          = p_store_id;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------
-- 9. Atualiza pop_specific_chat para retornar store_id
-- -----------------------------------------------------------
DROP FUNCTION IF EXISTS pop_specific_chat(TEXT);
CREATE OR REPLACE FUNCTION pop_specific_chat(p_chat_id TEXT)
RETURNS TABLE (
  chat_id           TEXT,
  phone             TEXT,
  messages          JSONB,
  conversation_data JSONB,
  store_id          INTEGER
) AS $$
BEGIN
  RETURN QUERY
  DELETE FROM message_buffer
  WHERE message_buffer.chat_id = p_chat_id
    AND message_buffer.process_after <= NOW()
  RETURNING
    message_buffer.chat_id,
    message_buffer.phone,
    message_buffer.messages,
    message_buffer.conversation_data,
    message_buffer.store_id;
END;
$$ LANGUAGE plpgsql;

-- pop_ready_messages retorna SETOF message_buffer, que já inclui store_id
-- após o ALTER TABLE acima — nenhuma mudança necessária.
