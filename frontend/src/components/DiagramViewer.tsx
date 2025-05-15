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

  useEffect(() => {
    if (!filePath) return; // 파일 선택 전엔 실행 안 함

    (async () => {
      setLoad(true);
      setErr(undefined);

      try {
        /* ① 백엔드 호출 */
        const res = await fetch(`http://localhost:8000${ENDPOINT}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}), // 기본값 사용
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

        /* ② 응답 파싱 (data가 문자열인지 객체인지 모두 처리) */
        const raw: any = await res.json();

        let json: DiagramJSON;
        if (typeof raw === 'string') {
          json = JSON.parse(raw);
        } else if (typeof raw?.data === 'string') {
          json = JSON.parse(raw.data);
        } else if (raw?.data) {
          json = raw.data as DiagramJSON;
        } else {
          json = raw as DiagramJSON;
        }

        /* ③ React-Flow 형식 변환 */
        const n: Node[] = json.nodes.map((r) => ({
          id: r.id,
          data: { label: r.label },
          position: { x: 0, y: 0 }, // dagre에서 재배치
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

  if (loading)
    return (
      <div className="p-4 text-sm text-slate-500">diagram loading…</div>
    );
  if (error)
    return (
      <div className="p-4 text-sm text-red-600 whitespace-pre-wrap">{error}</div>
    );

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
