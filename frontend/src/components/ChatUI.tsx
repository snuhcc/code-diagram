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
  const [dropdownSelectedIndex, setDropdownSelectedIndex] = useState<number>(-1);
  const dropdownRef = useRef<HTMLDivElement>(null); // 추가: 드롭다운 컨테이너 ref
  const dropdownItemRefs = useRef<(HTMLDivElement | null)[]>([]); // 추가: 각 아이템 ref
  const [isBotTyping, setIsBotTyping] = useState(false);
  const [isGraphSearch, setIsGraphSearch] = useState(false); // Call Graph Search 활성화 상태
  const [lastHighlightedNodes, setLastHighlightedNodes] = useState<string[]>([]); // 최근 하이라이트 노드들
  const [isHighlightOn, setIsHighlightOn] = useState(false); // 하이라이트 On/Off 상태
  const { tree } = useFS();
  const allFiles = getAllFilePaths(tree);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const didInit = useRef(false); // Strict Mode 중복방지


  useEffect(() => {
    if (didInit.current) return; // Strict Mode 중복 방지
    didInit.current = true;
    console.log('ChatUI mounted');
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
    
    // 그래프 검색 모드에서 예시 텍스트를 사용자가 수정하면 예시 텍스트 제거
    const examples = [
      '예시) getUserData함수가 호출되는 흐름은 어떤게 있습니까?',
      '예시) handleLogin함수를 호출하는 모든 함수들을 보여주세요',
      '예시) processPayment함수와 연관된 호출 관계를 분석해주세요'
    ];
    if (isGraphSearch && examples.includes(input) && value !== input) {
      setInput(value);
      return;
    }
    
    setInput(value);

    // 그래프 검색 모드에서는 파일 자동완성 비활성화
    if (isGraphSearch) {
      setShowDropdown(false);
      setDropdownSelectedIndex(-1);
      return;
    }

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
        setDropdownSelectedIndex(filtered.length > 0 ? 0 : -1);
      } else {
        setDropdownItems(allFiles); // Show all files when just "@" is typed
        setShowDropdown(true);
        setDropdownSelectedIndex(allFiles.length > 0 ? 0 : -1);
      }
    } else {
      setShowDropdown(false); // Hide dropdown if no "@" present
      setDropdownSelectedIndex(-1);
    }
  };

  // Keyboard navigation for dropdown
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 그래프 검색 모드에서는 드롭다운 키보드 네비게이션 비활성화
    if (isGraphSearch || !showDropdown || dropdownItems.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setDropdownSelectedIndex((prev) => {
        const next = prev < dropdownItems.length - 1 ? prev + 1 : 0;
        return next;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setDropdownSelectedIndex((prev) => {
        const next = prev > 0 ? prev - 1 : dropdownItems.length - 1;
        return next;
      });
    } else if (e.key === 'Enter') {
      if (dropdownSelectedIndex >= 0 && dropdownSelectedIndex < dropdownItems.length) {
        e.preventDefault();
        handleSelectItem(dropdownItems[dropdownSelectedIndex]);
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  // 선택된 드롭다운 항목이 보이도록 스크롤 조정
  useEffect(() => {
    if (
      showDropdown &&
      dropdownSelectedIndex >= 0 &&
      dropdownItemRefs.current[dropdownSelectedIndex]
    ) {
      dropdownItemRefs.current[dropdownSelectedIndex]?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [dropdownSelectedIndex, showDropdown, dropdownItems]);

  const handleSelectItem = (selected: string) => {
    const atIndex = input.lastIndexOf('@');
    if (atIndex >= 0) {
      const beforeAt = input.slice(0, atIndex + 1);
      const afterAt = input.slice(atIndex + 1);
      const spaceIndex = afterAt.indexOf(' ');
      const endIndex = spaceIndex >= 0 ? atIndex + 1 + spaceIndex : input.length;
      // Insert @filename and a space after
      const newInput = beforeAt + selected + ' ' + input.slice(endIndex);
      setInput(newInput);
    }
    setShowDropdown(false);
    setDropdownSelectedIndex(-1);
  };

  // Call Graph Search 토글 함수
  const toggleGraphSearch = () => {
    setIsGraphSearch(!isGraphSearch);
    if (!isGraphSearch) {
      // 그래프 검색 모드 활성화 시 예시 텍스트 설정 (랜덤으로 선택)
      const examples = [
        '예시) getUserData함수가 호출되는 흐름은 어떤게 있습니까?',
        '예시) handleLogin함수를 호출하는 모든 함수들을 보여주세요',
        '예시) processPayment함수와 연관된 호출 관계를 분석해주세요'
      ];
      const randomExample = examples[Math.floor(Math.random() * examples.length)];
      setInput(randomExample);
    } else {
      // 비활성화 시 입력창 비우기 및 하이라이트 관련 상태 리셋
      setInput('');
      setLastHighlightedNodes([]);
      setIsHighlightOn(false);
      clearHighlights();
    }
  };

  // 하이라이트 토글 함수
  const toggleHighlight = () => {
    const newHighlightState = !isHighlightOn;
    setIsHighlightOn(newHighlightState);
    
    console.log('[ChatUI] Toggling highlights:', newHighlightState ? 'ON' : 'OFF');
    if ((window as any).updateHighlightedNodes) {
      if (newHighlightState && lastHighlightedNodes.length > 0) {
        // ON: 최근 하이라이트 노드들 복원
        (window as any).updateHighlightedNodes(lastHighlightedNodes);
      } else {
        // OFF: 하이라이트 해제
        (window as any).updateHighlightedNodes([]);
      }
    }
  };

  // 하이라이트 해제 함수 (기존 로직 유지 - 내부적으로 사용)
  const clearHighlights = () => {
    console.log('[ChatUI] Clearing highlights');
    setIsHighlightOn(false);
    if ((window as any).updateHighlightedNodes) {
      (window as any).updateHighlightedNodes([]);
    }
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
          graph_mode: isGraphSearch,
          target_path: targetFolder,
          query: input,
          code: '',
          diagram: '',
          context_files: contextFiles,
        }),
      });
      if (!res.ok) throw new Error(`Failed to send message: ${res.status}`);
      const data = await res.json();
      const text = data.answer;
      const highlightNodes = data.highlight || [];
      // 그래프 검색 모드에서 하이라이트할 노드 ID들이 있는지 확인
      if (isGraphSearch && highlightNodes.length > 0) {
        // 최근 하이라이트 노드들 저장
        setLastHighlightedNodes(highlightNodes);
        setIsHighlightOn(true);
        
        // DiagramViewer에 하이라이트 노드들 전달
        console.log('[ChatUI] Highlight nodes:', highlightNodes);
        if ((window as any).updateHighlightedNodes) {
          (window as any).updateHighlightedNodes(highlightNodes);
        }
      }
      
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
          {/* Call Graph Search 버튼 및 하이라이트 해제 버튼 */}
          <div className="mb-3 flex items-center gap-2">
            <button
              onClick={toggleGraphSearch}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                isGraphSearch
                  ? 'bg-blue-500 text-white hover:bg-blue-600'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              🔍 Call Graph Search
            </button>
            
            {/* 하이라이트 On/Off 토글 버튼 - 그래프 검색 모드이고 하이라이트할 노드가 있을 때만 표시 */}
            {isGraphSearch && lastHighlightedNodes.length > 0 && (
              <button
                onClick={toggleHighlight}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  isHighlightOn
                    ? 'bg-purple-500 text-white hover:bg-purple-600'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {isHighlightOn ? '✨ Highlight ON' : '⭕ Highlight OFF'}
              </button>
            )}
          </div>
          
          <form onSubmit={send}>
            <input
              type="text"
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              onFocus={() => {
                // 사용자가 입력을 시작하면 그래프 검색 모드에서도 예시 텍스트 제거
                const examples = [
                  '예시) getUserData함수가 호출되는 흐름은 어떤게 있습니까?',
                  '예시) handleLogin함수를 호출하는 모든 함수들을 보여주세요',
                  '예시) processPayment함수와 연관된 호출 관계를 분석해주세요'
                ];
                if (isGraphSearch && examples.includes(input)) {
                  setInput('');
                }
              }}
              className={`w-full p-2 border rounded transition-colors ${
                isGraphSearch ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-300'
              }`}
              placeholder={
                isGraphSearch
                  ? "[Call Graph Search Mode] Type your query here..."
                  : "[Chat Mode] Type your query here..."
              }
            />
            <button type="submit" className="hidden">
              Send
            </button>
          </form>
          {showDropdown && !isGraphSearch && (
            <div
              ref={dropdownRef}
              className="absolute z-10 bg-white border border-slate-300 rounded shadow-md max-h-60 overflow-y-auto"
              style={{ bottom: '100%', left: 0, width: '100%', maxHeight: '12rem' }} // maxHeight: 5*2.4rem=12rem
            >
              {dropdownItems.map((item, i) => (
                <div
                  key={i}
                  ref={el => (dropdownItemRefs.current[i] = el)}
                  onClick={() => handleSelectItem(item)}
                  className={`px-3 py-1 hover:bg-slate-100 cursor-pointer ${
                    i === dropdownSelectedIndex ? 'bg-blue-100' : ''
                  }`}
                  style={{ minHeight: '2.4rem' }}
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