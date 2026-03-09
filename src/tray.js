const { app, Tray, BrowserWindow, ipcMain, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { QUEUE_FILE, readQueue, removeJob, clearDone } = require('./queue');
const { exec } = require('child_process');

let tray = null;
let popup = null;
let watcher = null;

function createTrayIcon() {
  // Create a simple colored icon programmatically
  const size = 16;
  const canvas = nativeImage.createEmpty();

  // We'll use a template icon file — create it if missing
  const iconPath = path.join(__dirname, 'icon.png');
  if (!fs.existsSync(iconPath)) {
    // Create a simple 16x16 icon using raw pixel data
    createIcon(iconPath);
  }

  return nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
}

function createIcon(iconPath) {
  // Generate a minimal PNG (16x16 solid circle)
  // Using raw PNG generation for a simple tray icon
  const { createCanvas } = tryRequireCanvas();
  if (createCanvas) {
    const canvas = createCanvas(16, 16);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#7c3aed';
    ctx.beginPath();
    ctx.arc(8, 8, 7, 0, Math.PI * 2);
    ctx.fill();
    fs.writeFileSync(iconPath, canvas.toBuffer('image/png'));
  } else {
    // Fallback: copy a minimal PNG (purple dot)
    // We'll create a 1x1 purple PNG as absolute fallback
    const minimalPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMElEQVQ4T2N0' +
      'Yvj/nwEPYMIniE8dwyBzAV5v4AvDUReM+gUjJBnR4YLPmwPuAgDLqA0RFRG3' +
      'uQAAAABJRU5ErkJggg==',
      'base64'
    );
    fs.writeFileSync(iconPath, minimalPng);
  }
}

function tryRequireCanvas() {
  try { return require('canvas'); } catch { return {}; }
}

function createPopup() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  popup = new BrowserWindow({
    width: 380,
    height: 500,
    x: screenWidth - 400,
    y: screenHeight - 520,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    transparent: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  popup.loadFile(path.join(__dirname, 'ui', 'index.html'));

  popup.on('blur', () => {
    popup.hide();
  });
}

function togglePopup() {
  if (popup.isVisible()) {
    popup.hide();
  } else {
    // Reposition near tray
    const trayBounds = tray.getBounds();
    const popupBounds = popup.getBounds();
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

    const x = Math.min(trayBounds.x - popupBounds.width / 2, screenWidth - popupBounds.width);
    const y = screenHeight - popupBounds.height - 10;

    popup.setPosition(Math.max(0, Math.round(x)), Math.round(y));
    popup.show();
    popup.focus();
    sendQueueToPopup();
  }
}

function sendQueueToPopup() {
  if (popup && popup.isVisible()) {
    const queue = readQueue();
    popup.webContents.send('queue-update', queue);
  }
}

function updateTrayTooltip() {
  const queue = readQueue();
  const waiting = queue.jobs.filter(j => j.status === 'waiting').length;
  const working = queue.jobs.filter(j => j.status === 'working').length;

  let tooltip = 'Claude Queue';
  if (waiting > 0) tooltip += ` | ${waiting} waiting`;
  if (working > 0) tooltip += ` | ${working} working`;

  tray.setToolTip(tooltip);
}

function focusVSCodeWindow(repoPath) {
  const repoName = path.basename(repoPath);
  // PowerShell script to find and focus VS Code window by repo name
  const psScript = `
    Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      public class Win32 {
        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
      }
"@
    $procs = Get-Process | Where-Object { $_.MainWindowTitle -like "*${repoName}*Visual Studio Code*" }
    if ($procs) {
      $hwnd = $procs[0].MainWindowHandle
      [Win32]::ShowWindow($hwnd, 9)
      [Win32]::SetForegroundWindow($hwnd)
    }
  `.replace(/\n/g, ' ');

  exec(`powershell -Command "${psScript}"`, (err) => {
    if (err) console.error('Focus error:', err.message);
  });
}

function watchQueueFile() {
  // Ensure file exists
  readQueue();

  let debounce = null;
  watcher = fs.watch(QUEUE_FILE, () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      updateTrayTooltip();
      sendQueueToPopup();
    }, 200);
  });
}

app.whenReady().then(() => {
  // Single instance lock
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }

  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('Claude Queue');

  tray.on('click', () => togglePopup());

  createPopup();
  watchQueueFile();
  updateTrayTooltip();

  // IPC handlers
  ipcMain.on('focus-window', (_, repoPath) => {
    focusVSCodeWindow(repoPath);
    popup.hide();
  });

  ipcMain.on('remove-job', (_, repoPath) => {
    removeJob(repoPath);
  });

  ipcMain.on('clear-done', () => {
    clearDone();
  });

  ipcMain.on('refresh', () => {
    sendQueueToPopup();
  });
});

app.on('window-all-closed', (e) => {
  e.preventDefault(); // Keep running in tray
});

app.on('before-quit', () => {
  if (watcher) watcher.close();
});
