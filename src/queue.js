const fs = require('fs');
const path = require('path');
const os = require('os');

const QUEUE_FILE = path.join(os.homedir(), '.claude', 'job-queue.json');
const STALE_HOURS = 24;

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
    const raw = fs.readFileSync(QUEUE_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.jobs)) return { jobs: [] };
    return data;
  } catch {
    return { jobs: [] };
  }
}

/**
 * Atomic write: write to temp file then rename.
 * Prevents corruption from concurrent hook writes.
 */
function writeQueue(data) {
  ensureFile();
  const tmp = QUEUE_FILE + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, QUEUE_FILE);
  } catch (e) {
    // Clean up temp file if rename failed
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
}

function pruneStale(data) {
  const cutoff = Date.now() - (STALE_HOURS * 60 * 60 * 1000);
  data.jobs = data.jobs.filter(j => new Date(j.timestamp).getTime() > cutoff);
}

function upsertJob({ repoPath, status, message }) {
  const data = readQueue();
  pruneStale(data);

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
  data.jobs = data.jobs.filter(j =>
    path.resolve(j.repoPath).toLowerCase() !== path.resolve(repoPath).toLowerCase()
  );
  writeQueue(data);
}

function clearDone() {
  const data = readQueue();
  data.jobs = data.jobs.filter(j => j.status !== 'done');
  writeQueue(data);
}

module.exports = { QUEUE_FILE, readQueue, writeQueue, upsertJob, removeJob, clearDone };
