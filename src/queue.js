const fs = require('fs');
const path = require('path');
const os = require('os');

const QUEUE_FILE = path.join(os.homedir(), '.claude', 'job-queue.json');
const HISTORY_FILE = path.join(os.homedir(), '.claude', 'job-history.json');
const STALE_HOURS = 24;
const AUTO_DONE_HOURS = 2;
const HISTORY_DAYS = 30;

function ensureFile(filePath, defaultData) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
  }
}

function atomicWrite(filePath, data) {
  const tmp = filePath + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
}

// --- Queue (active jobs) ---

function readQueue({ applyAutoDone = false } = {}) {
  ensureFile(QUEUE_FILE, { jobs: [] });
  try {
    const raw = fs.readFileSync(QUEUE_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.jobs)) return { jobs: [] };
    if (applyAutoDone) {
      autoDone(data);
    }
    return data;
  } catch {
    return { jobs: [] };
  }
}

function writeQueue(data) {
  ensureFile(QUEUE_FILE, { jobs: [] });
  atomicWrite(QUEUE_FILE, data);
}

function pruneStale(data) {
  const cutoff = Date.now() - (STALE_HOURS * 60 * 60 * 1000);
  const staleJobs = data.jobs.filter(j => new Date(j.timestamp).getTime() <= cutoff);
  // Archive stale jobs before removing them
  for (const job of staleJobs) {
    archiveJob(job, 'stale');
  }
  data.jobs = data.jobs.filter(j => new Date(j.timestamp).getTime() > cutoff);
}

function autoDone(data) {
  const cutoff = Date.now() - (AUTO_DONE_HOURS * 60 * 60 * 1000);
  for (const job of data.jobs) {
    if (job.status === 'waiting' && new Date(job.timestamp).getTime() < cutoff) {
      job.status = 'done';
    }
  }
}

function upsertJob({ repoPath, sessionId, status, message, task }) {
  const data = readQueue();
  pruneStale(data);
  autoDone(data);

  repoPath = path.resolve(repoPath);
  const repoName = path.basename(repoPath);

  let existing = null;
  if (sessionId) {
    existing = data.jobs.find(j => j.sessionId === sessionId);
  }
  if (!existing) {
    existing = data.jobs.find(j =>
      !j.sessionId &&
      path.resolve(j.repoPath).toLowerCase() === repoPath.toLowerCase()
    );
  }

  if (existing) {
    existing.status = status;
    existing.message = message || existing.message;
    existing.timestamp = new Date().toISOString();
    if (task) existing.task = task;
    if (sessionId && !existing.sessionId) {
      existing.sessionId = sessionId;
    }
  } else {
    data.jobs.push({
      id: sessionId || `${repoName}-${Date.now()}`,
      sessionId: sessionId || null,
      repo: repoName,
      repoPath,
      status,
      message: message || '',
      task: task || '',
      createdAt: new Date().toISOString(),
      timestamp: new Date().toISOString()
    });
  }

  writeQueue(data);
}

/**
 * Mark a job as done and archive it. Used by SessionEnd and TaskCompleted hooks.
 * Returns true if job was found and archived.
 */
function completeJob({ sessionId, repoPath, endReason }) {
  const data = readQueue();
  repoPath = repoPath ? path.resolve(repoPath) : null;

  let job = null;
  if (sessionId) {
    job = data.jobs.find(j => j.sessionId === sessionId);
  }
  if (!job && repoPath) {
    job = data.jobs.find(j =>
      path.resolve(j.repoPath).toLowerCase() === repoPath.toLowerCase()
    );
  }

  if (!job) return false;

  // Archive before removing
  archiveJob(job, endReason);

  // Remove from active queue
  data.jobs = data.jobs.filter(j => j !== job);
  writeQueue(data);
  return true;
}

function removeJobById(jobId) {
  const data = readQueue();
  data.jobs = data.jobs.filter(j => j.id !== jobId && j.sessionId !== jobId);
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
  // Archive done jobs before clearing
  for (const job of data.jobs.filter(j => j.status === 'done')) {
    archiveJob(job, 'dismissed');
  }
  data.jobs = data.jobs.filter(j => j.status !== 'done');
  writeQueue(data);
}

// --- History (completed task log) ---

function readHistory() {
  ensureFile(HISTORY_FILE, { history: [] });
  try {
    const raw = fs.readFileSync(HISTORY_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.history)) return { history: [] };
    return data;
  } catch {
    return { history: [] };
  }
}

function archiveJob(job, endReason) {
  const data = readHistory();

  // Don't duplicate — skip if this sessionId is already archived
  if (job.sessionId && data.history.some(h => h.sessionId === job.sessionId)) {
    return;
  }

  data.history.push({
    sessionId: job.sessionId || null,
    repo: job.repo,
    repoPath: job.repoPath,
    task: job.task || '',
    message: job.message || '',
    endReason: endReason || 'unknown',
    createdAt: job.createdAt || job.timestamp,
    completedAt: new Date().toISOString()
  });

  // Prune old history
  const cutoff = Date.now() - (HISTORY_DAYS * 24 * 60 * 60 * 1000);
  data.history = data.history.filter(h => new Date(h.completedAt).getTime() > cutoff);

  ensureFile(HISTORY_FILE, { history: [] });
  atomicWrite(HISTORY_FILE, data);
}

function getStats() {
  const data = readHistory();
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());

  let today = 0;
  let thisWeek = 0;

  for (const h of data.history) {
    const t = new Date(h.completedAt).getTime();
    if (t >= todayStart.getTime()) today++;
    if (t >= weekStart.getTime()) thisWeek++;
  }

  return {
    today,
    thisWeek,
    total: data.history.length
  };
}

module.exports = {
  QUEUE_FILE,
  HISTORY_FILE,
  readQueue,
  writeQueue,
  upsertJob,
  completeJob,
  removeJob,
  removeJobById,
  clearDone,
  readHistory,
  archiveJob,
  getStats
};
