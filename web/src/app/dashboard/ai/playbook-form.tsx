'use client';

import { useState, useTransition } from 'react';
import { savePlaybook } from './actions';
import { PLAYBOOK_MAX_RULES, type PlaybookRule } from '@/lib/ai-profile';
import { btn, btnDanger, btnGhost, errorBox, input, label, noticeBox } from '@/components/ui';

const EXAMPLES: PlaybookRule[] = [
  {
    when: 'the customer asks for a discount',
    then: 'check customer_history. If they have 3 or more confirmed orders, offer 10% off this order. Otherwise say discounts are for repeat customers and suggest the sale items.',
  },
  { when: 'the customer asks if the product is original', then: 'say every item is imported directly and comes with the brand tag and receipt.' },
  { when: 'the customer asks to see the product on video', then: 'say the team will send a video on WhatsApp, and call request_human.' },
];

export function PlaybookForm({ initial }: { initial: PlaybookRule[] }) {
  const [rules, setRules] = useState<PlaybookRule[]>(initial.length ? initial : [{ when: '', then: '' }]);
  const [state, setState] = useState<{ error?: string; message?: string }>({});
  const [saving, start] = useTransition();

  const update = (i: number, patch: Partial<PlaybookRule>) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = (rule: PlaybookRule = { when: '', then: '' }) => setRules((rs) => [...rs.filter((r) => r.when || r.then), rule].slice(0, PLAYBOOK_MAX_RULES));

  return (
    <div className="space-y-4">
      {rules.map((rule, i) => (
        <div key={i} className="space-y-3 rounded-control border border-line p-4">
          <div>
            <label className={label} htmlFor={`when-${i}`}>When the customer…</label>
            <input className={input} id={`when-${i}`} maxLength={300} value={rule.when} onChange={(e) => update(i, { when: e.target.value })} placeholder="asks for a discount" />
          </div>
          <div>
            <label className={label} htmlFor={`then-${i}`}>The AI should…</label>
            <textarea className={input} id={`then-${i}`} rows={3} maxLength={1000} value={rule.then} onChange={(e) => update(i, { then: e.target.value })} placeholder="say or do this" />
          </div>
          <button type="button" onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))} className={`${btnDanger} min-h-9 px-2.5 text-xs`}>
            Remove
          </button>
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => add()} disabled={rules.length >= PLAYBOOK_MAX_RULES} className={btnGhost}>
          + Add instruction
        </button>
        <button
          type="button"
          className={btn}
          disabled={saving}
          onClick={() => start(async () => setState(await savePlaybook(rules)))}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {state.error && <p className={errorBox} role="alert">{state.error}</p>}
      {state.message && <p className={noticeBox}>{state.message}</p>}

      <div className="border-t border-line pt-4">
        <p className="mb-2 text-sm font-medium text-zinc-600">Examples, tap to add</p>
        <ul className="space-y-2">
          {EXAMPLES.map((ex) => (
            <li key={ex.when}>
              <button type="button" onClick={() => add(ex)} className="text-left text-sm text-zinc-600 hover:text-foreground">
                <span className="text-zinc-400">When</span> {ex.when} <span className="text-zinc-400">→</span> {ex.then}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
