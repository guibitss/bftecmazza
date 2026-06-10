-- Labels tables for conversation tagging

CREATE TABLE IF NOT EXISTS labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id INT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6b7280',
  created_by UUID REFERENCES app_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, name)
);

CREATE TABLE IF NOT EXISTS conversation_labels (
  conversation_id INT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES app_users(id),
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (conversation_id, label_id)
);

ALTER TABLE labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "labels_select" ON labels FOR SELECT USING (
  (SELECT is_admin FROM app_users WHERE id = auth.uid()) = true
  OR (SELECT manager_of_store_id FROM app_users WHERE id = auth.uid()) = store_id
  OR EXISTS (
    SELECT 1 FROM inboxes i
    JOIN user_inboxes ui ON ui.inbox_id = i.id
    WHERE i.store_id = labels.store_id AND ui.user_id = auth.uid()
  )
);

CREATE POLICY "labels_manage" ON labels FOR ALL USING (
  (SELECT is_admin FROM app_users WHERE id = auth.uid()) = true
  OR (SELECT manager_of_store_id FROM app_users WHERE id = auth.uid()) = store_id
);

CREATE POLICY "conv_labels_select" ON conversation_labels FOR SELECT USING (
  (SELECT is_admin FROM app_users WHERE id = auth.uid()) = true
  OR EXISTS (
    SELECT 1 FROM conversations c
    JOIN inboxes i ON i.id = c.inbox_id
    JOIN user_inboxes ui ON ui.inbox_id = i.id
    WHERE c.id = conversation_labels.conversation_id AND ui.user_id = auth.uid()
  )
);

CREATE POLICY "conv_labels_write" ON conversation_labels FOR ALL USING (
  (SELECT is_admin FROM app_users WHERE id = auth.uid()) = true
  OR EXISTS (
    SELECT 1 FROM conversations c
    JOIN inboxes i ON i.id = c.inbox_id
    JOIN user_inboxes ui ON ui.inbox_id = i.id
    WHERE c.id = conversation_labels.conversation_id AND ui.user_id = auth.uid()
  )
);
