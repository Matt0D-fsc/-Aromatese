// The AI has always spoken Bangla to customers while the dashboard spoke only English to the shop owner.
// This covers the shell a merchant reads on every visit — navigation, page headings, the buttons they press.
// Adding a screen is one line per string in both dictionaries; a missing key falls back to English rather
// than showing a blank or a key name.

export const LANGS = { en: 'English', bn: 'বাংলা' } as const;
export type Lang = keyof typeof LANGS;
export const LANG_COOKIE = 'cn_lang';

const en = {
  'nav.home': 'Home',
  'nav.products': 'Products',
  'nav.chats': 'Chats',
  'nav.orders': 'Orders',
  'nav.customers': 'Customers',
  'nav.analytics': 'Analytics',
  'nav.team': 'Team',
  'nav.profile': 'Shop profile',
  'nav.openChat': 'AI chat',
  'nav.signOut': 'Sign out',
  suspended: 'Your shop is suspended. You can view your data, but changes and AI replies are paused. Contact the ChatNab team.',

  'products.title': 'Products',
  'products.subtitle': 'Your AI sales agent can only sell, suggest and show what is listed here.',
  'products.add': '+ Add product',
  'products.emptyTitle': 'Add your first product',
  'products.emptyBody': 'Upload photos, set the price and stock, and let AI write the Bangla and Banglish titles. Once you have products, the AI can start selling.',
  'products.hidden': 'Hidden',
  'products.inStock': 'in stock',
  'products.outOfStock': 'Out of stock',

  'orders.title': 'Orders',
  'orders.subtitle': 'Orders your AI agent took in chat. Call the customer, then confirm. Confirming takes the items out of stock.',
  'orders.emptyTitle': 'No orders yet',
  'orders.emptyBody': 'When a customer agrees to buy in chat, the AI collects their details and the order shows up here.',
  'orders.confirm': 'Confirm',
  'orders.cancel': 'Cancel',
  'orders.search': 'Order number or phone',

  'chats.title': 'Chats',
  'chats.takeOver': 'Take over',
  'chats.handBack': 'Hand back to AI',
  'chats.send': 'Send',

  'customers.title': 'Customers',
  'analytics.title': 'Analytics',
} as const;

export type Key = keyof typeof en;

// Only the merchant-facing shell is translated so far. Anything not listed here reads in English.
const bn: Partial<Record<Key, string>> = {
  'nav.home': 'হোম',
  'nav.products': 'পণ্য',
  'nav.chats': 'চ্যাট',
  'nav.orders': 'অর্ডার',
  'nav.customers': 'ক্রেতা',
  'nav.analytics': 'হিসাব',
  'nav.team': 'টিম',
  'nav.profile': 'দোকানের তথ্য',
  'nav.openChat': 'এআই চ্যাট',
  'nav.signOut': 'সাইন আউট',
  suspended: 'আপনার দোকান সাময়িকভাবে বন্ধ আছে। আপনি তথ্য দেখতে পারবেন, কিন্তু পরিবর্তন ও এআই উত্তর বন্ধ। ChatNab টিমের সাথে যোগাযোগ করুন।',

  'products.title': 'পণ্য',
  'products.subtitle': 'এখানে যা আছে, আপনার এআই শুধু সেগুলোই দেখাতে ও বিক্রি করতে পারে।',
  'products.add': '+ নতুন পণ্য',
  'products.emptyTitle': 'প্রথম পণ্যটি যোগ করুন',
  'products.emptyBody': 'ছবি দিন, দাম ও স্টক লিখুন — বাংলা ও বাংলিশ নাম এআই নিজেই লিখে দেবে। পণ্য যোগ হলেই এআই বিক্রি শুরু করতে পারবে।',
  'products.hidden': 'লুকানো',
  'products.inStock': 'স্টকে আছে',
  'products.outOfStock': 'স্টকে নেই',

  'orders.title': 'অর্ডার',
  'orders.subtitle': 'এআই চ্যাটে যে অর্ডারগুলো নিয়েছে। ক্রেতাকে ফোন করে তারপর কনফার্ম করুন। কনফার্ম করলে স্টক কমে যাবে।',
  'orders.emptyTitle': 'এখনো কোনো অর্ডার নেই',
  'orders.emptyBody': 'চ্যাটে ক্রেতা কিনতে রাজি হলে এআই তার তথ্য নিয়ে অর্ডারটি এখানে দেখাবে।',
  'orders.confirm': 'কনফার্ম',
  'orders.cancel': 'বাতিল',
  'orders.search': 'অর্ডার নম্বর বা ফোন',

  'chats.title': 'চ্যাট',
  'chats.takeOver': 'নিজে উত্তর দিন',
  'chats.handBack': 'এআইকে ফেরত দিন',
  'chats.send': 'পাঠান',

  'customers.title': 'ক্রেতা',
  'analytics.title': 'হিসাব',
};

const DICTIONARIES: Record<Lang, Partial<Record<Key, string>>> = { en, bn };

export const t = (lang: Lang, key: Key): string => DICTIONARIES[lang][key] ?? en[key];
