const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 8181;
const OPENCLAW_DIR = '/home/node/.openclaw';
const SESSIONS_DIR = path.join(OPENCLAW_DIR, 'agents/main/sessions');

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return null;
  }
}

function getAgents() {
  const sessions = readJSON(path.join(OPENCLAW_DIR, 'agents/main/sessions/sessions.json'));
  const mainSession = sessions?.['agent:main:main'];
  // Get current model - check override first, then fallback to default
  const currentModel = mainSession?.modelOverride || mainSession?.model || 'claude-opus-4-6';
  return [{
    id: 'main',
    name: 'ClawBotcito',
    role: 'orchestrator',
    emoji: '🦞',
    status: mainSession ? 'WORKING' : 'STANDBY',
    model: currentModel,
    channel: 'telegram',
    sessionId: mainSession?.sessionId || null,
    lastActive: mainSession?.updatedAt || null
  }];
}

function getCronJobs() {
  const data = readJSON(path.join(OPENCLAW_DIR, 'cron/jobs.json'));
  if (!data?.jobs) return [];
  return data.jobs.map(job => {
    let status = 'scheduled';
    const now = Date.now();
    const nextRun = job.state?.nextRunAtMs || 0;
    const lastRun = job.state?.lastRunAtMs || 0;
    
    if (job.state?.consecutiveErrors > 0 || job.state?.lastStatus === 'error') {
      status = 'failed';
    } else if (nextRun > now) {
      // Next run is in the future = waiting/scheduled
      status = 'scheduled';
    } else if (lastRun && !job.state?.lastStatus) {
      status = 'running';
    }
    
    // lastRunStatus is separate from kanban status
    const lastRunOk = job.state?.lastStatus === 'ok';

    return {
      id: job.id,
      name: job.name,
      enabled: job.enabled,
      schedule: job.schedule,
      sessionTarget: job.sessionTarget,
      delivery: job.delivery,
      status,
      lastRunOk,
      lastRunAt: job.state?.lastRunAtMs || null,
      lastStatus: job.state?.lastStatus || null,
      lastDurationMs: job.state?.lastDurationMs || null,
      nextRunAt: job.state?.nextRunAtMs || null,
      consecutiveErrors: job.state?.consecutiveErrors || 0,
      prompt: job.payload?.message || '',
      createdAt: job.createdAtMs,
      updatedAt: job.updatedAtMs
    };
  });
}

function getSubagentRuns() {
  const data = readJSON(path.join(OPENCLAW_DIR, 'subagents/runs.json'));
  if (!data?.runs) return [];
  return Object.values(data.runs)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 20)
    .map(run => ({
      runId: run.runId,
      label: run.label || null,
      task: run.task?.substring(0, 200) || '',
      status: run.outcome?.status || 'running',
      createdAt: run.createdAt,
      endedAt: run.endedAt || null,
      model: run.model || null
    }));
}

function buildFeed() {
  const events = [];
  
  // Cron job events
  const jobs = getCronJobs();
  jobs.forEach(job => {
    if (job.lastRunAt) {
      events.push({
        type: 'tasks',
        icon1: '🔄', icon1tip: 'Task event',
        icon2: job.lastStatus === 'ok' ? '✅' : '❌',
        icon2tip: job.lastStatus === 'ok' ? 'Completed' : 'Failed',
        text: `Task "${job.name}" ${job.lastStatus === 'ok' ? 'completed successfully' : 'failed'}`,
        timestamp: job.lastRunAt,
        duration: job.lastDurationMs
      });
    }
    if (job.nextRunAt) {
      events.push({
        type: 'tasks',
        icon1: '🔄', icon1tip: 'Task event',
        icon2: '📋', icon2tip: 'Scheduled',
        text: `Task "${job.name}" scheduled for next run`,
        timestamp: job.updatedAt || job.createdAt
      });
    }
  });

  // Subagent events
  const runs = getSubagentRuns();
  runs.forEach(run => {
    events.push({
      type: 'tasks',
      icon1: '🔄', icon1tip: 'Subagent',
      icon2: run.status === 'ok' ? '✅' : run.status === 'running' ? '🟢' : '❌',
      icon2tip: run.status === 'ok' ? 'Completed' : run.status === 'running' ? 'Running' : 'Failed',
      text: `Subagent "${run.label || 'task'}" ${run.status === 'ok' ? 'completed' : run.status === 'running' ? 'running' : 'failed'}`,
      timestamp: run.endedAt || run.createdAt
    });
  });

  // Agent events
  const agents = getAgents();
  agents.forEach(agent => {
    if (agent.lastActive) {
      events.push({
        type: 'agents',
        icon1: '🔔', icon1tip: 'Agent event',
        icon2: '🟢', icon2tip: 'Working',
        text: `${agent.name} (${agent.id}): session active`,
        timestamp: agent.lastActive
      });
    }
  });

  // Sort by timestamp descending
  events.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  return events.slice(0, 30);
}

function getHistory(query) {
  const limit = Math.min(parseInt(query.limit) || 50, 200);
  const offset = parseInt(query.offset) || 0;
  const search = (query.search || '').toLowerCase();
  const sessionFilter = query.session || null;

  // Find all session files
  const sessionFiles = fs.readdirSync(SESSIONS_DIR)
    .filter(f => f.endsWith('.jsonl') && !f.startsWith('probe-') && !f.includes('.deleted.'))
    .map(f => {
      const filePath = path.join(SESSIONS_DIR, f);
      const stat = fs.statSync(filePath);
      return { file: f, path: filePath, mtime: stat.mtimeMs, id: f.replace('.jsonl', '') };
    })
    .sort((a, b) => b.mtime - a.mtime);

  const allMessages = [];
  const sessionMeta = [];

  for (const sess of sessionFiles) {
    if (sessionFilter && sess.id !== sessionFilter) continue;
    try {
      const lines = fs.readFileSync(sess.path, 'utf8').split('\n').filter(Boolean);
      let sessionStart = null;
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'session') {
            sessionStart = entry.timestamp;
          }
          if (entry.type === 'message' && entry.message) {
            const msg = entry.message;
            const role = msg.role || 'unknown';
            let content = '';
            let toolCalls = [];
            
            if (typeof msg.content === 'string') {
              content = msg.content;
            } else if (Array.isArray(msg.content)) {
              const textParts = [];
              for (const part of msg.content) {
                if (part.type === 'text') textParts.push(part.text);
                else if (part.type === 'toolCall') {
                  toolCalls.push({ name: part.name, id: part.id, args: (part.arguments || '').substring(0, 500) });
                } else if (part.type === 'toolResult') {
                  toolCalls.push({ name: 'result', id: part.toolCallId, result: JSON.stringify(part.content || '').substring(0, 500) });
                }
              }
              content = textParts.join('\n');
            }

            if (search && !content.toLowerCase().includes(search) && !role.includes(search)) continue;

            // Skip empty messages with only thinking/tool content and no text
            if (!content && toolCalls.length === 0) continue;

            allMessages.push({
              id: entry.id,
              sessionId: sess.id,
              role,
              content,
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
              timestamp: entry.timestamp
            });
          }
        } catch (e) { /* skip bad lines */ }
      }
      sessionMeta.push({ id: sess.id, startedAt: sessionStart, mtime: sess.mtime });
    } catch (e) { /* skip unreadable files */ }
  }

  // Sort by timestamp descending (newest first)
  allMessages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const total = allMessages.length;
  const paged = allMessages.slice(offset, offset + limit);

  // Get current main session
  const sessData = readJSON(path.join(SESSIONS_DIR, 'sessions.json'));
  const currentSessionId = sessData?.['agent:main:main']?.sessionId || null;

  return {
    messages: paged,
    total,
    offset,
    limit,
    sessions: sessionMeta,
    currentSessionId
  };
}

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Content-Type', 'application/json');

  const parsedUrl = new URL(req.url, 'http://localhost');
  const urlPath = parsedUrl.pathname;
  const query = Object.fromEntries(parsedUrl.searchParams);

  if (urlPath === '/api/history') {
    try {
      res.end(JSON.stringify(getHistory(query)));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e.message }));
    }
  } else if (urlPath === '/api/agents') {
    res.end(JSON.stringify(getAgents()));
  } else if (urlPath === '/api/tasks') {
    res.end(JSON.stringify(getCronJobs()));
  } else if (urlPath === '/api/feed') {
    res.end(JSON.stringify(buildFeed()));
  } else if (urlPath === '/api/runs') {
    res.end(JSON.stringify(getSubagentRuns()));
  } else if (urlPath === '/api/status') {
    const agents = getAgents();
    const jobs = getCronJobs();
    res.end(JSON.stringify({
      agentsActive: agents.filter(a => a.status === 'WORKING').length,
      agentsTotal: agents.length,
      tasksInQueue: jobs.length,
      timestamp: Date.now()
    }));
  } else {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Dashboard API running on http://localhost:${PORT}`);
});
