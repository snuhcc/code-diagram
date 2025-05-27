import { useState, useEffect, FormEvent } from 'react';
import { XMarkIcon, PlusIcon } from '@heroicons/react/24/outline';

interface Message {
  role: 'user' | 'bot';
  t: string;
}

interface Session {
  id: string;
  log: Message[];
}

const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';

export default function ChatUI() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Open initial session on mount
  useEffect(() => {
    async function init() {
      const newSessionId = await openNewSession();
      if (newSessionId) {
        setCurrentSessionId(newSessionId);
      }
    }
    init();

    // Cleanup: close all remaining sessions on unmount
    return () => {
      sessions.forEach((session) => {
        fetch(`${apiUrl}/api/chatbot/session/close`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: session.id }),
        });
      });
    };
  }, []);

  const openNewSession = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/chatbot/session/open`, { method: 'GET' });
      console.log('res', res);
      if (!res.ok) throw new Error(`Failed to open session: ${res.status}`);
      const data = await res.json();
      const newSessionId = data.session_id;
      console.log('newSessionId', newSessionId);
      setSessions((prev) => [...prev, { id: newSessionId, log: [] }]);
      setCurrentSessionId(newSessionId);
      return newSessionId;
    } catch (err) {
      console.error('Failed to open session:', err);
      setError('Failed to open session. Please try again.');
      return null;
    }
  };

  const closeSession = async (sessionId: string) => {
    try {
      await fetch(`${apiUrl}/api/chatbot/session/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      });
      setSessions((prevSessions) => {
        const newSessions = prevSessions.filter((s) => s.id !== sessionId);
        if (currentSessionId === sessionId) {
          setCurrentSessionId(newSessions.length > 0 ? newSessions[0].id : null);
        }
        return newSessions;
      });
    } catch (err) {
      console.error('Failed to close session:', err);
      setError('Failed to close session. Please try again.');
    }
  };

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !currentSessionId) return;

    // Add user message
    setSessions((prev) =>
      prev.map((s) =>
        s.id === currentSessionId ? { ...s, log: [...s.log, { role: 'user', t: input }] } : s
      )
    );

    const body = JSON.stringify({
      session_id: currentSessionId,
      query: input,
      code: '',
      diagram: '',
    });

    try {
      const res = await fetch(`${apiUrl}/api/chatbot/session/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (!res.ok) throw new Error(`Failed to send message: ${res.status}`);
      const data = await res.json();
      const text = data.answer;
      setSessions((prev) =>
        prev.map((s) =>
          s.id === currentSessionId ? { ...s, log: [...s.log, { role: 'bot', t: text }] } : s
        )
      );
    } catch (err) {
      console.error('Failed to send message:', err);
      setSessions((prev) =>
        prev.map((s) =>
          s.id === currentSessionId
            ? { ...s, log: [...s.log, { role: 'bot', t: 'Error: Failed to send message.' }] }
            : s
        )
      );
    }
    setInput('');
  };

  const currentLog = sessions.find((s) => s.id === currentSessionId)?.log || [];

  return (
    <div className="flex flex-col h-full">
      {/* Session Tabs */}
      <div className="flex items-center space-x-2 bg-slate-200 border-b border-slate-300 p-2 overflow-x-auto">
        {sessions.map((session, index) => (
          <div
            key={session.id}
            onClick={() => setCurrentSessionId(session.id)}
            className={`flex items-center px-3 py-1 cursor-pointer rounded-t-md ${
              session.id === currentSessionId ? 'bg-white border-t border-x border-slate-300' : ''
            }`}
          >
            <span>Session {index + 1}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeSession(session.id);
              }}
              className="ml-2"
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
          </div>
        ))}
        <button onClick={openNewSession} className="px-2 py-1">
          <PlusIcon className="w-5 h-5" />
        </button>
      </div>

      {/* Chat Area */}
      <div className="flex-1 p-4 overflow-y-auto">
        {sessions.length === 0 ? (
          <p className="text-center text-gray-500">
            No active sessions. Click '+' to start a new session.
          </p>
        ) : (
          currentLog.map((msg, i) => (
            <div key={i} className={`mb-2 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
              <span
                className={`inline-block p-2 rounded ${
                  msg.role === 'user' ? 'bg-blue-100' : 'bg-gray-100'
                }`}
              >
                {msg.t}
              </span>
            </div>
          ))
        )}
        {error && <p className="text-red-500">{error}</p>}
      </div>

      {/* Input Form */}
      {currentSessionId && (
        <form onSubmit={send} className="p-4 border-t border-slate-300">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="w-full p-2 border rounded"
            placeholder="Type your message..."
          />
          <button type="submit" className="hidden">
            Send
          </button>
        </form>
      )}
    </div>
  );
}