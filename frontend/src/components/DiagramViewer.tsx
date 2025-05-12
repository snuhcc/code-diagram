// src/components/DiagramViewer.tsx
'use client';

import { useEffect, useRef } from 'react';
import mermaid from 'mermaid';
import svgPanZoom from 'svg-pan-zoom';

let mermaidReady = false;

export default function DiagramViewer({ filePath }: { filePath: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    /* ─── 1) Mermaid 초기화 ─── */
    if (!mermaidReady) {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
      mermaidReady = true;
    }

    /* ─── 2) 간단한 예시 그래프 (추후 파일 내용 기반으로 변경) ─── */
    const id    = filePath.replace(/[^\w]/g, '_');
    const graph = `graph TD; Root[${id}] --> A; Root --> B;`;

    /* ─── 3) SVG 생성 후 컨테이너에 삽입 ─── */
    mermaid.render(id, graph).then(({ svg }) => {
      if (!ref.current) return;

      ref.current.innerHTML = svg;

      /* ─── 4) SVG를 컨테이너(패널) 크기에 100 × 100 %로 맞춤 ─── */
      const svgEl = ref.current.querySelector('svg') as SVGSVGElement | null;
      if (svgEl) {
        // 고정 px 속성 제거
        svgEl.removeAttribute('width');
        svgEl.removeAttribute('height');

        // 퍼센트 크기 강제
        svgEl.style.width  = '100%';
        svgEl.style.height = '100%';
        svgEl.style.display = 'block';        // 인라인-블록 여백 제거

        /* ─── 5) Pan · Zoom 활성화 ─── */
        svgPanZoom(svgEl, {
          controlIconsEnabled: true,
          fit: true,      // 처음 로드 시 패널에 맞춤
          center: true,
        });
      }
    });
  }, [filePath]);

  /* flex-item 으로 패널 공간을 100 % 차지 */
  return (
    <div
      ref={ref}
      className="flex-1 h-full bg-[--color-panel] overflow-hidden"
    />
  );
}
