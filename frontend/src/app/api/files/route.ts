/** Next 15 이상: Edge → Node 런타임으로 전환 (fs 사용) */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';     // dev · hot-reload 편하게

import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';

type FileNode = { id: string; name: string; path: string; children?: FileNode[] };

const POC_DIR = path.join(process.cwd(), '..', 'poc');   //   …/poc

/* ── 재귀적으로 파일/폴더 탐색해 FileNode 트리 생성 ───────────── */
function walk(dir: string): FileNode[] {
  return fs.readdirSync(dir).map((name): FileNode => {
    const full = path.join(dir, name);                   // …/poc/foo.py
    const rel  = path.relative(POC_DIR, full);           // foo.py  또는 sub/bar.py
    const id   = rel.replace(/[^\w]/g, '_');             // 고유 ID

    if (fs.statSync(full).isDirectory()) {
      return { id, name, path: rel, children: walk(full) };
    }
    return { id, name, path: rel };
  });
}

/* ── GET /api/files ─────────────────────────────────────── */
export async function GET() {
  const tree: FileNode = {
    id: 'poc',
    name: 'poc',
    path: 'poc',               // root 노드는 “poc”
    children: walk(POC_DIR),
  };
  return NextResponse.json([tree]);  // 배열로 감싸서 FileExplorer에 그대로 전달
}
