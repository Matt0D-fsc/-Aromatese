import { describe, expect, it } from 'vitest';
import { mediaObjectPath, mediaNote, toChatLine, type MessageRow } from '../web/src/lib/chat.js';

const row = (over: Partial<MessageRow>): MessageRow => ({
  id: 'm1',
  sender_type: 'customer',
  content_type: 'text',
  content_text: null,
  media_url: null,
  grounding_data: null,
  created_at: '2026-09-18T10:00:00Z',
  ...over,
});

describe('chat media', () => {
  it('builds a per-shop object path and strips the codec off the mime type', () => {
    expect(mediaObjectPath('t1', 'c1', 'm1', 'audio/webm;codecs=opus')).toBe('t1/c1/m1.webm');
    expect(mediaObjectPath('t1', 'c1', 'm1', 'image/jpeg')).toBe('t1/c1/m1.jpeg');
    // Unknown or malformed types still get a usable path rather than throwing.
    expect(mediaObjectPath('t1', 'c1', 'm1', 'rubbish')).toBe('t1/c1/m1.bin');
  });

  it('surfaces a transcript or a photo description, and nothing when neither was saved', () => {
    expect(mediaNote({ media: { transcript: 'ei ghori ta koto?' } })).toBe('ei ghori ta koto?');
    expect(mediaNote({ media: { description: 'blue cotton saree' } })).toBe('blue cotton saree');
    expect(mediaNote({ products: [] })).toBe('');
    expect(mediaNote(null)).toBe('');
  });

  it('carries the media path and note onto the chat line', () => {
    const line = toChatLine(row({ content_type: 'audio', media_url: 't1/c1/m1.webm', grounding_data: { media: { transcript: 'lal shari ache?' } } }));
    expect(line.mediaPath).toBe('t1/c1/m1.webm');
    expect(line.mediaNote).toBe('lal shari ache?');
    // A plain text message stays clean: no path, no note.
    expect(toChatLine(row({ content_text: 'hi' }))).toMatchObject({ mediaPath: null, mediaNote: '', text: 'hi' });
  });
});

describe('search input', () => {
  it('strips the characters PostgREST or() treats as syntax', async () => {
    const { searchTerm } = await import('../web/src/lib/chat.js');
    // A term that would otherwise close the filter and append another one.
    expect(searchTerm('CN-ABC,status.eq.confirmed')).toBe('CN-ABCstatus.eq.confirmed');
    expect(searchTerm('*%()')).toBe('');
    expect(searchTerm('  01712345678  ')).toBe('01712345678');
    expect(searchTerm(undefined)).toBe('');
    expect(searchTerm('x'.repeat(200))).toHaveLength(60);
  });
});

describe('csv export', () => {
  it('stops a spreadsheet formula from executing when a merchant opens the file', async () => {
    const { csvCell } = await import('../web/src/lib/csv.js');
    // A product title someone could set deliberately.
    expect(csvCell('=cmd|/c calc')).toBe('"\'=cmd|/c calc"');
    expect(csvCell('+1')).toBe('"\'+1"');
    expect(csvCell('-5')).toBe('"\'-5"');
    expect(csvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"');
    // Ordinary values are left alone, quotes doubled, objects serialised.
    expect(csvCell('Neel Saree')).toBe('"Neel Saree"');
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell({ phone: '01712345678' })).toBe('"{""phone"":""01712345678""}"');
    expect(csvCell(null)).toBe('');
  });

  it('writes a BOM so Excel reads Bangla as UTF-8', async () => {
    const { csvFile } = await import('../web/src/lib/csv.js');
    const file = csvFile(['title', 'price'], [{ title: 'নীল শাড়ি', price: 2400 }]);
    expect(file.startsWith('﻿')).toBe(true);
    expect(file).toContain('নীল শাড়ি');
    expect(file.split('\r\n')).toHaveLength(2);
  });
});

describe('AI persona and playbook', () => {
  it('keeps only complete, capped rules and puts them in the prompt with admin instructions last', async () => {
    const { readPlaybook, readPersona } = await import('../web/src/lib/ai-profile.js');
    const { systemPrompt } = await import('../web/src/lib/agent.js');
    const rules = readPlaybook([{ when: ' asks for a discount ', then: 'check customer_history' }, { when: 'no action', then: '' }, 'junk', { when: 'x'.repeat(400), then: 'y' }]);
    expect(rules).toHaveLength(2);
    expect(rules[0]).toEqual({ when: 'asks for a discount', then: 'check customer_history' });
    expect(rules[1].when).toHaveLength(300);
    expect(readPersona({ assistantName: 'Rupa', evil: 'x' })).toEqual({ assistantName: 'Rupa' });

    const prompt = systemPrompt({ id: 't', name: 'Shop', business_category: null, ai_playbook: rules, ai_persona: { assistantName: 'Rupa', adminInstructions: 'No same-day delivery.' } });
    expect(prompt).toContain('You are Rupa, the AI sales assistant');
    expect(prompt).toContain('1. When asks for a discount -> check customer_history');
    expect(prompt.indexOf('PLATFORM INSTRUCTIONS')).toBeGreaterThan(prompt.indexOf('SHOP INSTRUCTIONS —'));
    expect(systemPrompt({ id: 't', name: 'Shop', business_category: null })).not.toContain('SHOP INSTRUCTIONS —');
  });
});

describe('monthly usage', () => {
  it('warns from 80% and stops at the limit, with months in UTC', async () => {
    const { usageLevel, monthStart, nextReset } = await import('../web/src/lib/usage.js');
    expect(usageLevel(0, 1000)).toBe('ok');
    expect(usageLevel(799, 1000)).toBe('ok');
    expect(usageLevel(800, 1000)).toBe('warn');
    expect(usageLevel(1000, 1000)).toBe('out');
    expect(usageLevel(0, 0)).toBe('out'); // a limit of 0 means no AI at all
    const late = new Date('2026-12-31T23:30:00Z');
    expect(monthStart(late).toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(nextReset(late).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('delivery fees from policy text', () => {
  it('reads one clear amount, and nothing when it is ambiguous', async () => {
    const { parseFee, collectAmount } = await import('../web/src/lib/orders.js');
    expect(parseFee('60 taka')).toBe(60);
    expect(parseFee('৳120')).toBe(120);
    expect(parseFee('১২০ টাকা')).toBe(120);
    expect(parseFee('Tk 1,200')).toBe(1200);
    expect(parseFee('Free')).toBe(0);
    expect(parseFee('ফ্রি ডেলিভারি')).toBe(0);
    expect(parseFee('60-80 taka')).toBeNull();
    expect(parseFee('free over 2000, else 60')).toBeNull();
    expect(parseFee('depends on weight')).toBeNull();
    expect(parseFee(undefined)).toBeNull();
    expect(collectAmount({ total_bdt: '2800.00', courier_fee_bdt: '60.00' })).toBe(2860);
  });
});
