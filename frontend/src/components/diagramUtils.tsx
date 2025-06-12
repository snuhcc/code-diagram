import { Node, Edge, NodeProps, Handle, Position } from '@xyflow/react';
import dagre from 'dagre';
import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';
import 'highlight.js/styles/atom-one-light.css';

hljs.registerLanguage('python', python);

// Constants
export const ENDPOINTS = {
  CG: '/api/generate_call_graph',
  CFG: '/api/generate_control_flow_graph',
  INLINE_CODE_EXPLANATION: '/api/inline_code_explanation',
} as const;

export const STYLES = {
  NODE: {
    MIN_WIDTH: 60,
    PADDING: 16,
    HEIGHT: { SMALL: 35, DEFAULT: 40 },
    FONT_SIZE: '12px',
    FONT_FAMILY: 'Arial, sans-serif',
  },
  GROUP: {
    PADDING: 20,
    COLLAPSED_WIDTH: 200,
    COLLAPSED_HEIGHT: 50,
  },
  COLORS: {
    NODE: {
      DEFAULT: '#ffffff',
      HOVER: '#fef9c3',
      SELECTED: '#fca5a5',
      ACTIVE: '#dbeafe',
      BORDER: '#4A90E2',
      BORDER_HOVER: '#eab308',
      BORDER_SELECTED: '#b91c1c',
      BORDER_ACTIVE: '#0284c7',
    },
    GROUP: {
      DEFAULT: '#FAFAFA',
      COLLAPSED: '#f3f4f6',
      BORDER: '#b9bfc9',
      BORDER_COLLAPSED: '#6b7280',
      BORDER_ACTIVE: '#fb923c',
    },
    EDGE: {
      DEFAULT: '#34A853',
      HOVER: '#f59e42',
    },
  },
  CFG_PANEL: {
    WIDTH: 800,
    HEIGHT: 600,
  },
} as const;

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
  width?: number;
  height?: number;
  resizing?: boolean;
}

// Cache
export const snippetCache = new Map<string, string>();

// Helper Functions
export function getTextWidth(text: string, font: string = `${STYLES.NODE.FONT_SIZE} ${STYLES.NODE.FONT_FAMILY}`): number {
  if (typeof document === 'undefined') return text.length * 7;
  const canvas = (getTextWidth as any).canvas || ((getTextWidth as any).canvas = document.createElement("canvas"));
  const context = canvas.getContext("2d");
  if (!context) return text.length * 7;
  context.font = font;
  return context.measureText(text).width;
}

export function extractFunctionSnippet(code: string, functionName: string): { snippet: string, startLine: number } | null {
  const lines = code.split('\n');
  const startIndex = lines.findIndex(line => line.trim().startsWith(`def ${functionName}(`));
  if (startIndex === -1) return null;
  
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    if (!lines[i].startsWith(' ') && !lines[i].startsWith('\t')) {
      return { snippet: lines.slice(startIndex, i).join('\n'), startLine: startIndex + 1 };
    }
  }
  return { snippet: lines.slice(startIndex).join('\n'), startLine: startIndex + 1 };
}

export function highlightWithLineNumbers(snippet: string, startLine: number = 1): string {
  const highlighted = hljs.highlight(snippet, { language: 'python' }).value;
  const lines = highlighted.split('\n');
  const padding = String(startLine + lines.length - 1).length;
  return lines
    .map((line, idx) => `<span style="color:#64748b">${String(startLine + idx).padStart(padding, ' ')}</span>  ${line}`)
    .join('\n');
}

export function isNodeHidden(nodeId: string, collapsedGroups: Set<string>, nodes: Node[]): boolean {
  const node = nodes.find(n => n.id === nodeId);
  if (!node?.parentId) return false;
  return collapsedGroups.has(node.parentId) || isNodeHidden(node.parentId, collapsedGroups, nodes);
}

export function findRepresentativeNode(nodeId: string, collapsedGroups: Set<string>, nodes: Node[]): string {
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return nodeId;
  if (node.type === 'group' || !node.parentId) return nodeId;
  if (collapsedGroups.has(node.parentId)) return node.parentId;
  
  let current = node;
  while (current.parentId) {
    const parent = nodes.find(n => n.id === current.parentId);
    if (!parent) break;
    if (parent.type === 'group' && collapsedGroups.has(parent.id)) return parent.id;
    current = parent;
  }
  return nodeId;
}

export function calculateLayout(
  files: Record<string, { nodes: RawNode[]; edges: RawEdge[] }>,
  nodeWidths: Record<string, number>
): Record<string, { x: number; y: number }> {
  const totalNodes = Object.values(files).reduce((sum, f) => sum + f.nodes.length, 0);
  const nodesep = totalNodes > 50 ? 15 : totalNodes > 30 ? 20 : 25;
  const ranksep = totalNodes > 50 ? 40 : totalNodes > 30 ? 50 : 60;
  
  const g = new dagre.graphlib.Graph({ compound: true, multigraph: true })
    .setGraph({
      rankdir: 'TB',
      nodesep,
      ranksep,
      ranker: 'tight-tree',
      align: 'DL',
      marginx: 10,
      marginy: 10,
    })
    .setDefaultEdgeLabel(() => ({}));
    
  Object.keys(files).forEach(file => g.setNode(`cluster_${file}`, { marginx: 10, marginy: 10 }));
  
  Object.entries(files).forEach(([file, { nodes, edges }]) => {
    nodes.forEach(n => {
      const width = nodeWidths[n.id] || STYLES.NODE.MIN_WIDTH;
      const height = totalNodes > 50 ? STYLES.NODE.HEIGHT.SMALL : STYLES.NODE.HEIGHT.DEFAULT;
      g.setNode(n.id, { width, height });
      g.setParent(n.id, `cluster_${file}`);
    });
  });
  
  Object.values(files).forEach(({ edges }) => {
    edges.forEach(({ source, target }) => {
      if (!g.hasEdge(source, target)) g.setEdge(source, target, { weight: 1 });
    });
  });
  
  dagre.layout(g);
  
  const positions: Record<string, { x: number; y: number }> = {};
  g.nodes().forEach(id => {
    const node = g.node(id);
    if (node && !id.startsWith('cluster_') && node.x != null && node.y != null) {
      positions[id] = { x: node.x, y: node.y };
    }
  });
  
  return positions;
}

// Custom Group Node Component
export function CustomGroupNode({ data }: NodeProps) {
  const { label, isCollapsed, onToggleCollapse } = data;

  const ChevronIcon = ({ direction = 'down' }: { direction: 'down' | 'right' }) => (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      style={{
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
          <span>{label}</span>
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
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          height: 32,
        }}
      >
        <span
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse();
          }}
          style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
        >
          <ChevronIcon direction="down" />
        </span>
        <span>{label}</span>
      </div>
    </>
  );
}

// Utility functions
export function parseApiResponse(response: any): any {
  return typeof response?.data === 'string' ? JSON.parse(response.data) : response.data;
}

export function cleanFilePath(path: string, targetFolder?: string): string {
  if (!targetFolder) return path;
  const regex = new RegExp(`^${targetFolder}[\\\\/]`);
  return path.replace(regex, '');
}

export function calculateNodeWidth(label: string): number {
  const textWidth = getTextWidth(label);
  return Math.max(STYLES.NODE.MIN_WIDTH, textWidth + STYLES.NODE.PADDING);
}