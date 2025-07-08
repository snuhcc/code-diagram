from pathlib import Path

# 텍스트로 처리할 확장자
TEXT_EXTS = {".py", ".md", ".txt", ".json", ".toml", ".yaml", ".yml", ".ini"}
# 건너뛸 디렉토리 이름
IGNORE_DIRS = {"__pycache__", ".pytest_cache", ".git", ".vscode", ".idea", "node_modules", "venv", "env"}
IGNORE_FILES = {"__init__.py", ".DS_Store"}

DIAGRAM_EXAMPLE = {
    "nodes": [
        {
            "id": "sub_dir.file_name.function_name_0",
            "function_name": "function_name_0",  # function_name
            "file": "root_dir/sub_dir/file_name.py",  # file path
            "line_start": 1,
            "line_end": 17,
            "description": "Function to do something."  # summary of function
        },
        {
            "id": "sub_dir.file_name.function_name_1",
            "function_name": "function_name_1",
            "file": "root_dir/file_name.py",
            "line_start": 18,
            "line_end": 34,
            "description": "Function to do something else."
        },
        {
            "id": "sub_dir.file_name.function_name_2",
            "function_name": "function_name_2",
            "file": "root_dir/sub_dir/file_name.py",
            "line_start": 35,
            "line_end": 44,
            "description": "Function to do something else."
        }
    ],
    "edges": [
        {
            "id": "sub_dir.file_name.e0",   # file_name.edge_id
            "source": "sub_dir.file_name.function_name_0",
            "target": "sub_dir.file_name.function_name_0",
        },
        {
            "id": "sub_dir.file_name.e1",   # file_name.edge_id
            "source": "sub_dir.file_name.function_name_0",
            "target": "sub_dir.file_name.function_name_1",
        },
    ]
}

PROMPT_CODE_TO_CG = """
    You are a SOFTWARE ENGINEERING EXPERT. You are given Python codes.
    Please generate a Call Graph for the provided code.

    INPUT:
    - The directory structure of the repository:
    {repo_tree}
    - The function code with line numbers:
    {code_from_file}
    - Example output format (JSON):
    {diagram_example}

    OUTPUT:
    - The output must strictly follow the provided JSON format.
    - Node IDs should be unique and follow the format: "sub_dir.file_name.function_name" where sub_dir is the name of the sub-directory from root_dir, file_name is the name of the file without extension, and function_name is the name of the function.
    - Only create nodes for functions or classes declared in this code, if there are no functions or classes declared, just add "Global" node.
    - If a function or class is called but not declared in this code (e.g., imported), do not create a node for it, but do create an edge to it.
    - For edges to imported functions or classes, if the import statement is like 'from A.B import C', the edge target should be 'A.B.C'.
    - Edges must represent function calls or class method calls.
    - Edge ids should be unique and follow the format: "file_name.e[index]" where file_name is the name of the file without extension and index is a sequential number starting from 0.
    - Ignore built-in functions and standard library calls.
"""

PROMPT_CODE_TO_CFG = """
    You are tasked with analyzing the provided code and generating a Control Flow Graph (CFG) description in JSON format to help users easily understand the structure and logic of the code.

    When creating the CFG description, please adhere strictly to the following guidelines:

    1. Identify all control flow structures explicitly:
      - Clearly specify conditional statements (if, else if, else).
      - Clearly indicate loops (for, while, do-while).

    2. Structure clearly:
      - Use nodes to represent code blocks or segments.
      - Describe clearly how control transfers from one node to another using edges.

    3. Detail Branching and Loops:
      - For conditions, explicitly state the condition being evaluated and indicate which node is taken when true or false.
      - For loops, explicitly indicate the entry point, loop condition check, loop body, and exit point.

    4. Include an Entry and Exit node:
      - Clearly mark the start (Entry) and end (Exit) of the control flow.

    INPUT:
    - The function code with line numbers:
    {function_code}
    - The File Name:
    {file_name}

    OUTPUT Format(JSON):
    {{
        "nodes": [
            {{
                "id": "main.1",
                "label": "Start of main()",
                "file": file_name,
                "line_start": 1,
                "line_end": 1,
                "description": "Entry point of main function."
            }},
            {{
                "id": "main.2",
                "label": "If condition x > 0",
                "file": file_name,
                "line_start": 2,
                "line_end": 2,
                "description": "Conditional branch."
            }},
            // ... more nodes ...
        ],
        "edges": [
            {{
                "id": "e0",
                "source": "main.1",
                "target": "main.2",
                "description": "next number"
            }},
            {{
                "id": "e1",
                "source": "main.2",
                "target": "main.3",
                "description": "true"
            }},
            {{
                "id": "e2",
                "source": "main.2",
                "target": "main.4",
                "description": "false"
            }}
            // ... more edges ...
        ]
    }}
"""

PROMPT_INLINE_CODE_EXPLANATION = """
    Please generate an inline code explanation for the provided code.
    INPUT:
    - The code snippet with line numbers:
    {code_snippet}
    - Line numbers that need explanation (from ~ to):
    {line_start} ~ {line_end}
    - Explanation level (1-10): {explanation_level}

    OUTPUT:
    - The output must be ENGLISH.
    - The output must follow this exact format: 
        "Explanation for lines xx~xx:
        Lines aa~bb: [description].\n
        Lines cc~dd: [description].\n
        Lines ee~ff: [description]."
    - Adjust the explanation depth based on the explanation level:
      * Level 1-2: Very brief, single sentence explanation
      * Level 3-4: Brief explanation with key points
      * Level 5-6: Moderate explanation with context
      * Level 7-8: Detailed explanation with examples
      * Level 9-10: Very detailed explanation with implementation details, edge cases, and best practices
    - The output must be a clear explanation appropriate for the given level.
    
"""

def build_repo_tree(root: Path, prefix: str = "", is_sub: bool = False) -> str:
    """
    tree 스타일 디렉토리 구조 문자열 생성.
    첫 호출 시, root 디렉토리 이름도 포함합니다.
    """
    lines = []
    if not is_sub:
        # 최상위 root 이름 추가
        lines.append(f"{root.name}")
    entries = sorted(
        [
            e for e in root.iterdir()
            if not (
                (e.is_dir() and e.name in IGNORE_DIRS) or
                (e.is_file() and e.name in IGNORE_FILES)
            )
        ],
        key=lambda e: (e.is_file(), e.name.lower())
    )
    for idx, entry in enumerate(entries):
        # print(f"Processing entry: {entry.name} (is_dir: {entry.is_dir()})")
        connector = "└── " if idx == len(entries) - 1 else "├── "
        lines.append(f"{prefix}{connector}{entry.name}")
        if entry.is_dir():
            extension = "    " if idx == len(entries) - 1 else "│   "
            # 하위 디렉토리는 is_sub=True로 재귀 호출
            sub_lines = build_repo_tree(entry, prefix + extension, is_sub=True).splitlines()
            # 최상위 이름 제외한 부분만 추가
            # print(f"Subdirectory lines: {sub_lines}")
            lines.extend(sub_lines[:])
    return "\n".join(lines)

# def format_file_block(path: Path, root: Path) -> str:
#     rel = path.relative_to(root)
#     size = path.stat().st_size
#     try:
#         text = path.read_text(encoding="utf-8")
#     except UnicodeDecodeError:
#         return f"# Skipped non-UTF8 file: {rel}\n"
#     lines = text.splitlines()
#     numbered = "\n".join(f"{i+1:4d}: {line}" for i, line in enumerate(lines))
#     return (
#         f"--- FILE: {rel} ({size} bytes) ---\n"
#         f"{numbered}\n"
#         f"--- END FILE: {rel} ---\n"
#     )

# def generate_repo_prompt(root_dir: str, out_path: str = None):
#     root = Path(root_dir)

#     parts = ["=== DIRECTORY TREE ===", build_repo_tree(root), "=== END DIRECTORY TREE ===\n"]

#     for file in sorted(root.rglob("*")):
#         # 1) 폴더 제외
#         if any(part in IGNORE_DIRS for part in file.parts):
#             continue
#         # 2) 파일만, 그리고 텍스트 확장자만
#         if not file.is_file() or file.suffix.lower() not in TEXT_EXTS:
#             continue

#         parts.append(format_file_block(file, root))

#     prompt = "\n".join(parts)

#     if out_path:
#         if not out_path.endswith(".txt"):
#             out_path += ".txt"
#         with open(out_path, "w", encoding="utf-8") as f:
#             f.write(prompt)
#         print(f"Prompt saved to {out_path}")
#     else:
#         print(prompt)
#         return prompt

def get_codes_from_file(file_path):
    """
    주어진 파일에서 코드를 읽고, 각 줄에 라인 넘버를 추가하여 반환합니다.
    """
    from pathlib import Path
    file_path = Path(file_path)
    try:
        text = file_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return f"# Skipped non-UTF8 file: {file_path.name}\n"
    lines = text.splitlines()
    numbered = "\n".join(f"{i+1:4d}: {line}" for i, line in enumerate(lines))
    parts = [
        f"=== FILE: {file_path.name} ===",
        numbered,
        f"=== END FILE: {file_path.name} ===\n"
    ]
    return "\n".join(parts)

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: python make_prompt.py <ROOT_DIR> [OUTPUT_FILE]")
    else:
        generate_repo_prompt(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)