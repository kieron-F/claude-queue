const SysTray = require('systray2').default;
const http = require('http');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { QUEUE_FILE, readQueue, removeJob, clearDone } = require('./queue');
const open = require('open');

const PORT = 51477; // Random high port for local UI

// --- Tray icon ---
// Load from icon file, or fall back to generated icon
const ICON = loadIcon();

function loadIcon() {
  const iconPath = path.join(__dirname, 'icon.ico');
  if (fs.existsSync(iconPath)) {
    return fs.readFileSync(iconPath).toString('base64');
  }
  // Fallback: generate a simple N-Zyte-inspired icon (lightning bolt shape)
  return generateIcon();
}

function generateIcon() {
  const width = 16, height = 16;
  const pixels = Buffer.alloc(width * height * 4);

  // Draw a simplified N-Zyte bolt/zigzag shape on dark bg
  // The N-Zyte logo is a Z-like lightning bolt
  const shape = [
    '................',
    '..XXXXXXXXXXXX..',
    '..XXXXXXXXXXX...',
    '..........XXX...',
    '.........XXX....',
    '........XXX.....',
    '.......XXX......',
    '......XXX.......',
    '.....XXX........',
    '....XXX.........',
    '...XXX..........',
    '...XXX..........',
    '..XXXXXXXXXXXX..',
    '..XXXXXXXXXXXX..',
    '................',
    '................',
  ];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = ((height - 1 - y) * width + x) * 4;
      if (shape[y] && shape[y][x] === 'X') {
        // Light grey like VS Code icon: #CCCCCC
        pixels[i] = 0xcc; pixels[i+1] = 0xcc; pixels[i+2] = 0xcc; pixels[i+3] = 0xff;
      } else {
        // Transparent
        pixels[i] = 0; pixels[i+1] = 0; pixels[i+2] = 0; pixels[i+3] = 0;
      }
    }
  }

  // Build ICO
  const bmpInfoSize = 40;
  const imageSize = width * height * 4;
  const maskSize = Math.ceil(width / 32) * 4 * height;
  const dataSize = bmpInfoSize + imageSize + maskSize;
  const ico = Buffer.alloc(6 + 16 + dataSize);
  let o = 0;
  ico.writeUInt16LE(0, o); o += 2;
  ico.writeUInt16LE(1, o); o += 2;
  ico.writeUInt16LE(1, o); o += 2;
  ico[o++] = width; ico[o++] = height; ico[o++] = 0; ico[o++] = 0;
  ico.writeUInt16LE(1, o); o += 2;
  ico.writeUInt16LE(32, o); o += 2;
  ico.writeUInt32LE(dataSize, o); o += 4;
  ico.writeUInt32LE(22, o); o += 4;
  ico.writeUInt32LE(bmpInfoSize, o); o += 4;
  ico.writeInt32LE(width, o); o += 4;
  ico.writeInt32LE(height * 2, o); o += 4;
  ico.writeUInt16LE(1, o); o += 2;
  ico.writeUInt16LE(32, o); o += 2;
  ico.writeUInt32LE(0, o); o += 4;
  ico.writeUInt32LE(imageSize + maskSize, o); o += 4;
  o += 16;
  pixels.copy(ico, o);
  return ico.toString('base64');
}

// --- HTTP server for popup UI ---
function startServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fs.readFileSync(path.join(__dirname, 'ui', 'index.html'), 'utf-8'));
    } else if (req.url === '/api/queue') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(readQueue()));
    } else if (req.url === '/api/focus' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const { repoPath } = JSON.parse(body);
          focusVSCodeWindow(repoPath);
          res.writeHead(200); res.end('ok');
        } catch (e) { console.error('Focus parse error:', e.message, 'body:', body); res.writeHead(400); res.end('bad request'); }
      });
    } else if (req.url === '/api/dismiss' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const { repoPath } = JSON.parse(body);
          removeJob(repoPath);
          res.writeHead(200); res.end('ok');
        } catch { res.writeHead(400); res.end('bad request'); }
      });
    } else if (req.url === '/api/clear-done' && req.method === 'POST') {
      clearDone();
      res.writeHead(200); res.end('ok');
    } else {
      res.writeHead(404); res.end('not found');
    }
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Claude Queue UI: http://127.0.0.1:${PORT}`);
  });

  return server;
}

// --- Focus VS Code window ---
function focusVSCodeWindow(repoPath) {
  const repoName = path.basename(repoPath).replace(/'/g, "''");
  const os = require('os');
  const scriptPath = path.join(os.tmpdir(), 'claude-queue-focus.ps1');

  const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Focus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$$procs = Get-Process -Name "Code" -ErrorAction SilentlyContinue | Where-Object { $$_.MainWindowTitle -like "*${repoName}*" }
if ($$procs) {
  $$hwnd = $$procs[0].MainWindowHandle
  [Win32Focus]::ShowWindow($$hwnd, 9) | Out-Null
  [Win32Focus]::SetForegroundWindow($$hwnd) | Out-Null
}
`.replace(/\$\$/g, '$');

  fs.writeFileSync(scriptPath, psScript, 'utf-8');
  exec(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, (err) => {
    if (err) console.error('Focus error:', err.message);
  });
}

// --- Build tray menu ---
function buildMenu() {
  const queue = readQueue();
  const jobs = queue.jobs || [];

  const waiting = jobs.filter(j => j.status === 'waiting');
  const working = jobs.filter(j => j.status === 'working');

  const items = [];

  if (waiting.length > 0) {
    items.push({ title: `--- ${waiting.length} WAITING ---`, enabled: false });
    for (const job of waiting) {
      items.push({
        title: `  ${job.repo}: ${job.message || 'Waiting'}`,
        tooltip: job.repoPath,
        enabled: true,
      });
    }
  }

  if (working.length > 0) {
    items.push({ title: `--- ${working.length} Working ---`, enabled: false });
    for (const job of working) {
      items.push({
        title: `  ${job.repo}: ${job.message || 'Working...'}`,
        tooltip: job.repoPath,
        enabled: true,
      });
    }
  }

  if (jobs.length === 0) {
    items.push({ title: 'No active sessions', enabled: false });
  }

  items.push({ title: '---', enabled: false });
  items.push({ title: 'Open Dashboard', enabled: true });
  items.push({ title: 'Clear Done', enabled: true });
  items.push({ title: '---', enabled: false });
  items.push({ title: 'Quit', enabled: true });

  return items;
}

// --- Main ---
async function main() {
  startServer();

  const items = buildMenu();

  const systray = new SysTray({
    menu: {
      icon: ICON,
      title: '',
      tooltip: 'Claude Queue',
      items
    },
    debug: false,
    copyDir: true,
  });

  systray.onClick(action => {
    const title = action.item.title.trim();

    if (title === 'Quit') {
      systray.kill();
      process.exit(0);
    } else if (title === 'Open Dashboard') {
      open(`http://127.0.0.1:${PORT}`);
    } else if (title === 'Clear Done') {
      clearDone();
      refreshMenu(systray);
    } else if (action.item.tooltip) {
      // It's a job — focus that window
      focusVSCodeWindow(action.item.tooltip);
    }
  });

  // Watch queue file and refresh menu
  let debounce = null;
  fs.watch(QUEUE_FILE, () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => refreshMenu(systray), 500);
  });

  console.log('Claude Queue tray app running. Right-click the tray icon to see sessions.');
}

function refreshMenu(systray) {
  const items = buildMenu();
  // systray2 doesn't support full menu rebuild easily,
  // so we update item titles
  items.forEach((item, i) => {
    try {
      systray.sendAction({
        type: 'update-item',
        item: { ...item, __id: i },
        seq_id: i,
      });
    } catch { /* ignore */ }
  });
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
