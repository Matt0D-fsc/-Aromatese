import { GEMINI_MODEL, generateAudioContent, generateContent } from '@/lib/gemini';
import { createAdminClient } from '@/lib/supabase/admin';
import { auditError } from '@/lib/audit';
import { CHAT_MEDIA_BUCKET, mediaObjectPath, type MediaNote } from '@/lib/chat';

// Keeps what a customer sent: the file itself in the private chat-media bucket, and what the AI heard or saw
// on the message row. Without this the merchant's inbox shows an empty "voice note" and the model forgets the
// customer's own words the moment the turn ends.

export type IncomingMedia = { mimeType: string; kind: 'audio' | 'image'; bytes: Buffer };

const PROMPT = {
  audio:
    'Transcribe this voice note exactly, in the language spoken (Bangla script, Banglish or English). ' +
    'Reply with the transcript only, no commentary. If it is silent or unintelligible, reply with exactly: [unclear]',
  image:
    'Describe the product in this photo in one short line: item type, colour, pattern, material, and any visible brand. ' +
    'Reply with the description only. If there is no product in the photo, reply with exactly: [no product]',
};

// Never throws: a chat reply must not fail because an upload or a transcription did.
export async function storeMedia(
  db: ReturnType<typeof createAdminClient>,
  msg: { id: string; tenantId: string; conversationId: string },
  media: IncomingMedia,
): Promise<void> {
  try {
    const path = mediaObjectPath(msg.tenantId, msg.conversationId, msg.id, media.mimeType);
    const [upload, note] = await Promise.all([
      db.storage.from(CHAT_MEDIA_BUCKET).upload(path, media.bytes, { contentType: media.mimeType }),
      describe(media),
    ]);
    if (upload.error) await auditError('media.upload', upload.error, { tenantId: msg.tenantId });

    const patch: Record<string, unknown> = {};
    if (!upload.error) patch.media_url = path;
    if (note) patch.grounding_data = { media: note };
    if (!Object.keys(patch).length) return;

    const { error } = await db.from('messages').update(patch).eq('id', msg.id);
    if (error) await auditError('media.save', error, { tenantId: msg.tenantId });
  } catch (err) {
    await auditError('media.store', err, { tenantId: msg.tenantId });
  }
}

// Photos go to whichever engine the platform admin picked; voice notes go to whichever one can actually carry
// audio (see generateAudioContent). The model is asked for the transcript or description alone, nothing else.
async function describe(media: IncomingMedia): Promise<MediaNote | null> {
  try {
    const call = media.kind === 'audio' ? generateAudioContent : generateContent;
    const res = await call({
      model: GEMINI_MODEL,
      contents: [
        {
          role: 'user',
          parts: [{ inlineData: { mimeType: media.mimeType, data: media.bytes.toString('base64') } }, { text: PROMPT[media.kind] }],
        },
      ],
      config: { temperature: 0 },
    });
    const text = (res.text ?? '').trim().slice(0, 1000);
    if (!text || text.startsWith('[unclear') || text.startsWith('[no product')) return null;
    return media.kind === 'audio' ? { transcript: text } : { description: text };
  } catch (err) {
    console.error('[media] could not describe the', media.kind, err);
    return null;
  }
}
