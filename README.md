# Claude Queue

A system tray app + VS Code sidebar that shows all your active Claude Code sessions in one place. See which sessions are waiting for input, click to jump straight there.

Built for developers running multiple Claude Code sessions across different repos simultaneously.

![Status: Alpha](https://img.shields.io/badge/status-alpha-orange)

## How It Works

```
Claude Session (repo-1) ──hook──▶ ~/.claude/job-queue.json ◀── Tray App (reads & displays)
Claude Session (repo-2) ──hook──▶                          ◀── VS Code Sidebar (reads & displays)
Claude Session (repo-3) ──hook──▶
```

1. **Claude Code hooks** fire when Claude finishes responding or sends a notification
2. A small script writes the session status to a shared JSON file (`~/.claude/job-queue.json`)
3. The **tray app** watches that file and shows a popup list — click to focus the right VS Code window
4. The **VS Code sidebar** shows the same list inside your editor

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/N-Zyte-Labs/claude-queue.git
cd claude-queue
npm install
```

### 2. Install the hooks

This adds global hooks to your `~/.claude/settings.json` so every Claude Code session reports its status:

```bash
npm run setup
```

### 3. Launch the tray app

```bash
npm start
```

The app appears in your system tray (bottom-right on Windows). Pin it for permanent visibility:

**Settings → Personalization → Taskbar → Other system tray icons** → toggle **Claude Queue** on.

## Usage

- **Click the tray icon** to see all active sessions
- Jobs are sorted: **waiting** (yellow) at the top, **working** (blue, pulsing), **done** (green)
- **Click a job** to focus that VS Code window
- **Hover + X** to dismiss a job
- **Clear done** removes completed sessions

## VS Code Extension (Optional)

The `vscode-ext/` folder contains a sidebar extension that shows the same job queue inside VS Code.

To install locally:

```bash
cd vscode-ext
# Install vsce if you don't have it
npm install -g @vscode/vsce
vsce package
code --install-extension claude-queue-sidebar-1.0.0.vsix
```

## Uninstall

Remove the hooks from your Claude Code settings:

```bash
npm run remove
```

## How the Hooks Work

The setup script adds three hooks to `~/.claude/settings.json`:

| Hook | Fires when | Sets status to |
|------|-----------|---------------|
| `UserPromptSubmit` | You send a message | `working` |
| `Stop` | Claude finishes responding | `waiting` |
| `Notification` | Claude sends a notification | `waiting` |

Each hook runs a tiny Node script that writes one line to `~/.claude/job-queue.json`. No network calls, no external services — everything stays local.

## Queue File Format

`~/.claude/job-queue.json`:

```json
{
  "jobs": [
    {
      "id": "my-repo-1741234567890",
      "repo": "my-repo",
      "repoPath": "C:/Users/you/Code/my-repo",
      "status": "waiting",
      "message": "Waiting for input",
      "timestamp": "2026-03-09T10:30:00.000Z"
    }
  ]
}
```

## Requirements

- Windows 10/11 (window focusing uses Win32 APIs)
- Node.js 18+
- Claude Code CLI

## License

MIT
