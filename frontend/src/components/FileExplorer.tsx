// src/components/FileExplorer.tsx
'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useFS, FileNode } from '@/store/files';

export default function FileExplorer() {
  const { tree, current, setCurrent, load } = useFS();
  const [open, setOpen] = useState<Record<string, boolean>>({});

  /* DEMO 트리 – 추후 fetch('/api/files') 로 교체 */
  useEffect(() => {
    load([
      {
        id: 'src',
        name: 'src',
        path: '/src',
        children: [
          { id: 'index', name: 'index.tsx', path: '/src/index.tsx' },
          { id: 'app',   name: 'App.tsx',   path: '/src/App.tsx'   },
        ],
      },
      { id: 'readme', name: 'README.md', path: '/README.md' },
    ]);
    setOpen({ '/src': true });
  }, [load]);

  const render = (nodes: FileNode[], depth = 0) =>
    nodes.map((n) => {
      const isDir    = !!n.children;
      const isOpen   = open[n.path];
      const isActive = current?.path === n.path;

      return (
        <div key={n.path}>
          <div
            style={{ paddingLeft: depth * 12 }}
            className={clsx(
              'cursor-pointer select-none text-xs py-[2px] px-1',
              'hover:bg-[--color-side]/40',
              isActive && 'vscode-tree-active'
            )}
            onClick={() => {
              if (isDir) {
                setOpen(o => ({ ...o, [n.path]: !o[n.path] }));
              } else {
                setCurrent(n.id);
              }
            }}
          >
            {isDir ? (isOpen ? '▾ ' : '▸ ') : '  '}
            {n.name}
          </div>

          {isDir && isOpen && n.children && render(n.children, depth + 1)}
        </div>
      );
    });

  return (
    <aside className="w-56 h-full vscode-sidebar overflow-y-auto">
      {render(tree)}
    </aside>
  );
}
