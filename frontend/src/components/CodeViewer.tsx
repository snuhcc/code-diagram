// src/components/CodeViewer.tsx
'use client';

import { useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';

export default function CodeViewer({ filePath }: { filePath: string }) {
  const [code, setCode] = useState('// loading…');

  useEffect(() => {
    (async () => {
      /* TODO: fetch(`/api/code?path=${filePath}`) */
      setCode(`// Demo ${filePath}\n\nconsole.log('Hello');`);
    })();
  }, [filePath]);

  const lang =
    filePath.endsWith('.tsx') || filePath.endsWith('.ts')
      ? 'typescript'
      : filePath.endsWith('.md')
      ? 'markdown'
      : 'plaintext';

  return (
    <div className="h-full bg-[--color-background]">
      <div className="h-8 flex items-center text-xs px-3 bg-[--color-panel] border-b border-[--color-border] select-none">
        {filePath.split('/').pop()}
      </div>
      <Editor
        height="calc(100% - 2rem)"
        defaultLanguage={lang}
        value={code}
        theme="vs-dark"
        options={{
          readOnly: false,
          minimap: { enabled: true },
          fontSize: 14,
          folding: true,
          automaticLayout: true,
        }}
      />
    </div>
  );
}
