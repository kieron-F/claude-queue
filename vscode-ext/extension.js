const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');

const QUEUE_FILE = path.join(os.homedir(), '.claude', 'job-queue.json');

function readQueue() {
  try {
    const raw = fs.readFileSync(QUEUE_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.jobs)) return { jobs: [] };
    return data;
  } catch {
    return { jobs: [] };
  }
}

function removeJob(repoPath) {
  try {
    const data = readQueue();
    data.jobs = data.jobs.filter(j =>
      path.resolve(j.repoPath).toLowerCase() !== path.resolve(repoPath).toLowerCase()
    );
    const tmp = QUEUE_FILE + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, QUEUE_FILE);
  } catch (e) {
    console.error('Claude Queue: removeJob error:', e.message);
  }
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
        const uri = vscode.Uri.file(message.repoPath);
        vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: false });
      } else if (message.command === 'dismiss') {
        removeJob(message.repoPath);
        this._sendUpdate();
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
      console.error('Claude Queue: watcher error:', e.message);
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

  .section-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-descriptionForeground);
    padding: 6px 0 4px;
    opacity: 0.6;
  }
  .section-label:first-child { padding-top: 0; }

  .job {
    padding: 8px 10px;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 3px;
    border-left: 3px solid transparent;
  }
  .job:hover { background: var(--vscode-list-hoverBackground); }
  .job.waiting { border-left-color: #f0a500; }
  .job.working { border-left-color: #4da6ff; }

  .indicator {
    width: 8px; height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .indicator.waiting { background: #f0a500; box-shadow: 0 0 6px rgba(240,165,0,0.4); }
  .indicator.working { background: #4da6ff; animation: pulse 1.5s infinite; }
  .indicator.done { background: #4caf50; }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }

  .info { flex: 1; min-width: 0; }
  .repo {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .message {
    font-size: 0.85em;
    opacity: 0.6;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 2px;
  }

  .time {
    font-size: 0.8em;
    flex-shrink: 0;
  }
  .time.waiting { color: #f0a500; font-weight: 600; }
  .time.working { color: #4da6ff; opacity: 0.7; }
  .time.done { opacity: 0.4; }

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
  .dismiss:hover { opacity: 1 !important; color: #e94560; }

  .empty {
    text-align: center;
    opacity: 0.3;
    padding: 20px;
    font-size: 0.9em;
  }
</style>
</head>
<body>
  <div id="jobs"></div>
  <script>
    const vscodeApi = acquireVsCodeApi();
    const statusOrder = { waiting: 0, working: 1, done: 2 };

    function timeAgo(ts) {
      const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
      if (secs < 60) return 'now';
      const mins = Math.floor(secs / 60);
      if (mins < 60) return mins + 'm';
      const hrs = Math.floor(mins / 60);
      return hrs < 24 ? hrs + 'h' : Math.floor(hrs/24) + 'd';
    }

    function esc(s) {
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
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

      const waiting = jobs.filter(j => j.status === 'waiting');
      const working = jobs.filter(j => j.status === 'working');
      const done = jobs.filter(j => j.status === 'done');
      let html = '';

      if (waiting.length > 0) {
        html += '<div class="section-label">Needs Attention</div>';
        html += waiting.map(j => jobHtml(j, 'waiting')).join('');
      }
      if (working.length > 0) {
        html += '<div class="section-label">Working</div>';
        html += working.map(j => jobHtml(j, 'working')).join('');
      }
      if (done.length > 0) {
        html += '<div class="section-label">Done</div>';
        html += done.map(j => jobHtml(j, 'done')).join('');
      }

      el.innerHTML = html;
    }

    function jobHtml(job, status) {
      // Use data attributes instead of inline string escaping
      const id = btoa(encodeURIComponent(job.repoPath));
      return '<div class="job ' + status + '" data-path="' + id + '" onclick="focusJob(this)">' +
        '<div class="indicator ' + status + '"></div>' +
        '<div class="info">' +
          '<div class="repo">' + esc(job.repo) + '</div>' +
          '<div class="message">' + esc(job.message || status) + '</div>' +
        '</div>' +
        '<div class="time ' + status + '">' + timeAgo(job.timestamp) + '</div>' +
        '<button class="dismiss" data-path="' + id + '" onclick="event.stopPropagation(); dismissJob(this)" title="Dismiss">x</button>' +
      '</div>';
    }

    function decodePath(el) {
      try {
        return decodeURIComponent(atob(el.dataset.path));
      } catch { return ''; }
    }

    function focusJob(el) {
      const p = decodePath(el);
      if (p) vscodeApi.postMessage({ command: 'focus', repoPath: p });
    }

    function dismissJob(el) {
      const p = decodePath(el);
      if (p) vscodeApi.postMessage({ command: 'dismiss', repoPath: p });
    }

    window.addEventListener('message', e => {
      if (e.data.type === 'update') render(e.data.queue);
    });

    vscodeApi.postMessage({ command: 'refresh' });
    setInterval(() => vscodeApi.postMessage({ command: 'refresh' }), 2000);
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
