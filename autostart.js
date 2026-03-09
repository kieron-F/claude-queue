#!/usr/bin/env node

/**
 * Windows Task Scheduler setup for auto-starting Claude Queue on login.
 *
 * Run: node autostart.js          → create scheduled task
 * Run: node autostart.js --remove → remove scheduled task
 */

const { execSync } = require('child_process');
const path = require('path');

const TASK_NAME = 'ClaudeQueue';
const SCRIPT_PATH = path.join(__dirname, 'src', 'tray.js').replace(/\//g, '\\');
const removing = process.argv.includes('--remove');

if (removing) {
  try {
    execSync(`schtasks /delete /tn "${TASK_NAME}" /f`, { stdio: 'pipe' });
    console.log(`Removed scheduled task "${TASK_NAME}".`);
  } catch {
    console.log(`Task "${TASK_NAME}" not found or already removed.`);
  }
} else {
  // Use the start-hidden.vbs wrapper to avoid a visible console window
  const vbsPath = path.join(__dirname, 'start-hidden.vbs').replace(/\//g, '\\');

  try {
    // Remove existing task first (ignore errors)
    try { execSync(`schtasks /delete /tn "${TASK_NAME}" /f`, { stdio: 'pipe' }); } catch {}

    execSync(
      `schtasks /create /tn "${TASK_NAME}" /tr "wscript.exe \\"${vbsPath}\\"" /sc ONLOGON /rl LIMITED /f`,
      { stdio: 'inherit' }
    );
    console.log(`\nScheduled task "${TASK_NAME}" created.`);
    console.log('Claude Queue will auto-start on login.');
    console.log(`\nTo remove: npm run autostart:remove`);
  } catch (e) {
    console.error('Failed to create scheduled task. Try running as Administrator.');
    console.error(e.message);
  }
}
