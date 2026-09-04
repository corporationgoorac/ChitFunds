const express = require('express'); // FIXED: Lowercase 'const'
const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const qrcode = require('qrcode'); // 🚀 ADVANCED ADDITION: Added qrcode library for image generation

// 🛠️ FIX: Gracefully handle dotenv for Hugging Face compatibility
try {
    require('dotenv').config();
} catch (e) {
    console.log("ℹ️ 'dotenv' module not found. Relying on native environment variables (Hugging Face Secrets).");
}

// FORCE ENTIRE SERVER NATIVELY INTO INDIAN STANDARD TIME (IST)
process.env.TZ = "Asia/Kolkata";

// =========================================================
// 📱 CONFIGURE YOUR WHATSAPP NUMBER HERE 
// Securely pulling from environment variables / Hugging Face Secrets.
// =========================================================
const LINKING_PHONE_NUMBER = process.env.PHONE;

if (!LINKING_PHONE_NUMBER) {
    console.error("⚠️ [CRITICAL WARNING] 'PHONE' secret is missing! (Warning kept for backward compatibility).");
}

// ---------------------------------------------------------
// PRODUCTION FIX: GLOBAL ERROR HANDLERS
// ---------------------------------------------------------
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ [CRITICAL] Background Promise Rejection caught:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('⚠️ [CRITICAL] Background Exception caught:', error);
});

// --- 1. EXPRESS SERVER INIT ---
const app = express();
const port = process.env.PORT || 7860; // 7860 is the default port for Hugging Face Spaces

app.use(express.json());

// --- 2. FIREBASE ADMIN SDK INIT ---
// In Hugging Face, go to Settings -> Secrets and add FIREBASE_SERVICE_ACCOUNT
try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        
        // ADVANCED EDGE CASE FIX: Prevent Firebase from initializing multiple times if server re-routes
        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
        }
        console.log("✅ Firebase Admin initialized securely from Secrets.");
    } else {
        console.warn("⚠️ FIREBASE_SERVICE_ACCOUNT secret is missing in Hugging Face.");
    }
} catch (error) {
    console.error("❌ Firebase Admin init failed:", error);
}

// --- NEW API ENDPOINT: Force WA Client Restart for Fresh Code ---
let isGeneratingNewCode = false; 

app.post('/api/refresh-code', async (req, res) => {
    try {
        isGeneratingNewCode = true; 
        console.log("🔄 Manual client restart requested for a fresh QR code...");
        try {
            await client.destroy();
        } catch(e) {
            // Ignore if already dead
        }
        
        try {
            if (fs.existsSync('qr-code.png')) {
                fs.unlinkSync('qr-code.png');
            }
            // Fallback cleanup for legacy pairing file
            if (fs.existsSync('pairing-code.txt')) {
                fs.unlinkSync('pairing-code.txt');
            }
        } catch (fsErr) {
            console.error("⚠️ Could not delete old artifacts during refresh:", fsErr.message);
        }
        
        // Wait 2 seconds for clean destruction before booting up again
        setTimeout(startWhatsAppClient, 2000);
        res.json({ success: true });
    } catch (error) {
        console.error("Failed to refresh code:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- NEW API ENDPOINT: Smart status checking ---
app.get('/api/pairing-status', (req, res) => {
    const codePath = path.join(__dirname, 'qr-code.png');
    const sessionPath = path.join(__dirname, 'wa_session');
  
    if (fs.existsSync(codePath)) {
        isGeneratingNewCode = false; 
        try {
            // Read the PNG and send it as a base64 Data URL to the frontend
            const qrBase64 = fs.readFileSync(codePath, 'base64');
            res.json({ ready: true, qr: `data:image/png;base64,${qrBase64}`, linked: false });
        } catch (fsReadErr) {
            console.error("⚠️ File read collision on QR code:", fsReadErr.message);
            res.json({ ready: false, linked: false }); 
        }
    } else {
        if (isGeneratingNewCode) {
            res.json({ ready: false, linked: false });
        } 
        else if (fs.existsSync(sessionPath)) {
            res.json({ ready: false, linked: true });
        } 
        else {
            res.json({ ready: false, linked: false });
        }
    }
});

// Serve the Professional UI directly from the root URL
app.get('/', (req, res) => {
    const htmlTemplate = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>WhatsApp Device Link - Meena Chitfunds</title>
        <style>
            body {
                margin: 0; padding: 0;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                background-color: #0b111a;
                color: #e9edef;
                display: flex; flex-direction: column; align-items: center; justify-content: center;
                min-height: 100vh;
            }
            .container {
                background-color: #131b26; padding: 40px 25px;
                border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
                border: 1px solid #1e293b;
                text-align: center; max-width: 400px; width: 85%;
                box-sizing: border-box;
            }
            h2 { 
                color: #065fd4;
                margin-top: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;
            }
            p { color: #94a3b8; font-size: 15px; line-height: 1.5; margin-bottom: 30px; }
            .code-container {
                background: #ffffff; padding: 10px; border-radius: 12px;
                display: inline-block; margin-bottom: 25px; border: 1px solid #1e293b;
                width: 100%; max-width: 280px;
                box-sizing: border-box;
            }
            .code-container img {
                width: 100%; height: auto; border-radius: 8px; display: block;
            }
            .btn {
                background-color: #065fd4; color: #ffffff;
                border: none; padding: 14px 24px; border-radius: 24px;
                font-weight: 700; font-size: 15px; cursor: pointer;
                transition: background 0.2s; width: 100%; margin-bottom: 12px;
                box-sizing: border-box;
            }
            .btn:active { background-color: #044ba6; }
            .btn-secondary {
                background-color: transparent; color: #065fd4;
                border: 1px solid #065fd4; padding: 14px 24px; border-radius: 24px;
                font-weight: 700; font-size: 15px; cursor: pointer;
                transition: all 0.2s; width: 100%; margin-bottom: 12px; box-sizing: border-box;
            }
            .btn-secondary:active { background-color: rgba(6, 95, 212, 0.1); }
            .btn:disabled, .btn-secondary:disabled { opacity: 0.6; cursor: not-allowed; }
            .loader {
                border: 4px solid #1e293b; border-top: 4px solid #065fd4;
                border-radius: 50%; width: 45px; height: 45px;
                animation: spin 1s linear infinite; margin: 0 auto 25px;
            }
            .footer { margin-top: 25px; font-size: 12px; color: #64748b; font-weight: 500;}
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            
            /* Success Animation */
            .success-icon {
                font-size: 60px; margin-bottom: 15px; display: inline-block;
                animation: popIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
            }
            .pulse { display: inline-block; width: 18px; height: 18px; background-color: #10b981; border-radius: 50%; box-shadow: 0 0 0 rgba(16, 185, 129, 0.4); animation: pulse 2s infinite; vertical-align: middle; margin-right: 8px; }
            @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); } 70% { box-shadow: 0 0 0 15px rgba(16, 185, 129, 0); } 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); } }
            @keyframes popIn { 0% { transform: scale(0); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>Meena Chitfunds Server</h2>
            <div id="dynamic-content">
                <div class="loader"></div>
                <p>Checking system status...</p>
            </div>
        </div>
        <div class="footer">Securely managed by Goorac Systems</div>

        <script>
            let currentState = "INIT";
            let currentCode = "";
            
            function renderCode(qrSrc) {
                document.getElementById('dynamic-content').innerHTML = \`
                    <p>Open WhatsApp on your primary phone, navigate to <b>Linked Devices</b>, and scan the QR code below.</p>
                    <div class="code-container">
                      <img src="\` + qrSrc + \`" alt="WhatsApp QR Code">
                    </div>
                    <button class="btn-secondary" id="refresh-btn" onclick="forceNewCode()">🔄 Generate New QR</button>
                \`;
            }

            function forceNewCode() {
                const btn = document.getElementById('refresh-btn');
                if (btn) { btn.innerText = '⏳ Generating...'; btn.disabled = true; }
                
                // Tell backend to restart client
                fetch('/api/refresh-code', { method: 'POST' }).catch(err => console.error(err));
                
                // Immediately switch to waiting state visually
                currentState = 'WAITING';
                currentCode = '';
                document.getElementById('dynamic-content').innerHTML = \`
                    <div class="loader"></div>
                    <p>Requesting fresh QR code from WhatsApp...<br><br>Please wait a few seconds.</p>
                \`
            }
            
            function checkStatus() {
                fetch('/api/pairing-status')
                    .then(res => res.json())
                    .then(data => {
                        const container = document.getElementById('dynamic-content');
                        if (!container) return;

                        if (data.ready && data.qr) {
                            // Detected a pairing QR
                            if (currentState !== 'CODE' || currentCode !== data.qr) {
                                currentState = 'CODE';
                                currentCode = data.qr;
                                renderCode(data.qr);
                            }
                        } else if (data.linked) {
                            // Session connected
                            if (currentState !== 'LINKED') {
                                currentState = 'LINKED';
                                container.innerHTML = \`
                                    <div class="success-icon">✅</div>
                                    <p style="color: #10b981; font-weight: bold; font-size: 22px; margin-bottom: 10px; display: flex; align-items: center; justify-content: center;"><span class="pulse"></span> Online</p>
                                    <p>Meena Chitfunds WhatsApp Server is securely connected and actively monitoring schedules.</p>
                                    <button class="btn-secondary" style="margin-top: 15px;" onclick="forceNewCode()">🔄 Re-Link Device</button>
                                \`;
                            }
                        } else {
                            // Booting up
                            if (currentState !== 'WAITING') {
                                currentState = 'WAITING';
                                container.innerHTML = \`
                                    <div class="loader"></div>
                                    <p>The system is generating the QR Code.<br><br>Waiting for WhatsApp Engine...</p>
                                \`;
                            }
                        }
                    })
                    .catch(err => console.error('Polling Error:', err))
                    .finally(() => {
                        setTimeout(checkStatus, 2500); 
                    });
            }
            checkStatus();
        </script>
    </body>
    </html>
    `;
    res.send(htmlTemplate);
});

// ADVANCED NETWORK BINDING FIX: Bind to 0.0.0.0 explicitly for Hugging Face Docker stability
app.listen(port, '0.0.0.0', () => {
    console.log(`🌐 Server running securely on port ${port}`);
}).on('error', (err) => {
    console.error('⚠️ [CRITICAL] Express Server Error:', err);
});

// --- 3. WHATSAPP WEB INIT (RAM OPTIMIZED) ---
let waStatus = 'INITIALIZING'; // INITIALIZING, QR_READY, CONNECTED
let isInitializing = false; // Flag to prevent multiple initializations simultaneously

// ADVANCED EDGE CASE FIX: Flags to prevent duplicate scheduler clones and memory leaks
let isCheckModuleLoaded = false; 
let isClientDestroying = false;

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './wa_session' }), // Saves session to prevent re-scanning
    authTimeoutMs: 0, // Infinite timeout to prevent HuggingFace timeout crashes
    puppeteer: {
        headless: true,
        timeout: 0,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', // Critical for Docker/Hugging Face
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--disable-gpu',
            '--js-flags="--max-old-space-size=450"', // UPDATED: Limit JS Heap strictly to 450MB
            // EXTRA RAM SAVERS:
            '--disable-extensions',
            '--memory-pressure-off',
            // NETWORK FORGIVENESS FLAGS:
            '--ignore-certificate-errors',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--proxy-server="direct://"', 
            '--proxy-bypass-list=*', 
            '--disable-features=NetworkService',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ]
    }
});

// 🚀 ADVANCED ADDITION: Dynamic QR Image Generator
client.on('qr', async (qr) => {
    console.log('🔄 Authentication required. Generating QR code...');
    waStatus = 'QR_READY';
    isInitializing = false; // THE DEADLOCK FIX: Unlock here so it can reboot if needed
    
    try {
        // Generate QR code as PNG and save to disk safely
        await qrcode.toFile('qr-code.png', qr, {
            color: {
                dark: '#000000',  // Optimal scanning contrast
                light: '#ffffff'
            }
        });
        
        console.log('====================================================');
        console.log(`🔢 SUCCESS: QR code generated and saved to UI.`);
        console.log('====================================================');
        
    } catch (err) {
        console.error('❌ Failed to generate QR code:', err.message);
    }
});

// Event: Successfully Connected
client.on('ready', () => {
    console.log('✅ WhatsApp Client is READY and ONLINE!');
    waStatus = 'CONNECTED';
    isInitializing = false; // Reset lock once safely connected
    
    // --- CLEAN UP QR CODE AFTER SUCCESSFUL CONNECTION ---
    try {
        if (fs.existsSync('qr-code.png')) {
            fs.unlinkSync('qr-code.png');
        }
        
        // Safety cleanup for old legacy artifacts
        if (fs.existsSync('pairing-code.txt')) {
            fs.unlinkSync('pairing-code.txt');
        }
    } catch (fsErr) {
        console.error("⚠️ Minor warning: Could not delete old artifacts:", fsErr.message);
    }

    // --- EXECUTE CHECK.JS IF AVAILABLE ---
    // ADVANCED EDGE CASE FIX: Prevent check.js from being cloned every time WA reconnects
    if (!isCheckModuleLoaded) {
        const checkScriptPath = path.join(__dirname, 'check.js');
        if (fs.existsSync(checkScriptPath)) {
            console.log('🚀 check.js found! Initializing automated scheduled tasks...');
            const checkLogic = require('./check.js');
            // Pass the connected client and firebase admin to check.js
            if(typeof checkLogic === 'function') {
                // THE SUICIDE GUARD: Prevent check.js syntax errors from crashing the main connection
                try {
                    checkLogic(client, admin);
                    isCheckModuleLoaded = true; // Lock the module so it never runs twice!
                } catch (error) {
                    console.error("❌ check.js failed to start safely:", error);
                }
            }
        } else {
            console.log('ℹ️ check.js not found. Skipping automation startup.');
        }
    } else {
        console.log('⚡ WhatsApp Reconnected: check.js is already running safely in the background.');
    }
});

// --- NEW EVENT: AUTHENTICATION FAILURE GUARD ---
client.on('auth_failure', msg => {
    console.error('❌ Authentication Failure (Corrupted Session):', msg);
    waStatus = 'DISCONNECTED';
    isInitializing = false; // Release lock so it can be destroyed and rebooted cleanly
});

// Event: Disconnected (Requires re-scan)
// ADVANCED EDGE CASE FIX: Added 'async' to allow for safe memory destruction
client.on('disconnected', async (reason) => {
    console.log('❌ Client was logged out or disconnected:', reason);
    waStatus = 'DISCONNECTED';
    
    // Safely reboot client, preventing multiple simultaneous calls
    if (!isInitializing && !isClientDestroying) {
        isInitializing = true;
        isClientDestroying = true;
        
        // ADVANCED EDGE CASE FIX: Purge the corrupted browser instance before rebooting
        console.log("🧹 Safe Reboot: Destroying corrupted WhatsApp instance from RAM...");
        
        // THE GUILLOTINE GUARD: If destroy() hangs forever, kill it after 5 seconds
        await Promise.race([
            client.destroy().catch(() => {}),
            new Promise(res => setTimeout(res, 5000))
        ]);
        
        isClientDestroying = false;

        // THE FILE LOCK GUARD: Wait 5 seconds to let the OS release session files before restarting
        console.log("⏳ Waiting 5 seconds to release OS file locks...");
        setTimeout(() => {
            startWhatsAppClient(); // Safely reboot client
        }, 5000);
    }
});

// --- 4. PREVENT MEMORY LEAKS (RAM CLEARING) ---
// Every 15 minutes, safely clear browser cache without logging out
setInterval(async () => {
    // ADVANCED CRASH GUARD: Added !client.pupPage.isClosed() to prevent querying a dead browser
    if (waStatus === 'CONNECTED' && client.pupPage && !client.pupPage.isClosed()) {
        try {
            await client.pupPage.evaluate(() => performance.clearResourceTimings());
            
            // Deep safe RAM clear via CDP (Chrome DevTools Protocol) without disrupting session
            const clientCDP = await client.pupPage.target().createCDPSession();
            await clientCDP.send('Network.clearBrowserCache');
            await clientCDP.send('HeapProfiler.collectGarbage');
            await clientCDP.detach();
            
            //console.log("🧹 Headless Browser RAM & Cache optimized to stay under 450MB.");
        } catch (e) {
            // Simplified error output so it doesn't flood your logs if it fails once
            console.error("Failed to clear RAM:", e.message);
        }
    }
}, 15 * 60 * 1000);

// --- ADVANCED AUTO-RETRY ON NETWORK TIMEOUT ---
async function startWhatsAppClient() {
    if (isInitializing) return; // Prevent double boot
    isInitializing = true;
    console.log("🚀 Booting WhatsApp Client...");
    try {
        await client.initialize();
    } catch (err) {
        console.error("❌ WhatsApp Engine Failed to Start:", err.message);
        console.log("🧹 Cleaning up locked browser instance...");
        
        try {
            await client.destroy(); 
        } catch (destroyErr) {
            // Ignore if the browser is already completely dead
        }
        
        isInitializing = false;
        console.log("🔄 Network timeout detected. Retrying safely in 15 seconds...");
        setTimeout(startWhatsAppClient, 15000);
    }
}

// Initialize the engine
startWhatsAppClient();

// Export for other files to use
module.exports = { client, admin };
