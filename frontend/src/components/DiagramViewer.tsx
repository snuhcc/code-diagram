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

/* ────────────── 세션-전역 다이어그램 캐시 ────────────── */
let diagramCache: DiagramJSON | null = null;

/* ───────────── dagre helper ───────────── */
function layout(nodes: Node[] = [], edges: Edge[] = []) {
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

/* ──────────── 타입 (백엔드 공통) ─────────── */
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

/* ──────────── 엔드포인트 ──────────── */
const ENDPOINT = '/api/generate_control_flow_graph';

export default function DiagramViewer({ filePath }: { filePath: string }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoad] = useState(true);
  const [error, setErr] = useState<string>();

  const openTab = useEditor((s) => s.open);

  /* ───── 노드 클릭 → 코드 탭 열기 + 탐색기 하이라이트 ───── */
  const onNodeClick: NodeMouseHandler = (_, node) => {
    const file: string | undefined = (node.data as any)?.file;
    if (!file) return;

    const clean = file.replace(/^poc[\\/]/, '');
    openTab({
      id: nanoid(),
      path: clean,
      name: clean.split(/[\\/]/).pop() ?? clean,
    });

    // 파일-익스플로러 현재 파일 동기화
    const fsState = useFS.getState();
    const target = findByPath(fsState.tree, clean);
    if (target) fsState.setCurrent(target.id);
  };

  /* ───── 다이어그램 로딩 ───── */
  useEffect(() => {
    (async () => {
      /* ① 캐시 존재 시 즉시 사용 */
      if (diagramCache) {
        hydrate(diagramCache);
        setLoad(false);
        return;
      }

      /* ② 없으면 API 호출 */
      setLoad(true);
      setErr(undefined);

      try {
        const res = await fetch(`http://localhost:8000${ENDPOINT}`, {
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

        diagramCache = json;      // ③ 성공 시 캐시
        hydrate(json);
      } catch (e: any) {
        setErr(String(e));
        setNodes([]);
        setEdges([]);
      } finally {
        setLoad(false);
      }
    })();
  }, [filePath]);

  /* ───── 렌더링 분기 ───── */
  if (loading)
    return <div className="p-4 text-sm text-slate-500">diagram loading…</div>;
  if (error)
    return (
      <div className="p-4 text-sm text-red-600 whitespace-pre-wrap">{error}</div>
    );

  return (
    <div className="relative h-full w-full border-l border-slate-300">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={onNodeClick}
        fitView
        minZoom={0.2}
        maxZoom={2}
        className="bg-gray-50"
      >
        <Background variant="dots" gap={16} size={1} />
        <MiniMap pannable zoomable />
        <Controls />
      </ReactFlow>
    </div>
  );

  /* ─── 내부 util ─────────────────────────────────────────── */
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
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed },
    }));

    setNodes(layout(n, e));
    setEdges(e);
  }
}

/* ──────────── helper: 경로로 FileNode 찾기 ─────────── */
function findByPath(nodes: FileNode[] = [], p: string): FileNode | undefined {
  for (const n of nodes) {
    if (n.path?.replace(/^poc[\\/]/, '') === p) return n;
    if (n.children) {
      const r = findByPath(n.children, p);
      if (r) return r;
    }
  }
}
