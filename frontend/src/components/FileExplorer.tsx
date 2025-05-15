'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useFS, FileNode } from '@/store/files';
import { useEditor } from '@/store/editor';
import { nanoid } from 'nanoid';

function filterTree(nodes: FileNode[] = []): FileNode[] {
  return nodes
    .filter((n) => n.name !== '__pycache__')           // ① 현재 노드 제외
    .map((n) =>
      Array.isArray(n.children)                        // ② 자식도 재귀적으로 필터
        ? { ...n, children: filterTree(n.children) }
        : n,
    );
}

/* 배열/객체/undefined → 배열 */
const arr = (x: FileNode[] | FileNode | undefined): FileNode[] =>
  Array.isArray(x) ? x : x ? [x] : [];

/* 한 줄 UI */
function Row({
  n, depth, isDir, isOpen, isActive, onClick,
}: {
  n: FileNode; depth: number; isDir: boolean; isOpen: boolean;
  isActive: boolean; onClick: () => void;
}) {
  return (
    <div
      style={{ paddingLeft: depth * 12 }}
      className={clsx(
        'cursor-pointer select-none text-xs py-[2px] px-1',
        'hover:bg-slate-100 transition-colors',
        isActive && 'bg-sky-100 text-sky-700'
      )}
      onClick={onClick}
    >
      {isDir ? (isOpen ? '▾ ' : '▸ ') : '  '}
      {n.name}
    </div>
  );
}

export default function FileExplorer() {
  const { tree, current, setCurrent, load } = useFS();
  const [open, setOpen] = useState<Record<string, boolean>>({ poc: true });

  /* 트리 로드 */
  useEffect(() => {
    (async () => {
      const data: FileNode[] = await fetch('/api/files').then((r) => r.json());
      load(filterTree(data));                          // ← 필터링 후 저장
    })();
  }, [load]);

  /* 클릭 동작 */
  const click = (n: FileNode) => {
    if (Array.isArray(n.children)) {
      setOpen(o => ({ ...o, [n.path ?? '']: !o[n.path ?? ''] }));
    } else if (n.path) {
      const clean = n.path.replace(/^poc[\\/]/, '');
      console.log(clean)
      // 2) 상태 업데이트
      setCurrent(n.id);
      useEditor.getState().open({
        id: nanoid(),
        path: clean,
        name: n.name,
      });


    }
  };

  /* 재귀 렌더 */
  const render = (nodes: FileNode[] | FileNode | undefined, depth = 0): JSX.Element[] =>
    arr(nodes).map(n => {
      const isDir = Array.isArray(n.children);
      const isOpen = !!open[n.path ?? ''];
      const isActive = current?.id === n.id;

      return (
        <div key={n.id}>
          <Row
            n={n} depth={depth} isDir={isDir} isOpen={isOpen}
            isActive={isActive} onClick={() => click(n)}
          />
          {isDir && isOpen && render(n.children, depth + 1)}
        </div>
      );
    });

  return (
    <aside className="w-full pl-2 h-full overflow-y-auto border-r border-slate-300 bg-slate-50">
      {render(tree)}
    </aside>
  );
}
