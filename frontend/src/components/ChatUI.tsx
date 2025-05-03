// src/components/ChatUI.tsx
'use client';

import { useState, useRef, useEffect, FormEvent } from 'react';

export default function ChatUI() {
  const [input, setInput] = useState('');
  const [log, setLog] = useState<{ role: 'user' | 'bot'; t: string }[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    setLog(l => [...l, { role: 'user', t: input }]);
    const prompt = input;
    setInput('');

    /* TODO: 실제 LLM 호출 */
    const res  = await fetch('/api/chat', { method: 'POST', body: prompt });
    const text = await res.text();
    setLog(l => [...l, { role: 'bot', t: text }]);
  }

  useEffect(() => {
    listRef.current?.scrollTo(0, listRef.current.scrollHeight);
  }, [log]);

  return (
    <div className="flex flex-col h-full bg-[--color-panel] border-t border-[--color-border]">
      <div ref={listRef} className="flex-1 overflow-y-auto p-2 text-xs space-y-1">
        {log.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-[--color-accent]' : ''}>
            {m.t}
          </div>
        ))}
      </div>

      <form onSubmit={send} className="flex border-t border-[--color-border] p-1">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          className="flex-1 bg-[--color-background] text-xs p-2 resize-none outline-none"
          rows={1}
          placeholder="Ask…"
        />
        <button className="px-3">▶︎</button>
      </form>
    </div>
  );
}
