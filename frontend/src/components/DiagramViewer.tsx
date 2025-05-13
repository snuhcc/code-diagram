// src/components/DiagramViewer.tsx
'use client';

import { useMemo } from 'react';
import {
  ReactFlow,          // ⬅️ default → named import
  Background,
  Controls,
  MiniMap,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

/** 간단 예시: 선택된 파일 경로를 루트 노드로 삼아 두 개의 자식으로 연결 */
function makeGraph(filePath: string): { nodes: Node[]; edges: Edge[] } {
  const idRoot = filePath.replace(/[^\w]/g, '_');

  const nodes: Node[] = [
    {
      id: idRoot,
      data: { label: idRoot },
      position: { x: 0, y: 0 },
      style: { padding: 6, borderRadius: 4, border: '1px solid #3b82f6' },
    },
    { id: 'A', data: { label: 'A' }, position: { x: -120, y: 120 } },
    { id: 'B', data: { label: 'B' }, position: { x: 120, y: 120 } },
  ];

  const edges: Edge[] = [
    { id: 'e1', source: idRoot, target: 'A', animated: true },
    { id: 'e2', source: idRoot, target: 'B', animated: true },
  ];

  return { nodes, edges };
}

export default function DiagramViewer({ filePath }: { filePath: string }) {
  const { nodes, edges } = useMemo(() => makeGraph(filePath), [filePath]);

  return (
    <div className="relative h-full w-full border-l border-slate-300">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        className="bg-gray-50"
        minZoom={0.2}
        maxZoom={2}
      >
        <Background variant="dots" gap={16} size={1} />
        <MiniMap pannable zoomable />
        <Controls />
      </ReactFlow>
    </div>
  );
}
