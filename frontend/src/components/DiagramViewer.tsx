// frontend/src/components/DiagramViewer.tsx
'use client';

import { useState, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  MiniMap,
  Controls,
  MarkerType,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { nanoid } from 'nanoid';
import { useEditor } from '@/store/editor';
import { useFS, type FileNode } from '@/store/files';

/* ────────────────────────── 전역 캐시 ────────────────────────── */
let diagramCache: DiagramJSON | null = null;
const snippetCache = new Map<string, string>(); // <cleanPath, preview>

/* ─────────────────── dagre 레이아웃 유틸 ──────────────────── */
function layout(nodes: Node[] = [], edges: Edge[] = []): Node[] {
  const g = new dagre.graphlib.Graph().setGraph({
    rankdir: 'TB',
    nodesep: 50,
    ranksep: 70,
  });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((n) => g.setNode(n.id, { width: 160, height: 40 }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);

  return nodes.map((n) => {
    const { x, y } = g.node(n.id);
    return { ...n, position: { x, y } };
  });
}

/* ────────────────────── 공통 타입 ─────────────────────────── */
interface RawNode {
  id: string;
  label: string;
  file: string;
}
interface RawEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
}
interface DiagramJSON {
  nodes: RawNode[];
  edges: RawEdge[];
}

/* ──────────────────── API ENDPOINT ───────────────────────── */
const ENDPOINT = '/api/generate_control_flow_graph';
const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';

/* ──────────────────── 컴포넌트 ───────────────────────────── */
export default function DiagramViewer({ filePath }: { filePath: string }) {
  /* ─── 상태 ────────────────────────────────────────────── */
  const [baseNodes, setBaseNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoad] = useState(true);
  const [error, setErr] = useState<string>();
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [snippet, setSnippet] = useState<string>('');

  /* ─── zustand 스토어 ─────────────────────────────────── */
  const editorState = useEditor.getState();
  const fsState = useFS.getState();

  /* ─── 현재 에디터에 열린 파일 경로 ─────────────────────── */
  const activePath =
    editorState.tabs.find((t) => t.id === editorState.activeId)?.path ??
    editorState.tabs.at(-1)?.path ??
    '';

  /* ─── 노드 클릭: 코드 탭 열고 탐색기 하이라이트 ────────── */
  const onNodeClick: NodeMouseHandler = (_, node) => {
    const raw = (node.data as any)?.file as string | undefined;
    if (!raw) return;

    const clean = raw.replace(/^poc[\\/]/, '');
    editorState.open({
      id: nanoid(),
      path: clean,
      name: clean.split(/[\\/]/).pop() ?? clean,
    });

    const target = findByPath(fsState.tree, clean);
    if (target) fsState.setCurrent(target.id);
  };

  /* ─── hover 진입/이탈 ─────────────────────────────────── */
  const onEnter: NodeMouseHandler = async (_, node) => {
    setHoverId(node.id);

    const raw = (node.data as any)?.file as string | undefined;
    if (!raw) {
      setSnippet('');
      return;
    }
    const clean = raw.replace(/^poc[\\/]/, '');

    if (snippetCache.has(clean)) {
      setSnippet(snippetCache.get(clean)!);
      return;
    }

    try {
      const txt = await fetch(
        `/api/file?path=${encodeURIComponent(clean)}`
      ).then((r) => r.text());
      const preview = txt.split('\n').slice(0, 15).join('\n');
      snippetCache.set(clean, preview);
      setSnippet(preview);
    } catch {
      setSnippet('(preview unavailable)');
    }
  };

  const onLeave: NodeMouseHandler = () => {
    setHoverId(null);
    setSnippet('');
  };

  /* ─── 다이어그램 로딩 & 캐시 ───────────────────────────── */
  useEffect(() => {
    (async () => {
      if (diagramCache) {
        hydrate(diagramCache);
        setLoad(false);
        return;
      }

      setLoad(true);
      setErr(undefined);

      try {
        const res = await fetch(`${apiUrl}${ENDPOINT}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

        const raw = await res.json();
        const json: DiagramJSON =
          typeof raw === 'string'
            ? JSON.parse(raw)
            : typeof raw?.data === 'string'
            ? JSON.parse(raw.data)
            : raw?.data ?? raw;

        diagramCache = json;
        hydrate(json);
      } catch (e: any) {
        setErr(String(e));
        setBaseNodes([]);
        setEdges([]);
      } finally {
        setLoad(false);
      }
    })();
  }, [filePath]);

  /* ─── 노드 스타일 계산 ───────────────────────────────── */
  const nodes = baseNodes.map((n) => {
    const clean = (n.data as any)?.file?.replace(/^poc[\\/]/, '');
    const isActive = clean === activePath;
    const isHover = hoverId === n.id;

    return {
      ...n,
      style: {
        ...n.style,
        background: isHover
          ? '#fef9c3' // yellow-100
          : isActive
          ? '#dbeafe' // sky-100
          : '#ffffff',
        border: isHover
          ? '2px solid #eab308' // yellow-600
          : isActive
          ? '2px solid #0284c7' // sky-600
          : '1px solid #3b82f6',
        transition: 'all 0.1s ease-in-out',
      },
    };
  });

  /* ─── 로딩·에러 분기 ──────────────────────────────────── */
  if (loading)
    return <div className="p-4 text-sm text-slate-500">diagram loading…</div>;
  if (error)
    return (
      <div className="p-4 text-sm text-red-600 whitespace-pre-wrap">
        {error}
      </div>
    );

  /* ─── 렌더링 ──────────────────────────────────────────── */
  return (
    <div className="relative h-full w-full border-l border-slate-300">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={onEnter}
        onNodeMouseLeave={onLeave}
        fitView
        minZoom={0.2}
        maxZoom={2}
        className="bg-gray-50"
      >
        <Background variant="dots" gap={16} size={1} />
        <MiniMap pannable zoomable />
        <Controls />
      </ReactFlow>

      {/* ─── 우측 하단 코드 스니펫 패널 ─────────────────── */}
      {hoverId && snippet && (
        <div
          className="absolute bottom-2 right-2 w-[340px] max-h-[220px]
                     bg-slate-800 text-slate-100 text-xs
                     rounded shadow-lg p-3 overflow-auto
                     whitespace-pre font-mono"
        >
          {snippet}
        </div>
      )}
    </div>
  );

  /* ─── JSON → 상태 반영 ───────────────────────────────── */
  function hydrate(json: DiagramJSON) {
    const n: Node[] = json.nodes.map((r) => ({
      id: r.id,
      data: { label: r.label, file: r.file },
      position: { x: 0, y: 0 },
      style: {
        padding: 6,
        borderRadius: 4,
        border: '1px solid #3b82f6',
        background: '#fff',
      },
    }));

    const e: Edge[] = json.edges.map((r) => ({
      id: r.id,
      source: r.source,
      target: r.target,
      markerEnd: { type: MarkerType.ArrowClosed },
      animated: true,
    }));

    setBaseNodes(layout(n, e));
    setEdges(e);
  }
}

/* ─────────────────── FileNode 경로 매칭 ─────────────────── */
function findByPath(
  nodes: FileNode[] = [],
  p: string
): FileNode | undefined {
  for (const n of nodes) {
    if (n.path?.replace(/^poc[\\/]/, '') === p) return n;
    if (n.children) {
      const r = findByPath(n.children, p);
      if (r) return r;
    }
  }
}
