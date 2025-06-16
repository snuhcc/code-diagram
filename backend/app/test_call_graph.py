#!/usr/bin/env python3
"""
Test script for call graph generation using AST and import analyzers.
"""

import json
import os
import sys
from pathlib import Path

# Add the analyzers directory to the path
sys.path.append(os.path.join(os.path.dirname(__file__), 'analyzers'))

from analyzers.ast_analyzer import analyze_project_call_graph, generate_call_graph
from analyzers.import_analyzer import analyze_imports

def test_poc_directory():
    """Test call graph generation on the poc directory."""
    
    # Get the poc directory path
    workspace_root = Path(__file__).parent.parent.parent  # Go up to workspace root
    poc_dir = workspace_root / "poc"
    
    if not poc_dir.exists():
        print(f"POC directory not found: {poc_dir}")
        return
    
    print(f"Analyzing POC directory: {poc_dir}")
    
    # Generate call graph
    try:
        call_graph = analyze_project_call_graph(str(poc_dir))
        
        # Save the result
        output_file = Path(__file__).parent / "artifacts" / "test_call_graph_output.json"
        output_file.parent.mkdir(exist_ok=True)
        
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(call_graph, f, indent=2, ensure_ascii=False)
        
        # Also save as test_poc_directory.json in the same directory as this script
        poc_output_file = Path(__file__).parent / "test_poc_directory.json"
        with open(poc_output_file, 'w', encoding='utf-8') as f:
            json.dump(call_graph, f, indent=2, ensure_ascii=False)
        
        print(f"Call graph saved to: {output_file}")
        print(f"POC directory results also saved to: {poc_output_file}")
        
        # Print summary
        total_files = len(call_graph)
        total_nodes = sum(len(data['nodes']) for data in call_graph.values())
        total_edges = sum(len(data['edges']) for data in call_graph.values())
        
        print(f"\nSummary:")
        print(f"  Files analyzed: {total_files}")
        print(f"  Total functions: {total_nodes}")
        print(f"  Total function calls: {total_edges}")
        
        # Show some examples
        print(f"\nExample output:")
        for file_path, data in list(call_graph.items())[:2]:
            print(f"\nFile: {file_path}")
            print(f"  Nodes: {len(data['nodes'])}")
            print(f"  Edges: {len(data['edges'])}")
            if data['nodes']:
                print(f"  Example node: {data['nodes'][0]}")
            if data['edges']:
                print(f"  Example edge: {data['edges'][0]}")
        
    except Exception as e:
        print(f"Error generating call graph: {e}")
        import traceback
        traceback.print_exc()

def test_single_file():
    """Test call graph generation on a single file."""
    
    workspace_root = Path(__file__).parent.parent.parent
    test_file = workspace_root / "poc" / "main.py"
    
    if not test_file.exists():
        print(f"Test file not found: {test_file}")
        return
    
    print(f"Analyzing single file: {test_file}")
    
    try:
        # Test the generate_call_graph function with a single file
        call_graph = generate_call_graph([str(test_file)], str(workspace_root))
        
        # Print the result
        print("\nSingle file call graph:")
        print(json.dumps(call_graph, indent=2))
        
    except Exception as e:
        print(f"Error analyzing single file: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    print("Testing Call Graph Generation")
    print("=" * 50)
    
    # Test single file first
    test_single_file()
    
    print("\n" + "=" * 50)
    
    # Test entire POC directory
    test_poc_directory()
