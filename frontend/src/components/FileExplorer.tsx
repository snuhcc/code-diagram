'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useFS, FileNode } from '@/store/files';
import { useEditor } from '@/store/editor';
import { nanoid } from 'nanoid';

const TARGET_FOLDER = process.env.NEXT_PUBLIC_TARGET_FOLDER ?? 'study1/face_classification';

function filterTree(nodes: FileNode[] = []): FileNode[] {
  return nodes
    .filter((n) => n.name !== '__pycache__' && n.name !== '.DS_Store')
    .sort((a, b) => {
      const aIsDir = Array.isArray(a.children);
      const bIsDir = Array.isArray(b.children);
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    })
    .map((n) =>
      Array.isArray(n.children)
        ? { ...n, children: filterTree(n.children) }
        : n
    );
}

const arr = (x: FileNode[] | FileNode | undefined): FileNode[] =>
  Array.isArray(x) ? x : x ? [x] : [];

function getIcon(n: FileNode, isDir: boolean, isOpen: boolean) {
  if (isDir) {
    // VSCode 스타일 폴더 아이콘 (열림/닫힘)
    return isOpen ? (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        style={{ marginRight: 4, display: 'inline' }}
        fill="none"
      >
        <path
          d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.38a1.5 1.5 0 0 1 1.06.44l.62.62A1.5 1.5 0 0 0 8.62 5H13a1 1 0 0 1 1 1v6.5A1.5 1.5 0 0 1 12.5 14h-9A1.5 1.5 0 0 1 2 12.5v-8Z"
          fill="#eab308"
          stroke="#b45309"
          strokeWidth="0.7"
        />
      </svg>
    ) : (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        style={{ marginRight: 4, display: 'inline' }}
        fill="none"
      >
        <rect
          x="2"
          y="4"
          width="12"
          height="8"
          rx="1.5"
          fill="#fde68a"
          stroke="#b45309"
          strokeWidth="0.7"
        />
        <path
          d="M5.5 3h2.38a1.5 1.5 0 0 1 1.06.44l.62.62A1.5 1.5 0 0 0 8.62 5H2V4.5A1.5 1.5 0 0 1 3.5 3h2Z"
          fill="#fbbf24"
          stroke="#b45309"
          strokeWidth="0.7"
        />
      </svg>
    );
  }
  if (n.name.endsWith('.py')) {
    // Python 아이콘 (심플)
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 32 32"
        style={{ marginRight: 4, display: 'inline' }}
        fill="none"
      >
        <rect x="4" y="7" width="24" height="18" rx="6" fill="#3776AB" />
        <rect x="4" y="7" width="24" height="9" rx="4.5" fill="#FFD43B" />
        <circle cx="10" cy="12" r="1.5" fill="#222" />
        <circle cx="22" cy="20" r="1.5" fill="#fff" />
      </svg>
    );
  }
  // 기본 파일 아이콘
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      style={{ marginRight: 4, display: 'inline' }}
      fill="none"
    >
      <rect
        x="3"
        y="2"
        width="10"
        height="12"
        rx="2"
        fill="#e5e7eb"
        stroke="#94a3b8"
        strokeWidth="0.7"
      />
      <rect x="5" y="5" width="6" height="1" rx="0.5" fill="#94a3b8" />
      <rect x="5" y="8" width="6" height="1" rx="0.5" fill="#94a3b8" />
    </svg>
  );
}

function Row({
  n,
  depth,
  isDir,
  isOpen,
  isActive,
  onClick,
}: {
  n: FileNode;
  depth: number;
  isDir: boolean;
  isOpen: boolean;
  isActive: boolean;
  onClick: () => void;
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
      {getIcon(n, isDir, isOpen)}
      {n.name}
    </div>
  );
}

export default function FileExplorer() {
  const { tree, current, setCurrent, load } = useFS();
  const [open, setOpen] = useState<Record<string, boolean>>({ [TARGET_FOLDER]: true });
  const { activePath } = useEditor();

  useEffect(() => {
    (async () => {
      const data: FileNode[] = await fetch('/api/files').then((r) => r.json());
      const filteredTree = filterTree(data);
      load(filteredTree);
      useFS.getState().loadContents(); // 파일 내용 로드
    })();
  }, [load]);

  const click = (n: FileNode) => {
    if (Array.isArray(n.children)) {
      setOpen((o) => ({ ...o, [n.path ?? '']: !o[n.path ?? ''] }));
    } else if (n.path) {
      const regex = new RegExp(`^${TARGET_FOLDER}[\\\\/]`);
      const clean = n.path.replace(regex, '');
      setCurrent(n.id);
      useEditor.getState().open({
        id: nanoid(),
        path: clean,
        name: n.name,
      });
    }
  };

  const render = (nodes: FileNode[] | FileNode | undefined, depth = 0): JSX.Element[] =>
    arr(nodes).map((n) => {
      const isDir = Array.isArray(n.children);
      const isOpen = !!open[n.path ?? ''];
      const regex = new RegExp(`^${TARGET_FOLDER}[\\\\/]`);
      const isActive = n.path?.replace(regex, '') === activePath;

      return (
        <div key={n.id}>
          <Row
            n={n}
            depth={depth}
            isDir={isDir}
            isOpen={isOpen}
            isActive={isActive}
            onClick={() => click(n)}
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