// Simple markdown preview server for npic-qc-proposal-v1.md
const http = require('http');
const fs = require('fs');
const path = require('path');

const MD_FILE = path.join(__dirname, 'npic-qc-proposal-v1.md');
const PORT = 4321;

const html = (content) => `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NPIC QC 提案</title>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f8f8f6;
      color: #1a1a1a;
      padding: 48px 24px;
    }
    .page {
      max-width: 860px;
      margin: 0 auto;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 2px 24px rgba(0,0,0,0.08);
      padding: 64px 72px;
    }
    h1 { font-size: 2rem; font-weight: 700; margin-bottom: 4px; }
    h2 { font-size: 1.25rem; font-weight: 700; margin-top: 2.5rem; margin-bottom: 0.75rem;
         padding-bottom: 6px; border-bottom: 2px solid #e5e7eb; }
    h3 { font-size: 1rem; font-weight: 700; margin-top: 1.5rem; margin-bottom: 0.5rem; color: #374151; }
    h4 { font-size: 0.9rem; font-weight: 700; margin-top: 1.25rem; margin-bottom: 0.4rem; color: #4b5563; }
    p  { line-height: 1.75; margin-bottom: 0.75rem; font-size: 0.95rem; }
    ul, ol { margin: 0.5rem 0 0.75rem 1.4rem; }
    li { line-height: 1.75; font-size: 0.95rem; margin-bottom: 0.2rem; }
    blockquote {
      margin: 1rem 0;
      padding: 12px 16px;
      border-left: 4px solid #d1d5db;
      background: #f9fafb;
      color: #6b7280;
      border-radius: 0 6px 6px 0;
      font-size: 0.9rem;
    }
    code {
      background: #f3f4f6;
      padding: 1px 5px;
      border-radius: 4px;
      font-family: 'SF Mono', Consolas, monospace;
      font-size: 0.85em;
      color: #1f2937;
    }
    pre {
      background: #1e293b;
      color: #e2e8f0;
      padding: 20px 24px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 1rem 0;
      font-size: 0.82rem;
      line-height: 1.6;
    }
    pre code { background: none; color: inherit; padding: 0; font-size: inherit; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1rem 0;
      font-size: 0.9rem;
    }
    th {
      background: #f1f5f9;
      text-align: left;
      padding: 10px 14px;
      font-weight: 600;
      border: 1px solid #e2e8f0;
    }
    td {
      padding: 9px 14px;
      border: 1px solid #e2e8f0;
      vertical-align: top;
    }
    tr:nth-child(even) td { background: #fafafa; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 2rem 0; }
    strong { font-weight: 700; }
    em { font-style: italic; }
    a { color: #2563eb; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .meta {
      font-size: 0.82rem;
      color: #9ca3af;
      margin-bottom: 2rem;
      line-height: 1.8;
    }
  </style>
</head>
<body>
  <div class="page" id="content"></div>
  <script>
    const md = ${JSON.stringify(content)};
    document.getElementById('content').innerHTML = marked.parse(md);
  </script>
</body>
</html>`;

http.createServer((req, res) => {
  try {
    const content = fs.readFileSync(MD_FILE, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html(content));
  } catch (e) {
    res.writeHead(500);
    res.end('Error: ' + e.message);
  }
}).listen(PORT, () => {
  console.log('Proposal preview running on http://localhost:' + PORT);
});
