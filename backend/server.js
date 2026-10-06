/**
 * ============================================================================
 * MEENA CHITFUNDS - WHATSAPP AUTOMATION BACKEND SERVER (WHATSAPP-WEB.JS)
 * ============================================================================
 * Architecture:
 * 1. Express server hosted on Port 5555.
 * 2. Embedded whatsapp-web.js client (Puppeteer based) with persistent credentials.
 * 3. Firebase Admin SDK initialized from env OR local firebaseApiKey.json.
 * 4. High-performance, targeted Firestore reads (1 Group Read + N Defaulter Reads).
 * 5. Strict Indian Phone Number Normalization Pipeline.
 * 6. Live Dashboard with matching Meena Chitfunds Design System.
 * 7. Global Auto-Dispatch Engine (Chitfunds all) with Cross-Group Memory Caching.
 * 8. Individualized Sequential Math Engine (No Global Timeline Traps).
 * 9. JIT Checkpoint Architecture with Firebase State Management for Crash Recovery.
 * 10. Anti-Ban Typing Simulation with 4-6m Delays and 15m Inter-Group Cooldowns.
 * 11. Quiet Hours (11 PM - 6 AM IST) with Mid-Loop Cutoff and Manual Overrides.
 * 12. Dynamic Admin Phone Engine & Personalized Participant Payment Links.
 */

const express = require('express');
const http = require('http');
const admin = require('firebase-admin');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

// --- 1. FIREBASE ADMIN INITIALIZATION (ENV OR LOCAL JSON) ---
let serviceAccount;
const secretEnv = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_CONFIG;
const localKeyPath = path.join(__dirname, 'firebaseApiKey.json');

try {
    if (secretEnv) {
        serviceAccount = JSON.parse(secretEnv);
        console.log('[FIREBASE] Successfully parsed service account from environment variables.');
    } else if (fs.existsSync(localKeyPath)) {
        serviceAccount = require(localKeyPath);
        console.log('[FIREBASE] Successfully loaded service account from local firebaseApiKey.json.');
    } else {
        console.error('CRITICAL: Firebase credentials not found in environment variables or firebaseApiKey.json');
        process.exit(1);
    }
} catch (err) {
    console.error('[FIREBASE] Error loading Firebase configuration:', err.message);
    process.exit(1);
}

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();
const STATE_DOC_REF = db.collection('system_state').doc('whatsapp_auto_dispatch');
console.log('[FIREBASE] Firestore Admin SDK initialized.');

// --- 2. GLOBAL STATE FOR DASHBOARD UI & DISPATCH TIMERS ---
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5555;

let currentQRCodeDataURL = null;
let connectionStatus = 'initializing'; 
let connectedUser = null;
let isDispatching = false;
let globalCancelFlag = false; 
let isAutoDispatchPaused = false; 
let autoDispatchInterval = null;

// Delay Helpers
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const waitMinutes = (min, max) => wait(Math.floor(Math.random() * ((max * 60000) - (min * 60000) + 1)) + (min * 60000));

// Quiet Hours Helper (11:00 PM to 6:00 AM IST)
function isQuietHours() {
    const istString = new Date().toLocaleString("en-US", {timeZone: "Asia/Kolkata"});
    const istHour = new Date(istString).getHours();
    return istHour >= 23 || istHour < 6;
}

// --- 3. CORE CALCULATION ENGINES ---
function calculateCurrentSystemMonth(startDateStr) {
    if (!startDateStr) return 1;
    const start = new Date(startDateStr);
    const now = new Date();
    let months = (now.getFullYear() - start.getFullYear()) * 12;
    months -= start.getMonth();
    months += now.getMonth();
    return months <= 0 ? 1 : months + 1;
}

function calculateParticipantExpectedMonth(user, groupData) {
    if (!user || !groupData) return 1;
    let start;
    if (user?.joinedAt) {
        start = typeof user.joinedAt.toDate === 'function' ? user.joinedAt.toDate() : new Date(user.joinedAt);
    } else {
        start = new Date(groupData?.startDate || new Date());
    }
    const now = new Date();
    let elapsed = (now.getFullYear() - start.getFullYear()) * 12;
    elapsed -= start.getMonth();
    elapsed += now.getMonth();
    if (elapsed < 0) elapsed = 0;

    let expected = elapsed + 1;
    const totalGroupMonths = groupData.totalMonths || 0;
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

// --- 4. PROFESSIONAL INDIAN PHONE NUMBER SANITIZER ---
function formatIndianPhoneNumber(rawPhone) {
    if (!rawPhone) return null;
    let digits = String(rawPhone).replace(/\D/g, '');

    if (digits.length === 10) {
        digits = '91' + digits;
    } else if (digits.length === 11 && digits.startsWith('0')) {
        digits = '91' + digits.substring(1);
    } else if (digits.length === 12 && digits.startsWith('91')) {
        // Already valid
    } else {
        return null;
    }

    return `${digits}@c.us`;
}

function chunkArray(array, size) {
    const chunked = [];
    for (let i = 0; i < array.length; i += size) {
        chunked.push(array.slice(i, i + size));
    }
    return chunked;
}

// --- 5. WHATSAPP-WEB.JS BOT ENGINE ---
let client;

// Human-Like Typing Engine
async function sendWithTyping(jid, text) {
    try {
        const chat = await client.getChatById(jid);
        await chat.sendStateTyping();
        await wait(Math.floor(Math.random() * (4000 - 2000 + 1)) + 2000); 
        await client.sendMessage(jid, text);
    } catch (err) {
        console.warn(`[TYPING ENGINE] Could not simulate typing for ${jid}. Sending directly.`);
        await client.sendMessage(jid, text);
    }
}

// Get Admin Fallback (Supports dynamic Firebase fetch and fallback targets)
async function getAdminJid() {
    try {
        const adminSnap = await db.collection('system_state').doc('admin_settings').get();
        if (adminSnap.exists && adminSnap.data().adminPhone) {
            return adminSnap.data().adminPhone;
        }
    } catch (err) {
        console.error('[ADMIN FETCH ERROR]', err);
    }

    if (process.env.ADMIN_PHONE) {
        return formatIndianPhoneNumber(process.env.ADMIN_PHONE);
    }
    return client?.info?.wid?._serialized || null;
}

async function startWhatsAppBot() {
    console.log('[BOT] Starting whatsapp-web.js session...');

    const chromePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

    client = new Client({
        authStrategy: new LocalAuth({
            dataPath: path.join(__dirname, 'whatsappsession')
        }),
        puppeteer: {
            executablePath: fs.existsSync(chromePath) ? chromePath : undefined,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-extensions', // Added to prevent RAM bloat
                '--disable-software-rasterizer', // Added to prevent RAM bloat
                '--disable-background-networking', // Added to prevent RAM bloat
                '--disable-default-apps', // Added to prevent RAM bloat
                '--mute-audio', // Added to prevent RAM bloat
                '--disable-accelerated-2d-canvas', // Added to prevent RAM bloat
                '--disk-cache-size=0' // Fixes disk cache memory leaks over time
            ],
            headless: true
        }
    });

    client.on('qr', async (qr) => {
        connectionStatus = 'qr_ready';
        currentQRCodeDataURL = await QRCode.toDataURL(qr);
        console.log('[BOT] New QR Code generated. Visit dashboard to scan.');
    });

    client.on('ready', () => {
        connectionStatus = 'connected';
        currentQRCodeDataURL = null;
        connectedUser = client.info.pushname || 'Admin';
        console.log(`[BOT] Connected successfully as ${connectedUser}!`);
        
        if (!autoDispatchInterval) {
            autoDispatchInterval = setInterval(checkAndRunAutoDispatch, 60 * 60 * 1000);
            checkAndRunAutoDispatch(); 
        }
    });

    client.on('disconnected', async (reason) => {
        connectionStatus = 'disconnected';
        currentQRCodeDataURL = null;
        console.log('[BOT] Client was logged out or disconnected:', reason);
        console.log('[BOT] Reinitializing and clearing memory processes...');
        
        // RAM LEAK FIX: Ensures the zombie chromium processes are killed properly before reinitializing
        try {
            await client.destroy();
        } catch (destroyErr) {
            console.log('[BOT] Cleanup notice during disconnect:', destroyErr.message);
        }
        
        client.initialize();
    });

    // --- MESSAGE LISTENER ---
    client.on('message', async (msg) => {
        try {
            const messageText = msg.body.trim();
            const senderJid = msg.from;

            // DYNAMIC ADMIN NUMBER REGISTRATION (UPDATED REGEX TO AVOID "SYSTEM BUSY")
            const adminRegex = /^(?:chitfunds\s+)?change admin number\s+(.+)$/i;
            const adminMatch = messageText.match(adminRegex);
            if (adminMatch && adminMatch[1]) {
                const rawPhone = adminMatch[1].trim();
                const formatted = formatIndianPhoneNumber(rawPhone);
                if (formatted) {
                    await db.collection('system_state').doc('admin_settings').set({ adminPhone: formatted }, { merge: true });
                    await client.sendMessage(senderJid, `✅ Admin number successfully updated to +${formatted.replace('@c.us', '')}. All future reports will be routed here.`);
                } else {
                    await client.sendMessage(senderJid, `❌ Invalid phone number format. Please provide a valid 10-digit number.`);
                }
                return;
            }

            // EMERGENCY KILL-SWITCH
            if (messageText.toLowerCase() === 'chitfunds stop') {
                globalCancelFlag = true;
                isAutoDispatchPaused = true;
                await client.sendMessage(senderJid, `🛑 *System Halted*\nAll active manual and automated dispatches have been commanded to stop. Please wait a moment for the loops to exit safely.`);
                return;
            }

            // PAUSE / RESUME BACKGROUND AUTO-SENDER
            if (messageText.toLowerCase() === 'chitfunds pause') {
                isAutoDispatchPaused = true;
                await client.sendMessage(senderJid, `⏸️ *Auto-Dispatch Paused*\nThe background chron job will not execute any queues until resumed.`);
                return;
            }
            if (messageText.toLowerCase() === 'chitfunds resume') {
                isAutoDispatchPaused = false;
                globalCancelFlag = false;
                if (isQuietHours()) {
                    await client.sendMessage(senderJid, `▶️ *Auto-Dispatch Resumed*\nHowever, Quiet Hours (11 PM - 6 AM) are active. The queue will automatically start at 6:00 AM.`);
                } else {
                    await client.sendMessage(senderJid, `▶️ *Auto-Dispatch Resumed*\nThe background chron job is active. Checking Firebase state...`);
                    checkAndRunAutoDispatch();
                }
                return;
            }

            // GLOBAL DISPATCH TRIGGER (MANUAL)
            if (messageText.toLowerCase() === 'chitfunds all' || messageText.toLowerCase() === 'auto chitfunds all') {
                console.log(`[TRIGGER] Received GLOBAL Chitfunds command from ${senderJid}`);
                if (isDispatching) {
                    await client.sendMessage(senderJid, `⚠️ *System Busy*\nAnother dispatch is currently running. Use 'Chitfunds stop' if you need to abort it.`);
                    return;
                }
                globalCancelFlag = false;
                await handleGlobalChitfundsDispatch(senderJid);
                return;
            }

            // SINGLE GROUP DISPATCH TRIGGER (MANUAL)
            const triggerRegex = /^chitfunds\s+([A-Za-z0-9_-]+)/i;
            const match = messageText.match(triggerRegex);

            if (!match) return;

            const targetGroupId = match[1].trim();
            console.log(`[TRIGGER] Received Chitfunds command for group: "${targetGroupId}" from ${senderJid}`);

            if (isDispatching) {
                await client.sendMessage(senderJid, `⚠️ *System Busy*\nAnother group dispatch is currently running. Use 'Chitfunds stop' if you need to abort it.`);
                return;
            }
            globalCancelFlag = false;
            await handleChitfundsDispatch(targetGroupId, senderJid);

        } catch (err) {
            console.error('[BOT ERROR] Message listener failed:', err);
        }
    });

    client.initialize();
}

// --- 5.1 THE BACKGROUND AUTO-TRIGGER LOGIC (FIREBASE STATE MANAGER) ---
async function checkAndRunAutoDispatch() {
    if (isAutoDispatchPaused || isDispatching || globalCancelFlag) return;
    
    if (isQuietHours()) {
        console.log('[AUTO-DISPATCH] Quiet hours (11 PM - 6 AM) are active. Sleeping until 6:00 AM.');
        return;
    }

    try {
        const now = new Date();
        const istString = now.toLocaleString("en-US", {timeZone: "Asia/Kolkata"});
        const istDate = new Date(istString);
        const day = istDate.getDate();
        const monthYear = `${istDate.getMonth() + 1}-${istDate.getFullYear()}`;

        let currentWindow = day <= 15 ? 'Window1' : 'Window2';
        let fieldName = day <= 15 ? 'lastRunWindow1' : 'lastRunWindow2';

        const stateSnap = await STATE_DOC_REF.get();
        const state = stateSnap.exists ? stateSnap.data() : {};

        // If the window hasn't run this month, reset the queue in Firebase
        if (state[fieldName] !== monthYear) {
            console.log(`[AUTO-DISPATCH] Triggering new cycle for ${currentWindow} (${monthYear})`);
            const groupsSnap = await db.collection('groups').get();
            const allGroupIds = groupsSnap.docs.map(d => d.id);
            
            await STATE_DOC_REF.set({
                [fieldName]: monthYear,
                pendingGroups: allGroupIds
            }, { merge: true });

            processAutoDispatchQueue();
        } else if (state.pendingGroups && state.pendingGroups.length > 0) {
            // Power-Cut Recovery
            console.log(`[AUTO-DISPATCH] Resuming interrupted queue for ${currentWindow}. ${state.pendingGroups.length} groups remaining.`);
            processAutoDispatchQueue();
        }
    } catch (err) {
        console.error(`[AUTO-DISPATCH ERROR] Failed to check state:`, err);
    }
}

// --- 5.2 THE CRASH-PROOF JIT BACKGROUND PROCESSOR ---
async function processAutoDispatchQueue() {
    if (isDispatching || isAutoDispatchPaused || globalCancelFlag) return;
    isDispatching = true;
    const adminJid = await getAdminJid();
    let nightHalt = false;
    let isFirstGroupAuto = true;

    try {
        let stateSnap = await STATE_DOC_REF.get();
        let pendingQueue = stateSnap.exists ? (stateSnap.data().pendingGroups || []) : [];

        if (adminJid && pendingQueue.length > 0) {
            await client.sendMessage(adminJid, `⚙️ *Background Auto-Dispatch Started*\nGroups remaining in queue: ${pendingQueue.length}\nExecuting 15m JIT cool-downs between groups.`);
        }

        while (pendingQueue.length > 0) {
            if (globalCancelFlag || isAutoDispatchPaused) {
                if (adminJid) await client.sendMessage(adminJid, `⏸️ Background Dispatch Aborted/Paused mid-run.`);
                break;
            }

            if (isQuietHours()) {
                if (adminJid) await client.sendMessage(adminJid, `🌙 *Quiet Hours Reached (11:00 PM)*\nAuto-dispatch paused. Will resume remaining queue at 6:00 AM.`);
                break;
            }

            const groupId = pendingQueue[0];
            
            if (!isFirstGroupAuto) {
                console.log(`[AUTO-DISPATCH] Group @${groupId} is next. Waiting 15 minutes before reading ledger...`);
                await waitMinutes(15, 15);
                
                if (globalCancelFlag || isAutoDispatchPaused) break; 

                if (isQuietHours()) {
                    if (adminJid) await client.sendMessage(adminJid, `🌙 *Quiet Hours Reached (11:00 PM)*\nAuto-dispatch paused. Will resume remaining queue at 6:00 AM.`);
                    break;
                }
            } else {
                console.log(`[AUTO-DISPATCH] Starting immediately for @${groupId}...`);
            }
            
            isFirstGroupAuto = false;

            // JIT READ: Safe and 100% Real-Time
            console.log(`[AUTO-DISPATCH] Performing JIT read for @${groupId}...`);
            const groupSnap = await db.collection('groups').doc(groupId).get();
            
            if (!groupSnap.exists) {
                // Ghost group, just remove it from queue
                await STATE_DOC_REF.update({ pendingGroups: admin.firestore.FieldValue.arrayRemove(groupId) }).catch(err => console.error("Firebase Sync Error", err));
                pendingQueue.shift();
                continue;
            }

            const groupData = groupSnap.data();
            const memberSnapshot = groupData.memberSnapshot || [];
            const startAmt = groupData.startAmount || 0;
            const schedule = groupData.installmentSchedule || [];
            
            const allUserIds = memberSnapshot.map(m => m.id);
            if (allUserIds.length === 0) {
                await STATE_DOC_REF.update({ pendingGroups: admin.firestore.FieldValue.arrayRemove(groupId) }).catch(err => console.error("Firebase Sync Error", err));
                pendingQueue.shift();
                continue;
            }

            const idBatches = chunkArray(allUserIds, 30);
            let userRecords = [];
            for (const batch of idBatches) {
                const userSnap = await db.collection('users').where(admin.firestore.FieldPath.documentId(), 'in', batch).get();
                userSnap.forEach(docSnap => { userRecords.push({ id: docSnap.id, ...docSnap.data() }); });
            }

            const snapshotMap = new Map();
            memberSnapshot.forEach(m => snapshotMap.set(m.id, m));

            const dispatchQueue = [];
            let groupPendingTotal = 0;

            for (const user of userRecords) {
                const expectedUserMonth = calculateParticipantExpectedMonth(user, groupData);
                const snap = snapshotMap.get(user.id) || { monthsPaid: 0 };
                const monthsPaid = snap.monthsPaid || 0;
                
                if (monthsPaid < expectedUserMonth) {
                    let totalOwed = 0;
                    let pendingMonthsList = [];

                    for (let m = monthsPaid + 1; m <= expectedUserMonth; m++) {
                        const dueForM = calculateDueForMonth(m, startAmt, schedule);
                        totalOwed += dueForM;
                        pendingMonthsList.push({ month: m, amount: dueForM });
                    }

                    const targetJid = formatIndianPhoneNumber(user.phone);
                    if (!targetJid) continue;

                    groupPendingTotal += totalOwed;
                    let breakdownText = "";
                    pendingMonthsList.forEach(pm => { breakdownText += `- Month ${pm.month}: ₹${pm.amount.toLocaleString('en-IN')}\n`; });

                    const participantName = (user.name || 'Participant').toUpperCase();
                    const groupName = (groupData.groupName || groupId).toUpperCase();

                    const message = 
`*Meena Chitfunds*
Group: ${groupName} (@${groupId})
Timeline: Month ${expectedUserMonth} of ${groupData.totalMonths || 0}

Dear ${participantName},
You have pending payments for the following months:

${breakdownText}
*Total Pending: ₹${totalOwed.toLocaleString('en-IN')}*

Kindly clear your dues at the earliest.

View your ledger & pay here:
https://corporationgoorac.github.io/ChitFunds/#${user.id}`;

                    // Added User ID to queue for Firebase Tracking
                    dispatchQueue.push({ id: user.id, name: participantName, jid: targetJid, text: message, amount: totalOwed });
                }
            }

            // FIREBASE TRACKER: Prevent duplicates upon restart
            let currentSysState = await STATE_DOC_REF.get();
            let sysData = currentSysState.exists ? currentSysState.data() : {};
            
            // QUEUE SYNC FIX: Ensure pendingUsers exists to prevent crash locks
            if (sysData.currentProcessingGroup !== groupId || !sysData.pendingUsers) {
                let allPendingIds = dispatchQueue.map(item => item.id);
                await STATE_DOC_REF.set({
                    currentProcessingGroup: groupId,
                    pendingUsers: allPendingIds
                }, { merge: true });
                sysData.pendingUsers = allPendingIds;
            }
            
            let pendingUsers = sysData.pendingUsers || [];
            let filteredDispatchQueue = dispatchQueue.filter(item => pendingUsers.includes(item.id));

            let successCount = 0;
            let failCount = 0;

            for (let i = 0; i < filteredDispatchQueue.length; i++) {
                if (globalCancelFlag || isAutoDispatchPaused) break;

                if (isQuietHours()) {
                    nightHalt = true;
                    if (adminJid) await client.sendMessage(adminJid, `🌙 *Quiet Hours Reached (11:00 PM) mid-group*\nAuto-dispatch paused for the night. Will resume at 6:00 AM.`);
                    break;
                }

                const item = filteredDispatchQueue[i];
                try {
                    await sendWithTyping(item.jid, item.text);
                    successCount++;
                    console.log(`[AUTO-DISPATCH] Sent to ${item.name} (${item.jid})`);
                    
                    // FIREBASE ARRAY REMOVAL - INSTANT CLEAR
                    await STATE_DOC_REF.update({ pendingUsers: admin.firestore.FieldValue.arrayRemove(item.id) }).catch(err => console.error("Firebase Sync Error", err));
                } catch (sendErr) {
                    failCount++;
                }

                if (i < filteredDispatchQueue.length - 1) {
                    console.log(`[AUTO-DISPATCH] Waiting 4-6 minutes before next message...`);
                    await waitMinutes(4, 6);
                }
            }

            // FIREBASE TRACKER: Completion Verification
            let postState = await STATE_DOC_REF.get();
            let postPending = postState.exists ? (postState.data().pendingUsers || []) : [];

            // QUEUE SYNC FIX: Infinite Loop Prevention (Checking if actionable items are remaining rather than an empty array)
            let remainingActionable = postPending.filter(id => dispatchQueue.some(item => item.id === id));

            if (!globalCancelFlag && !isAutoDispatchPaused && !nightHalt && remainingActionable.length === 0) {
                // Group fully sent. Safe to strike from global queue and clear tracking ID.
                await STATE_DOC_REF.update({ 
                    pendingGroups: admin.firestore.FieldValue.arrayRemove(groupId),
                    currentProcessingGroup: admin.firestore.FieldValue.delete(),
                    pendingUsers: admin.firestore.FieldValue.delete()
                }).catch(err => console.error("Firebase Finalize Sync Error", err));
                pendingQueue.shift(); 

                if (adminJid) {
                    const report = 
`✅ *Auto-Dispatch Complete: Group @${groupId}*
Group Name: ${(groupData.groupName || groupId).toUpperCase()}
- Reminders Delivered: ${successCount}
- Delivery Failures: ${failCount}
- Pending Value Reminded: ₹${groupPendingTotal.toLocaleString('en-IN')}

Group struck from active database queue. Proceeding to next group.`;
                    await client.sendMessage(adminJid, report);
                }
            } else if (nightHalt) {
                break; 
            }
            
            // RAM GC Optimization for long waits
            userRecords = null;
            dispatchQueue.length = 0; 
            snapshotMap.clear();
        }

        if (pendingQueue.length === 0 && adminJid && !globalCancelFlag && !isAutoDispatchPaused && !nightHalt) {
            await client.sendMessage(adminJid, `🏁 *Background Auto-Dispatch Finished!*\nAll active groups have been processed for this time window. Going to sleep.`);
        }

    } catch (criticalErr) {
        console.error('[CRITICAL AUTO-DISPATCH ERROR]:', criticalErr);
        if (adminJid) await client.sendMessage(adminJid, `❌ *Background Server Error:*\n${criticalErr.message}`);
    } finally {
        isDispatching = false;
    }
}

// --- 6. TARGETED DISPATCH PIPELINE (MANUAL - INDEPENDENT OF STATE MANAGER) ---
async function handleChitfundsDispatch(groupId, requesterJid) {
    isDispatching = true;
    const adminJid = await getAdminJid();
    const finalReportTarget = adminJid || requesterJid;

    try {
        await client.sendMessage(requesterJid, `⏳ *Analyzing Group @${groupId}...*\nFetching ledger status and isolating pending dues. Please wait.`);

        await STATE_DOC_REF.update({ pendingGroups: admin.firestore.FieldValue.arrayRemove(groupId) }).catch(err => console.error("Firebase Sync Error", err));

        const groupRef = db.collection('groups').doc(groupId);
        const groupSnap = await groupRef.get();

        if (!groupSnap.exists) {
            await client.sendMessage(requesterJid, `❌ *Group Not Found*\nNo chit group exists with ID: @${groupId}`);
            isDispatching = false;
            return;
        }

        const groupData = groupSnap.data();
        const memberSnapshot = groupData.memberSnapshot || [];
        const startAmt = groupData.startAmount || 0;
        const schedule = groupData.installmentSchedule || [];

        const allUserIds = memberSnapshot.map(m => m.id);

        if (allUserIds.length === 0) {
            await client.sendMessage(requesterJid, `✅ *Empty Group*\nGroup *${(groupData.groupName || groupId).toUpperCase()}* has no participants.`);
            isDispatching = false;
            return;
        }

        const idBatches = chunkArray(allUserIds, 30);
        let userRecords = [];

        for (const batch of idBatches) {
            const userSnap = await db.collection('users').where(admin.firestore.FieldPath.documentId(), 'in', batch).get();
            userSnap.forEach(docSnap => { userRecords.push({ id: docSnap.id, ...docSnap.data() }); });
        }

        const dispatchQueue = [];
        let invalidPhoneCount = 0;
        let groupPendingTotal = 0;

        const snapshotMap = new Map();
        memberSnapshot.forEach(m => snapshotMap.set(m.id, m));

        for (const user of userRecords) {
            const expectedUserMonth = calculateParticipantExpectedMonth(user, groupData);
            const snap = snapshotMap.get(user.id) || { monthsPaid: 0 };
            const monthsPaid = snap.monthsPaid || 0;

            if (monthsPaid < expectedUserMonth) {
                let totalOwed = 0;
                let pendingMonthsList = [];

                for (let m = monthsPaid + 1; m <= expectedUserMonth; m++) {
                    const dueForM = calculateDueForMonth(m, startAmt, schedule);
                    totalOwed += dueForM;
                    pendingMonthsList.push({ month: m, amount: dueForM });
                }

                const targetJid = formatIndianPhoneNumber(user.phone);

                if (!targetJid) {
                    invalidPhoneCount++;
                    continue;
                }

                groupPendingTotal += totalOwed;
                let breakdownText = "";
                pendingMonthsList.forEach(pm => { breakdownText += `- Month ${pm.month}: ₹${pm.amount.toLocaleString('en-IN')}\n`; });

                const participantName = (user.name || 'Participant').toUpperCase();
                const groupName = (groupData.groupName || groupId).toUpperCase();

                const message = 
`*Meena Chitfunds*
Group: ${groupName} (@${groupId})
Timeline: Month ${expectedUserMonth} of ${groupData.totalMonths || 0}

Dear ${participantName},
You have pending payments for the following months:

${breakdownText}
*Total Pending: ₹${totalOwed.toLocaleString('en-IN')}*

Kindly clear your dues at the earliest.

View your ledger & pay here:
https://corporationgoorac.github.io/ChitFunds/#${user.id}`;

                dispatchQueue.push({ id: user.id, name: participantName, jid: targetJid, text: message, amount: totalOwed });
            }
        }

        // FIREBASE TRACKER: Manual Dispatch Safety
        let currentSysState = await STATE_DOC_REF.get();
        let sysData = currentSysState.exists ? currentSysState.data() : {};
        
        // QUEUE SYNC FIX
        if (sysData.currentProcessingGroup !== groupId || !sysData.pendingUsers) {
            let allPendingIds = dispatchQueue.map(item => item.id);
            await STATE_DOC_REF.set({
                currentProcessingGroup: groupId,
                pendingUsers: allPendingIds
            }, { merge: true });
            sysData.pendingUsers = allPendingIds;
        }
        
        let pendingUsers = sysData.pendingUsers || [];
        let filteredDispatchQueue = dispatchQueue.filter(item => pendingUsers.includes(item.id));

        if (filteredDispatchQueue.length === 0) {
            await client.sendMessage(requesterJid, `✅ *All Clear!*\nEvery participant in group *${(groupData.groupName || groupId).toUpperCase()}* is up to date based on their individual timelines. No messages needed.`);
            
            // Clean up state manually
            await STATE_DOC_REF.update({
                currentProcessingGroup: admin.firestore.FieldValue.delete(),
                pendingUsers: admin.firestore.FieldValue.delete()
            }).catch(err => console.error("Firebase Reset Error", err));

            isDispatching = false;
            return;
        }

        await client.sendMessage(requesterJid, `🚀 *Dispatch Started*\nQueue size: ${filteredDispatchQueue.length} participants.\nThrottling active: Messages will be sent with human typing delays (4-6 mins).`);

        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < filteredDispatchQueue.length; i++) {
            if (globalCancelFlag) break;

            const item = filteredDispatchQueue[i];
            try {
                await sendWithTyping(item.jid, item.text);
                successCount++;
                console.log(`[DISPATCH] [${i + 1}/${filteredDispatchQueue.length}] Sent to ${item.name} (${item.jid})`);
                await STATE_DOC_REF.update({ pendingUsers: admin.firestore.FieldValue.arrayRemove(item.id) }).catch(err => console.error("Firebase Sync Error", err));
            } catch (sendErr) {
                failCount++;
                console.error(`[DISPATCH ERROR] Failed sending to ${item.name}:`, sendErr.message);
            }

            if (i < filteredDispatchQueue.length - 1) {
                console.log(`[DISPATCH] Pausing for 4-6 minutes...`);
                await waitMinutes(4, 6);
            }
        }

        let postState = await STATE_DOC_REF.get();
        let postPending = postState.exists ? (postState.data().pendingUsers || []) : [];
        let remainingActionable = postPending.filter(id => dispatchQueue.some(item => item.id === id));
        
        if (!globalCancelFlag && remainingActionable.length === 0) {
             await STATE_DOC_REF.update({
                 currentProcessingGroup: admin.firestore.FieldValue.delete(),
                 pendingUsers: admin.firestore.FieldValue.delete()
             }).catch(err => console.error("Firebase Sync Error", err));
        }

        const reportTitle = globalCancelFlag ? "*Meena Chitfunds Manual Dispatch Aborted*" : "*Meena Chitfunds Manual Dispatch Completed*";
        const report = 
`${reportTitle}

Group: *${(groupData.groupName || groupId).toUpperCase()}*
Status:
- Reminders Delivered: *${successCount}*
- Delivery Failures: *${failCount}*
- Skipped (Invalid Phone): *${invalidPhoneCount}*
- Pending Value Reminded: ₹${groupPendingTotal.toLocaleString('en-IN')}

All active queues are cleared.`;

        await client.sendMessage(finalReportTarget, report);
        if (adminJid && adminJid !== requesterJid) {
            await client.sendMessage(requesterJid, `✅ Dispatch finished. Audit report sent to Admin.`);
        }
        console.log(`[DISPATCH COMPLETED] Successfully processed group @${groupId}`);

        // GC Optimization
        userRecords = null;
        dispatchQueue.length = 0;
        snapshotMap.clear();

    } catch (criticalErr) {
        console.error('[CRITICAL DISPATCH ERROR]:', criticalErr);
        await client.sendMessage(requesterJid, `❌ *Server Error during execution:*\n${criticalErr.message}`);
    } finally {
        isDispatching = false;
    }
}

// --- 6.1 GLOBAL AUTO-DISPATCH PIPELINE (MANUAL - JIT & INDEPENDENT) ---
async function handleGlobalChitfundsDispatch(requesterJid) {
    isDispatching = true;
    const adminJid = await getAdminJid();
    const finalReportTarget = adminJid || requesterJid;

    try {
        await client.sendMessage(requesterJid, `🌐 *Starting Global Manual Dispatch...*\nScanning all active groups in Firestore. JIT 15-minute cooldowns will apply.`);

        const now = new Date();
        const istString = now.toLocaleString("en-US", {timeZone: "Asia/Kolkata"});
        const istDate = new Date(istString);
        const day = istDate.getDate();
        const monthYear = `${istDate.getMonth() + 1}-${istDate.getFullYear()}`;
        let fieldName = day <= 15 ? 'lastRunWindow1' : 'lastRunWindow2';

        await STATE_DOC_REF.set({
            [fieldName]: monthYear,
            pendingGroups: []
        }, { merge: true }).catch(err => console.error("Firebase Sync Error", err));

        const groupsSnap = await db.collection('groups').get();
        if (groupsSnap.empty) {
            await client.sendMessage(requesterJid, `✅ No active groups found in database.`);
            isDispatching = false;
            return;
        }

        let totalRemindersSent = 0;
        let totalFailures = 0;
        let groupsProcessed = 0;

        for (let gIndex = 0; gIndex < groupsSnap.docs.length; gIndex++) {
            if (globalCancelFlag) break;

            const groupDoc = groupsSnap.docs[gIndex];
            const groupId = groupDoc.id;

            if (gIndex > 0) {
                console.log(`[GLOBAL-MANUAL] Waiting 15 minutes before reading ledger for @${groupId}...`);
                await client.sendMessage(requesterJid, `⏳ *Waiting 15m* before reading ledger for Group @${groupId}...`);
                await waitMinutes(15, 15);
                
                if (globalCancelFlag) break;
            }

            const groupSnap = await db.collection('groups').doc(groupId).get();
            if (!groupSnap.exists) continue; // Protection against ghost/deleted groups mid-run
            
            const groupData = groupSnap.data();
            const memberSnapshot = groupData.memberSnapshot || [];
            
            if (memberSnapshot.length === 0) continue; 

            const startAmt = groupData.startAmount || 0;
            const schedule = groupData.installmentSchedule || [];
            const allUserIds = memberSnapshot.map(m => m.id);

            const idBatches = chunkArray(allUserIds, 30);
            let userRecords = [];
            for (const batch of idBatches) {
                const userSnap = await db.collection('users').where(admin.firestore.FieldPath.documentId(), 'in', batch).get();
                userSnap.forEach(docSnap => { userRecords.push({ id: docSnap.id, ...docSnap.data() }); });
            }

            const snapshotMap = new Map();
            memberSnapshot.forEach(m => snapshotMap.set(m.id, m));

            const dispatchQueue = [];
            let groupPendingTotal = 0;

            for (const user of userRecords) {
                const expectedUserMonth = calculateParticipantExpectedMonth(user, groupData);
                const snap = snapshotMap.get(user.id) || { monthsPaid: 0 };
                const monthsPaid = snap.monthsPaid || 0;
                
                if (monthsPaid < expectedUserMonth) {
                    let totalOwed = 0;
                    let pendingMonthsList = [];

                    for (let m = monthsPaid + 1; m <= expectedUserMonth; m++) {
                        const dueForM = calculateDueForMonth(m, startAmt, schedule);
                        totalOwed += dueForM;
                        pendingMonthsList.push({ month: m, amount: dueForM });
                    }

                    const targetJid = formatIndianPhoneNumber(user.phone);
                    if (!targetJid) continue;

                    groupPendingTotal += totalOwed;

                    let breakdownText = "";
                    pendingMonthsList.forEach(pm => {
                        breakdownText += `- Month ${pm.month}: ₹${pm.amount.toLocaleString('en-IN')}\n`;
                    });

                    const participantName = (user.name || 'Participant').toUpperCase();
                    const groupName = (groupData.groupName || groupId).toUpperCase();

                    const message = 
`*Meena Chitfunds*
Group: ${groupName} (@${groupId})
Timeline: Month ${expectedUserMonth} of ${groupData.totalMonths || 0}

Dear ${participantName},
You have pending payments for the following months:

${breakdownText}
*Total Pending: ₹${totalOwed.toLocaleString('en-IN')}*

Kindly clear your dues at the earliest.

View your ledger & pay here:
https://corporationgoorac.github.io/ChitFunds/#${user.id}`;

                    dispatchQueue.push({ id: user.id, name: participantName, jid: targetJid, text: message, amount: totalOwed });
                }
            }

            // FIREBASE TRACKER: Global Loop
            let currentSysState = await STATE_DOC_REF.get();
            let sysData = currentSysState.exists ? currentSysState.data() : {};
            
            // QUEUE SYNC FIX
            if (sysData.currentProcessingGroup !== groupId || !sysData.pendingUsers) {
                let allPendingIds = dispatchQueue.map(item => item.id);
                await STATE_DOC_REF.set({
                    currentProcessingGroup: groupId,
                    pendingUsers: allPendingIds
                }, { merge: true });
                sysData.pendingUsers = allPendingIds;
            }
            
            let pendingUsers = sysData.pendingUsers || [];
            let filteredDispatchQueue = dispatchQueue.filter(item => pendingUsers.includes(item.id));

            if (filteredDispatchQueue.length > 0) {
                groupsProcessed++;
                await client.sendMessage(requesterJid, `🚀 *Dispatching Group @${groupId}*\nFound ${filteredDispatchQueue.length} defaulters. Starting 4-6m typing loop...`);

                let groupSuccessCount = 0;
                let groupFailCount = 0;

                for (let i = 0; i < filteredDispatchQueue.length; i++) {
                    if (globalCancelFlag) break;

                    const item = filteredDispatchQueue[i];
                    try {
                        await sendWithTyping(item.jid, item.text);
                        groupSuccessCount++;
                        totalRemindersSent++;
                        await STATE_DOC_REF.update({ pendingUsers: admin.firestore.FieldValue.arrayRemove(item.id) }).catch(err => console.error("Firebase Sync Error", err));
                    } catch (sendErr) {
                        groupFailCount++;
                        totalFailures++;
                    }

                    if (i < filteredDispatchQueue.length - 1) {
                        await waitMinutes(4, 6);
                    }
                }

                let postState = await STATE_DOC_REF.get();
                let postPending = postState.exists ? (postState.data().pendingUsers || []) : [];
                let remainingActionable = postPending.filter(id => dispatchQueue.some(item => item.id === id));
                
                if (!globalCancelFlag && remainingActionable.length === 0) {
                    await STATE_DOC_REF.update({
                        currentProcessingGroup: admin.firestore.FieldValue.delete(),
                        pendingUsers: admin.firestore.FieldValue.delete()
                    }).catch(err => console.error("Firebase Sync Error", err));
                    await client.sendMessage(finalReportTarget, `✅ *Completed Group @${groupId}*\nSent ${groupSuccessCount} reminders (₹${groupPendingTotal.toLocaleString('en-IN')} pending). Moving to next...`);
                }

            } else {
                console.log(`[GLOBAL-MANUAL] Group @${groupId} is fully paid up. Skipping.`);
            }

            // RAM GC Optimization for long waits
            userRecords = null;
            dispatchQueue.length = 0;
            snapshotMap.clear();
        }

        const reportTitle = globalCancelFlag ? "🏁 *Global Manual Dispatch Aborted!*" : "🏁 *Global Manual Dispatch Finished!*";
        const finalReport = 
`${reportTitle}

Processed ${groupsProcessed} active groups with pending dues.
- Total Reminders Sent: *${totalRemindersSent}*
- Delivery Failures: *${totalFailures}*

All queues are cleared.`;
        await client.sendMessage(finalReportTarget, finalReport);
        if (adminJid && adminJid !== requesterJid) {
            await client.sendMessage(requesterJid, `✅ Global Manual Dispatch action completed. Audit report sent to Admin.`);
        }
        console.log(`[GLOBAL COMPLETED] Finished manual dispatch for all groups.`);

    } catch (criticalErr) {
        console.error('[CRITICAL GLOBAL ERROR]:', criticalErr);
        await client.sendMessage(requesterJid, `❌ *Server Error during global execution:*\n${criticalErr.message}`);
    } finally {
        isDispatching = false;
    }
}

// --- 7. EXPRESS DASHBOARD ---
app.get('/api/status', (req, res) => {
    res.json({
        status: connectionStatus,
        user: connectedUser,
        qr: currentQRCodeDataURL
    });
});

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>WhatsApp Gateway - Meena Chitfunds</title>
  <style>
    :root {
      --bg-color: #f4f7f6;
      --text-main: #111111;
      --text-muted: #6b7280;
      --surface-color: #ffffff;
      --surface-hover: #f9fafb;
      --border-color: #e5e7eb;
      --brand-accent: #065fd4;
      --brand-accent-light: #e6f0fa;
      --danger-color: #dc3545;
      --danger-light: #fde8e8;
      --warning-color: #f59e0b;
      --warning-light: #fef3c7;
      --success-color: #0f9d58;
      --success-light: #e6f4ea;
      --card-shadow: 0 4px 12px rgba(0,0,0,0.03), 0 1px 3px rgba(0,0,0,0.02);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg-color: #0a0a0a;
        --text-main: #f8f9fa;
        --text-muted: #9ca3af;
        --surface-color: #141414;
        --surface-hover: #1f1f1f;
        --border-color: #2d2d2d;
        --brand-accent: #3ea6ff;
        --brand-accent-light: rgba(62, 166, 255, 0.15);
        --danger-color: #ff4e45;
        --danger-light: rgba(255, 78, 69, 0.15);
        --warning-color: #fbbf24;
        --warning-light: rgba(251, 191, 36, 0.15);
        --success-color: #34a853;
        --success-light: rgba(52, 168, 83, 0.15);
        --card-shadow: 0 4px 12px rgba(0,0,0,0.2);
      }
    }
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    body {
      background-color: var(--bg-color);
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 0; padding: 0;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      min-height: 100vh;
    }
    .container {
      width: 90%; max-width: 420px; background: var(--surface-color);
      border: 1px solid var(--border-color); border-radius: 24px; padding: 32px 24px;
      box-shadow: var(--card-shadow); text-align: center;
    }
    .status-badge {
      display: inline-block; padding: 6px 14px; border-radius: 20px;
      font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px;
      margin-bottom: 24px;
    }
    .status-badge.connected { background: var(--success-light); color: var(--success-color); }
    .status-badge.waiting { background: var(--warning-light); color: var(--warning-color); }
    .status-badge.offline { background: var(--danger-light); color: var(--danger-color); }
    .qr-box {
      width: 250px; height: 250px; margin: 0 auto 24px;
      border: 2px dashed var(--border-color); border-radius: 16px;
      display: flex; align-items: center; justify-content: center;
      background: var(--surface-hover); overflow: hidden;
    }
    .qr-box img { width: 100%; height: 100%; object-fit: contain; }
    .title { font-size: 20px; font-weight: 800; margin: 0 0 8px 0; }
    .subtitle { font-size: 13px; color: var(--text-muted); font-weight: 500; margin: 0 0 24px 0; line-height: 1.4; }
    .command-box {
      background: var(--bg-color); border: 1px solid var(--border-color);
      border-radius: 12px; padding: 12px; font-family: monospace; font-size: 13px;
      font-weight: 700; color: var(--brand-accent); word-break: break-all;
    }
  </style>
</head>
<body>
  <div class="container">
    <div id="badge" class="status-badge waiting">Connecting Server...</div>
    <h2 class="title">WhatsApp Gateway</h2>
    <p class="subtitle" id="instruction">Establishing secure link with WhatsApp Web services...</p>

    <div class="qr-box" id="qr-container">
      <div style="font-size: 12px; color: var(--text-muted); font-weight: 700;">Loading...</div>
    </div>

    <div style="text-align: left; margin-top: 16px;">
      <div style="font-size: 11px; text-transform: uppercase; font-weight: 800; color: var(--text-muted); margin-bottom: 6px;">Trigger Syntax</div>
      <div class="command-box" style="margin-bottom: 8px;">Chitfunds &lt;groupId&gt; <span style="float:right; font-size: 11px; color: var(--text-muted);">Single Group</span></div>
      <div class="command-box" style="margin-bottom: 8px;">Chitfunds all <span style="float:right; font-size: 11px; color: var(--text-muted);">Global Auto-Run</span></div>
      <div class="command-box">Chitfunds stop <span style="float:right; font-size: 11px; color: var(--danger-color);">Kill Switch</span></div>
    </div>
  </div>

  <script>
    async function syncStatus() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();

        const badge = document.getElementById('badge');
        const qrContainer = document.getElementById('qr-container');
        const instruction = document.getElementById('instruction');

        if (data.status === 'connected') {
          badge.className = 'status-badge connected';
          badge.innerText = 'Connected • Online';
          instruction.innerText = 'Bot is active. Listening for WhatsApp commands.';
          qrContainer.innerHTML = '<svg viewBox="0 0 24 24" width="72" height="72" fill="var(--success-color)"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>';
        } else if (data.status === 'qr_ready' && data.qr) {
          badge.className = 'status-badge waiting';
          badge.innerText = 'Scan QR Code';
          instruction.innerText = 'Open WhatsApp > Linked Devices > Link a Device.';
          qrContainer.innerHTML = '<img src="' + data.qr + '" alt="QR Code">';
        } else {
          badge.className = 'status-badge offline';
          badge.innerText = 'Initializing';
          instruction.innerText = 'Connecting to WhatsApp network...';
        }
      } catch (err) {
        console.error(err);
      }
    }

    setInterval(syncStatus, 3000);
    syncStatus();
  </script>
</body>
</html>
    `);
});

// --- 8. START SERVER ---
server.listen(PORT, () => {
    console.log(`[HTTP] Express Dashboard active on http://0.0.0.0:${PORT}`);
    startWhatsAppBot();
});
