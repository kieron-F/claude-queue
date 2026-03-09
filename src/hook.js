#!/usr/bin/env node

/**
 * Claude Code Hook Script
 *
 * Receives hook event JSON on stdin and updates the shared job queue.
 *
 * stdin includes: session_id, cwd, hook_event_name, plus event-specific fields.
 * - Stop: { hook_event_name: "Stop", stop_hook_active, last_assistant_message }
 * - Notification: { hook_event_name: "Notification", message, title, notification_type }
 */

const { upsertJob } = require('./queue');

async function main() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let event;
  try {
    event = JSON.parse(input);
  } catch {
    event = {};
  }

  const repoPath = event.cwd || process.cwd();
  const hookEvent = event.hook_event_name || 'unknown';

  if (hookEvent === 'Stop') {
    // Claude finished responding — waiting for user input
    const msg = event.last_assistant_message;
    let summary = 'Waiting for input';
    if (msg && typeof msg === 'string') {
      // Grab first ~60 chars of last message as context
      summary = msg.slice(0, 60).replace(/\n/g, ' ').trim();
      if (msg.length > 60) summary += '...';
    }
    upsertJob({ repoPath, status: 'waiting', message: summary });
  } else if (hookEvent === 'Notification') {
    const message = event.message || event.title || 'Notification';
    upsertJob({ repoPath, status: 'waiting', message });
  } else if (hookEvent === 'UserPromptSubmit') {
    // User just sent a prompt — Claude is now working
    upsertJob({ repoPath, status: 'working', message: 'Claude is working...' });
  }
}

main().catch(() => process.exit(0));
