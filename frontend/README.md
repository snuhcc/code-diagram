
# Code-Diagram Frontend

A VS Code–style interface built with **Next 14** and **Tailwind CSS 4**.
Left-to-right layout — File Explorer · Monaco code viewer · Mermaid diagram · Chat panel.

## Quick start

```bash
pnpm install   # deps
pnpm dev       # http://localhost:3000 (로컬 API 사용)
pnpm dev:ngrok # http://localhost:3000 (Ngrok API 사용)
```

### 환경별 실행 방법

- **로컬 개발**: `pnpm dev` - `NEXT_PUBLIC_API_BASE_URL` (http://localhost:8000) 사용
- **Ngrok 환경**: `pnpm dev:ngrok` - `NEXT_PUBLIC_API_BASE_URL_NGROK` 사용

### Sample frontend/.env.local
```bash
# FastAPI 기본 주소 (로컬 개발용)
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000

# Ngrok 주소 (외부 접근용)
NEXT_PUBLIC_API_BASE_URL_NGROK=https://mint-skunk-optionally.ngrok-free.app

# Ngrok 사용 여부 (dev:ngrok 스크립트에서 true로 설정됨)
NEXT_PUBLIC_USE_NGROK=false

# FastAPI에서 설정한 폴더 경로
NEXT_PUBLIC_TARGET_FOLDER=study_1/face_classification
```

# Stack

| **Tech** | **Note**             |
| -------------- | -------------------------- |
| Next.js 14     | App Router, Turbopack      |
| Tailwind 4     | VS Code theme via CSS vars |
| Monaco Editor  | Real VS Code editor core   |
| Mermaid 10     | Live code graphs           |
| Zustand        | File-tree stat             |
