-- FKs necessárias pro embedding do PostgREST funcionar no schema demo
ALTER TABLE demo.vendors ADD CONSTRAINT demo_vendors_store_fk FOREIGN KEY (store_id) REFERENCES demo.stores(id);
ALTER TABLE demo.inboxes ADD CONSTRAINT demo_inboxes_store_fk FOREIGN KEY (store_id) REFERENCES demo.stores(id);
ALTER TABLE demo.inboxes ADD CONSTRAINT demo_inboxes_vendor_fk FOREIGN KEY (vendor_id) REFERENCES demo.vendors(id);
ALTER TABLE demo.conversations ADD CONSTRAINT demo_conv_store_fk FOREIGN KEY (store_id) REFERENCES demo.stores(id);
ALTER TABLE demo.conversations ADD CONSTRAINT demo_conv_inbox_fk FOREIGN KEY (inbox_id) REFERENCES demo.inboxes(id);
ALTER TABLE demo.messages ADD CONSTRAINT demo_msg_conv_fk FOREIGN KEY (conversation_id) REFERENCES demo.conversations(id);
ALTER TABLE demo.conversation_labels ADD CONSTRAINT demo_cl_conv_fk FOREIGN KEY (conversation_id) REFERENCES demo.conversations(id);
ALTER TABLE demo.conversation_labels ADD CONSTRAINT demo_cl_label_fk FOREIGN KEY (label_id) REFERENCES demo.labels(id);
ALTER TABLE demo.conversation_analysis ADD CONSTRAINT demo_ca_vendor_fk FOREIGN KEY (vendor_id) REFERENCES demo.vendors(id);
ALTER TABLE demo.conversation_analysis ADD CONSTRAINT demo_ca_store_fk FOREIGN KEY (store_id) REFERENCES demo.stores(id);
NOTIFY pgrst, 'reload schema';
