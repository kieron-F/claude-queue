const SysTray = require('systray2').default;
const http = require('http');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { QUEUE_FILE, readQueue, removeJob, clearDone } = require('./queue');
const open = require('open');

const PORT = 51477;

// --- Tray icon ---
const ICON = loadIcon();

function loadIcon() {
  const iconPath = path.join(__dirname, 'icon.ico');
  if (fs.existsSync(iconPath)) {
    return fs.readFileSync(iconPath).toString('base64');
  }
  return generateIcon();
}

function generateIcon() {
  const width = 16, height = 16;
  const pixels = Buffer.alloc(width * height * 4);

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
        pixels[i] = 0xcc; pixels[i+1] = 0xcc; pixels[i+2] = 0xcc; pixels[i+3] = 0xff;
      } else {
        pixels[i] = 0; pixels[i+1] = 0; pixels[i+2] = 0; pixels[i+3] = 0;
      }
    }
  }

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

// --- HTTP server for dashboard ---
function startServer() {
  const server = http.createServer((req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors); res.end(); return;
    }

    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fs.readFileSync(path.join(__dirname, 'ui', 'index.html'), 'utf-8'));
    } else if (req.url === '/api/queue') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
      res.end(JSON.stringify(readQueue()));
    } else if (req.url === '/api/focus' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const { repoPath } = JSON.parse(body);
          console.log('Focus request for:', repoPath);
          focusVSCodeWindow(repoPath);
          res.writeHead(200, { ...cors }); res.end('ok');
        } catch (e) {
          console.error('Focus error:', e.message);
          res.writeHead(400, cors); res.end('bad request');
        }
      });
    } else if (req.url === '/api/dismiss' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const { repoPath } = JSON.parse(body);
          removeJob(repoPath);
          res.writeHead(200, cors); res.end('ok');
        } catch {
          res.writeHead(400, cors); res.end('bad request');
        }
      });
    } else if (req.url === '/api/clear-done' && req.method === 'POST') {
      clearDone();
      res.writeHead(200, cors); res.end('ok');
    } else {
      res.writeHead(404); res.end('not found');
    }
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Claude Queue dashboard: http://127.0.0.1:${PORT}`);
  });

  return server;
}

// --- Focus VS Code window ---
function focusVSCodeWindow(repoPath) {
  const skip = new Set([
    'c:', 'd:', 'e:', 'users', 'user', 'home', 'kiero', 'danilo',
    'coding', 'code', 'documents', 'desktop', 'downloads',
    'projects', 'repos', 'src', 'dev', 'work', 'github', 'git'
  ]);
  const parts = repoPath.replace(/\\/g, '/').split('/').filter(Boolean);
  const candidates = [];
  const seen = new Set();
  for (let i = parts.length - 1; i >= 0; i--) {
    const seg = parts[i];
    const key = seg.toLowerCase();
    if (!skip.has(key) && !seen.has(key)) {
      seen.add(key);
      candidates.push(seg.replace(/'/g, "''"));
    }
  }
  const repoName = candidates[0] || path.basename(repoPath);
  const osModule = require('os');
  const scriptPath = path.join(osModule.tmpdir(), 'claude-queue-focus.ps1');

  const psScript = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class FocusHelper {
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  public static IntPtr Find(string search) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((hWnd, lParam) => {
      if (!IsWindowVisible(hWnd)) return true;
      int len = GetWindowTextLength(hWnd);
      if (len == 0) return true;
      StringBuilder sb = new StringBuilder(len + 1);
      GetWindowText(hWnd, sb, sb.Capacity);
      if (sb.ToString().IndexOf(search, StringComparison.OrdinalIgnoreCase) >= 0) {
        found = hWnd;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static bool Focus(IntPtr hWnd) {
    uint pid; uint fgPid;
    uint tid = GetWindowThreadProcessId(hWnd, out pid);
    IntPtr fg = GetForegroundWindow();
    uint fgTid = GetWindowThreadProcessId(fg, out fgPid);
    uint myTid = GetCurrentThreadId();
    AttachThreadInput(myTid, fgTid, true);
    AttachThreadInput(myTid, tid, true);
    keybd_event(0xA4, 0, 0, UIntPtr.Zero);
    keybd_event(0xA4, 0, 2, UIntPtr.Zero);
    ShowWindow(hWnd, 3);
    BringWindowToTop(hWnd);
    bool ok = SetForegroundWindow(hWnd);
    AttachThreadInput(myTid, tid, false);
    AttachThreadInput(myTid, fgTid, false);
    return ok;
  }
}
"@
$$candidates = @(${candidates.map(c => '"' + c + '"').join(', ')})
$$focused = $$false
foreach ($$name in $$candidates) {
  $$hwnd = [FocusHelper]::Find($$name)
  if ($$hwnd -ne [IntPtr]::Zero) {
    [FocusHelper]::Focus($$hwnd) | Out-Null
    Write-Output "Focused: $$name"
    $$focused = $$true
    break
  }
}
if (-not $$focused) {
  Write-Output "Not found: ${repoName}"
}
`.replace(/\$\$/g, '$');

  fs.writeFileSync(scriptPath, psScript, 'utf-8');
  exec(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, (err, stdout, stderr) => {
    if (stdout) console.log('Focus result:', stdout.trim());
    if (err) console.error('Focus error:', err.message);
    if (stderr) console.error('Focus stderr:', stderr.trim());
  });
}

// --- Main ---
async function main() {
  startServer();

  // Auto-open dashboard in browser
  const noOpen = process.argv.includes('--no-open');
  if (!noOpen) {
    setTimeout(() => open(`http://127.0.0.1:${PORT}`), 500);
  }

  const systray = new SysTray({
    menu: {
      icon: ICON,
      title: '',
      tooltip: 'Claude Queue',
      items: [
        { title: 'Open Dashboard', enabled: true },
        { title: '---', enabled: false },
        { title: 'Quit', enabled: true }
      ]
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
    }
  });

  console.log('Claude Queue tray app running. Dashboard auto-opens in browser.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
