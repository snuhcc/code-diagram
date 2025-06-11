import { Node, Edge, NodeProps, Handle, Position } from '@xyflow/react';
import dagre from 'dagre';
import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';
import 'highlight.js/styles/atom-one-light.css';

hljs.registerLanguage('python', python);

// Types
export interface RawNode {
  id: string;
  label?: string;
  function_name?: string;
  file: string;
}

export interface RawEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
}

export interface CFGPanel {
  id: string;
  functionName: string;
  file: string;
  result: any;
  expanded: boolean;
  pos: { x: number; y: number };
  dragging: boolean;
  dragOffset: { x: number; y: number };
}

// Cache
export const snippetCache = new Map<string, string>();

// Helper Functions
export function getTextWidth(text: string, font: string = '12px Arial'): number {
  if (typeof document === 'undefined') return text.length * 7;
  const canvas = (getTextWidth as any).canvas || ((getTextWidth as any).canvas = document.createElement("canvas"));
  const context = canvas.getContext("2d");
  if (!context) {
    return text.length * 7;
  }
  context.font = font;
  const metrics = context.measureText(text);
  return metrics.width;
}
(getTextWidth as any).canvas = null;

export function extractFunctionSnippetWithLine(code: string, functionName: string): { snippet: string, startLine: number } | null {
  const lines = code.split('\n');
  let startLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith(`def ${functionName}(`) && line === line.trim()) {
      startLine = i;
      break;
    }
  }
  if (startLine === -1) return null;
  for (let i = startLine + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    if (!lines[i].startsWith(' ') && !lines[i].startsWith('\t')) {
      return { snippet: lines.slice(startLine, i).join('\n'), startLine: startLine + 1 };
    }
  }
  return { snippet: lines.slice(startLine).join('\n'), startLine: startLine + 1 };
}

export function addLineNumbersAndHighlight(snippet: string, start: number = 1): string {
  const highlighted = hljs.highlight(snippet, { language: 'python' }).value;
  const lines = highlighted.split('\n');
  const pad = String(start + lines.length - 1).length;
  return lines
    .map((line, idx) => {
      const num = String(start + idx).padStart(pad, ' ');
      return `<span style="color:#64748b">${num}</span>  ${line}`;
    })
    .join('\n');
}

export function isNodeHidden(nodeId: string, collapsedGroups: Set<string>, nodes: Node[]): boolean {
  const node = nodes.find(n => n.id === nodeId);
  if (!node || !node.parentId) return false;
  
  if (collapsedGroups.has(node.parentId)) {
    return true;
  }
  
  return isNodeHidden(node.parentId, collapsedGroups, nodes);
}

export function findRepresentativeGroup(nodeId: string, collapsedGroups: Set<string>, nodes: Node[]): string {
  const node = nodes.find(n => n.id === nodeId);
  if (!node) {
    return nodeId;
  }
  
  if (node.type === 'group') {
    return nodeId;
  }
  
  if (node.parentId && collapsedGroups.has(node.parentId)) {
    return node.parentId;
  }
  
  let currentNode = node;
  while (currentNode.parentId) {
    const parentNode = nodes.find(n => n.id === currentNode.parentId);
    if (!parentNode) break;
    
    if (parentNode.type === 'group' && collapsedGroups.has(parentNode.id)) {
      return parentNode.id;
    }
    currentNode = parentNode;
  }
  
  return nodeId;
}

export function getRedirectedEdge(edge: Edge, collapsedGroups: Set<string>, nodes: Node[]): Edge | null {
  const sourceNode = nodes.find(n => n.id === edge.source);
  const targetNode = nodes.find(n => n.id === edge.target);
  
  if (!sourceNode || !targetNode) {
    return edge;
  }
  
  const newSource = findRepresentativeGroup(edge.source, collapsedGroups, nodes);
  const newTarget = findRepresentativeGroup(edge.target, collapsedGroups, nodes);
  
  if (newSource === newTarget) {
    return null;
  }
  
  if (newSource === edge.source && newTarget === edge.target) {
    return edge;
  }
  
  return {
    ...edge,
    id: `${edge.id}_redirected_${newSource}_${newTarget}`,
    source: newSource,
    target: newTarget,
    data: {
      ...edge.data,
      originalSource: edge.source,
      originalTarget: edge.target,
      isRedirected: true,
    },
  };
}

// Layout Function
export function layoutWithCluster(
  files: Record<string, { nodes: RawNode[]; edges: RawEdge[] }>,
  nodeWidths: Record<string, number>
): Record<string, { x: number; y: number }> {
  const totalFiles = Object.keys(files).length;
  const totalNodes = Object.values(files).reduce((sum, f) => sum + f.nodes.length, 0);
  
  const maxWidth = window.innerWidth * 0.5;
  
  const averageNodeWidth = Object.values(nodeWidths).length > 0 
    ? Object.values(nodeWidths).reduce((sum, w) => sum + w, 0) / Object.values(nodeWidths).length
    : (totalNodes > 50 ? 100 : 120);

  const maxNodesPerRank = Math.floor(maxWidth / (averageNodeWidth + 30));
  
  const nodesep = totalNodes > 50 ? 15 : totalNodes > 30 ? 20 : 25;
  const ranksep = totalNodes > 50 ? 40 : totalNodes > 30 ? 50 : 60;
  
  const g = new dagre.graphlib.Graph({ compound: true, multigraph: true })
    .setGraph({
      rankdir: 'TB',
      nodesep: nodesep,
      ranksep: ranksep,
      ranker: 'tight-tree',
      align: 'DL',
      marginx: 10,
      marginy: 10,
    })
    .setDefaultEdgeLabel(() => ({}));
    
  Object.keys(files).forEach((file) => {
    g.setNode(`cluster_${file}`, {
      marginx: 10,
      marginy: 10,
    });
  });
  
  Object.entries(files).forEach(([file, { nodes, edges }]) => {
    const nodeDepths = new Map<string, number>();
    const nodeChildren = new Map<string, string[]>();
    
    edges.forEach(({ source, target }) => {
      if (!nodeChildren.has(source)) {
        nodeChildren.set(source, []);
      }
      nodeChildren.get(source)!.push(target);
    });
    
    const visited = new Set<string>();
    const queue: { node: string; depth: number }[] = [];
    const incomingEdges = new Set(edges.map(e => e.target));
    const rootNodes = nodes.filter(n => !incomingEdges.has(n.id));
    
    rootNodes.forEach(root => {
      queue.push({ node: root.id, depth: 0 });
    });
    
    while (queue.length > 0) {
      const { node, depth } = queue.shift()!;
      if (visited.has(node)) continue;
      
      visited.add(node);
      nodeDepths.set(node, depth);
      
      const children = nodeChildren.get(node) || [];
      children.forEach(child => {
        queue.push({ node: child, depth: depth + 1 });
      });
    }
    
    const depthGroups = new Map<number, string[]>();
    nodeDepths.forEach((depth, nodeId) => {
      if (!depthGroups.has(depth)) {
        depthGroups.set(depth, []);
      }
      depthGroups.get(depth)!.push(nodeId);
    });
    
    let virtualNodeCount = 0;
    depthGroups.forEach((nodesAtDepth, depth) => {
      if (nodesAtDepth.length > maxNodesPerRank && depth > 0) {
        const chunks = [];
        for (let i = 0; i < nodesAtDepth.length; i += maxNodesPerRank) {
          chunks.push(nodesAtDepth.slice(i, i + maxNodesPerRank));
        }
        
        if (chunks.length > 1) {
          chunks.forEach((chunk, chunkIndex) => {
            const virtualNodeId = `virtual_${file}_${depth}_${virtualNodeCount++}`;
            g.setNode(virtualNodeId, {
              width: 1,
              height: 1,
              dummy: true,
            });
            g.setParent(virtualNodeId, `cluster_${file}`);
            
            const parents = new Set<string>();
            chunk.forEach(nodeId => {
              edges.forEach(edge => {
                if (edge.target === nodeId) {
                  parents.add(edge.source);
                }
              });
            });
            
            parents.forEach(parent => {
              g.setEdge(parent, virtualNodeId, {
                weight: 0.1,
              });
            });
            
            chunk.forEach(nodeId => {
              g.setEdge(virtualNodeId, nodeId, {
                weight: 10,
              });
            });
          });
        }
      }
    });
    
    nodes.forEach((n) => {
      const width = nodeWidths[n.id] || (totalNodes > 50 ? 100 : 120);
      const height = totalNodes > 50 ? 35 : 40;
      
      g.setNode(n.id, { 
        width: width,
        height: height,
      });
      g.setParent(n.id, `cluster_${file}`);
    });
  });
  
  Object.values(files).forEach(({ edges }) => {
    edges.forEach(({ source, target }) => {
      if (!g.hasEdge(source, target)) {
        g.setEdge(source, target, {
          weight: 1,
        });
      }
    });
  });
  
  dagre.layout(g);
  
  const pos: Record<string, { x: number; y: number }> = {};
  g.nodes().forEach((id: string) => {
    const n = g.node(id);
    if (n && !n.dummy && n.x != null && n.y != null) {
      pos[id] = { x: n.x, y: n.y };
    }
  });
  
  return pos;
}

// Custom Group Node Component
export function CustomGroupNode({ data, id }: NodeProps) {
  const { label, isCollapsed, onToggleCollapse } = data;

  const ChevronIcon = ({ direction = 'down' }: { direction: 'down' | 'right' }) => (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#6366f1',
        transition: 'transform 0.15s',
        transform: direction === 'right' ? 'rotate(-90deg)' : 'none',
      }}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );

  if (isCollapsed) {
    return (
      <>
        <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
        <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 600,
            fontSize: 13,
            color: '#444',
            cursor: 'pointer',
            gap: 8,
          }}
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse();
          }}
        >
          <ChevronIcon direction="right" />
          <span style={{ display: 'flex', alignItems: 'center' }}>{label}</span>
        </div>
      </>
    );
  }

  return (
    <>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <div
        style={{
          position: 'absolute',
          top: -32,
          left: 0,
          width: '100%',
          fontWeight: 600,
          fontSize: 13,
          color: '#444',
          pointerEvents: 'none',
          userSelect: 'none',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          height: 32,
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            pointerEvents: 'auto',
            height: '100%',
          }}
        >
          <span
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse();
            }}
            style={{
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              lineHeight: 1,
              height: '1em',
            }}
          >
            <ChevronIcon direction="down" />
          </span>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              lineHeight: 1,
              height: '1em',
            }}
          >
            {label}
          </span>
        </div>
      </div>
    </>
  );
}