const fs = require('fs');
const path = require('path');
const os = require('os');

const QUEUE_FILE = path.join(os.homedir(), '.claude', 'job-queue.json');

function ensureFile() {
  const dir = path.dirname(QUEUE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(QUEUE_FILE)) {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify({ jobs: [] }, null, 2));
  }
}

function readQueue() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8'));
  } catch {
    return { jobs: [] };
  }
}

function writeQueue(data) {
  ensureFile();
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(data, null, 2));
}

function upsertJob({ repoPath, status, message }) {
  const data = readQueue();
  // Normalize path casing on Windows to avoid duplicates
  repoPath = path.resolve(repoPath);
  const repoName = path.basename(repoPath);
  const existing = data.jobs.find(j => path.resolve(j.repoPath).toLowerCase() === repoPath.toLowerCase());

  if (existing) {
    existing.status = status;
    existing.message = message || existing.message;
    existing.timestamp = new Date().toISOString();
  } else {
    data.jobs.push({
      id: `${repoName}-${Date.now()}`,
      repo: repoName,
      repoPath,
      status,
      message: message || '',
      timestamp: new Date().toISOString()
    });
  }

  writeQueue(data);
}

function removeJob(repoPath) {
  const data = readQueue();
  data.jobs = data.jobs.filter(j => j.repoPath !== repoPath);
  writeQueue(data);
}

function clearDone() {
  const data = readQueue();
  data.jobs = data.jobs.filter(j => j.status !== 'done');
  writeQueue(data);
}

module.exports = { QUEUE_FILE, readQueue, writeQueue, upsertJob, removeJob, clearDone };
