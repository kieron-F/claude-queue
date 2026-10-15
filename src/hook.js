#!/usr/bin/env node

/**
 * Claude Code Hook Script
 *
 * Receives hook event JSON on stdin and updates the shared job queue.
 *
 * stdin includes: session_id, cwd, hook_event_name, plus event-specific fields.
 * - Stop: { stop_hook_active, last_assistant_message }
 * - Notification: { message, title, notification_type }
 * - UserPromptSubmit: { user_message }
 * - SessionEnd: { reason } (clear|logout|prompt_input_exit|other)
 * - TaskCompleted: {}
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
  const sessionId = event.session_id || null;
  const hookEvent = event.hook_event_name || 'unknown';

  log('INFO', `Hook fired: ${hookEvent} for ${repoPath} (session: ${sessionId || 'unknown'})`);

  const { upsertJob, completeJob } = require('./queue');

  if (hookEvent === 'Stop') {
    const msg = event.last_assistant_message;
    let summary = 'Waiting for input';
    if (msg && typeof msg === 'string') {
      summary = msg.slice(0, 200).replace(/\n/g, ' ').trim();
      if (msg.length > 200) summary += '...';
    }
    upsertJob({ repoPath, sessionId, status: 'waiting', message: summary });

  } else if (hookEvent === 'Notification') {
    const message = event.message || event.title || 'Notification';
    upsertJob({ repoPath, sessionId, status: 'waiting', message });

  } else if (hookEvent === 'UserPromptSubmit') {
    const userMsg = event.user_message || '';
    let task = userMsg.slice(0, 200).replace(/\n/g, ' ').trim();
    if (userMsg.length > 200) task += '...';
    upsertJob({ repoPath, sessionId, status: 'working', message: 'Claude is working...', task: task || undefined });

  } else if (hookEvent === 'TaskCompleted') {
    completeJob({ sessionId, repoPath, endReason: 'completed' });

  } else if (hookEvent === 'SessionEnd') {
    const reason = event.reason || 'other';
    completeJob({ sessionId, repoPath, endReason: reason });
  }

  log('INFO', `Hook complete: ${hookEvent} for ${path.basename(repoPath)}`);
}

main().catch(err => {
  log('ERROR', `Hook crashed: ${err.message}`);
  process.exit(0);
});
