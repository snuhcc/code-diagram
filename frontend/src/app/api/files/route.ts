/** Next 15 이상: Edge → Node 런타임으로 전환 (fs 사용) */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';     // dev · hot-reload 편하게

import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';

type FileNode = { id: string; name: string; path: string; children?: FileNode[] };

// 환경변수에서 타겟 폴더 읽기
const TARGET_FOLDER = process.env.NEXT_PUBLIC_TARGET_FOLDER!;
const TARGET_DIR = path.join(process.cwd(), '..', TARGET_FOLDER);

/* ── 재귀적으로 파일/폴더 탐색해 FileNode 트리 생성 ───────────── */
function walk(dir: string): FileNode[] {
  return fs.readdirSync(dir).map((name): FileNode => {
    const full = path.join(dir, name);                   
    const rel  = path.relative(path.join(process.cwd(), '..'), full); // 전체 상대경로
    const id   = rel.replace(/[^\w]/g, '_');             // 고유 ID

    if (fs.statSync(full).isDirectory()) {
      return { id, name, path: rel, children: walk(full) };
    }
    return { id, name, path: rel };
  });
}

/* ── GET /api/files ─────────────────────────────────────── */
export async function GET() {
  try {
    const tree: FileNode = {
      id: TARGET_FOLDER.replace(/[^\w]/g, '_'),
      name: TARGET_FOLDER,
      path: TARGET_FOLDER,               
      children: walk(TARGET_DIR),
    };
    return NextResponse.json([tree]);  // 배열로 감싸서 FileExplorer에 그대로 전달
  } catch (error) {
    console.error('Error reading directory:', error);
    return NextResponse.json({ error: 'Directory not found' }, { status: 404 });
  }
}