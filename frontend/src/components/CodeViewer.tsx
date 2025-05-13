'use client';

import { useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';

export default function CodeViewer({ filePath }: { filePath: string }) {
  const [code, setCode] = useState('// loading…');

  /* ① 실제 파일 내용 가져오기 -------------------------------------- */
  useEffect(() => {
    (async () => {
      const c = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`).then((r) =>
        r.text()
      );
      setCode(c);
    })();
  }, [filePath]);

  /* ② 확장자로 언어 결정 ----------------------------------------- */
  const lang = (() => {
    if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) return 'typescript';
    if (filePath.endsWith('.py')) return 'python';
    if (filePath.endsWith('.md')) return 'markdown';
    return 'plaintext';
  })();

  /* ③ 에디터 + 제목 바 ------------------------------------------- */
  return (
    <div className="h-full bg-slate-100 rounded-md shadow-sm overflow-hidden">
      <div className="h-8 flex items-center px-3 bg-slate-200 border-b border-slate-300 text-xs">
        {filePath.split('/').pop()}
      </div>
      <Editor
        height="calc(100% - 2rem)"
        defaultLanguage={lang}
        value={code}
        theme="vs-dark"
        options={{
          minimap: { enabled: true },
          fontSize: 14,
          automaticLayout: true,
          readOnly: true,
        }}
      />
    </div>
  );
}
