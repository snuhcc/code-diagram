// frontend/src/app/api/file/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const POC_DIR = path.join(process.cwd(), '..', 'poc');   // <root>/poc

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('path') ?? '';

  /* ── 경로 정규화 & 보안 ─────────────────────────────── */
  const parts = raw.split(/[\\/]/).filter(p => p && p !== '..');
  // "poc/…" 또는 "../poc/…" 로 올 수 있으니 'poc' 토큰 제거
  if (parts[0] === 'poc') parts.shift();
  if (parts[0] === '..' && parts[1] === 'poc') parts.splice(0, 2);

  const rel = parts.join('/');             // ex) "main.py"  "src/App.tsx"
  const abs = path.join(POC_DIR, rel);     // <root>/poc/main.py

  try {
    const text = await fs.readFile(abs, 'utf8');
    /* 기본 텍스트 응답 */
    return new NextResponse(text);
  } catch {
    /* 파일 못 찾으면 404 JSON */
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }
}
