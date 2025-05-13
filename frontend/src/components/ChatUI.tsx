'use client';

import { useState, useRef, useEffect, FormEvent } from 'react';

function SendIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M2 21L23 12L2 3L2 10L17 12L2 14L2 21Z" />
    </svg>
  );
}

export default function ChatUI() {
  const [input, setInput] = useState('');
  const [log, setLog] = useState<{ role: 'user' | 'bot'; t: string }[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;

    setLog((l) => [...l, { role: 'user', t: input }]);

    const res = await fetch('/api/chat', { method: 'POST', body: input });
    const text = await res.text();

    setLog((l) => [...l, { role: 'bot', t: text }]);
    setInput('');
  }

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [log]);

  return (
    <div className="flex flex-col h-full bg-slate-50 border-t border-slate-300">
      <div ref={listRef} className="flex-1 overflow-y-auto p-2 space-y-2">
        {log.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className={
                m.role === 'user'
                  ? 'bg-sky-100 text-sky-800 rounded-md px-3 py-2 max-w-[70%] whitespace-pre-wrap'
                  : 'bg-gray-200 text-gray-800 rounded-md px-3 py-2 max-w-[70%] whitespace-pre-wrap'
              }
            >
              {m.t}
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={send} className="flex items-center border-t border-slate-300 p-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1 bg-white text-sm p-2 resize-none outline-none rounded border border-slate-300"
          rows={1}
          placeholder="Ask something…"
        />

        <button
          type="submit"
          className="ml-2 w-10 h-10 flex items-center justify-center bg-sky-600 hover:bg-sky-700 text-white rounded transition-colors"
        >
          <SendIcon />
        </button>
      </form>
    </div>
  );
}
