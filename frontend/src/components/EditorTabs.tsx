'use client';

import { useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import { useEditor } from '@/store/editor';

/* ─── 개별 코드 탭 ─────────────────────────────────────────── */
function CodePane({ path }: { path: string }) {
  const [code, setCode] = useState('// loading…');
  const [err, setErr] = useState<string>();

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
      if (!active) return;

      if (res.ok) {
        setCode(await res.text());
      } else {
        const { error } = await res.json().catch(() => ({ error: res.statusText }));
        setErr(`${res.status}: ${error}`);
      }
    })();
    return () => {
      active = false;
    };
  }, [path]);

  const lang = (() => {
    if (path.endsWith('.py')) return 'python';
    if (path.endsWith('.tsx') || path.endsWith('.ts')) return 'typescript';
    if (path.endsWith('.md')) return 'markdown';
    return 'plaintext';
  })();

  if (err) {
    return (
      <pre className="p-4 text-sm text-red-600 whitespace-pre-wrap">{err}</pre>
    );
  }

  return (
    <Editor
      height="calc(100% - 2rem)" // 상단 탭바 높이 제외
      defaultLanguage={lang}
      value={code}
      theme="vs-dark"
      options={{
        readOnly: true,
        fontSize: 14,
        minimap: { enabled: true },
        automaticLayout: true,
      }}
    />
  );
}

/* ─── 탭 컨테이너 ─────────────────────────────────────────── */
export default function EditorTabs() {
  const { tabs, activeId, setActive, close } = useEditor();

  if (!tabs.length) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-slate-500">
        Open a file to begin
      </div>
    );
  }

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  return (
    <div className="flex flex-col h-full">
      {/* 탭 헤더 */}
      <div className="h-8 flex items-center bg-slate-200 border-b border-slate-300 select-none">
        {tabs.map((t) => {
          const on = t.id === active.id;
          return (
            <div
              key={t.id}
              onClick={() => setActive(t.id)}
              className={
                'h-full flex items-center px-3 text-xs cursor-pointer border-r border-slate-300 transition-colors ' +
                (on
                  ? 'bg-white text-sky-700 font-semibold border-b-2 border-b-sky-600'
                  : 'text-slate-600 hover:bg-slate-100 border-b-2 border-b-transparent')
              }
            >
              {t.name}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  close(t.id);
                }}
                className="ml-2 text-slate-400 hover:text-slate-600 transition-colors"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {/* 코드 영역 */}
      <div className="flex-1">
        <CodePane path={active.path} />
      </div>
    </div>
  );
}
