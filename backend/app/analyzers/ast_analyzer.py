import ast
import os
from collections import defaultdict
from typing import Dict, List, Any, Optional, Set, Tuple

class FunctionVisitor(ast.NodeVisitor):
    """Extract function and method information from Python files."""
    
    def __init__(self):
        self.functions = []
        self.current_function = None
        self.function_calls = defaultdict(list)
        self.function_lines = {}
        self.exports = []
        self.classes = []
        self.class_methods = defaultdict(list)
        self.current_class = None
        self.variables = []
        self.variable_dependencies = defaultdict(list)
        self.builtin_filter = BuiltinFilter()
        
    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        # Skip if this is a class method (handled separately)
        if self.current_class:
            self.class_methods[self.current_class].append(node.name)
            
        # Record function info
        func_name = node.name
        self.functions.append(func_name)
        self.function_lines[func_name] = {
            'start': node.lineno,
            'end': self._find_last_line(node)
        }
        
        # Check if function is exported
        if func_name.startswith('__') and func_name.endswith('__'):
            pass  # Skip magic methods for exports
        elif node.decorator_list:
            for decorator in node.decorator_list:
                if isinstance(decorator, ast.Name) and decorator.id == 'export':
                    self.exports.append(func_name)
        else:
            # Functions at module level are considered "exported"
            if not self.current_class and not self.current_function:
                self.exports.append(func_name)
        
        # Visit the function body to find function calls
        parent_function = self.current_function
        self.current_function = func_name
        self.generic_visit(node)
        self.current_function = parent_function
        
    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        # Handle async functions the same way as regular functions
        self.visit_FunctionDef(node)
        
    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        class_name = node.name
        self.classes.append(class_name)
        self.exports.append(class_name)  # Classes at module level are exported
        
        parent_class = self.current_class
        self.current_class = class_name
        self.generic_visit(node)
        self.current_class = parent_class
        
    def visit_Call(self, node: ast.Call) -> None:
        if not self.current_function:
            self.generic_visit(node)
            return
            
        if isinstance(node.func, ast.Name):
            # Direct function call like func()
            func_name = node.func.id
            
            # Skip built-in functions using the filter
            if not self.builtin_filter.should_exclude_call(func_name):
                self.function_calls[self.current_function].append(func_name)
            
            # Check for special 'useState' equivalent in Python
            if func_name == 'useState' and len(node.args) > 0:
                # This is similar to React's useState hook
                # We'll need to track this in the parent Assign node
                pass
                
        elif isinstance(node.func, ast.Attribute):
            # Method call like obj.method() or module.function()
            method_name = node.func.attr
            
            # Try to get the module name for better filtering
            module_name = None
            if isinstance(node.func.value, ast.Name):
                module_name = node.func.value.id
            
            # Skip built-in methods using the filter
            if not self.builtin_filter.should_exclude_call(method_name, module_name):
                # Store as module.function if module is available
                if module_name:
                    full_call = f"{module_name}.{method_name}"
                    self.function_calls[self.current_function].append(full_call)
                else:
                    self.function_calls[self.current_function].append(method_name)
        
        self.generic_visit(node)
        
    def visit_Assign(self, node: ast.Assign) -> None:
        # Look for assignments like module.exports = X or exports = Y
        if (isinstance(node.targets[0], ast.Name) and 
            node.targets[0].id in ['exports', '__all__']):
            if isinstance(node.value, ast.List):
                for elt in node.value.elts:
                    if isinstance(elt, ast.Str):
                        self.exports.append(elt.s)
                    elif isinstance(elt, ast.Constant) and isinstance(elt.value, str):
                        self.exports.append(elt.value)
        
        # Handle variable assignments
        for target in node.targets:
            if isinstance(target, ast.Name):
                var_name = target.id
                var_type = self._infer_type(node.value)
                
                # Check if this is a "state" variable (similar to React's useState)
                is_state = False
                if (isinstance(node.value, ast.Call) and 
                    isinstance(node.value.func, ast.Name) and 
                    node.value.func.id == 'useState'):
                    is_state = True
                    var_type = 'State'
                elif (isinstance(node.value, ast.Subscript) and 
                      isinstance(node.value.value, ast.Name) and 
                      node.value.value.id == 'state'):
                    is_state = True
                    var_type = 'State'
                
                # Add to variables with context
                if self.current_function:
                    context = f"in {self.current_function}"
                elif self.current_class:
                    context = f"in {self.current_class}"
                else:
                    context = "module-level"
                
                # Add appropriate suffix for state variables
                display_name = var_name
                if is_state:
                    display_name = f"{var_name} (State)"
                
                self.variables.append({
                    "name": display_name,
                    "type": var_type,
                    "context": context
                })
                
                # Track dependencies
                if isinstance(node.value, ast.Call):
                    if isinstance(node.value.func, ast.Name):
                        self.variable_dependencies[var_name].append(node.value.func.id)
                        self.variable_dependencies[var_name].append(node.value.func.id)
            
            # Handle tuple unpacking (like message, setMessage = useState(...))
            elif isinstance(target, ast.Tuple):
                # Check if this is a "useState" equivalent pattern
                if (isinstance(node.value, ast.Call) and 
                    isinstance(node.value.func, ast.Name) and 
                    node.value.func.id in ['useState', 'React.useState']):
                    
                    # Extract the variable names from the tuple
                    if len(target.elts) >= 2:
                        state_var = target.elts[0]
                        setter_var = target.elts[1]
                        
                        if isinstance(state_var, ast.Name) and isinstance(setter_var, ast.Name):
                            # Add state variable
                            self.variables.append({
                                "name": f"{state_var.id} (State)",
                                "type": "State",
                                "dependencies": ["useState"]
                            })
                            
                            # Add setter variable
                            self.variables.append({
                                "name": f"{setter_var.id} (State Setter)",
                                "type": "StateSetter",
                                "dependencies": [state_var.id]
                            })
                    
                    # Extract the variable names from the tuple
                    if len(target.elts) >= 2:
                        state_var = target.elts[0]
                        setter_var = target.elts[1]
                        
                        if isinstance(state_var, ast.Name) and isinstance(setter_var, ast.Name):
                            # Add state variable
                            self.variables.append({
                                "name": f"{state_var.id} (State)",
                                "type": "State",
                                "dependencies": ["useState"]
                            })
                            
                            # Add setter variable
                            self.variables.append({
                                "name": f"{setter_var.id} (State Setter)",
                                "type": "StateSetter",
                                "dependencies": [state_var.id]
                            })
        
        self.generic_visit(node)
        
    def _infer_type(self, node: ast.AST) -> str:
        """Infer the type of a value node."""
        if isinstance(node, (ast.Str, ast.Constant)) and isinstance(getattr(node, 'value', None), str):
            return 'str'
        elif isinstance(node, (ast.Num, ast.Constant)) and isinstance(getattr(node, 'value', None), (int, float)):
            return 'number'
        elif isinstance(node, ast.List):
            return 'list'
        elif isinstance(node, ast.Dict):
            return 'dict'
        elif isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name):
                return node.func.id
            elif isinstance(node.func, ast.Attribute):
                return node.func.attr
        return 'unknown'
        
    def _find_last_line(self, node: ast.AST) -> int:
        """Find the last line of a node, including all its children."""
        last_line = node.lineno
        for child in ast.iter_child_nodes(node):
            if hasattr(child, 'lineno'):
                last_line = max(last_line, child.lineno)
                # Recursively check children
                child_last_line = self._find_last_line(child)
                last_line = max(last_line, child_last_line)
        return last_line


def analyze_python_ast(content: str) -> Dict[str, Any]:
    """Analyze a Python file's AST to extract code structure."""
    try:
        tree = ast.parse(content)
        
        # Extract imports using the import_analyzer module
        from .import_analyzer import ImportVisitor
        import_visitor = ImportVisitor()
        import_visitor.visit(tree)
        
        # Extract code structure and function calls
        function_visitor = FunctionVisitor()
        function_visitor.visit(tree)
        
        return {
            'functions': function_visitor.functions,
            'function_calls': dict(function_visitor.function_calls),
            'function_lines': function_visitor.function_lines,
            'imports': import_visitor.imports,
            'detailed_dependencies': import_visitor.detailed_dependencies,
            'exports': function_visitor.exports,
            'classes': function_visitor.classes,
            'class_methods': function_visitor.class_methods,
            'variables': function_visitor.variables,
            'variable_dependencies': function_visitor.variable_dependencies
        }
    except SyntaxError as e:
        # Return partial information in case of syntax errors
        return {
            'error': str(e),
            'functions': [],
            'imports': [],
            'exports': [],
            'variables': []
        }


def ast_to_diagram_json(ast_result: dict, file_path: str) -> dict:
    """
    Convert AST analysis result to DIAGRAM_EXAMPLE-style JSON.
    """
    nodes = []
    edges = []
    # Use basename for node IDs, but normalize the full path for consistency
    base_file_name = os.path.splitext(os.path.basename(file_path))[0]
    normalized_file_path = os.path.abspath(file_path)
    rel_file = file_path  # You may want to make this relative to project root

    # 1. Nodes for functions and classes
    for func in ast_result.get('functions', []):
        lines = ast_result.get('function_lines', {}).get(func, {})
        node_id = f"{base_file_name}.{func}"
        nodes.append({
            "id": node_id,
            "function_name": func,
            "file": rel_file,
            "line_start": lines.get('start', None),
            "line_end": lines.get('end', None),
            "description": f"Function {func} in {rel_file}"
        })
    for cls in ast_result.get('classes', []):
        # You may want to add class line numbers if available
        node_id = f"{base_file_name}.{cls}"
        nodes.append({
            "id": node_id,
            "function_name": cls,
            "file": rel_file,
            "line_start": None,
            "line_end": None,
            "description": f"Class {cls} in {rel_file}"
        })

    # 2. Edges for function calls (with deduplication)
    edge_idx = 0
    seen_edges = set()  # Track unique source-target pairs
    
    for caller, callees in ast_result.get('function_calls', {}).items():
        source_id = f"{base_file_name}.{caller}"
        for callee in callees:
            # If callee is declared in this file, use local node id
            if callee in ast_result.get('functions', []) or callee in ast_result.get('classes', []):
                target_id = f"{base_file_name}.{callee}"
            else:
                # Imported or external: use import notation if possible
                target_id = callee  # You may want to resolve to 'A.B.C' if imported
            
            # Create a unique key for this edge
            edge_key = (source_id, target_id)
            
            # Only add if we haven't seen this edge before
            if edge_key not in seen_edges:
                seen_edges.add(edge_key)
                edges.append({
                    "id": f"{base_file_name}.e{edge_idx}",
                    "source": source_id,
                    "target": target_id,
                })
                edge_idx += 1

    return {
        "nodes": nodes,
        "edges": edges
    }


def generate_call_graph(file_paths: List[str], project_root: str = None) -> Dict[str, Dict[str, Any]]:
    """
    Generate a comprehensive call graph from multiple Python files.
    
    Args:
        file_paths: List of Python file paths to analyze
        project_root: Root directory of the project (for relative paths)
        
    Returns:
        Dict in cg_json_output_all.json format
    """
    from .import_analyzer import analyze_imports
    
    call_graph = {}
    
    # First pass: collect all functions and imports from all files
    all_functions = {}  # file_name -> functions
    all_imports = {}    # file_name -> imports
    
    for file_path in file_paths:
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
                
            # Analyze AST
            ast_result = analyze_python_ast(content)
            
            # Analyze imports
            import_result = analyze_imports(content)
            
            file_name = os.path.splitext(os.path.basename(file_path))[0]
            all_functions[file_name] = ast_result.get('functions', [])
            all_imports[file_name] = {
                'imports': import_result.get('imports', []),
                'detailed_dependencies': import_result.get('detailed_dependencies', [])
            }
            
        except Exception as e:
            print(f"Error processing {file_path}: {e}")
            continue
    
    # Second pass: resolve function calls and create call graph
    for file_path in file_paths:
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
                
            ast_result = analyze_python_ast(content)
            import_result = analyze_imports(content)
            
            # Convert to relative path if project_root is provided
            rel_path = file_path
            if project_root:
                rel_path = os.path.relpath(file_path, project_root)
            
            # Generate nodes
            nodes = []
            file_name = os.path.splitext(os.path.basename(file_path))[0]
            
            for func in ast_result.get('functions', []):
                lines = ast_result.get('function_lines', {}).get(func, {})
                node_id = f"{file_name}.{func}"
                
                # Generate description based on function content
                description = f"Function {func}"
                if lines.get('start') and lines.get('end'):
                    line_count = lines['end'] - lines['start'] + 1
                    description = f"Function {func} ({line_count} lines)"
                
                nodes.append({
                    "id": node_id,
                    "function_name": func,
                    "file": rel_path,
                    "line_start": lines.get('start'),
                    "line_end": lines.get('end'),
                    "description": description
                })
            
            # Generate edges (with deduplication)
            edges = []
            edge_idx = 0
            seen_edges = set()  # Track unique source-target pairs
            
            for caller, callees in ast_result.get('function_calls', {}).items():
                source_id = f"{file_name}.{caller}"
                
                for callee in callees:
                    target_id = _resolve_function_call(
                        callee, 
                        file_name, 
                        all_functions, 
                        all_imports[file_name]['detailed_dependencies']
                    )
                    
                    # Skip if target_id is None (built-in function)
                    if target_id is not None:
                        # Create a unique key for this edge
                        edge_key = (source_id, target_id)
                        
                        # Only add if we haven't seen this edge before
                        if edge_key not in seen_edges:
                            seen_edges.add(edge_key)
                            edges.append({
                                "id": f"{file_name}.e{edge_idx}",
                                "source": source_id,
                                "target": target_id
                            })
                            edge_idx += 1
            
            # Normalize the file path to avoid .. in the JSON keys
            normalized_file_path = os.path.abspath(file_path)
            call_graph[normalized_file_path] = {
                "nodes": nodes,
                "edges": edges
            }
            
        except Exception as e:
            print(f"Error processing {file_path}: {e}")
            continue
    
    return call_graph


def _resolve_function_call(callee: str, current_file: str, all_functions: Dict[str, List[str]], 
                          imports: List[Dict[str, Any]]) -> str:
    """
    Resolve a function call to its proper module.function format.
    
    Args:
        callee: Function name being called (can be 'func' or 'module.func')
        current_file: Current file name (without extension)
        all_functions: All functions by file
        imports: Import dependencies for current file
        
    Returns:
        Resolved function identifier or None if it's a built-in function
    """
    builtin_filter = BuiltinFilter()
    
    # Check if callee is already in module.function format
    if '.' in callee:
        module_name, func_name = callee.split('.', 1)
        
        # Skip built-in functions
        if builtin_filter.should_exclude_call(func_name, module_name):
            return None
        
        # Check if this is a local module
        if module_name in all_functions and func_name in all_functions[module_name]:
            return f"{module_name}.{func_name}"
        
        # Return as is for external modules
        return callee
    
    # Handle single function name
    # Skip built-in functions
    if builtin_filter.should_exclude_call(callee):
        return None
    
    # Check if it's a local function
    if callee in all_functions.get(current_file, []):
        return f"{current_file}.{callee}"
    
    # Check if it's an imported function
    for imp in imports:
        if callee in imp.get('imports', []):
            module = imp['module']
            
            # Skip if it's from a standard library module
            if builtin_filter.is_stdlib_module(module):
                return None
            
            # Try to resolve to local files first
            module_name = module.split('.')[-1]  # Get last part of module
            if module_name in all_functions:
                return f"{module_name}.{callee}"
            else:
                return f"{module}.{callee}"
    
    # Return as-is if can't resolve (external library)
    return callee


async def analyze_project_call_graph(project_path: str, exclude_patterns: List[str] = None) -> Dict[str, Dict[str, Any]]:
    """
    Analyze call graph for an entire Python project.
    
    Args:
        project_path: Root path of the Python project
        exclude_patterns: Patterns to exclude (e.g., ['test_*', '__pycache__'])
        
    Returns:
        Complete call graph in cg_json_output_all.json format
    """
    import glob
    import json
    
    if exclude_patterns is None:
        exclude_patterns = ['test_*', '__pycache__', '.*', 'venv', 'env', 'build', 'dist']
    
    # Find all Python files
    python_files = []
    for root, dirs, files in os.walk(project_path):
        # Filter out excluded directories
        dirs[:] = [d for d in dirs if not any(d.startswith(pattern.rstrip('*')) for pattern in exclude_patterns)]
        
        for file in files:
            if file.endswith('.py') and not any(file.startswith(pattern.rstrip('*')) for pattern in exclude_patterns):
                python_files.append(os.path.join(root, file))
    
    # Generate call graph
    call_graph = generate_call_graph(python_files, project_path)
    
    # Determine workspace root (go up directories to find backend folder)
    current_path = os.path.abspath(project_path)
    workspace_root = os.path.join(current_path, "..")
    
    # Save to artifacts directory
    artifacts_dir = os.path.join(workspace_root, 'backend', 'app', 'artifacts')
    os.makedirs(artifacts_dir, exist_ok=True)
    
    output_file = os.path.join(artifacts_dir, 'cg_json_output_all.json')
    call_graph_json_str = ""
    try:
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(call_graph, f, indent=2, ensure_ascii=False)
            call_graph_json_str = json.dumps(call_graph, indent=4, ensure_ascii=False)
        print(f"Call graph saved to: {output_file}")
    except Exception as e:
        print(f"Error saving call graph to {output_file}: {e}")
    
    return call_graph_json_str


def extract_function_description(node: ast.FunctionDef, content_lines: List[str]) -> str:
    """
    Extract a meaningful description from a function definition.
    
    Args:
        node: AST FunctionDef node
        content_lines: Source code lines
        
    Returns:
        Function description
    """
    # Check for docstring
    if (node.body and 
        isinstance(node.body[0], ast.Expr) and 
        isinstance(node.body[0].value, (ast.Str, ast.Constant))):
        
        docstring = node.body[0].value
        if isinstance(docstring, ast.Str):
            doc_text = docstring.s
        elif isinstance(docstring, ast.Constant) and isinstance(docstring.value, str):
            doc_text = docstring.value
        else:
            doc_text = ""
            
        # Return first line of docstring
        if doc_text:
            first_line = doc_text.strip().split('\n')[0]
            return first_line[:100] + "..." if len(first_line) > 100 else first_line
    
    # Analyze function signature and body for description
    func_name = node.name
    arg_count = len(node.args.args)
    
    # Look at function body to infer purpose
    body_info = []
    if node.body:
        # Check for common patterns
        has_return = any(isinstance(stmt, ast.Return) for stmt in ast.walk(node))
        has_if = any(isinstance(stmt, ast.If) for stmt in ast.walk(node))
        has_loop = any(isinstance(stmt, (ast.For, ast.While)) for stmt in ast.walk(node))
        
        if has_return:
            body_info.append("returns value")
        if has_if:
            body_info.append("conditional logic")
        if has_loop:
            body_info.append("iterative processing")
    
    # Generate description
    description = f"Function {func_name}"
    if arg_count > 0:
        description += f" with {arg_count} parameter{'s' if arg_count > 1 else ''}"
    
    if body_info:
        description += f", {', '.join(body_info)}"
    
    return description


def enhanced_function_visitor(content: str) -> Dict[str, Any]:
    """
    Enhanced function visitor that extracts more detailed information.
    """
    try:
        tree = ast.parse(content)
        content_lines = content.split('\n')
        
        visitor = FunctionVisitor()
        visitor.visit(tree)
        
        # Enhance function descriptions
        enhanced_functions = {}
        for func_def in ast.walk(tree):
            if isinstance(func_def, ast.FunctionDef):
                description = extract_function_description(func_def, content_lines)
                enhanced_functions[func_def.name] = description
        
        result = {
            'functions': visitor.functions,
            'function_calls': dict(visitor.function_calls),
            'function_lines': visitor.function_lines,
            'exports': visitor.exports,
            'classes': visitor.classes,
            'class_methods': dict(visitor.class_methods),
            'variables': visitor.variables,
            'variable_dependencies': dict(visitor.variable_dependencies),
            'function_descriptions': enhanced_functions
        }
        
        return result
        
    except SyntaxError as e:
        return {
            'error': str(e),
            'functions': [],
            'function_calls': {},
            'function_lines': {},
            'exports': [],
            'classes': [],
            'class_methods': {},
            'variables': [],
            'variable_dependencies': {},
            'function_descriptions': {}
        }


class BuiltinFilter:
    """Filter for Python built-in and standard library functions."""
    
    def __init__(self):
        # Core built-in functions
        self.core_builtins = {
            'print', 'len', 'range', 'str', 'int', 'float', 'bool', 'list', 'dict', 'set', 'tuple',
            'abs', 'all', 'any', 'ascii', 'bin', 'callable', 'chr', 'classmethod', 'compile',
            'complex', 'delattr', 'dir', 'divmod', 'enumerate', 'eval', 'exec', 'filter',
            'format', 'frozenset', 'getattr', 'globals', 'hasattr', 'hash', 'help', 'hex',
            'id', 'input', 'isinstance', 'issubclass', 'iter', 'locals', 'map', 'max', 'min',
            'next', 'object', 'oct', 'open', 'ord', 'pow', 'property', 'repr', 'reversed',
            'round', 'setattr', 'slice', 'sorted', 'staticmethod', 'sum', 'super', 'type',
            'vars', 'zip', '__import__'
        }
        
        # Common method names from built-in types
        self.builtin_methods = {
            'append', 'extend', 'insert', 'remove', 'pop', 'clear', 'index', 'count', 'sort',
            'reverse', 'copy', 'join', 'split', 'replace', 'strip', 'lstrip', 'rstrip',
            'upper', 'lower', 'title', 'capitalize', 'startswith', 'endswith', 'find', 'rfind',
            'keys', 'values', 'items', 'get', 'update', 'setdefault', 'popitem',
            'add', 'discard', 'union', 'intersection', 'difference', 'symmetric_difference',
            'issubset', 'issuperset', 'isdisjoint'
        }
        
        # Standard library modules that we often don't want to track
        self.stdlib_modules = {
            'os', 'sys', 'json', 're', 'math', 'random', 'datetime', 'time', 'collections',
            'itertools', 'functools', 'operator', 'pathlib', 'urllib', 'http', 'socket',
            'threading', 'multiprocessing', 'subprocess', 'shutil', 'glob', 'pickle',
            'csv', 'xml', 'html', 'email', 'logging', 'unittest', 'argparse', 'configparser'
        }
        
        # Common functions from standard library modules
        self.stdlib_functions = {
            # os module
            'getcwd', 'chdir', 'listdir', 'makedirs', 'removedirs', 'rename', 'rmdir',
            'walk', 'path', 'environ', 'getenv',
            # sys module
            'exit', 'argv', 'platform', 'version_info',
            # json module
            'dumps', 'loads', 'dump', 'load',
            # re module
            'match', 'search', 'findall', 'finditer', 'sub', 'subn', 'compile',
            # math module
            'sqrt', 'sin', 'cos', 'tan', 'log', 'log10', 'exp', 'ceil', 'floor', 'pi', 'e',
            # random module
            'random', 'randint', 'choice', 'choices', 'sample', 'shuffle', 'seed',
            # datetime module
            'now', 'today', 'strftime', 'strptime',
            # time module
            'sleep', 'time', 'localtime', 'gmtime', 'mktime',
            # pathlib
            'exists', 'is_file', 'is_dir', 'mkdir', 'rmdir', 'iterdir', 'glob', 'rglob'
        }
    
    def is_builtin(self, func_name: str) -> bool:
        """Check if a function name is a built-in function."""
        return (func_name in self.core_builtins or 
                func_name in self.builtin_methods or 
                func_name in self.stdlib_functions)
    
    def is_stdlib_module(self, module_name: str) -> bool:
        """Check if a module is a standard library module."""
        return module_name in self.stdlib_modules
    
    def should_exclude_call(self, func_name: str, module_name: str = None) -> bool:
        """
        Determine if a function call should be excluded from the call graph.
        
        Args:
            func_name: Name of the function being called
            module_name: Module the function belongs to (if known)
            
        Returns:
            True if the call should be excluded
        """
        # Always exclude core built-ins
        if self.is_builtin(func_name):
            return True
        
        # Exclude calls from standard library modules
        if module_name and self.is_stdlib_module(module_name):
            return True
        
        # Exclude private/magic methods
        if func_name.startswith('_'):
            return True
        
        return False