/**
 * Production-Ready Advanced Node.js Backend for Meena Chitfunds
 * 
 * Features:
 * 1. API Key Load Balancer (Round Robin) to bypass rate limits silently (Sequential, No Spam).
 * 2. Zero-Latency RAM Snapshot for Groups and Users (Surgical O(1) Updates).
 * 3. Live Server-Side Ledger Math (Individual Participant Join Dates + Tiered Schedules).
 * 4. Automatic Context Injection (Month 1 to Expected + 3 Future Projections).
 * 5. Advanced Auto-Failover: Automatically retries the next API key on 429/500 errors.
 * 6. Dynamic Context Limiting: Safely clamps history to 20 messages on the server side.
 * 7. Fast-Inference Chitfunds Persona Engine with Tanglish Enforcement.
 * 8. Real-Time System Dashboard with Extended Day/Hour Uptime Tracking & Key Pool Stats.
 * 9. High-Speed Vision Processing: In-memory image compression (Sharp) to KB sizes.
 */

// ============================================================================
// 0. GLOBAL TIMESTAMP OVERRIDE (INDIAN STANDARD TIME - 12H FORMAT)
// ============================================================================
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

function getISTTime() {
    return new Date().toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    }).toUpperCase();
}

console.log = function (...args) { originalLog(`[${getISTTime()}]`, ...args); };
console.warn = function (...args) { originalWarn(`[${getISTTime()}]`, ...args); };
console.error = function (...args) { originalError(`[${getISTTime()}]`, ...args); };

require('dotenv').config();
const express = require('express');
const http = require('http');
const admin = require('firebase-admin');
const cors = require('cors');

const multer = require('multer');
const sharp = require('sharp');

// Configure Multer for pure in-memory storage (up to 75MB payloads handled in RAM)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 75 * 1024 * 1024 } 
});

// ============================================================================
// CONFIGURATION: AI MODELS 
// ============================================================================
const CHAT_MODEL = "gemini-3.5-flash-lite"; // Highly efficient model for text REST API

// ============================================================================
// 1. FIREBASE ADMIN & IN-MEMORY CACHE INITIALIZATION
// ============================================================================
const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccountRaw) {
    console.error("CRITICAL: FIREBASE_SERVICE_ACCOUNT environment variable is missing.");
    process.exit(1);
}

const serviceAccount = JSON.parse(serviceAccountRaw);
if (serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// High-speed RAM Maps for zero-latency lookups
const groupsMap = new Map();
const usersMap = new Map();

// Sync Users (To attach names and phone numbers to ledger data)
// Uses Surgical RAM Updates: Replaces only the modified document in memory instantly
db.collection('users').onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
        if (change.type === 'removed') {
            usersMap.delete(change.doc.id);
        } else {
            usersMap.set(change.doc.id, { id: change.doc.id, ...change.doc.data() });
        }
    });
    console.log(`[Firestore Sync] Users memory refreshed: ${usersMap.size} cached.`);
});

// Sync Groups (Contains all financial timeline data and memberSnapshot ledgers)
// Uses Surgical RAM Updates: Replaces only the modified document in memory instantly
db.collection('groups').onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
        if (change.type === 'removed') {
            groupsMap.delete(change.doc.id);
        } else {
            groupsMap.set(change.doc.id, { id: change.doc.id, ...change.doc.data() });
        }
    });
    console.log(`[Firestore Sync] Groups memory refreshed: ${groupsMap.size} cached.`);
}, (error) => {
    console.error("Firestore snapshot error:", error);
});

// ============================================================================
// 2. CORE CHIT FUND MATH ENGINE (Participant-Specific Timeline Logic)
// ============================================================================

// Calculate individual expected month based strictly on their join date
function calculateParticipantExpectedMonth(joinDate, fallbackStartDateStr, totalGroupMonths) {
    let start;
    if (joinDate instanceof Date && !isNaN(joinDate)) {
        start = joinDate;
    } else if (joinDate) {
        start = new Date(joinDate);
    } else if (fallbackStartDateStr) {
        start = new Date(fallbackStartDateStr);
    } else {
        return 1;
    }
    
    const now = new Date();
    
    let elapsed = (now.getFullYear() - start.getFullYear()) * 12;
    elapsed -= start.getMonth();
    elapsed += now.getMonth();
    
    if (elapsed < 0) elapsed = 0;
    
    let expected = elapsed + 1;
    if (totalGroupMonths > 0 && expected > totalGroupMonths) {
        expected = totalGroupMonths;
    }
    
    return expected;
}

function calculateDueForMonth(targetMonth, startAmount, schedule = []) {
    if (targetMonth <= 1) return startAmount;
    let currentAmount = startAmount;
    for (let m = 2; m <= targetMonth; m++) {
        let increment = 0;
        for (let tier of schedule) {
            if (m >= tier.start && m <= tier.end) {
                increment = tier.amount;
                break;
            }
        }
        currentAmount += increment;
    }
    return currentAmount;
}

// Generates flawless chronological financial timelines mapping past, present, and +3 future months
function buildDefaulterContext() {
    let contextStr = "";
    
    for (const [groupId, group] of groupsMap.entries()) {
        const potSafe = group.totalPot ? Number(group.totalPot).toLocaleString('en-IN') : '0';
        contextStr += `[GROUP: ${group.groupName || 'Unnamed'} | ID: @${groupId} | Pot: ₹${potSafe}]\n`;
        
        const snapshot = group.memberSnapshot || [];
        const startAmt = group.startAmount || 0;
        const schedule = group.installmentSchedule || [];
        const totalMonths = group.totalMonths || 0;
        
        for (const member of snapshot) {
            const userDoc = usersMap.get(member.id);
            const userPhone = userDoc?.phone || 'Unknown';
            
            let userJoinDate = null;
            if (userDoc?.joinedAt) {
                userJoinDate = typeof userDoc.joinedAt.toDate === 'function' 
                    ? userDoc.joinedAt.toDate() 
                    : new Date(userDoc.joinedAt);
            }
            
            const expectedMonth = calculateParticipantExpectedMonth(userJoinDate, group.startDate, totalMonths);
            const paid = member.monthsPaid || 0;
            
            contextStr += `Participant: ${member.name} (@${member.id}) - Ph: ${userPhone} | Joined: ${userJoinDate ? userJoinDate.toISOString().split('T')[0] : 'Legacy'}\n`;
            
            let pendingTotal = 0;
            const projectionEnd = Math.min(expectedMonth + 3, totalMonths || expectedMonth + 3);
            
            for (let m = 1; m <= projectionEnd; m++) {
                const amt = calculateDueForMonth(m, startAmt, schedule);
                let statusTag = "";
                
                if (m <= paid) {
                    statusTag = "[PAID]";
                } else if (m < expectedMonth) {
                    statusTag = "[PREVIOUS MONTH PENDING]";
                    pendingTotal += amt;
                } else if (m === expectedMonth) {
                    statusTag = "[CURRENT MONTH DUE]";
                    pendingTotal += amt;
                } else {
                    statusTag = "[FUTURE INSTALLMENT]";
                }
                
                contextStr += `- Month ${m}: ₹${amt} ${statusTag}\n`;
            }
            
            if (pendingTotal > 0) {
                contextStr += `-> Total Immediate Pending: ₹${pendingTotal}\n\n`;
            } else {
                contextStr += `-> Total Immediate Pending: ₹0 (UP-TO-DATE)\n\n`;
            }
        }
    }
    
    return contextStr.trim();
}

// ============================================================================
// 3. SMART API KEY LOAD BALANCER & PROMPT GENERATOR (Sequential Execution)
// ============================================================================
const rawKeys = (process.env.GEMINI_API_KEYS || "").split(',').map(k => k.trim()).filter(Boolean);

const keyPool = rawKeys.map((key, i) => ({
    id: i + 1,
    key,
    status: "HEALTHY", 
    disabledUntil: 0,
    deadReason: null
}));

let currentKeyIndex = 0;

function getNextKey() {
    if (keyPool.length === 0) throw new Error("No Gemini API keys configured.");

    const now = Date.now();
    for (let i = 0; i < keyPool.length; i++) {
        const index = (currentKeyIndex + i) % keyPool.length;
        const entry = keyPool[index];

        if (entry.status === "DEPRECATED" && now >= entry.disabledUntil) {
            entry.status = "HEALTHY";
            entry.deadReason = null;
            console.log(`[Load Balancer] Key #${entry.id} deprecation lock expired (10m). Restored to HEALTHY for re-testing.`);
        }

        if (entry.status === "DEPRECATED") continue;

        if (entry.status === "RATE_LIMITED" && now >= entry.disabledUntil) {
            entry.status = "HEALTHY";
            console.log(`[Load Balancer] Key #${entry.id} rate-limit window expired. Restored to HEALTHY.`);
        }

        if (entry.status === "HEALTHY") {
            currentKeyIndex = (index + 1) % keyPool.length;
            return entry;
        }
    }

    return null; 
}

function markKeyRateLimited(entry, durationMs = 60000) {
    entry.status = "RATE_LIMITED";
    entry.disabledUntil = Date.now() + durationMs;
    console.warn(`[Load Balancer] Key #${entry.id} rate limited. Locked for ${durationMs / 1000}s.`);
}

function markKeyDeprecated(entry, reason, durationMs = 600000) {
    entry.status = "DEPRECATED";
    entry.deadReason = reason;
    entry.disabledUntil = Date.now() + durationMs; 
    console.error(`[Load Balancer] Key #${entry.id} TEMPORARILY RETIRED (10 mins): ${reason}`);
}

function getSystemPrompt() {
    const todayStr = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
    const monthStr = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'long', year: 'numeric' });
    
    return `Role: AI Chit Manager for Meena Chitfunds.
Task: Answer group dues, timeline status, and defaulter details strictly using the ledger.

STRICT RULES:
1. Language: Tanglish (Spoken Tamil + English). Use "இருக்கு", "இல்லங்க", "கட்டணும்".
2. Respect: Add "ங்க". No formal ancient Tamil.
3. Terms: Keep financial terms in English (Pending, Paid, Due, Future Installment).
4. Ledger Math: [PREVIOUS MONTH PENDING] + [CURRENT MONTH DUE] = Total Immediate Pending. Do NOT include [FUTURE INSTALLMENT] in current dues.
5. Be crisp, direct, and ensure zero hallucination. Provide line-item clarity if asked.

SYSTEM CLOCK:
TODAY: ${todayStr} | CURRENT MONTH: ${monthStr}

ACTIVE GROUPS & LIVE LEDGER:
${buildDefaulterContext()}`;
}

function getVisionSystemPrompt() {
    return `Role: AI Chit Manager for Meena Chitfunds.
Task: Verify uploaded payment receipts against the active ledger.

STRICT RULES:
1. Language: Tanglish (Spoken Tamil + English). Use "இருக்கு", "இல்லங்க". No formal ancient Tamil.
2. Match: Find the name and amount in the image, and match it to a pending due in the active ledger.
3. Ledger Math: Ensure the receipt covers [PREVIOUS MONTH PENDING] or [CURRENT MONTH DUE].
4. Response: Short and direct. State if the receipt covers their pending balance or if there is a mismatch.

ACTIVE GROUPS & LIVE LEDGER:
${buildDefaulterContext()}`;
}

// ============================================================================
// 4. SERVER SETUP & REST API
// ============================================================================
const app = express();
app.use(cors());
app.use(express.json());

app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        console.warn(`[Security] Blocked malformed bot ping (Invalid JSON).`);
        return res.status(400).json({ error: "Invalid JSON payload" });
    }
    next();
});

const server = http.createServer(app);

// ----------------------------------------------------------------------------
// Visual Professional Dark Mode Status Dashboard (System Online Interface)
// ----------------------------------------------------------------------------
app.get('/api/status', (req, res) => {
    res.json({
        status: "ONLINE",
        uptimeSeconds: Math.floor(process.uptime()),
        groupsCount: groupsMap.size,
        usersCount: usersMap.size,
        keyPoolSize: keyPool.length,
        keyPoolDetails: keyPool.map(k => ({
            id: k.id,
            status: k.status,
            disabledUntil: k.disabledUntil > Date.now() ? `${Math.ceil((k.disabledUntil - Date.now()) / 1000)}s remaining` : null,
            deadReason: k.deadReason
        })),
        currentKeyIndex: currentKeyIndex,
        chatModel: CHAT_MODEL,
        timestamp: new Date().toISOString()
    });
});

app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Meena Chitfunds AI • Engine Dashboard</title>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #070b10;
            --surface: #0e1520;
            --surface-card: #131c2a;
            --border: #1e2d42;
            --border-glow: rgba(16, 185, 129, 0.25);
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --emerald: #10b981;
            --emerald-glow: rgba(16, 185, 129, 0.45);
            --meena-red: #ef4444;
            --cyan: #06b6d4;
            --amber: #f59e0b;
            --purple: #8b5cf6;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background-color: var(--bg);
            color: var(--text-main);
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            overflow-x: hidden;
            background-image: 
                radial-gradient(circle at 50% 0%, rgba(13, 148, 136, 0.12) 0%, transparent 60%),
                radial-gradient(circle at 100% 100%, rgba(16, 185, 129, 0.05) 0%, transparent 40%);
        }

        .container {
            max-width: 1080px;
            margin: 0 auto;
            padding: 40px 24px;
            width: 100%;
        }

        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--border);
            padding-bottom: 24px;
            margin-bottom: 36px;
        }

        .brand {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .brand-title {
            font-size: 1.5rem;
            font-weight: 800;
            letter-spacing: -0.02em;
        }

        .brand-title span.meena { color: var(--meena-red); }
        .brand-title span.mkt { color: #ffffff; }

        .brand-sub {
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.78rem;
            color: var(--cyan);
            letter-spacing: 1px;
            text-transform: uppercase;
        }

        .system-badge {
            display: inline-flex;
            align-items: center;
            gap: 12px;
            background: rgba(16, 185, 129, 0.08);
            border: 1px solid var(--emerald);
            padding: 10px 20px;
            border-radius: 9999px;
            box-shadow: 0 0 20px var(--emerald-glow);
        }

        .pulse-orb {
            width: 12px;
            height: 12px;
            background: var(--emerald);
            border-radius: 50%;
            position: relative;
            box-shadow: 0 0 10px var(--emerald);
        }

        .pulse-orb::after {
            content: '';
            position: absolute;
            top: -4px;
            left: -4px;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            border: 2px solid var(--emerald);
            animation: radarPulse 1.8s infinite cubic-bezier(0.2, 0.8, 0.2, 1);
        }

        @keyframes radarPulse {
            0% { transform: scale(0.6); opacity: 1; }
            100% { transform: scale(2.2); opacity: 0; }
        }

        .system-badge span.status-txt {
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.88rem;
            font-weight: 700;
            color: #ffffff;
            letter-spacing: 1.5px;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
            gap: 20px;
            margin-bottom: 32px;
        }

        .card {
            background: var(--surface-card);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 24px;
            position: relative;
            overflow: hidden;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
            transition: border-color 0.25s, transform 0.25s;
        }

        .card:hover {
            border-color: rgba(6, 182, 212, 0.4);
            transform: translateY(-2px);
        }

        .card-label {
            font-size: 0.8rem;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: var(--text-muted);
            margin-bottom: 8px;
            font-weight: 600;
        }

        .card-value {
            font-family: 'JetBrains Mono', monospace;
            font-size: 2.1rem;
            font-weight: 700;
            color: #ffffff;
            line-height: 1.1;
        }

        .card-sub {
            margin-top: 8px;
            font-size: 0.8rem;
            color: var(--emerald);
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .panel {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 18px;
            padding: 28px;
            margin-bottom: 32px;
            box-shadow: 0 12px 30px rgba(0,0,0,0.5);
        }

        .panel-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }

        .panel-title {
            font-size: 1.05rem;
            font-weight: 700;
            letter-spacing: -0.01em;
            color: #ffffff;
        }

        .endpoint-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px;
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid var(--border);
            border-radius: 12px;
            margin-bottom: 12px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.88rem;
        }

        .endpoint-row:last-child { margin-bottom: 0; }

        .method {
            padding: 4px 10px;
            border-radius: 6px;
            font-weight: 700;
            font-size: 0.75rem;
        }

        .method.post { background: rgba(6, 182, 212, 0.15); color: var(--cyan); border: 1px solid rgba(6, 182, 212, 0.3); }
        .method.vision { background: rgba(139, 92, 246, 0.15); color: var(--purple); border: 1px solid rgba(139, 92, 246, 0.3); }

        .endpoint-tag {
            color: var(--text-muted);
            font-size: 0.8rem;
        }

        .state-chip {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            color: var(--emerald);
            font-weight: 600;
            font-size: 0.78rem;
        }

        .state-chip::before {
            content: '';
            width: 7px;
            height: 7px;
            background: var(--emerald);
            border-radius: 50%;
        }

        footer {
            border-top: 1px solid var(--border);
            padding: 20px 24px;
            text-align: center;
            font-size: 0.8rem;
            color: var(--text-muted);
            font-family: 'JetBrains Mono', monospace;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div class="brand">
                <div class="brand-title"><span class="meena">Meena</span> <span class="mkt">Chitfunds</span></div>
                <div class="brand-sub">AI Ledger Chat Engine v1.0</div>
            </div>
            <div class="system-badge">
                <div class="pulse-orb"></div>
                <span class="status-txt">SYSTEM ONLINE</span>
            </div>
        </header>

        <div class="stats-grid">
            <div class="card">
                <div class="card-label">Cached Groups (RAM)</div>
                <div class="card-value" id="valGroupsCount">${groupsMap.size}</div>
                <div class="card-sub">● Zero-Read Group Ledgers</div>
            </div>
            <div class="card">
                <div class="card-label">Cached Users (RAM)</div>
                <div class="card-value" id="valUsersCount">${usersMap.size}</div>
                <div class="card-sub">● Zero-Read Participant Cache</div>
            </div>
            <div class="card">
                <div class="card-label">Key Pool Capacity</div>
                <div class="card-value" id="valKeyPool">${keyPool.length}</div>
                <div class="card-sub">● Auto-Failover Active</div>
            </div>
            <div class="card">
                <div class="card-label">Active Engine</div>
                <div class="card-value" style="font-size: 1.45rem; padding-top: 6px;">Chat Architecture</div>
                <div class="card-sub" style="color: var(--cyan); display: flex; flex-direction: column; align-items: flex-start;">
                    <span>● Engine: ${CHAT_MODEL}</span>
                </div>
            </div>
            <div class="card">
                <div class="card-label">Server Uptime</div>
                <div class="card-value" id="valUptime">0s</div>
                <div class="card-sub" style="color: var(--amber);">● Continuous Gateway Active</div>
            </div>
        </div>

        <div class="panel">
            <div class="panel-header">
                <div class="panel-title">Production Gateway Endpoints</div>
            </div>

            <div class="endpoint-row">
                <div style="display: flex; align-items: center; gap: 14px;">
                    <span class="method post">POST</span>
                    <span>/chat</span>
                    <span class="endpoint-tag">(Text Ledger Queries via ${CHAT_MODEL})</span>
                </div>
                <div class="state-chip">HEALTHY</div>
            </div>
            <div class="endpoint-row">
                <div style="display: flex; align-items: center; gap: 14px;">
                    <span class="method post vision">POST</span>
                    <span>/vision</span>
                    <span class="endpoint-tag">(Multimodal Receipt Match via ${CHAT_MODEL})</span>
                </div>
                <div class="state-chip">HEALTHY</div>
            </div>
        </div>
    </div>

    <footer>
        Meena Chitfunds Enterprise • Production Gateway Node • All Systems Operational
    </footer>

    <script>
        async function refreshStats() {
            try {
                const res = await fetch('/api/status');
                if (!res.ok) return;
                const data = await res.json();
                
                document.getElementById('valGroupsCount').innerText = data.groupsCount;
                document.getElementById('valUsersCount').innerText = data.usersCount;
                document.getElementById('valKeyPool').innerText = data.keyPoolSize;

                const days = Math.floor(data.uptimeSeconds / 86400);
                const hrs = Math.floor((data.uptimeSeconds % 86400) / 3600);
                const mins = Math.floor((data.uptimeSeconds % 3600) / 60);
                const secs = data.uptimeSeconds % 60;

                let uptimeDisplay = '';
                if (days > 0) uptimeDisplay += days + 'd ';
                if (hrs > 0 || days > 0) uptimeDisplay += hrs + 'h ';
                uptimeDisplay += mins + 'm ' + secs + 's';

                document.getElementById('valUptime').innerText = uptimeDisplay;
            } catch(e) {}
        }
        setInterval(refreshStats, 3000);
        refreshStats();
    </script>
</body>
</html>`);
});

// REST Endpoint for Standard Typing/Chat
app.post('/chat', async (req, res) => {
    try {
        const { history = [], message } = req.body;
        
        // Advanced Context Management: Enforce strict 20-message memory limit on the backend
        const safeHistory = history.slice(-20);
        
        const payload = {
            systemInstruction: { parts: [{ text: getSystemPrompt() }] },
            contents: [
                ...safeHistory, 
                { role: "user", parts: [{ text: message }] }
            ]
        };

        const maxAttempts = keyPool.length;
        let finalResponseData = null;
        let finalStatus = 500;
        const keyAlerts = []; 

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const keyEntry = getNextKey();

            if (!keyEntry) {
                console.error("[Load Balancer] No active keys available.");
                return res.status(503).json({ 
                    error: "All keys are temporarily rate-limited or deprecated. Please check server configuration." 
                });
            }

            const url = `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent?key=${keyEntry.key}`;
            
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const data = await response.json();
                
                // --- SUCCESS ---
                if (response.ok) {
                    if (keyAlerts.length > 0 && data.candidates?.[0]?.content?.parts?.[0]?.text) {
                        const alertPrefix = keyAlerts.join("\n") + "\n\n---\n\n";
                        data.candidates[0].content.parts[0].text = alertPrefix + data.candidates[0].content.parts[0].text;
                    }
                    return res.json(data);
                }

                // --- 429: TEMPORARY RATE LIMIT ---
                if (response.status === 429) {
                    markKeyRateLimited(keyEntry, 60000);
                    finalResponseData = data;
                    finalStatus = response.status;
                    continue; 
                }

                // --- 404 / 403: DEPRECATED / INVALID KEY (10 MINUTE LOCK) ---
                if (response.status === 404 || response.status === 403) {
                    const errorDesc = response.status === 404 
                        ? `Key #${keyEntry.id} is deprecated or endpoint not found (HTTP 404)`
                        : `Key #${keyEntry.id} has invalid credentials/permissions (HTTP 403)`;

                    markKeyDeprecated(keyEntry, errorDesc);
                    keyAlerts.push(`⚠️ [System Notice]: ${errorDesc}. Switched to backup key.`);
                    
                    finalResponseData = data;
                    finalStatus = response.status;
                    continue;
                }

                // --- 500+: TRANSIENT SERVER ERROR ---
                if (response.status >= 500) {
                    console.warn(`[Load Balancer] Google 5xx error on Key #${keyEntry.id}. Retrying next key...`);
                    finalResponseData = data;
                    finalStatus = response.status;
                    continue;
                }

                return res.status(response.status).json(data);

            } catch (fetchError) {
                console.error(`[Load Balancer] Network fetch error on Key #${keyEntry.id}:`, fetchError.message);
                finalResponseData = { error: "Network fetch failed during generation" };
                finalStatus = 500;
            }
        }

        res.status(finalStatus).json(finalResponseData);

    } catch (error) {
        console.error("[REST Error]", error);
        res.status(500).json({ error: "Failed to generate text response" });
    }
});

// REST Endpoint for Vision/Image Processing
app.post('/vision', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No image file uploaded." });
        }

        console.log(`[Vision Processor] Received image upload: ${(req.file.size / 1024 / 1024).toFixed(2)} MB`);

        // Lightning Compression: Resize to max 1024px width and convert to highly compressed WebP
        const compressedBuffer = await sharp(req.file.buffer)
            .resize({ width: 1024, withoutEnlargement: true })
            .webp({ quality: 75 })
            .toBuffer();
        
        console.log(`[Vision Processor] Compressed to: ${(compressedBuffer.length / 1024).toFixed(2)} KB`);

        const base64Data = compressedBuffer.toString('base64');
        const payload = {
            systemInstruction: { parts: [{ text: getVisionSystemPrompt() }] },
            contents: [
                {
                    role: "user",
                    parts: [
                        { text: "Verify this receipt against the ledger pending amounts." },
                        { inlineData: { mimeType: "image/webp", data: base64Data } }
                    ]
                }
            ]
        };

        const maxAttempts = keyPool.length;
        let finalResponseData = null;
        let finalStatus = 500;
        const keyAlerts = [];

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const keyEntry = getNextKey();

            if (!keyEntry) {
                return res.status(503).json({ error: "All keys are temporarily rate-limited or deprecated." });
            }

            const url = `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent?key=${keyEntry.key}`;
            
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const data = await response.json();
                
                if (response.ok) {
                    if (keyAlerts.length > 0 && data.candidates?.[0]?.content?.parts?.[0]?.text) {
                        const alertPrefix = keyAlerts.join("\n") + "\n\n---\n\n";
                        data.candidates[0].content.parts[0].text = alertPrefix + data.candidates[0].content.parts[0].text;
                    }
                    return res.json(data);
                }

                if (response.status === 429) {
                    markKeyRateLimited(keyEntry, 60000);
                    finalResponseData = data;
                    finalStatus = response.status;
                    continue; 
                }

                if (response.status === 404 || response.status === 403) {
                    const errorDesc = response.status === 404 
                        ? `Key #${keyEntry.id} is deprecated or endpoint not found (HTTP 404)`
                        : `Key #${keyEntry.id} has invalid credentials/permissions (HTTP 403)`;
                    markKeyDeprecated(keyEntry, errorDesc);
                    keyAlerts.push(`⚠️ [System Notice]: ${errorDesc}. Switched to backup key.`);
                    finalResponseData = data;
                    finalStatus = response.status;
                    continue;
                }

                if (response.status >= 500) {
                    finalResponseData = data;
                    finalStatus = response.status;
                    continue;
                }

                return res.status(response.status).json(data);

            } catch (fetchError) {
                console.error(`[Load Balancer] Network fetch error on Key #${keyEntry.id}:`, fetchError.message);
                finalResponseData = { error: "Network fetch failed during generation" };
                finalStatus = 500;
            }
        }
        res.status(finalStatus).json(finalResponseData);

    } catch (error) {
        console.error("[Vision API Error]", error);
        res.status(500).json({ error: "Failed to process image and generate response" });
    }
});

// ============================================================================
// 5. BOOT SERVER
// ============================================================================
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
