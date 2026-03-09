#!/usr/bin/env node

/**
 * Setup script: Installs Claude Code hooks globally.
 *
 * Run: node setup.js          → install hooks
 * Run: node setup.js --remove → remove hooks
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const SETTINGS_FILE = path.join(os.homedir(), '.claude', 'settings.json');
const HOOK_SCRIPT = path.join(__dirname, 'src', 'hook.js').replace(/\\/g, '/');
const HOOK_COMMAND = `node "${HOOK_SCRIPT}"`;

const removing = process.argv.includes('--remove');

function readSettings() {
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    } catch {
      console.error('Could not parse settings.json, backing up...');
      fs.copyFileSync(SETTINGS_FILE, SETTINGS_FILE + '.bak');
      return {};
    }
  }
  return {};
}

function hasHook(hookArray) {
  return hookArray.some(entry =>
    entry.hooks && entry.hooks.some(h => h.command === HOOK_COMMAND)
  );
}

function addHookEntry(settings, eventName) {
  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks[eventName]) settings.hooks[eventName] = [];

  if (hasHook(settings.hooks[eventName])) {
    console.log(`  ${eventName}: already installed`);
    return;
  }

  settings.hooks[eventName].push({
    hooks: [
      {
        type: 'command',
        command: HOOK_COMMAND,
        timeout: 5
      }
    ]
  });
  console.log(`  ${eventName}: added`);
}

function removeHookEntry(settings, eventName) {
  if (!settings.hooks || !settings.hooks[eventName]) {
    console.log(`  ${eventName}: not found`);
    return;
  }

  const before = settings.hooks[eventName].length;
  settings.hooks[eventName] = settings.hooks[eventName].filter(entry =>
    !(entry.hooks && entry.hooks.some(h => h.command === HOOK_COMMAND))
  );
  const after = settings.hooks[eventName].length;

  if (settings.hooks[eventName].length === 0) {
    delete settings.hooks[eventName];
  }

  console.log(`  ${eventName}: ${before !== after ? 'removed' : 'not found'}`);
}

function run() {
  const settings = readSettings();

  if (removing) {
    console.log('Removing Claude Queue hooks...\n');
    removeHookEntry(settings, 'Stop');
    removeHookEntry(settings, 'Notification');
    removeHookEntry(settings, 'UserPromptSubmit');
  } else {
    console.log('Installing Claude Queue hooks...\n');
    addHookEntry(settings, 'Stop');
    addHookEntry(settings, 'Notification');
    addHookEntry(settings, 'UserPromptSubmit');
  }

  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  console.log(`\nSettings saved to ${SETTINGS_FILE}`);

  if (!removing) {
    console.log('\nDone! Claude Code sessions will now report to the job queue.');
    console.log('Queue file: ~/.claude/job-queue.json');
    console.log('\nNext steps:');
    console.log('  npm install       → install Electron');
    console.log('  npm start         → launch the tray app');
  } else {
    console.log('\nHooks removed. Claude Code will no longer report to the job queue.');
  }
}

run();
