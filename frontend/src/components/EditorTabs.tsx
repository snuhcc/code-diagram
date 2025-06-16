'use client';

import { useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import { useEditor } from '@/store/editor';

function CodePane({
  path,
  highlights,
  highlight,
  line,
}: {
  path: string;
  highlights?: { line: number; query: string };
  highlight?: { from: number; to: number };
  line?: number;
}) {
  const [code, setCode] = useState('// loading…');
  const [err, setErr] = useState<string>();
  const [editor, setEditor] = useState<any>(null);

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

  useEffect(() => {
    if (!editor) return;

    // Remove all decorations first
    editor.deltaDecorations(
      editor.__currentDecorations || [],
      []
    );
    let decorations: any[] = [];

    // Highlight search results
    if (highlights) {
      const { line, query } = highlights;
      editor.revealLineAtTop(line);
      decorations.push({
        range: new monaco.Range(line, 1, line, 1),
        options: { isWholeLine: true, className: 'highlight-line' },
      });
      const matches = editor.getModel().findMatches(query, true, false, true, null, true);
      decorations = decorations.concat(
        matches.map((match) => ({
          range: match.range,
          options: { inlineClassName: 'highlight-text' },
        }))
      );
    }
    
    // Scroll to specific line (for function start) - position at 30% from top
    if (line && line > 0 && !highlights && !highlight) {
      const position = { lineNumber: line, column: 1 };
      editor.setPosition(position);
      editor.revealPositionNearTop(position);
    }
    
    console.log('highlight', highlight);
    // Highlight range
    if (highlight && highlight.from !== undefined && highlight.to !== undefined) {
      const model = editor.getModel();
      if (model) {
        const line_start = highlight.from;
        const line_end = highlight.to;
        
        // Scroll to the highlight position - position at 30% from top
        const position = { lineNumber: line_start, column: 1 };
        editor.setPosition(position);
        editor.revealPositionNearTop(position);
        
        decorations.push({
          range: new monaco.Range(
            line_start,
            1,
            line_end,
            1
          ),
          options: { isWholeLine: true, className: 'highlight-line' },
        });
      }
    }

    editor.__currentDecorations = editor.deltaDecorations(
      editor.__currentDecorations || [],
      decorations
    );
  }, [editor, highlights, highlight, line]);

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
      height="calc(100% - 2rem)"
      defaultLanguage={lang}
      value={code}
      theme="vs"
      onMount={(editor) => setEditor(editor)}
      options={{
        readOnly: true,
        fontSize: 11.5,
        minimap: { enabled: true },
        automaticLayout: true,
        wordWrap: 'on',
      }}
    />
  );
}

export default function EditorTabs() {
  const { tabs, activeId, setActive, close, searchHighlights, highlight, line } = useEditor();

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
      {/* ⭐️ 탭 바에 스크롤 추가 */}
      <div
        className="h-8 flex items-center bg-slate-200 border-b border-slate-300 select-none overflow-x-auto"
        style={{ whiteSpace: 'nowrap' }}
      >
        <div className="flex flex-row flex-nowrap">
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
                style={{ flex: '0 0 auto' }} // ⭐️ 탭이 줄바꿈되지 않도록
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
      </div>
      <div className="flex-1">
        <CodePane path={active.path} highlights={searchHighlights} highlight={highlight} line={line} />
      </div>
    </div>
  );
}