# Claude Queue

A web dashboard + system tray app + VS Code sidebar that shows all your active Claude Code sessions in one place. See which sessions need attention, click to jump straight there.

Built for developers running multiple Claude Code sessions across different VS Code instances simultaneously.

## How It Works

```
Claude Session (repo-1) ──hook──▶ ~/.claude/job-queue.json ◀── Web Dashboard (primary UI)
Claude Session (repo-2) ──hook──▶                          ◀── System Tray (launch/quit)
Claude Session (repo-3) ──hook──▶                          ◀── VS Code Sidebar (optional)
```

1. **Claude Code hooks** fire on every prompt submit, stop, and notification
2. A small script writes the session status to `~/.claude/job-queue.json`
3. The **web dashboard** (http://127.0.0.1:51477) shows all sessions with status, timing, and focus buttons
4. The **system tray** icon provides quick access to the dashboard
5. The **VS Code sidebar** (optional) shows the same data inside your editor

## Quick Start

### 1. Install

```bash
cd claude-queue
npm install
```

### 2. Install the hooks

Adds global hooks to `~/.claude/settings.json` so every Claude Code session reports its status:

```bash
npm run setup
```

### 3. Launch

```bash
npm start
```

The dashboard opens automatically in your browser. The tray icon appears in the system tray.

## Commands

| Command | Description |
|---------|-------------|
| `npm start` | Launch tray app + open dashboard |
| `npm run start:silent` | Launch tray app without opening browser |
| `npm run dashboard` | Open dashboard in browser (if tray already running) |
| `npm run setup` | Install Claude Code hooks |
| `npm run remove` | Remove Claude Code hooks |
| `npm run autostart` | Auto-start on Windows login |
| `npm run autostart:remove` | Remove auto-start |

## Dashboard Features

- **Colour-coded cards**: amber = waiting for input, blue = working, green = done
- **Waiting time counter**: shows how long each session has been waiting
- **Desktop notifications**: browser notification when a session transitions to "waiting"
- **One-click focus**: click a card or the Focus button to bring that VS Code window to the foreground
- **Dismiss**: remove stale sessions from the queue
- **Tab title badge**: shows `(N) Claude Queue` when N sessions are waiting
- **Auto-prune**: sessions older than 24 hours are automatically removed

## VS Code Extension (Optional)

The `vscode-ext/` folder contains a sidebar extension.

```bash
cd vscode-ext
npm install -g @vscode/vsce
vsce package
code --install-extension claude-queue-sidebar-1.0.0.vsix
```

## Uninstall

```bash
npm run remove           # Remove hooks
npm run autostart:remove # Remove auto-start (if set up)
```

## How the Hooks Work

| Hook | Fires when | Sets status to |
|------|-----------|---------------|
| `UserPromptSubmit` | You send a message | `working` |
| `Stop` | Claude finishes responding | `waiting` |
| `Notification` | Claude sends a notification | `waiting` |

Each hook runs a tiny Node script that writes to `~/.claude/job-queue.json`. No network calls, no external services — everything stays local. All operations use atomic file writes to prevent corruption.

Hook events are logged to `~/.claude/claude-queue.log` for debugging.

## Troubleshooting

**Dashboard not loading:**
- Check that `npm start` is running (or the tray icon is visible)
- Try `npm run dashboard` to open the URL manually

**Sessions not appearing:**
- Run `npm run setup` to reinstall hooks
- Check `~/.claude/claude-queue.log` for errors
- Verify `~/.claude/settings.json` has the hook entries

**Focus not working:**
- Window focusing uses PowerShell + Win32 APIs — requires Windows 10/11
- The focus logic searches VS Code window titles for the repo name
- Check the tray app console output for "Focus result:" or "Focus error:" messages

**Stale sessions:**
- Sessions auto-prune after 24 hours
- Click the X on any card to dismiss manually
- Click "Clear Done" to remove all completed sessions

## Requirements

- Windows 10/11 (window focusing uses Win32 APIs)
- Node.js 18+
- Claude Code CLI

## License

MIT
