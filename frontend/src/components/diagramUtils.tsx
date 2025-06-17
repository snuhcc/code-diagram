import { Node, Edge, NodeProps, Handle, Position } from '@xyflow/react';
import dagre from 'dagre';
import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';
import 'highlight.js/styles/atom-one-light.css';

hljs.registerLanguage('python', python);

// Constants
export const ENDPOINTS = {
  CG: '/api/generate_call_graph_ast', // AST 기반 호출 그래프 생성
  CFG: '/api/generate_control_flow_graph',
  INLINE_CODE_EXPLANATION: '/api/inline_code_explanation',
} as const;

export const STYLES = {
  NODE: {
    MIN_WIDTH: 120,
    PADDING: 20,
    HEIGHT: {
      DEFAULT: 28,
      CLASS: 35,  // 클래스 노드는 더 큰 높이
      METHOD: 26, // 메소드 노드는 조금 작은 높이
    },
    FONT_SIZE: '12px',
    FONT_FAMILY: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  GROUP: {
    PADDING: 20, // Reduced from 40 to 20
    COLLAPSED_WIDTH: 200,
    COLLAPSED_HEIGHT: 50,
  },    COLORS: {
    NODE: {
      DEFAULT: '#ffffff',
      HOVER: '#fef3c7',
      ACTIVE: '#dbeafe',
      SELECTED: '#fbbf24',
      HIGHLIGHTED: '#f3e8ff',
      BORDER: '#e5e7eb',
      BORDER_HOVER: '#f59e0b',
      BORDER_ACTIVE: '#3b82f6',
      BORDER_SELECTED: '#d97706',
      BORDER_HIGHLIGHTED: '#8b5cf6',
      // 클래스 전용 색상
      CLASS: {
        DEFAULT: '#f0f9ff',
        BORDER: '#0ea5e9',
        HOVER: '#e0f2fe',
        SELECTED: '#0284c7',
      },
      // 메소드 전용 색상  
      METHOD: {
        DEFAULT: '#f7fee7',
        BORDER: '#65a30d',
        HOVER: '#ecfccb',
        SELECTED: '#84cc16',
      },
    },
    GROUP: {
      DEFAULT: '#FAFAFA',
      COLLAPSED: '#f3f4f6',
      BORDER: '#b9bfc9',
      BORDER_COLLAPSED: '#6b7280',
      BORDER_ACTIVE: '#fb923c',
    },
    EDGE: {
      DEFAULT: '#64748b',
      HOVER: '#f59e0b',
      HIGHLIGHTED: '#8b5cf6',
      // 엣지 타입별 색상
      FUNCTION_CALL: '#64748b',
      INSTANTIATION: '#dc2626', // 클래스 인스턴스화는 빨간색
      METHOD_CALL: '#16a34a',   // 메소드 호출은 초록색
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
  node_type?: string;
  line_start?: number;
  line_end?: number;
}

export interface RawEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  edge_type?: string;
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
  explanationLevel?: number; // 1-10 scale for explanation detail level
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

export function extractCodeSnippet(code: string, identifierName: string): { snippet: string, startLine: number } | null {
  const lines = code.split('\n');
  
  // Try to find function definition first
  let startIndex = lines.findIndex(line => line.trim().startsWith(`def ${identifierName}(`));
  
  // If not found, try to find class definition
  if (startIndex === -1) {
    startIndex = lines.findIndex(line => line.trim().startsWith(`class ${identifierName}(`));
  }
  
  // Also try without parentheses for classes that don't inherit
  if (startIndex === -1) {
    startIndex = lines.findIndex(line => line.trim() === `class ${identifierName}:` || line.trim().startsWith(`class ${identifierName}:`));
  }
  
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

// 클래스와 메소드를 고려한 하이브리드 레이아웃 함수 (파일은 마인드맵, 클래스/메소드는 그리드)
export function calculateLayoutWithClasses(
  files: Record<string, { nodes: RawNode[]; edges: RawEdge[] }>,
  nodeWidths: Record<string, number>
): Record<string, { x: number; y: number; width?: number; height?: number }> {
  const positions: Record<string, { x: number; y: number; width?: number; height?: number }> = {};
  
  const LAYOUT_CONFIG = {
    CENTER_X: 400,          // 중심점 X 좌표
    CENTER_Y: 400,          // 중심점 Y 좌표
    FILE_RADIUS: 350,       // 파일들이 중심에서 떨어진 거리
    FILE_AREA_WIDTH: 600,   // 각 파일 영역의 너비
    FILE_AREA_HEIGHT: 500,  // 각 파일 영역의 높이
    CLASS_SPACING: 80,      // 클래스 간격
    METHOD_SPACING_X: 20,   // 메소드 좌우 간격
    METHOD_SPACING_Y: 35,   // 메소드 상하 간격
    FUNCTION_SPACING: 70,   // 일반 함수 간격
    CLASS_PADDING: {        // 클래스 내부 패딩
      TOP: 50,    
      BOTTOM: 25, 
      LEFT: 25,   
      RIGHT: 25,  
    },
    METHOD_WIDTH: 140,      // 메소드 노드 너비
    METHOD_HEIGHT: 30,      // 메소드 노드 높이
    CLASS_MIN_WIDTH: 200,   // 클래스 최소 너비
    CLASS_MIN_HEIGHT: 100,  // 클래스 최소 높이
  };

  const fileEntries = Object.entries(files);
  const fileCount = fileEntries.length;

  // 파일별로 중심에서 방사형으로 배치
  fileEntries.forEach(([file, data], fileIndex) => {
    // 파일들을 중심점 주위에 원형으로 배치 (마인드맵 스타일)
    const fileAngle = fileCount > 1 ? (2 * Math.PI * fileIndex) / fileCount : 0;
    const fileX = LAYOUT_CONFIG.CENTER_X + Math.cos(fileAngle) * LAYOUT_CONFIG.FILE_RADIUS;
    const fileY = LAYOUT_CONFIG.CENTER_Y + Math.sin(fileAngle) * LAYOUT_CONFIG.FILE_RADIUS;
    
    // 파일 영역의 시작점 (왼쪽 위 모서리)
    const fileAreaStartX = fileX - LAYOUT_CONFIG.FILE_AREA_WIDTH / 2;
    const fileAreaStartY = fileY - LAYOUT_CONFIG.FILE_AREA_HEIGHT / 2;
    
    // 파일 내 노드들을 클래스, 메소드, 일반 함수로 분류
    const classNodes: any[] = [];
    const methodNodes: any[] = [];
    const functionNodes: any[] = [];
    
    data.nodes.forEach(n => {
      const nodeType = n.node_type || 'function';
      if (nodeType === 'class') {
        classNodes.push(n);
      } else if (nodeType === 'method') {
        methodNodes.push(n);
      } else {
        functionNodes.push(n);
      }
    });

    // 클래스별로 메소드 그룹핑
    const classMethods: Record<string, any[]> = {};
    methodNodes.forEach(method => {
      const parts = method.id.split('.');
      if (parts.length >= 3) {
        const classNodeId = `${parts[0]}.${parts[1]}`;
        if (!classMethods[classNodeId]) {
          classMethods[classNodeId] = [];
        }
        classMethods[classNodeId].push(method);
      }
    });

    let currentY = fileAreaStartY + 50; // 파일 헤더를 위한 공간
    
    // 클래스들을 그리드 방식으로 배치 (이전 방식)
    classNodes.forEach((classNode, classIndex) => {
      const methods = classMethods[classNode.id] || [];
      const methodCount = methods.length;
      
      // 메소드 배치를 위한 그리드 계산
      const methodsPerRow = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(methodCount))));
      const methodRows = Math.ceil(methodCount / methodsPerRow);
      
      // 클래스 크기 계산
      const classWidth = Math.max(
        LAYOUT_CONFIG.CLASS_MIN_WIDTH,
        methodsPerRow * LAYOUT_CONFIG.METHOD_WIDTH + 
        (methodsPerRow - 1) * LAYOUT_CONFIG.METHOD_SPACING_X + 
        LAYOUT_CONFIG.CLASS_PADDING.LEFT + LAYOUT_CONFIG.CLASS_PADDING.RIGHT + 40
      );
      
      const classHeight = Math.max(
        LAYOUT_CONFIG.CLASS_MIN_HEIGHT,
        LAYOUT_CONFIG.CLASS_PADDING.TOP + 
        methodRows * LAYOUT_CONFIG.METHOD_HEIGHT + 
        (methodRows - 1) * LAYOUT_CONFIG.METHOD_SPACING_Y + 
        LAYOUT_CONFIG.CLASS_PADDING.BOTTOM + 30
      );
      
      // 클래스 위치 계산 (수평으로 배치, 필요시 다음 줄로)
      const classesPerRow = Math.floor((LAYOUT_CONFIG.FILE_AREA_WIDTH - 100) / (classWidth + 50));
      const classCol = classIndex % Math.max(1, classesPerRow);
      const classRow = Math.floor(classIndex / Math.max(1, classesPerRow));
      
      const classX = fileAreaStartX + classCol * (classWidth + 50);
      const classY = currentY + classRow * (classHeight + LAYOUT_CONFIG.CLASS_SPACING);
      
      // 클래스 노드 위치와 크기 설정
      positions[classNode.id] = { 
        x: classX, 
        y: classY,
        width: classWidth,
        height: classHeight
      };
      
      // 해당 클래스의 메소드들을 클래스 내부에 그리드로 배치 (이전 방식)
      methods.forEach((method, methodIndex) => {
        const row = Math.floor(methodIndex / methodsPerRow);
        const col = methodIndex % methodsPerRow;
        
        const methodX = classX + LAYOUT_CONFIG.CLASS_PADDING.LEFT + 10 + 
                       col * (LAYOUT_CONFIG.METHOD_WIDTH + LAYOUT_CONFIG.METHOD_SPACING_X);
        const methodY = classY + LAYOUT_CONFIG.CLASS_PADDING.TOP + 10 + 
                       row * (LAYOUT_CONFIG.METHOD_HEIGHT + LAYOUT_CONFIG.METHOD_SPACING_Y);
        
        positions[method.id] = { 
          x: methodX, 
          y: methodY,
          width: LAYOUT_CONFIG.METHOD_WIDTH,
          height: LAYOUT_CONFIG.METHOD_HEIGHT
        };
      });
      
      // 다음 클래스들을 위한 currentY 업데이트
      if (classCol === Math.max(1, classesPerRow) - 1 || classIndex === classNodes.length - 1) {
        currentY = classY + classHeight + LAYOUT_CONFIG.CLASS_SPACING;
      }
    });
    
    // 일반 함수들을 그리드 방식으로 배치 (클래스들 아래에)
    if (functionNodes.length > 0) {
      currentY += 30; // 클래스와 함수 사이 추가 간격
      
      functionNodes.forEach((funcNode, funcIndex) => {
        const functionsPerRow = 4;
        const funcCol = funcIndex % functionsPerRow;
        const funcRow = Math.floor(funcIndex / functionsPerRow);
        
        const funcWidth = nodeWidths[funcNode.id] || 150;
        const funcX = fileAreaStartX + funcCol * (funcWidth + 30);
        const funcY = currentY + funcRow * LAYOUT_CONFIG.FUNCTION_SPACING;
        
        positions[funcNode.id] = { 
          x: funcX, 
          y: funcY,
          width: funcWidth,
          height: 35
        };
      });
    }
  });

  // 전체 다이어그램을 중앙 정렬
  const allPositions = Object.values(positions);
  if (allPositions.length > 0) {
    const minX = Math.min(...allPositions.map(p => p.x));
    const maxX = Math.max(...allPositions.map(p => p.x + (p.width || 0)));
    const minY = Math.min(...allPositions.map(p => p.y));
    const maxY = Math.max(...allPositions.map(p => p.y + (p.height || 0)));
    
    const centerOffsetX = (minX + maxX) / 2 - LAYOUT_CONFIG.CENTER_X;
    const centerOffsetY = (minY + maxY) / 2 - LAYOUT_CONFIG.CENTER_Y;
    
    // 모든 위치를 중앙으로 이동
    Object.keys(positions).forEach(id => {
      positions[id].x -= centerOffsetX;
      positions[id].y -= centerOffsetY;
    });
  }

  return positions;
}

// Mindmap-style layout function with adjusted spacing
export function calculateLayout(
  files: Record<string, { nodes: RawNode[]; edges: RawEdge[] }>,
  nodeWidths: Record<string, number>
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  const groupNodes = new Set<string>(); // 그룹 노드 추적
  
  // 더 컴팩트한 레이아웃 설정
  const LAYOUT_CONFIG = {
    HORIZONTAL_SPACING: 150,     
    VERTICAL_SPACING: 60,        
    LEVEL_RADIUS_INCREMENT: 40,  
    INITIAL_RADIUS: 50,          
    SIBLING_ANGLE_SPREAD: Math.PI * 0.15, 
    FILE_SPACING_X: 450,         // 350에서 450으로 더 증가
    FILE_SPACING_Y: 400,         // 300에서 400으로 더 증가
    GROUP_MIN_DISTANCE: 300,     // 200에서 300으로 증가
  };
  
  // 그룹 노드 충돌 감지 함수 (더 큰 여백 포함)
  function isGroupColliding(pos1: { x: number; y: number }, pos2: { x: number; y: number }): boolean {
    const distance = Math.sqrt(Math.pow(pos1.x - pos2.x, 2) + Math.pow(pos1.y - pos2.y, 2));
    return distance < LAYOUT_CONFIG.GROUP_MIN_DISTANCE;
  }
  
  // 그룹 위치 조정 함수 (더 강력한 분리 로직)
  function adjustGroupPositions() {
    const maxIterations = 50; // 최대 반복 횟수
    let iteration = 0;
    
    while (iteration < maxIterations) {
      const groupPositions = Object.entries(positions)
        .filter(([id]) => groupNodes.has(id))
        .map(([id, pos]) => ({ id, pos }));
      
      let hasCollision = false;
      
      for (let i = 0; i < groupPositions.length; i++) {
        for (let j = i + 1; j < groupPositions.length; j++) {
          const group1 = groupPositions[i];
          const group2 = groupPositions[j];
          
          if (isGroupColliding(group1.pos, group2.pos)) {
            hasCollision = true;
            
            const dx = group2.pos.x - group1.pos.x;
            const dy = group2.pos.y - group1.pos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance === 0) {
              // 완전히 같은 위치인 경우 각도 기반으로 분산
              const angle = (j * 2 * Math.PI) / groupPositions.length;
              group2.pos.x = group1.pos.x + Math.cos(angle) * LAYOUT_CONFIG.GROUP_MIN_DISTANCE;
              group2.pos.y = group1.pos.y + Math.sin(angle) * LAYOUT_CONFIG.GROUP_MIN_DISTANCE;
            } else {
              // 충돌 방향으로 밀어내기 (더 강한 힘으로)
              const pushDistance = LAYOUT_CONFIG.GROUP_MIN_DISTANCE - distance + 50; // 추가 여백
              const pushX = (dx / distance) * pushDistance;
              const pushY = (dy / distance) * pushDistance;
              
              // 양쪽 그룹을 모두 이동 (더 안정적인 분리)
              const moveDistance = pushDistance / 2;
              group1.pos.x -= (dx / distance) * moveDistance * 0.3;
              group1.pos.y -= (dy / distance) * moveDistance * 0.3;
              group2.pos.x += (dx / distance) * moveDistance * 0.7;
              group2.pos.y += (dy / distance) * moveDistance * 0.7;
            }
            
            // 업데이트된 위치를 positions에 반영
            positions[group1.id] = { ...group1.pos };
            positions[group2.id] = { ...group2.pos };
          }
        }
      }
      
      if (!hasCollision) break;
      iteration++;
    }
  }
  
  // 먼저 그룹 노드들의 기본 위치를 설정
  const fileEntries = Object.entries(files);
  const filesPerRow = Math.max(2, Math.ceil(Math.sqrt(fileEntries.length)));
  
  fileEntries.forEach(([file], fileIndex) => {
    groupNodes.add(file);
    
    const fileRow = Math.floor(fileIndex / filesPerRow);
    const fileCol = fileIndex % filesPerRow;
    
    const fileOffsetX = fileCol * LAYOUT_CONFIG.FILE_SPACING_X;
    const fileOffsetY = fileRow * LAYOUT_CONFIG.FILE_SPACING_Y;
    
    // 그룹 노드 위치 먼저 설정
    positions[file] = {
      x: 200 + fileOffsetX,
      y: 200 + fileOffsetY
    };
  });
  
  // 그룹 노드 충돌 해결
  adjustGroupPositions();
  
  let globalOffsetX = 0;
  let globalOffsetY = 0;
  
  Object.entries(files).forEach(([file, { nodes, edges }], fileIndex) => {
    const children: Record<string, string[]> = {};
    const parents: Record<string, string[]> = {};
    
    edges.forEach(edge => {
      if (!children[edge.source]) children[edge.source] = [];
      if (!parents[edge.target]) parents[edge.target] = [];
      children[edge.source].push(edge.target);
      parents[edge.target].push(edge.source);
    });
    
    const roots = nodes.filter(node => !parents[node.id] || parents[node.id].length === 0);
    const rootNodes = roots.length > 0 ? roots : 
      nodes.sort((a, b) => (children[b.id]?.length || 0) - (children[a.id]?.length || 0)).slice(0, 1);
    
    // 그룹의 중심점을 기준으로 내부 노드들 배치
    const groupCenter = positions[file];
    
    rootNodes.forEach((root, rootIndex) => {
      const rootOffsetX = rootIndex * LAYOUT_CONFIG.FILE_SPACING_X * 0.2;
      
      const visited = new Set<string>();
      const queue: { 
        id: string; 
        level: number; 
        angle: number; 
        parentPos?: { x: number; y: number };
        sectorStart?: number;
        sectorEnd?: number;
      }[] = [];
      
      const rootX = groupCenter.x + rootOffsetX;
      const rootY = groupCenter.y;
      positions[root.id] = { x: rootX, y: rootY };
      visited.add(root.id);
      
      const rootChildren = children[root.id] || [];
      const childCount = rootChildren.length;
      
      if (childCount > 0) {
        const angleStep = (2 * Math.PI) / childCount;
        const startAngle = -Math.PI / 2;
        
        rootChildren.forEach((childId, index) => {
          const angle = startAngle + index * angleStep;
          queue.push({ 
            id: childId, 
            level: 1, 
            angle,
            parentPos: positions[root.id],
            sectorStart: angle - angleStep / 2,
            sectorEnd: angle + angleStep / 2
          });
        });
      }
      
      while (queue.length > 0) {
        const { id, level, angle, parentPos, sectorStart = 0, sectorEnd = 2 * Math.PI } = queue.shift()!;
        
        if (visited.has(id)) continue;
        visited.add(id);
        
        const radius = LAYOUT_CONFIG.INITIAL_RADIUS + (level - 1) * LAYOUT_CONFIG.LEVEL_RADIUS_INCREMENT;
        const x = parentPos!.x + Math.cos(angle) * radius;
        const y = parentPos!.y + Math.sin(angle) * radius;
        
        positions[id] = { x, y };
        
        const nodeChildren = children[id] || [];
        const unvisitedChildren = nodeChildren.filter(c => !visited.has(c));
        const childChildCount = unvisitedChildren.length;
        
        if (childChildCount > 0) {
          const sectorSize = Math.min(sectorEnd - sectorStart, LAYOUT_CONFIG.SIBLING_ANGLE_SPREAD);
          const childSectorStart = angle - sectorSize / 2;
          const childSectorEnd = angle + sectorSize / 2;
          const childAngleStep = sectorSize / (childChildCount + 1);
          
          unvisitedChildren.forEach((childId, index) => {
            const childAngle = childSectorStart + (index + 1) * childAngleStep;
            const childSectorSize = sectorSize / childChildCount;
            
            queue.push({ 
              id: childId, 
              level: level + 1, 
              angle: childAngle,
              parentPos: positions[id],
              sectorStart: childAngle - childSectorSize / 2,
              sectorEnd: childAngle + childSectorSize / 2
            });
          });
        }
      }
      
      // 연결되지 않은 노드들 배치
      nodes.forEach(node => {
        if (!visited.has(node.id)) {
          const unvisitedIndex = Array.from(visited).length;
          const gridCol = unvisitedIndex % 3;
          const gridRow = Math.floor(unvisitedIndex / 3);
          
          positions[node.id] = {
            x: rootX + LAYOUT_CONFIG.INITIAL_RADIUS * 2 + gridCol * LAYOUT_CONFIG.HORIZONTAL_SPACING,
            y: rootY - LAYOUT_CONFIG.INITIAL_RADIUS + gridRow * LAYOUT_CONFIG.VERTICAL_SPACING
          };
          visited.add(node.id);
        }
      });
    });
    
    globalOffsetX = Math.max(globalOffsetX, ...Object.values(positions).map(p => p.x));
    globalOffsetY = Math.max(globalOffsetY, ...Object.values(positions).map(p => p.y));
  });
  
  // 전체 다이어그램 중앙 정렬
  const allX = Object.values(positions).map(p => p.x);
  const allY = Object.values(positions).map(p => p.y);
  const minX = Math.min(...allX);
  const minY = Math.min(...allY);
  const maxX = Math.max(...allX);
  const maxY = Math.max(...allY);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  
  Object.keys(positions).forEach(id => {
    positions[id].x -= centerX - 400;
    positions[id].y -= centerY - 400;
  });
  
  return positions;
}

// --- CFG Panel Layout (Dagre TB) ---
export function calculateCFGLayout(
  nodes: Node[],
  edges: Edge[],
  options?: { direction?: 'TB' | 'LR'; nodeWidth?: number; nodeHeight?: number }
): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));

  const direction = options?.direction || 'TB';
  const nodeWidth = options?.nodeWidth || 120;
  const nodeHeight = options?.nodeHeight || 40;

  g.setGraph({ rankdir: direction });

  nodes.forEach(node => {
    g.setNode(node.id, {
      width: (node.style?.width as number) || nodeWidth,
      height: (node.style?.height as number) || nodeHeight,
    });
  });

  edges.forEach(edge => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  return nodes.map(node => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: { x: pos?.x - (pos?.width ?? nodeWidth) / 2, y: pos?.y - (pos?.height ?? nodeHeight) / 2 },
    };
  });
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