export interface ConversationContext {
  id_mensagem:    number;
  id_conta:       number;
  id_conversa:    number;
  telefone:       string;
  mensagem:       string;
  mensagem_de_audio: string;
  timestamp:      number;
  tipo:           string;
  etiquetas:      string[];
  waha_id:        string;
  source_id:      string;
  contact_id:     number;
  nome:           string;
}

export interface SecretariaOutput {
  transferir: boolean;
  mensagem:   string;
  suporte:    boolean;
}

export interface StoreConfig {
  id:                  number;
  slug:                string;
  inbox_id:            number;
  waha_url:            string;
  bot_session:         string;
  support_session:     string;
  support_notify_chat: string;
  support_label:       string;
  system_prompt:       string;
  active:              boolean;
}

export interface VendorConfig {
  id:           number;
  store_id:     number;
  name:         string;
  label:        string;
  waha_session: string;
  summary_chat: string | null;
  greeting:     string;
  greeting_off: string;
  queue_order:  number | null;
  active:       boolean;
}

export interface MessageBufferRow {
  chat_id:           string;
  messages:          string[];
  last_message:      string;
  process_after:     string;
  phone:             string;
  conversation_data: ConversationContext;
  store_id:          number;
}

export interface ChatMessage {
  role:    'user' | 'assistant' | 'system';
  content: string;
}

export interface TransferFlowInput {
  telefone:             string;
  nome:                 string;
  ultima_mensagem:      string;
  id_conta:             number;
  id_conversa:          number;
  source_id:            string;
  contact_id:           number;
  ultima_mensagem_da_IA: string;
  waha_id:              string;
  store_id:             number;
}
