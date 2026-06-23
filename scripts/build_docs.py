# Simple static site generator for docs
import sys
import os
from pathlib import Path

def generate_html(doc_path, output_path):
    """Convert markdown doc to simple HTML"""
    with open(doc_path, 'r') as f:
        content = f.read()
    
    # Simple markdown to HTML conversion
    lines = content.split('\n')
    html_lines = ['<!DOCTYPE html>', '<html lang="en">', '<head>', 
                  '<meta charset="UTF-8">', '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
                  '<title>PCP Documentation</title>',
                  '<style>',
                  'body { font-family: system-ui, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; }',
                  'h1, h2, h3 { color: #1f2937; }',
                  'code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; }',
                  'pre { background: #1f2937; color: #f3f4f6; padding: 16px; border-radius: 8px; overflow-x: auto; }',
                  'a { color: #2563eb; }',
                  'table { border-collapse: collapse; width: 100%; }',
                  'th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; }',
                  'th { background: #f9fafb; }',
                  'nav { margin-bottom: 32px; padding: 16px; background: #f9fafb; border-radius: 8px; }',
                  'nav a { margin-right: 16px; }',
                  '</style>',
                  '</head>', '<body>']
    
    # Add navigation
    html_lines.append('<nav>')
    html_lines.append('<strong>PCP Documentation</strong> | ')
    html_lines.append('<a href="readme.md">Home</a> | ')
    html_lines.append('<a href="protocol.md">Protocol</a> | ')
    html_lines.append('<a href="data-model.md">Data Model</a> | ')
    html_lines.append('<a href="deployment-vercel-neon.md">Deploy</a> | ')
    html_lines.append('<a href="security.md">Security</a> | ')
    html_lines.append('<a href="agent-instructions.md">AI Agent Guide</a>')
    html_lines.append('</nav>')
    
    in_code_block = False
    for line in lines:
        if line.startswith('# '):
            html_lines.append(f'<h1>{line[2:]}</h1>')
        elif line.startswith('## '):
            html_lines.append(f'<h2>{line[3:]}</h2>')
        elif line.startswith('### '):
            html_lines.append(f'<h3>{line[4:]}</h3>')
        elif line.startswith('```'):
            if not in_code_block:
                html_lines.append('<pre><code>')
                in_code_block = True
            else:
                html_lines.append('</code></pre>')
                in_code_block = False
        elif in_code_block:
            html_lines.append(line)
        elif line.startswith('- '):
            html_lines.append(f'<li>{line[2:]}</li>')
        elif line.startswith('|'):
            # Table line - will be handled separately
            html_lines.append(line)
        elif line.strip():
            html_lines.append(f'<p>{line}</p>')
        else:
            html_lines.append('<br>')
    
    html_lines.extend(['</body>', '</html>'])
    
    with open(output_path, 'w') as f:
        f.write('\n'.join(html_lines))

def main():
    docs_dir = Path('docs')
    output_dir = Path('docs_html')
    output_dir.mkdir(exist_ok=True)
    
    # Copy README
    readme_md = Path('README.md')
    if readme_md.exists():
        generate_html(readme_md, output_dir / 'index.html')
    
    # Process all markdown files in docs/
    for doc_file in docs_dir.glob('*.md'):
        output_file = output_dir / f'{doc_file.stem}.html'
        generate_html(doc_file, output_file)
    
    print(f'Generated {len(list(docs_dir.glob("*.md"))) + 1} HTML files')

if __name__ == '__main__':
    main()
