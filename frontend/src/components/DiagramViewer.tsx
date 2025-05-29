'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  MiniMap,
  Controls,
  MarkerType,
  type Node,
  type Edge,
  type NodeMouseHandler,
  applyNodeChanges,
  NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { nanoid } from 'nanoid';
import { useEditor } from '@/store/editor';
import { useFS, type FileNode } from '@/store/files';

// Global cache for diagram data and snippets
let diagramCache: Record<string, { nodes: RawNode[]; edges: RawEdge[] }> | null = null;
const snippetCache = new Map<string, string>(); // <cleanPath_functionName, preview>

// Dagre layout utility
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

// Common types
interface RawNode {
  id: string;
  label?: string;
  function_name?: string;
  file: string;
}
interface RawEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
}

// API endpoint
const ENDPOINT = '/api/generate_call_graph';
const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';

export default function DiagramViewer() {
  // State
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoad] = useState(true);
  const [error, setErr] = useState<string>();
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [snippet, setSnippet] = useState<string>('');

  // Zustand stores
  const editorState = useEditor.getState();
  const fsState = useFS.getState();

  // Current active file path
  const activePath =
    editorState.tabs.find((t) => t.id === editorState.activeId)?.path ??
    editorState.tabs.at(-1)?.path ??
    '';

  // Utility to extract function snippet from code
  function extractFunctionSnippet(code: string, functionName: string): string | null {
    const lines = code.split('\n');
    let startLine = -1;

    // Find the start of the function definition at indentation level 0
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith(`def ${functionName}(`)) {
        if (line === line.trim()) { // No leading spaces
          startLine = i;
          break;
        }
      }
    }

    if (startLine === -1) {
      return null;
    }

    // Find the end of the function (next line with indentation 0)
    for (let i = startLine + 1; i < lines.length; i++) {
      if (lines[i].trim() === '') {
        continue;
      }
      if (!lines[i].startsWith(' ') && !lines[i].startsWith('\t')) {
        return lines.slice(startLine, i).join('\n');
      }
    }
    return lines.slice(startLine).join('\n');
  }

  // Node click handler: open file in editor and highlight in explorer
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

  // Hover handlers
  const onEnter: NodeMouseHandler = async (_, node) => {
    setHoverId(node.id);

    const raw = (node.data as any)?.file as string | undefined;
    const functionName = (node.data as any)?.label as string | undefined;

    if (!raw || !functionName) {
      setSnippet('');
      return;
    }

    const clean = raw.replace(/^poc[\\/]/, '');
    const cacheKey = `${clean}_${functionName}`;

    if (snippetCache.has(cacheKey)) {
      setSnippet(snippetCache.get(cacheKey)!);
      return;
    }

    try {
      const txt = await fetch(
        `/api/file?path=${encodeURIComponent(clean)}`
      ).then((r) => r.text());

      const snippet = extractFunctionSnippet(txt, functionName);
      if (snippet) {
        const preview = snippet.split('\n').slice(0, 15).join('\n');
        snippetCache.set(cacheKey, preview);
        setSnippet(preview);
      } else {
        setSnippet('(function not found)');
      }
    } catch {
      setSnippet('(preview unavailable)');
    }
  };

  const onLeave: NodeMouseHandler = () => {
    setHoverId(null);
    setSnippet('');
  };

  // Handle node changes (dragging, etc.)
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
    },
    [setNodes]
  );

  // Load diagram data and cache it
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
          body: JSON.stringify({ path: '../../poc', file_type: 'py' }),
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

        const raw = await res.json();
        const json: Record<string, { nodes: RawNode[]; edges: RawEdge[] }> =
          typeof raw?.data === 'string' ? JSON.parse(raw.data) : raw.data;

        diagramCache = json;
        hydrate(json);
      } catch (e: any) {
        setErr(String(e));
        setNodes([]);
        setEdges([]);
      } finally {
        setLoad(false);
      }
    })();
  }, []);

  // Compute node styles
  const finalNodes = nodes.map((n) => {
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

  // Loading and error states
  if (loading)
    return <div className="p-4 text-sm text-slate-500">diagram loading…</div>;
  if (error)
    return (
      <div className="p-4 text-sm text-red-600 whitespace-pre-wrap">{error}</div>
    );

  // Render
  return (
    <div className="relative h-full w-full border-l border-slate-300">
      <ReactFlow
        nodes={finalNodes}
        edges={edges}
        onNodesChange={onNodesChange}
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

      {/* Code snippet panel */}
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

  // Hydrate JSON data into state
  function hydrate(json: Record<string, { nodes: RawNode[]; edges: RawEdge[] }>) {
    let allNodes: Node[] = [];
    let allEdges: Edge[] = [];

    Object.entries(json).forEach(([file, data]) => {
      const { nodes: rawNodes, edges: rawEdges } = data;

      // Filter edges to remove those referencing non-existent nodes
      const nodeIds = new Set(rawNodes.map((n) => n.id));
      const validEdges = rawEdges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

      const fileNodes: Node[] = rawNodes.map((r) => ({
        id: r.id,
        data: { label: r.label || r.function_name || r.id, file: r.file },
        position: { x: 0, y: 0 },
        style: {
          padding: 6,
          borderRadius: 4,
          border: '1px solid #3b82f6',
          background: '#fff',
        },
      }));

      const fileEdges: Edge[] = validEdges.map((r) => ({
        id: r.id,
        source: r.source,
        target: r.target,
        markerEnd: { type: MarkerType.ArrowClosed },
        animated: true,
      }));

      allNodes = allNodes.concat(fileNodes);
      allEdges = allEdges.concat(fileEdges);
    });

    const laidOutNodes = layout(allNodes, allEdges);
    setNodes(laidOutNodes);
    setEdges(allEdges);
  }
}

// Utility to find FileNode by path
function findByPath(nodes: FileNode[] = [], p: string): FileNode | undefined {
  for (const n of nodes) {
    if (n.path?.replace(/^poc[\\/]/, '') === p) return n;
    if (n.children) {
      const r = findByPath(n.children, p);
      if (r) return r;
    }
  }
}