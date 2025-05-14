// src/components/DiagramViewer.tsx
'use client';

import { useState, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  MiniMap,
  Controls,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';

/* ───────────── dagre helper ───────────── */
function layout(nodes: Node[] = [], edges: Edge[] = []) {
  const g = new dagre.graphlib.Graph().setGraph({
    rankdir: 'TB',
    nodesep: 50,
    ranksep: 70,
  });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach(n => g.setNode(n.id, { width: 160, height: 40 }));
  edges.forEach(e => g.setEdge(e.source, e.target));
  dagre.layout(g);

  return nodes.map(n => {
    const { x, y } = g.node(n.id);
    return { ...n, position: { x, y } };
  });
}

/* ──────────── 타입 (백엔드 공통) ─────────── */
interface RawNode { id: string; label: string }
interface RawEdge { id: string; source: string; target: string; type?: string }
interface DiagramJSON { nodes: RawNode[]; edges: RawEdge[] }

/* ──────────── 엔드포인트 한 줄! ──────────── */
/** 👉 여기만 교체하면 됨
 *   '/api/sample_cfg'  →  '/api/generate_control_flow_graph'
 */
const ENDPOINT = '/api/sample_cfg';             // <─ 바꿔야 할 곳

export default function DiagramViewer({ filePath }: { filePath: string }) {
  const [nodes, setNodes]  = useState<Node[]>([]);
  const [edges, setEdges]  = useState<Edge[]>([]);
  const [loading, setLoad] = useState(true);
  const [error, setErr]    = useState<string>();

  useEffect(() => {
    if (!filePath) return;

    (async () => {
      setLoad(true);
      setErr(undefined);

      try {
        /* 쿼리스트링만 붙여서 GET 호출 */
        const url =
          `http://localhost:8000${ENDPOINT}` +
          `?path=${encodeURIComponent(filePath)}` +
          `&file_type=${encodeURIComponent(filePath.split('.').pop() || '')}`;
          

        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

        /* sample_cfg는 바로 JSON, generate_cfg 는 {data:{…}} 형태 */
        const raw: any = await res.json();
        const json: DiagramJSON = raw.data ?? raw;   // 둘 다 대응

        /* React-Flow 형식 변환 */
        const n: Node[] = json.nodes.map(r => ({
          id: r.id,
          data: { label: r.label },
          position: { x: 0, y: 0 },
          style: { padding: 6, borderRadius: 4, border: '1px solid #3b82f6' },
        }));
        const e: Edge[] = json.edges.map(r => ({
          id: r.id,
          source: r.source,
          target: r.target,
          animated: true,
        }));

        setNodes(layout(n, e));
        setEdges(e);
      } catch (e) {
        setErr(String(e));
        setNodes([]);
        setEdges([]);
      } finally {
        setLoad(false);
      }
    })();
  }, [filePath]);

  if (loading) return <div className="p-4 text-sm text-slate-500">diagram loading…</div>;
  if (error)   return <div className="p-4 text-sm text-red-600">{error}</div>;

  return (
    <div className="relative h-full w-full border-l border-slate-300">
      <ReactFlow
        nodes={nodes}
        edges={edges}
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
}
