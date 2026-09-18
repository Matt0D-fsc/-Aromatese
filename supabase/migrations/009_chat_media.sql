-- Migration: 009_chat_media.sql
-- Description: Keep what customers send. Voice notes and photos go to a private per-shop bucket and
-- messages.media_url (a column since 001, never written until now) holds the object path. The AI's transcript
-- or photo description is saved on the message too, so the model remembers it on later turns and staff can
-- read it in the inbox. Object path convention: <tenant_id>/<conversation_id>/<message_id>.<ext>
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('chat-media', 'chat-media', FALSE, 5242880)
ON CONFLICT (id) DO NOTHING;

-- Only the agent server writes here (service role, which bypasses RLS). Shop staff read their own shop's folder
-- through short-lived signed URLs; the bucket is private, so another shop or a stranger with the path gets nothing.
CREATE POLICY chat_media_read ON storage.objects FOR SELECT
  USING (bucket_id = 'chat-media' AND (storage.foldername(name))[1] IN (SELECT my_tenant_folders(FALSE)));
