// Shared by the public chat page, its API route and the merchant inbox. No server-only imports here.
export const VISITOR_COOKIE = 'cn_visitor';

export type ChatProduct = {
  id: string;
  title: string;
  price: number;
  regularPrice: number | null;
  stock: number;
  imageUrl: string | null;
};

export type MessageRow = {
  id: string;
  sender_type: 'customer' | 'bot' | 'agent';
  content_type: 'text' | 'audio' | 'image';
  content_text: string | null;
  grounding_data: { products?: ChatProduct[]; orderNumber?: string } | null;
  created_at: string;
};

export type ChatLine = {
  id: string;
  from: MessageRow['sender_type'];
  kind: MessageRow['content_type'];
  text: string;
  products: ChatProduct[];
  orderNumber: string | null;
  createdAt?: string;
  localUrl?: string;
};

export const MESSAGE_COLUMNS = 'id, sender_type, content_type, content_text, grounding_data, created_at';

export const toChatLine = (m: MessageRow): ChatLine => ({
  id: m.id,
  from: m.sender_type,
  kind: m.content_type,
  text: m.content_text ?? '',
  products: m.grounding_data?.products ?? [],
  orderNumber: m.grounding_data?.orderNumber ?? null,
  createdAt: m.created_at,
});

export const mediaLabel = (kind: ChatLine['kind']) => (kind === 'audio' ? '🎤 Voice note' : kind === 'image' ? '📷 Photo' : '');

export const taka = (n: number) => `৳${Number(n).toLocaleString('en-IN')}`;

export const dhakaTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', dateStyle: 'medium', timeStyle: 'short' });
