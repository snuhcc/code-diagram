import { Node, Edge, NodeProps, Handle, Position } from '@xyflow/react';
import dagre from 'dagre';
import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';
import 'highlight.js/styles/atom-one-light.css';
import { motion } from 'framer-motion';

hljs.registerLanguage('python', python);

// Icon components for different node types
export const NodeIcons = {
  directory: () => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
    >
      <rect
        x="2"
        y="4"
        width="12"
        height="8"
        rx="1.5"
        fill="#fde68a"
        stroke="#b45309"
        strokeWidth="0.7"
      />
      <path
        d="M5.5 3h2.38a1.5 1.5 0 0 1 1.06.44l.62.62A1.5 1.5 0 0 0 8.62 5H2V4.5A1.5 1.5 0 0 1 3.5 3h2Z"
        fill="#fbbf24"
        stroke="#b45309"
        strokeWidth="0.7"
      />
    </svg>
  ),
  file: () => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 32 32"
      fill="none"
    >
      <rect x="4" y="7" width="24" height="18" rx="6" fill="#3776AB" />
      <rect x="4" y="7" width="24" height="9" rx="4.5" fill="#FFD43B" />
      <circle cx="10" cy="12" r="1.5" fill="#222" />
      <circle cx="22" cy="20" r="1.5" fill="#fff" />
    </svg>
  ),
  class: () => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
    >
      <rect
        x="2"
        y="3"
        width="12"
        height="10"
        rx="2"
        fill="#dbeafe"
        stroke="#1e40af"
        strokeWidth="0.7"
      />
      <rect
        x="4"
        y="5"
        width="8"
        height="1"
        rx="0.5"
        fill="#1e40af"
      />
      <rect
        x="4"
        y="7"
        width="6"
        height="1"
        rx="0.5"
        fill="#3b82f6"
      />
      <rect
        x="4"
        y="9"
        width="6"
        height="1"
        rx="0.5"
        fill="#3b82f6"
      />
      <circle
        cx="11"
        cy="8"
        r="1.5"
        fill="#1e40af"
      />
    </svg>
  ),
  function: () => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
    >
      <rect
        x="2"
        y="4"
        width="12"
        height="8"
        rx="2"
        fill="#dcfce7"
        stroke="#166534"
        strokeWidth="0.7"
      />
      <path
        d="M5 7h6M5 9h4"
        stroke="#166534"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <circle
        cx="6"
        cy="6"
        r="1"
        fill="#16a34a"
      />
      <path
        d="M9 6h3"
        stroke="#16a34a"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  ),
  method: () => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
    >
      <rect
        x="2"
        y="4"
        width="12"
        height="8"
        rx="2"
        fill="#dcfce7"
        stroke="#166534"
        strokeWidth="0.7"
      />
      <path
        d="M5 7h6M5 9h4"
        stroke="#166534"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <circle
        cx="6"
        cy="6"
        r="1"
        fill="#16a34a"
      />
      <path
        d="M9 6h3"
        stroke="#16a34a"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  )
};

// Constants
export const ENDPOINTS = {
  CG: '/api/generate_call_graph_ast', // AST 기반 호출 그래프 생성
  CFG: '/api/generate_control_flow_graph',
  INLINE_CODE_EXPLANATION: '/api/inline_code_explanation',
  INLINE_CODE_EXPLANATION_STREAM: '/api/inline_code_explanation_stream',
} as const;

export const STYLES = {
  NODE: {
    MIN_WIDTH: 120,
    PADDING: 20,
    HEIGHT: {
      DEFAULT: 40,
      CLASS: 48,  // 클래스 노드는 더 큰 높이
      METHOD: 36, // 메소드 노드는 조금 작은 높이
    },
    FONT_SIZE: '13px',
    FONT_FAMILY: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  GROUP: {
    PADDING: 30, // Reduced from 20 to 15 for more compact layout
    COLLAPSED_WIDTH: 180, // Reduced from 200 to 180
    COLLAPSED_HEIGHT: 45, // Reduced from 50 to 45
    FILE_HEADER_HEIGHT: 28,
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


export const LAYOUT_RULES = {
  NODE_PADDING_X: 20,  // 텍스트 좌우 여백
  NODE_PADDING_Y: 8,   // 텍스트 상하 여백
  MIN_GAP: 50,         // 노드 간 최소 거리(px)
  MAX_GAP: 300,        // 노드 간 최대 허용 거리(px) – 레이아웃 압축 시 사용
} as const;

// Global diagram scale factor to compress overall distances (0 < SCALE <= 1)
const GLOBAL_SCALE = 1; // 65% of original spacing to shorten edges

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
  // 1) SSR 안전 가드
  if (typeof document === 'undefined') return text.length * 7;

  // 2) 캐시 초기화 (font+text 조합으로 키 생성)
  const cacheKey = `${font}__${text}`;
  const cache: Map<string, number> = (getTextWidth as any)._cache || new Map();

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore – 사용자 정의 프로퍼티 저장
  (getTextWidth as any)._cache = cache;

  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  // 3) 실제 측정
  const canvas = (getTextWidth as any)._canvas || ((getTextWidth as any)._canvas = document.createElement('canvas'));
  const context = canvas.getContext('2d');
  if (!context) return text.length * 7;
  context.font = font;
  const width = context.measureText(text).width;

  cache.set(cacheKey, width);
  return width;
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
  
  // 단순화된 레이아웃 파라미터 – LAYOUT_RULES 로부터 파생
  const LAYOUT_CONFIG = {
    CENTER_X: 1,
    CENTER_Y: 1,
    FILE_RADIUS: 160, // 파일 그룹이 퍼지는 반지름 – 노드 간 MAX_GAP 을 고려해 소폭 감소
    FILE_AREA_WIDTH: 10 * (LAYOUT_RULES.MAX_GAP),
    FILE_AREA_HEIGHT: 10 * (LAYOUT_RULES.MAX_GAP),

    CLASS_SPACING: LAYOUT_RULES.MIN_GAP,
    METHOD_SPACING_X: LAYOUT_RULES.MIN_GAP / 2,
    METHOD_SPACING_Y: LAYOUT_RULES.MIN_GAP / 2,

    FUNCTION_SPACING_X: LAYOUT_RULES.MIN_GAP,
    FUNCTION_SPACING_Y: LAYOUT_RULES.MIN_GAP,

    CLASS_PADDING: {
      TOP: 24,
      BOTTOM: 12,
      LEFT: 16,
      RIGHT: 16,
    },

    // 메소드/클래스 최소 크기는 텍스트 폭 + 패딩으로 동적으로 계산하므로 기본값만 남김
    METHOD_HEIGHT: 24,
    CLASS_MIN_HEIGHT: 70,
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
      
      // 클래스 크기 계산 – 메소드 한 줄 폭 + 패딩, 글씨 길이에 따라 자동 확장
      const methodBoxWidth = nodeWidths[classNode.id] + LAYOUT_RULES.NODE_PADDING_X * 2;
      const classWidth = Math.max(
        methodBoxWidth,
        methodsPerRow * methodBoxWidth +
        (methodsPerRow - 1) * LAYOUT_CONFIG.METHOD_SPACING_X
      ) + LAYOUT_CONFIG.CLASS_PADDING.LEFT + LAYOUT_CONFIG.CLASS_PADDING.RIGHT;
      
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
      
      // --- 메소드 배치 : 가변 폭 누적 방식 -----------------------------
      const startX = classX;
      const startY = classY + LAYOUT_CONFIG.CLASS_PADDING.TOP-10;
      let curX = startX;
      let curY = startY;
      let rowMaxH = 0;
      let colCount = 0;
      methods.forEach(method => {
        const w = nodeWidths[method.id] + LAYOUT_RULES.NODE_PADDING_X * 2;
        const h = LAYOUT_CONFIG.METHOD_HEIGHT;

        if (colCount >= methodsPerRow) { // 줄바꿈
          curX = startX;
          curY += rowMaxH + LAYOUT_CONFIG.METHOD_SPACING_Y;
          rowMaxH = 0;
          colCount = 0;
        }

        positions[method.id] = { x: curX, y: curY, width: w, height: h };

        curX += w + LAYOUT_CONFIG.METHOD_SPACING_X;
        rowMaxH = Math.max(rowMaxH, h);
        colCount++;
      });
      
      // 다음 클래스들을 위한 currentY 업데이트
      if (classCol === Math.max(1, classesPerRow) - 1 || classIndex === classNodes.length - 1) {
        currentY = classY + classHeight + LAYOUT_CONFIG.CLASS_SPACING;
      }
    });
    
    // 일반 함수들을 그리드 방식으로 배치 (클래스들 아래에)
    if (functionNodes.length > 0) {
      currentY += 30; // 클래스와 함수 사이 추가 간격
      
      // 단일 파일 내 함수들의 최대 폭을 기준으로 셀 폭 통일 (가변 폭에 의한 겹침 방지)
      const maxFuncWidth = Math.max(...functionNodes.map(fn => nodeWidths[fn.id] || 150), 150);

      functionNodes.forEach((funcNode, funcIndex) => {
        const functionsPerRow = 4;
        const funcCol = funcIndex % functionsPerRow;
        const funcRow = Math.floor(funcIndex / functionsPerRow);

        const cellWidth = maxFuncWidth + LAYOUT_CONFIG.FUNCTION_SPACING_X;
        const funcX = fileAreaStartX + funcCol * cellWidth;
        const funcY = currentY + funcRow * LAYOUT_CONFIG.FUNCTION_SPACING_Y;

        const funcWidth = nodeWidths[funcNode.id] + LAYOUT_RULES.NODE_PADDING_X * 2;

        positions[funcNode.id] = {
          x: funcX,
          y: funcY,
          width: funcWidth,
          height: 35,
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

      // Apply global scale around (200,200) + offset (keeping file grouping roughly same center)
      const scaleCenterX = 200;
      const scaleCenterY = 200;
      positions[id].x = scaleCenterX + (positions[id].x - scaleCenterX) * GLOBAL_SCALE;
      positions[id].y = scaleCenterY + (positions[id].y - scaleCenterY) * GLOBAL_SCALE;
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
    HORIZONTAL_SPACING: 90,      // Bring sibling nodes closer horizontally
    VERTICAL_SPACING: 30,        // Bring sibling nodes closer vertically
    LEVEL_RADIUS_INCREMENT: 24,  // Smaller radial increment between levels
    INITIAL_RADIUS: 30,          // Initial radius closer to parent
    SIBLING_ANGLE_SPREAD: Math.PI * 0.1,  // Narrower angle spread
    FILE_SPACING_X: 280,         // Reduce distance between file groups horizontally
    FILE_SPACING_Y: 240,         // Reduce distance between file groups vertically
    GROUP_MIN_DISTANCE: 200,     // Allow groups to be placed nearer while avoiding overlap
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

    // Apply global scale around (200,200) + offset (keeping file grouping roughly same center)
    const scaleCenterX = 200;
    const scaleCenterY = 200;
    positions[id].x = scaleCenterX + (positions[id].x - scaleCenterX) * GLOBAL_SCALE;
    positions[id].y = scaleCenterY + (positions[id].y - scaleCenterY) * GLOBAL_SCALE;
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

// Custom node component for individual nodes (function, class, method)
export function CustomNode({ data }: NodeProps) {
  const { label, nodeType = 'function' } = data as any;
  
  const getIcon = () => {
    switch (nodeType) {
      case 'class':
        return <NodeIcons.class />;
      case 'method':
        return <NodeIcons.method />;
      case 'function':
      default:
        return <NodeIcons.function />;
    }
  };

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
          gap: 6,
          paddingLeft: 8,
          position: 'relative',
        }}
      >
        <div 
          style={{ 
            position: 'absolute',
            top: 3,
            left: 3,
            color: '#6b7280',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1
          }}
        >
          {getIcon()}
        </div>
        <span
          style={{
            marginLeft: 18,
            top: 1,
            position: 'absolute',
            fontSize: 'inherit',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'visible',
          }}
        >
          {label}
        </span>
      </div>
    </>
  );
}

// Custom group node component for file and directory groups
export function CustomGroupNode({ data }: NodeProps) {
  const { label, isCollapsed, onToggleCollapse, folderPath } = data as any;
  
  // 폴더 그룹인지 파일 그룹인지 구분
  const isFolder = !!folderPath;

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

  // 그룹 노드 width를 label 크기에 맞게 동적으로 계산
  // 아이콘과 패딩을 고려하여 추가 공간 확보
  const dynamicWidth = calculateNodeWidth(label) + 60; // 아이콘·패딩 여유

  if (isCollapsed) {
    return (
      <>
        <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
        <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
        <motion.div
          layout
          transition={{ type: 'spring', stiffness: 420, damping: 35 }}
          style={{
            width: dynamicWidth,
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ color: '#6b7280', marginTop: '1px' }}>
              {isFolder ? <NodeIcons.directory /> : <NodeIcons.file />}
            </div>
            <ChevronIcon direction="right" />
          </div>
          <span>{label}</span>
        </motion.div>
      </>
    );
  }

  // Expanded header inside group top area
  return (
    <>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <motion.div
        layout
        transition={{ type: 'spring', stiffness: 420, damping: 35 }}
        style={{
          position: 'absolute',
          top: 4,
          left: 4,
          fontWeight: 600,
          fontSize: 13,
          color: '#444',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
        }}
        onClick={(e) => {
          e.stopPropagation();
          onToggleCollapse();
        }}
      >
        <div style={{ color: '#6b7280', marginTop: '1px' }}>
          {isFolder ? <NodeIcons.directory /> : <NodeIcons.file />}
        </div>
        <ChevronIcon direction="down" />
        <span style={{ whiteSpace: 'nowrap' }}>{label}</span>
      </motion.div>
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
  const iconExtra = 22; // 16 icon + 6 gap
  const width = textWidth + (iconExtra + LAYOUT_RULES.NODE_PADDING_X) * 1.5;
  return Math.max(140, width); // 100px 을 안전 최소 폭으로 사용
}

// 기존 코드 아래에 노드 타입 오브젝트를 한번만 생성하여 외부에서 재사용할 수 있게 export 합니다.
export const NODE_TYPES = {
  group: CustomGroupNode,
  customNode: CustomNode,
} as const;