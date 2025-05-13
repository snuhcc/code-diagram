'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';                       // ➊ 자동 레이아웃용

/* ─── dagre 레이아웃 헬퍼 ─────────────────────────────── */
const layout = (nodes: Node[], edges: Edge[]) => {
  const g = new dagre.graphlib.Graph().setGraph({ rankdir: 'TB', nodesep: 50, ranksep: 70 });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach(n => g.setNode(n.id, { width: 160, height: 40 }));
  edges.forEach(e => g.setEdge(e.source, e.target));

  dagre.layout(g);

  return {
    nodes: nodes.map(n => {
      const { x, y } = g.node(n.id);
      return { ...n, position: { x, y } };
    }),
    edges,
  };
};

/* ─── API 호출 타입 ────────────────────────────────────── */
interface DiagramReq  { path: string; file_type: string }
interface DiagramResp {
  data: { nodes: Node[]; edges: Edge[] }
}

export default function DiagramViewer({ filePath }: { filePath: string }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>();

  /* ➋ 파일이 바뀔 때마다 백엔드 호출 */
  const fetchDiagram = useCallback(async () => {
    if (!filePath) return;
    setLoading(true);
    setErr(undefined);

    const body: DiagramReq = {
      path: filePath,
      file_type: filePath.split('.').pop() || 'python',  // 확장자로 추정
    };

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE}/api/generate_control_flow_graph`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const json: DiagramResp = await res.json();

      /* ➌ dagre로 좌표 계산 후 state 업데이트 */
      const { nodes: laid, edges: laidE } = layout(json.data.nodes, json.data.edges);
      setNodes(laid);
      setEdges(laidE);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, [filePath]);

  useEffect(() => { fetchDiagram(); }, [fetchDiagram]);

  if (err) {
    return <div className="p-4 text-sm text-red-600">{err}</div>;
  }

  if (loading) {
    return <div className="p-4 text-sm text-slate-500">diagram loading…</div>;
  }

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
