import { useState, useEffect, useRef, FormEvent } from 'react';
import { XMarkIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useFS, getAllFilePaths } from '@/store/files';
import { marked } from 'marked'; // 마크다운 파서 추가

interface Message {
  role: 'user' | 'bot';
  t: string;
}

interface Session {
  id: string;
  log: Message[];
}

const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';
const targetFolder = process.env.NEXT_PUBLIC_TARGET_FOLDER || ''; // 추가

export default function ChatUI() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownItems, setDropdownItems] = useState<string[]>([]);
  const [isBotTyping, setIsBotTyping] = useState(false);
  const { tree } = useFS();
  const allFiles = getAllFilePaths(tree);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function init() {
      const newSessionId = await openNewSession();
      if (newSessionId) setCurrentSessionId(newSessionId);
    }
    init();

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
      if (!res.ok) throw new Error(`Failed to open session: ${res.status}`);
      const data = await res.json();
      const newSessionId = data.session_id;
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

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInput(value);

    const atIndex = value.lastIndexOf('@');
    if (atIndex >= 0) {
      const afterAt = value.slice(atIndex + 1);
      const spaceIndex = afterAt.indexOf(' ');
      const word = spaceIndex >= 0 ? afterAt.slice(0, spaceIndex) : afterAt;
      if (word) {
        const filtered = allFiles.filter((path) =>
          path.toLowerCase().includes(word.toLowerCase())
        );
        setDropdownItems(filtered);
        setShowDropdown(true);
      } else {
        setDropdownItems(allFiles); // Show all files when just "@" is typed
        setShowDropdown(true);
      }
    } else {
      setShowDropdown(false); // Hide dropdown if no "@" present
    }
  };

  const handleSelectItem = (selected: string) => {
    const atIndex = input.lastIndexOf('@');
    if (atIndex >= 0) {
      const beforeAt = input.slice(0, atIndex + 1);
      const afterAt = input.slice(atIndex + 1);
      const spaceIndex = afterAt.indexOf(' ');
      const endIndex = spaceIndex >= 0 ? atIndex + 1 + spaceIndex : input.length;
      const newInput = beforeAt + selected + input.slice(endIndex);
      setInput(newInput); // Update input with selected file
    }
    setShowDropdown(false); // Hide dropdown after selection
  };

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !currentSessionId) return;

    setSessions((prev) =>
      prev.map((s) =>
        s.id === currentSessionId ? { ...s, log: [...s.log, { role: 'user', t: input }] } : s
      )
    );
    setInput('');
    setIsBotTyping(true); // 답변 대기 시작

    try {
      // context_files 생성 시 targetFolder를 앞에 붙임
      const contextFiles =
        input.match(/@(\S+)/g)?.map((m) => {
          const file = m.slice(1);
          return targetFolder ? `${targetFolder}/${file}` : file;
        }) || [];
      const res = await fetch(`${apiUrl}/api/chatbot/session/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: currentSessionId,
          query: input,
          code: '',
          diagram: '',
          context_files: contextFiles,
        }),
      });
      if (!res.ok) throw new Error(`Failed to send message: ${res.status}`);
      const data = await res.json();
      const text = data.answer;
      setSessions((prev) =>
        prev.map((s) =>
          s.id === currentSessionId ? { ...s, log: [...s.log, { role: 'bot', t: text }] } : s
        )
      );
      setIsBotTyping(false); // 답변 도착
    } catch (err) {
      console.error('Failed to send message:', err);
      setSessions((prev) =>
        prev.map((s) =>
          s.id === currentSessionId
            ? { ...s, log: [...s.log, { role: 'bot', t: 'Error: Failed to send message.' }] }
            : s
        )
      );
      setIsBotTyping(false); // 에러 발생 시도 답변 대기 종료
    }
  };

  const currentLog = sessions.find((s) => s.id === currentSessionId)?.log || [];

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [currentLog, currentSessionId]);

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <div className="flex items-center space-x-2 bg-slate-200 border-b border-slate-300 p-2 overflow-x-auto">
        {sessions.map((session, index) => (
          <div
            key={session.id}
            onClick={() => setCurrentSessionId(session.id)}
            className={`flex items-center px-3 py-1 cursor-pointer rounded-t-md ${
              session.id === currentSessionId ? 'bg-white border-t border-x border-slate-300' : ''
            }`}
          >
            <span style={{ fontWeight: 'bold' }}>💬 Chat # {index + 1}</span>
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

      <div
        ref={chatContainerRef}
        className="flex-1 p-4 overflow-y-auto bg-white"
      >
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
                // 마크다운 렌더링
                dangerouslySetInnerHTML={{ __html: marked.parse(msg.t) }}
              />
            </div>
          ))
        )}
        {isBotTyping && (
          <div className="mb-2 text-left">
            <span className="inline-block p-2 rounded bg-gray-100 text-gray-500 animate-pulse">
              <TypingIndicator />
            </span>
          </div>
        )}
        {error && <p className="text-red-500">{error}</p>}
      </div>

      {currentSessionId && (
        <div className="relative p-4 border-t border-slate-300 bg-white">
          <form onSubmit={send}>
            <input
              type="text"
              value={input}
              onChange={handleInputChange}
              className="w-full p-2 border rounded"
              placeholder="Type your message..."
            />
            <button type="submit" className="hidden">
              Send
            </button>
          </form>
          {showDropdown && (
            <div
              className="absolute z-10 bg-white border border-slate-300 rounded shadow-md max-h-60 overflow-y-auto"
              style={{ bottom: '100%', left: 0 }}
            >
              {dropdownItems.map((item, i) => (
                <div
                  key={i}
                  onClick={() => handleSelectItem(item)}
                  className="px-3 py-1 hover:bg-slate-100 cursor-pointer"
                >
                  {item}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// 채팅 타이핑 인디케이터 컴포넌트
function TypingIndicator() {
  return (
    <span>
      <span className="inline-block w-2 h-2 bg-gray-400 rounded-full mr-1 animate-bounce" style={{ animationDelay: '0s' }}></span>
      <span className="inline-block w-2 h-2 bg-gray-400 rounded-full mr-1 animate-bounce" style={{ animationDelay: '0.2s' }}></span>
      <span className="inline-block w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></span>
    </span>
  );
}