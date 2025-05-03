// src/components/DiagramViewer.tsx
'use client';

import { useEffect, useRef } from 'react';
import mermaid from 'mermaid';

let mermaidReady = false;

export default function DiagramViewer({ filePath }: { filePath: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mermaidReady) {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
      mermaidReady = true;
    }

    const id    = filePath.replace(/[^\w]/g, '_');
    const graph = `graph TD; Root[${id}] --> A; Root --> B;`;

    mermaid.render(id, graph).then(({ svg }) => {
      if (ref.current) ref.current.innerHTML = svg;
    });
  }, [filePath]);

  return <div ref={ref} className="h-full bg-[--color-panel] overflow-auto" />;
}
