#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8080;
const DATA_FILE = path.join(ROOT, 'group-scoreboard.json');
const TABLE_FILE = path.join(ROOT, 'group-scoreboard-table.html');

const state = {
  participants: {}
};

loadState();
persistState();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg'
};

function nowIso() {
  return new Date().toISOString();
}

function cleanName(value) {
  return String(value || '').trim().slice(0, 28);
}

function safeNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function createId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function scoreSort(a, b) {
  const roundsDiff = (safeNum(b.completedRounds) - safeNum(a.completedRounds));
  if (roundsDiff !== 0) return roundsDiff;
  const mistakesDiff = (safeNum(a.totalMistakes) - safeNum(b.totalMistakes));
  if (mistakesDiff !== 0) return mistakesDiff;
  return String(a.name || '').localeCompare(String(b.name || ''), 'he');
}

function participantsList() {
  return Object.values(state.participants).sort(scoreSort);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDuration(ms) {
  const n = safeNum(ms, 0);
  if (n <= 0) return '-';
  return `${(n / 1000).toFixed(1)}s`;
}

function formatUpdated(iso) {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('he-IL');
}

function buildScoreboardHtml() {
  const rows = participantsList();
  const rowsHtml = rows.length
    ? rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.name)}</td>
        <td>${safeNum(row.completedRounds)}</td>
        <td>${safeNum(row.totalMistakes)}</td>
        <td>${escapeHtml(formatDuration(row.lastRoundMs))}</td>
        <td>${escapeHtml(formatDuration(row.bestRoundMs))}</td>
        <td>${escapeHtml(row.currentMiniGame || '-')}</td>
        <td>${escapeHtml(formatUpdated(row.updatedAt))}</td>
      </tr>`).join('')
    : '<tr><td colspan="7">אין נתונים עדיין</td></tr>';

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>טבלת משתתפים</title>
<style>
body{font-family:Arial,sans-serif;margin:24px;background:#111;color:#fff}
h1{margin:0 0 12px}
small{color:#bbb}
table{width:100%;border-collapse:collapse;background:#1b1b1b}
th,td{border:1px solid #333;padding:10px;text-align:center;white-space:nowrap}
th{background:#272727}
</style>
</head>
<body>
<h1>טבלת משתתפים</h1>
<small>עודכן: ${escapeHtml(formatUpdated(nowIso()))}</small>
<table>
<thead>
<tr>
<th>משתתף</th>
<th>הושלמו</th>
<th>טעויות</th>
<th>זמן אחרון</th>
<th>הכי מהיר</th>
<th>משחקון</th>
<th>עודכן</th>
</tr>
</thead>
<tbody>${rowsHtml}
</tbody>
</table>
</body>
</html>`;
}

function persistState() {
  const payload = {
    updatedAt: nowIso(),
    participants: participantsList()
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), 'utf8');
  fs.writeFileSync(TABLE_FILE, buildScoreboardHtml(), 'utf8');
}

function loadState() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    if (!raw.trim()) return;
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed.participants) ? parsed.participants : [];
    list.forEach((row) => {
      const id = String(row.id || '').trim();
      const name = cleanName(row.name);
      if (!id || !name) return;
      state.participants[id] = {
        id,
        name,
        totalMistakes: safeNum(row.totalMistakes),
        roundMistakes: safeNum(row.roundMistakes),
        completedRounds: safeNum(row.completedRounds),
        totalFound: safeNum(row.totalFound),
        lastRoundMs: safeNum(row.lastRoundMs),
        bestRoundMs: safeNum(row.bestRoundMs),
        currentMiniGame: String(row.currentMiniGame || ''),
        currentMiniGameIndex: safeNum(row.currentMiniGameIndex),
        updatedAt: row.updatedAt || nowIso()
      };
    });
  } catch (error) {
    console.error('Failed to load scoreboard data:', error.message);
  }
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        req.destroy();
        reject(new Error('payload_too_large'));
      }
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

function normalizeStatsPatch(existing, patch) {
  const next = { ...existing };
  const name = cleanName(patch.name);
  if (name) next.name = name;
  if (patch.currentMiniGame !== undefined) next.currentMiniGame = String(patch.currentMiniGame || '');
  if (patch.currentMiniGameIndex !== undefined) next.currentMiniGameIndex = safeNum(patch.currentMiniGameIndex);
  if (patch.totalMistakes !== undefined) next.totalMistakes = Math.max(0, safeNum(patch.totalMistakes));
  if (patch.roundMistakes !== undefined) next.roundMistakes = Math.max(0, safeNum(patch.roundMistakes));
  if (patch.completedRounds !== undefined) next.completedRounds = Math.max(0, safeNum(patch.completedRounds));
  if (patch.totalFound !== undefined) next.totalFound = Math.max(0, safeNum(patch.totalFound));
  if (patch.lastRoundMs !== undefined) next.lastRoundMs = Math.max(0, safeNum(patch.lastRoundMs));
  if (patch.bestRoundMs !== undefined) next.bestRoundMs = Math.max(0, safeNum(patch.bestRoundMs));
  next.updatedAt = nowIso();
  return next;
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/group-api/scoreboard') {
    sendJson(res, 200, {
      updatedAt: nowIso(),
      participants: participantsList()
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/group-api/join') {
    try {
      const body = await readBody(req);
      const name = cleanName(body.name);
      if (!name) {
        sendJson(res, 400, { error: 'name_required' });
        return;
      }
      const id = createId();
      const participant = {
        id,
        name,
        totalMistakes: 0,
        roundMistakes: 0,
        completedRounds: 0,
        totalFound: 0,
        lastRoundMs: 0,
        bestRoundMs: 0,
        currentMiniGame: '',
        currentMiniGameIndex: 0,
        updatedAt: nowIso()
      };
      state.participants[id] = participant;
      persistState();
      sendJson(res, 200, {
        id,
        participant,
        participants: participantsList()
      });
    } catch (error) {
      const code = error.message === 'invalid_json' ? 400 : 500;
      sendJson(res, code, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/group-api/update') {
    try {
      const body = await readBody(req);
      const id = String(body.id || '').trim();
      const existing = state.participants[id];
      if (!id || !existing) {
        sendJson(res, 404, { error: 'participant_not_found' });
        return;
      }
      const stats = (body && typeof body.stats === 'object' && body.stats) ? body.stats : {};
      state.participants[id] = normalizeStatsPatch(existing, stats);
      persistState();
      sendJson(res, 200, {
        ok: true,
        participant: state.participants[id],
        participants: participantsList()
      });
    } catch (error) {
      const code = error.message === 'invalid_json' ? 400 : 500;
      sendJson(res, code, { error: error.message });
    }
    return;
  }

  sendJson(res, 404, { error: 'not_found' });
}

function resolveStaticPath(urlPath) {
  let pathname = urlPath || '/';
  if (pathname === '/') pathname = '/group.html';
  const decoded = decodeURIComponent(pathname);
  const clean = decoded.replace(/^\/+/, '');
  const absPath = path.join(ROOT, clean);
  if (!absPath.startsWith(ROOT)) return null;
  return absPath;
}

function serveStatic(req, res, pathname) {
  const absPath = resolveStaticPath(pathname);
  if (!absPath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(absPath, (statErr, stat) => {
    if (statErr || !stat.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(absPath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(absPath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  if (pathname.startsWith('/group-api/')) {
    await handleApi(req, res, pathname);
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`group server running: http://localhost:${PORT}`);
  console.log(`scoreboard json: ${DATA_FILE}`);
  console.log(`scoreboard table: ${TABLE_FILE}`);
});
