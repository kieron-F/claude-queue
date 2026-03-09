const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');

const QUEUE_FILE = path.join(os.homedir(), '.claude', 'job-queue.json');

function readQueue() {
  try {
    return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8'));
  } catch {
    return { jobs: [] };
  }
}

function removeJob(repoPath) {
  const data = readQueue();
  data.jobs = data.jobs.filter(j => j.repoPath !== repoPath);
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(data, null, 2));
}

class QueueViewProvider {
  constructor(extensionUri) {
    this._extensionUri = extensionUri;
    this._view = null;
    this._watcher = null;
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true
    };

    webviewView.webview.html = this._getHtml();

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(message => {
      if (message.command === 'focus') {
        // Open that folder in VS Code
        const uri = vscode.Uri.file(message.repoPath);
        vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: false });
      } else if (message.command === 'dismiss') {
        removeJob(message.repoPath);
      } else if (message.command === 'refresh') {
        this._sendUpdate();
      }
    });

    // Watch queue file for changes
    this._startWatching();
    this._sendUpdate();
  }

  _startWatching() {
    try {
      const dir = path.dirname(QUEUE_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (!fs.existsSync(QUEUE_FILE)) {
        fs.writeFileSync(QUEUE_FILE, JSON.stringify({ jobs: [] }, null, 2));
      }

      let debounce = null;
      this._watcher = fs.watch(QUEUE_FILE, () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => this._sendUpdate(), 200);
      });
    } catch (e) {
      console.error('Queue watcher error:', e);
    }
  }

  _sendUpdate() {
    if (this._view) {
      const queue = readQueue();
      this._view.webview.postMessage({ type: 'update', queue });
    }
  }

  _getHtml() {
    return `<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    padding: 8px;
  }
  .job {
    padding: 8px 10px;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }
  .job:hover { background: var(--vscode-list-hoverBackground); }
  .indicator {
    width: 8px; height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .indicator.waiting { background: #f9e2af; }
  .indicator.working { background: #89b4fa; animation: pulse 2s infinite; }
  .indicator.done { background: #a6e3a1; }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
  .info { flex: 1; min-width: 0; }
  .repo {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .message {
    font-size: 0.85em;
    opacity: 0.7;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 2px;
  }
  .time { font-size: 0.8em; opacity: 0.5; flex-shrink: 0; }
  .dismiss {
    opacity: 0;
    background: none;
    border: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    font-size: 14px;
    padding: 2px 4px;
    border-radius: 3px;
  }
  .job:hover .dismiss { opacity: 0.5; }
  .dismiss:hover { opacity: 1 !important; color: #f38ba8; }
  .empty {
    text-align: center;
    opacity: 0.4;
    padding: 20px;
    font-size: 0.9em;
  }
</style>
</head>
<body>
  <div id="jobs"></div>
  <script>
    const vscode = acquireVsCodeApi();
    const statusOrder = { waiting: 0, working: 1, done: 2 };

    function timeAgo(ts) {
      const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
      if (mins < 1) return 'now';
      if (mins < 60) return mins + 'm';
      const hrs = Math.floor(mins / 60);
      return hrs < 24 ? hrs + 'h' : Math.floor(hrs/24) + 'd';
    }

    function render(queue) {
      const el = document.getElementById('jobs');
      const jobs = (queue.jobs || []).sort((a,b) => {
        const d = (statusOrder[a.status]||9) - (statusOrder[b.status]||9);
        return d !== 0 ? d : new Date(b.timestamp) - new Date(a.timestamp);
      });

      if (!jobs.length) {
        el.innerHTML = '<div class="empty">No active sessions</div>';
        return;
      }

      el.innerHTML = jobs.map(j => \`
        <div class="job" onclick="focusWindow('\${j.repoPath.replace(/\\\\/g,'\\\\\\\\')}')">
          <div class="indicator \${j.status}"></div>
          <div class="info">
            <div class="repo">\${j.repo}</div>
            <div class="message">\${j.message || j.status}</div>
          </div>
          <div class="time">\${timeAgo(j.timestamp)}</div>
          <button class="dismiss" onclick="event.stopPropagation(); dismiss('\${j.repoPath.replace(/\\\\/g,'\\\\\\\\')}')">x</button>
        </div>
      \`).join('');
    }

    function focusWindow(p) { vscode.postMessage({ command: 'focus', repoPath: p }); }
    function dismiss(p) { vscode.postMessage({ command: 'dismiss', repoPath: p }); }

    window.addEventListener('message', e => {
      if (e.data.type === 'update') render(e.data.queue);
    });

    vscode.postMessage({ command: 'refresh' });
    setInterval(() => vscode.postMessage({ command: 'refresh' }), 5000);
  </script>
</body>
</html>`;
  }

  dispose() {
    if (this._watcher) this._watcher.close();
  }
}

function activate(context) {
  const provider = new QueueViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('claudeQueue.panel', provider)
  );

  context.subscriptions.push({ dispose: () => provider.dispose() });
}

function deactivate() {}

module.exports = { activate, deactivate };
