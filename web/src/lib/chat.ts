// Shared by the public chat page, its API route and the merchant inbox. No server-only imports here.
export const VISITOR_COOKIE = 'cn_visitor';

// Private bucket holding voice notes and photos customers sent. Read through short-lived signed URLs.
export const CHAT_MEDIA_BUCKET = 'chat-media';

// The extension is a hint for humans browsing the bucket; the object's stored content type is what readers use.
export const mediaObjectPath = (tenantId: string, conversationId: string, messageId: string, mimeType: string) => {
  const ext = mimeType.toLowerCase().split(';')[0].split('/')[1]?.replace(/[^a-z0-9]/g, '') || 'bin';
  return `${tenantId}/${conversationId}/${messageId}.${ext}`;
};

export type ChatProduct = {
  id: string;
  title: string;
  price: number;
  regularPrice: number | null;
  stock: number;
  imageUrl: string | null;
  // Every photo, cover first. Absent on cards saved before the gallery existed; those fall back to imageUrl.
  imageUrls?: string[];
};

// What the AI heard in a voice note or saw in a photo, kept so later turns and the merchant's inbox still have it.
export type MediaNote = { transcript?: string; description?: string };

export type MessageRow = {
  id: string;
  sender_type: 'customer' | 'bot' | 'agent';
  content_type: 'text' | 'audio' | 'image';
  content_text: string | null;
  media_url: string | null;
  grounding_data: { products?: ChatProduct[]; orderNumber?: string; media?: MediaNote } | null;
  created_at: string;
};

export type ChatLine = {
  id: string;
  from: MessageRow['sender_type'];
  kind: MessageRow['content_type'];
  text: string;
  products: ChatProduct[];
  orderNumber: string | null;
  mediaPath: string | null;
  mediaNote: string;
  createdAt?: string;
  localUrl?: string;
};

export const MESSAGE_COLUMNS = 'id, sender_type, content_type, content_text, media_url, grounding_data, created_at';

export const mediaNote = (g: MessageRow['grounding_data']) => g?.media?.transcript ?? g?.media?.description ?? '';

export const toChatLine = (m: MessageRow): ChatLine => ({
  id: m.id,
  from: m.sender_type,
  kind: m.content_type,
  text: m.content_text ?? '',
  products: m.grounding_data?.products ?? [],
  orderNumber: m.grounding_data?.orderNumber ?? null,
  mediaPath: m.media_url ?? null,
  mediaNote: mediaNote(m.grounding_data),
  createdAt: m.created_at,
});

// Text only: the icon beside it is drawn by whoever renders this, so it can take a colour and a size.
export const mediaLabel = (kind: ChatLine['kind']) => (kind === 'audio' ? 'Voice note' : kind === 'image' ? 'Photo' : '');

// PostgREST's or() filter uses commas and parentheses as separators and * and % as wildcards: a search box
// must never be able to smuggle one into the query it builds.
export const searchTerm = (raw: string | undefined | null, max = 60) => (raw ?? '').trim().replace(/[(),*%]/g, '').slice(0, max);

export const taka = (n: number) => `৳${Number(n).toLocaleString('en-IN')}`;

export const dhakaTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', dateStyle: 'medium', timeStyle: 'short' });
