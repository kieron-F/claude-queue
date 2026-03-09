#!/usr/bin/env node

/**
 * Claude Code Hook Script
 *
 * Receives hook event JSON on stdin and updates the shared job queue.
 *
 * stdin includes: session_id, cwd, hook_event_name, plus event-specific fields.
 * - Stop: { hook_event_name: "Stop", stop_hook_active, last_assistant_message }
 * - Notification: { hook_event_name: "Notification", message, title, notification_type }
 * - UserPromptSubmit: { hook_event_name: "UserPromptSubmit" }
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const LOG_FILE = path.join(os.homedir(), '.claude', 'claude-queue.log');

function log(level, msg) {
  try {
    const line = `${new Date().toISOString()} [${level}] ${msg}\n`;
    fs.appendFileSync(LOG_FILE, line);
  } catch {}
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let event;
  try {
    event = JSON.parse(input);
  } catch (e) {
    log('WARN', `Failed to parse stdin: ${e.message}`);
    event = {};
  }

  const repoPath = event.cwd || process.cwd();
  const hookEvent = event.hook_event_name || 'unknown';

  log('INFO', `Hook fired: ${hookEvent} for ${repoPath}`);

  const { upsertJob } = require('./queue');

  if (hookEvent === 'Stop') {
    // Claude finished responding — waiting for user input
    const msg = event.last_assistant_message;
    let summary = 'Waiting for input';
    if (msg && typeof msg === 'string') {
      summary = msg.slice(0, 60).replace(/\n/g, ' ').trim();
      if (msg.length > 60) summary += '...';
    }
    upsertJob({ repoPath, status: 'waiting', message: summary });
  } else if (hookEvent === 'Notification') {
    const message = event.message || event.title || 'Notification';
    upsertJob({ repoPath, status: 'waiting', message });
  } else if (hookEvent === 'UserPromptSubmit') {
    upsertJob({ repoPath, status: 'working', message: 'Claude is working...' });
  }

  log('INFO', `Hook complete: ${hookEvent} for ${path.basename(repoPath)}`);
}

main().catch(err => {
  log('ERROR', `Hook crashed: ${err.message}`);
  process.exit(0);
});
