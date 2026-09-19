'use client';

import { useActionState, useState } from 'react';
import { sendStaffReply } from './actions';
import { btn, errorBox, input } from '@/components/ui';

// A client form so a refused reply can be shown next to the box that holds it. Meta only lets a shop answer
// within 24 hours of the customer's last message, and staff coming back the next morning need to read that
// and keep their text, not meet an error page that threw it away.
export function StaffReplyForm({ conversationId, placeholder, sendLabel }: { conversationId: string; placeholder: string; sendLabel: string }) {
  const [state, action, pending] = useActionState(sendStaffReply.bind(null, conversationId), {} as Awaited<ReturnType<typeof sendStaffReply>>);
  const [text, setText] = useState('');

  // Controlled, and cleared only once the customer has it: React 19 empties an uncontrolled form as soon as
  // its action returns, which would lose the message on exactly the failures worth reading. Adjusted during
  // render rather than in an effect, so there is no flash of the sent text.
  const [clearedAt, setClearedAt] = useState(state.sent);
  if (state.sent !== clearedAt) {
    setClearedAt(state.sent);
    setText('');
  }

  return (
    <form action={action} className="space-y-2">
      <div className="flex gap-2">
        <input
          name="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={input}
          placeholder={placeholder}
          required
          maxLength={2000}
          autoComplete="off"
          aria-label="Reply to the customer"
        />
        <button className={btn} disabled={pending}>
          {pending ? '…' : sendLabel}
        </button>
      </div>
      {state.error && (
        <p className={errorBox} role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
