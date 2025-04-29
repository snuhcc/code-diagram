from pathlib import Path

# 텍스트로 처리할 확장자
TEXT_EXTS = {".py", ".md", ".txt", ".json", ".toml", ".yaml", ".yml", ".cfg", ".ini"}
# 건너뛸 디렉토리 이름
IGNORE_DIRS = {"__pycache__", ".pytest_cache"}

def build_tree(root: Path, prefix: str = "") -> str:
    entries = sorted(
        [e for e in root.iterdir() if e.name not in IGNORE_DIRS],
        key=lambda e: (e.is_file(), e.name.lower())
    )
    lines = []
    for idx, entry in enumerate(entries):
        connector = "└── " if idx == len(entries) - 1 else "├── "
        lines.append(f"{prefix}{connector}{entry.name}")
        if entry.is_dir():
            extension = "    " if idx == len(entries) - 1 else "│   "
            lines.append(build_tree(entry, prefix + extension))
    return "\n".join(lines)

def format_file_block(path: Path, root: Path) -> str:
    rel = path.relative_to(root)
    size = path.stat().st_size
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return f"# Skipped non-UTF8 file: {rel}\n"
    lines = text.splitlines()
    numbered = "\n".join(f"{i+1:4d}: {line}" for i, line in enumerate(lines))
    return (
        f"--- FILE: {rel} ({size} bytes) ---\n"
        f"{numbered}\n"
        f"--- END FILE: {rel} ---\n"
    )

def collect_prompt(root_dir: str, out_path: str = None):
    root = Path(root_dir)

    parts = ["=== DIRECTORY TREE ===", build_tree(root), "=== END DIRECTORY TREE ===\n"]

    for file in sorted(root.rglob("*")):
        # 1) 폴더 제외
        if any(part in IGNORE_DIRS for part in file.parts):
            continue
        # 2) 파일만, 그리고 텍스트 확장자만
        if not file.is_file() or file.suffix.lower() not in TEXT_EXTS:
            continue

        parts.append(format_file_block(file, root))

    prompt = "\n".join(parts)

    if out_path:
        if not out_path.endswith(".txt"):
            out_path += ".txt"
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(prompt)
        print(f"Prompt saved to {out_path}")
    else:
        print(prompt)

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: python make_prompt.py <ROOT_DIR> [OUTPUT_FILE]")
    else:
        collect_prompt(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)