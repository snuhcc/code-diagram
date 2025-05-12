// src/components/EditorTabs.tsx
'use client';

import { useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import { useEditor } from '@/store/editor';

function CodePane({ path }: { path: string }) {
  const [code, setCode] = useState('// loading…');

  useEffect(() => {
    (async () => {
      /* TODO: fetch(`/api/code?path=${path}`) */
      setCode(`// Demo ${path}\n\nconsole.log('Hello');`);
    })();
  }, [path]);

  const lang =
    path.endsWith('.tsx') || path.endsWith('.ts')
      ? 'typescript'
      : path.endsWith('.md')
      ? 'markdown'
      : 'plaintext';

  return (
    <Editor
      height="calc(100% - 2rem)"
      defaultLanguage={lang}
      value={code}
      theme="vs-dark"
      options={{
        minimap: { enabled: true },
        fontSize: 14,
        automaticLayout: true,
      }}
    />
  );
}

export default function EditorTabs() {
  const { tabs, activeId, setActive, close } = useEditor();

  if (!tabs.length)
    return (
      <div className="h-full flex items-center justify-center text-sm text-[--color-foreground]/60">
        Open a file to begin
      </div>
    );

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  return (
    <div className="flex flex-col h-full">
      {/* ───── 탭 바 ───── */}
      <div className="h-8 flex items-center bg-[--color-panel] border-b border-[--color-border] select-none">
        {tabs.map((t) => {
          const isActive = t.id === active.id;
          return (
            <div
              key={t.id}
              onClick={() => setActive(t.id)}
              className={`h-full flex items-center px-3 text-xs cursor-pointer
                          border-r border-[--color-border]
                          ${
                            isActive
                              ? /* 활성 탭 */
                                'bg-[--color-background] text-[--color-accent] font-semibold ' +
                                'border-b-2 border-b-[--color-accent]'
                              : /* 비활성 탭 */
                                'text-[--color-foreground]/70 hover:bg-[--color-side]/40 ' +
                                'border-b-2 border-b-transparent'
                          }`}
            >
              {t.name}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  close(t.id);
                }}
                className="ml-2 text-[--color-foreground]/50 hover:text-[--color-foreground]"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {/* ───── 활성 에디터 ───── */}
      <div className="flex-1">
        <CodePane path={active.path} />
      </div>
    </div>
  );
}
