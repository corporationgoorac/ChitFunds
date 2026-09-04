const { MessageMedia } = require('whatsapp-web.js'); // FIXED: Lowercase 'const' prevents startup crash
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Use the existing Firestore instance
const db = admin.firestore();

// ---------------------------------------------------------
// 1. THE SMART ROUTER & MESSAGE LISTENER (CHITFUNDS ONLY)
// ---------------------------------------------------------
module.exports = function(client) {
    // ADVANCED EDGE CASE FIX: Prevent duplicate event listeners and memory leaks if called multiple times
    if (client._checkEngineLoaded) {
        console.log("⚡ [CHECK.JS] Engine is already running. Preventing duplicate listeners.");
        return;
    }
    client._checkEngineLoaded = true;

    console.log("🤖 Goorac Bot Listener Active (Meena Chitfunds Engine)");

    // --- ADVANCED MEMORY GUARD: Prevents crashes on low-resource environments ---
    // ADVANCED EDGE CASE FIX: Ensure only one interval runs ever, avoiding CPU leaks
    if (!global._memoryMonitorActive) {
        global._memoryMonitorActive = true;
        const monitorMemory = setInterval(async () => {
            const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024;
            if (memoryUsage > 450) { 
                console.log(`⚠️ High Memory Detected (${Math.round(memoryUsage)}MB). Purging message cache...`);
                if (client.pupPage) {
                    await client.pupPage.evaluate(() => {
                        if (typeof window !== 'undefined' && window.Store && window.Store.Msg) { 
                            window.Store.Msg.clear();
                        }
                    }).catch(() => {});
                }
            }
        }, 300000); 
    }

    client.on('message', async (msg) => {
        // EDGE CASE FIX: Normalizing the input perfectly (mmd016 -> MMD016, "MMD 016" -> MMD016)
        const input = msg.body.trim().toUpperCase().replace(/\s+/g, '');

        // REGEX ROUTER FOR CHITFUNDS (2+ Letters followed by numbers)
        const chitfundPattern = /^[A-Z]{2,}\d+$/; 

        // =========================================================
        // ROUTE: MEENA CHITFUNDS (0-Read Optimized Logic)
        // =========================================================
        if (chitfundPattern.test(input)) {
            console.log(`🏦 [CHITFUNDS ROUTE] Processing Request for Participant: ${input}`);
            
            try {
                // 1-Read Optimization Document Lookup
                const userRef = db.collection('users').doc(input);
                const userSnap = await userRef.get();
                
                if (!userSnap.exists) {
                    // ADVANCED CRASH GUARD: Appended .catch() to prevent Unhandled Promise Rejections if WA Web disconnects mid-message
                    return msg.reply("❌ *Participant ID not found.*\nPlease check the ChitFund ID and try again.\n\n❌ *பங்கேற்பாளர் எண் காணப்படவில்லை.*\nஎண்ணை சரிபார்த்து மீண்டும் முயற்சிக்கவும்.").catch(e => console.error("Reply failed safely:", e.message));
                }

                const user = userSnap.data(); 
                user.id = userSnap.id;
                const activeGroups = user.activeGroups || [];
                
                if (activeGroups.length === 0) {
                    return msg.reply(`⚠️ Record found for *${user.name}*, but no active Chit Groups were found.\n\n⚠️ *${user.name}* க்கான பதிவு உள்ளது, ஆனால் செயலில் உள்ள குழுக்கள் எதுவும் இல்லை.`).catch(e => console.error("Reply failed safely:", e.message));
                }

                await msg.reply(`✨ _Meena Chitfunds_\nFound *${activeGroups.length}* active group(s) for *${user.name}*.\n\n📥 _Generating Financial Ledgers..._ | _அறிக்கைகளை உருவாக்குகிறது..._`).catch(e => console.error("Reply failed safely:", e.message));

                for (const groupId of activeGroups) {
                    // Fetch Group Data (1 Read)
                    const groupSnap = await db.collection('groups').doc(groupId).get();
                    if (!groupSnap.exists) continue;
                    const groupData = groupSnap.data();
                    groupData.id = groupSnap.id;

                    // Fetch Transactions ONLY for this user in this specific group
                    // BUG FIX: Since payouts are in 'auctions' collection now, this pure transactions call is naturally 100% correct!
                    const txnsSnap = await db.collection('transactions')
                        .where('subscriberId', '==', input)
                        .where('groupId', '==', groupId)
                        .get();
                    
                    let transactions = [];
                    txnsSnap.forEach(doc => transactions.push(doc.data()));

                    // Generate the Premium ChitFund Dashboard Image
                    const imageBuffer = await generateChitfundImage(client, user, groupData, transactions);

                    const media = new MessageMedia('image/png', imageBuffer.toString('base64'), `Ledger_${input}_${groupId}.png`);
                    
                    // UPDATED SECURE LINK
                    const caption = `👤 *Participant / பங்கேற்பாளர்:* ${user.name}\n👥 *Group / குழு:* ${groupData.groupName}\n🆔 *ID:* @${input}\n\n🌐 *View full ledger / முழு கணக்கு விவரங்களை காண:*\nhttps://meena.goorac.biz/chit#${input}\n\n✨ _Secured by Goorac_`;

                    // ADVANCED CRASH GUARD: Prevent crash if large image payload fails to send due to network drop
                    await client.sendMessage(msg.from, media, { caption: caption }).catch(e => console.error("Media send failed safely:", e.message));
                }
                console.log(`✅ Chitfunds Ledger(s) sent successfully for ${input}`);

            } catch (error) {
                console.error("❌ Chitfunds Bot Error:", error);
                msg.reply("⚠️ *System Busy:* Could not generate the ledger at this moment. Please try again later.").catch(() => {});
            }
        }
    });
};


// ---------------------------------------------------------
// CALCULATION ENGINES (0 EXTRA READS & EDGE CASE PROTECTED)
// ---------------------------------------------------------
function calculateCurrentMonth(startDateStr) {
    if(!startDateStr) return 1; 
    
    // FIREBASE BUG FIX: Safely handle both standard Strings and Firestore Native Timestamps natively
    const start = (typeof startDateStr.toDate === 'function') ? startDateStr.toDate() : new Date(startDateStr);
    
    if (isNaN(start)) return 1; // Failsafe for invalid dates
    
    const now = new Date();
    let months = (now.getFullYear() - start.getFullYear()) * 12;
    months -= start.getMonth();
    months += now.getMonth();
    return months <= 0 ? 1 : months + 1; 
}

// NEW ALGORITHM: Deep dynamic timeline calculating from joinedAt point
function calculateParticipantExpectedMonth(user, groupData) {
    if (!user || !groupData) return 1;
    const start = user?.joinedAt ? (typeof user.joinedAt.toDate === 'function' ? user.joinedAt.toDate() : new Date(user.joinedAt)) : new Date(groupData?.startDate || new Date());
    
    if (isNaN(start)) return 1;
    
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

function calculateDueForMonth(targetMonth, startAmount, schedule) {
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


// =========================================================
// IMAGE GENERATOR: MEENA CHITFUNDS (Premium Dashboard UI)
// =========================================================
async function generateChitfundImage(client, user, group, transactions) {
    let page;
    try {
        if (!client.pupBrowser) throw new Error("Puppeteer browser instance is not available.");
        
        // --- CHROME TAB BUG FIX 1: Prevent newPage() from hanging infinitely ---
        let newPageTimeout;
        page = await Promise.race([
            client.pupBrowser.newPage(),
            new Promise((_, reject) => { newPageTimeout = setTimeout(() => reject(new Error("newPage timeout")), 10000); })
        ]).finally(() => clearTimeout(newPageTimeout)); // Clears floating timer
        
        // MOBILE FIX: Viewport updated to a sleek mobile vertical frame (540px).
        // Added deviceScaleFactor: 2 for ultra-crisp Retina WhatsApp images!
        await page.setViewport({ width: 540, height: 1000, deviceScaleFactor: 2 });

        const isDarkTheme = Math.random() > 0.5;
        
        // META THEME FIX: Professional OLED-ready darks and deeper, richer accents
        const theme = {
            bg: isDarkTheme ? '#050505' : '#f8f9fa',
            cardBg: isDarkTheme ? '#111111' : '#ffffff',
            textMain: isDarkTheme ? '#f8fafc' : '#0f172a',
            textMuted: isDarkTheme ? '#94a3b8' : '#64748b',
            borderColor: isDarkTheme ? '#262626' : '#e2e8f0',
            tableBg: isDarkTheme ? '#1a1a1a' : '#f1f5f9',
            brandBlue: isDarkTheme ? '#2563eb' : '#0ea5e9',
            brandBlueLight: isDarkTheme ? 'rgba(37, 99, 235, 0.15)' : '#e0f2fe',
            auctionPurple: isDarkTheme ? '#8b5cf6' : '#6366f1',
            auctionPurpleLight: isDarkTheme ? 'rgba(139, 92, 246, 0.15)' : '#f0f9ff',
            success: isDarkTheme ? '#10b981' : '#059669',
            danger: isDarkTheme ? '#ef4444' : '#dc2626'
        };

        const totalPot = parseFloat(group.totalPot) || 0;
        const totalMonths = parseInt(group.totalMonths) || 0;
        const membersCount = parseInt(group.participantCount) || 0;
        
        // FIX: Remove auto-generated advance payments from standard array to avoid double-counting
        const validTransactions = transactions.filter(txn => txn.type !== "Advance Payment");

        // BUG FIX: Advanced Secondary Sort. First sorts by Month, then falls back to exact Date timestamp
        // This prevents multiple payments in the same month from displaying out of order
        validTransactions.sort((a, b) => {
            const monthDiff = (parseFloat(a.monthAttributed) || 0) - (parseFloat(b.monthAttributed) || 0);
            if (monthDiff !== 0) return monthDiff;
            const timeA = a.date && typeof a.date.toMillis === 'function' ? a.date.toMillis() : 0;
            const timeB = b.date && typeof b.date.toMillis === 'function' ? b.date.toMillis() : 0;
            return timeA - timeB;
        });

        // NEW LOGIC: Initialize calculation safely with the independent Advance Amount
        let advanceAmt = user?.advanceAmount ? parseFloat(user.advanceAmount) : 0;
        let runningPaid = advanceAmt;
        let lastMonthPaid = 0;

        let processedLedger = validTransactions.map(txn => {
            runningPaid += parseFloat(txn.amount) || 0;
            if(txn.monthAttributed > lastMonthPaid) lastMonthPaid = txn.monthAttributed;
            
            let displayDate = "N/A";
            if(txn.date && typeof txn.date.toDate === 'function') {
                displayDate = txn.date.toDate().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
            }
            return { ...txn, displayDate: displayDate, cumulativePaid: runningPaid };
        });

        // Visually prepend the Advance Amount so the user clearly sees it
        if (advanceAmt > 0) {
            processedLedger.unshift({
                monthAttributed: 'Adv',
                displayDate: 'At Join',
                type: 'Advance',
                amount: advanceAmt,
                cumulativePaid: advanceAmt
            });
        }

        // Exact Calculator Logic for This Month's Due & Auction Value
        // NEW ALGORITHM: Using Participant's Joined Date dynamic calculator instead of static group start date
        let calcMonth = calculateParticipantExpectedMonth(user, group);
        if(calcMonth > totalMonths) calcMonth = totalMonths;
        
        const thisMonthDue = calculateDueForMonth(calcMonth, group.startAmount || 0, group.installmentSchedule || []);
        const currentAuctionValue = thisMonthDue * membersCount;
        
        const progressPercent = totalMonths > 0 ? Math.min((lastMonthPaid / totalMonths) * 100, 100) : 0;

        // --- NEW: ADVANCED PENDING DUES CALCULATION ENGINE ---
        let pendingAmount = 0;
        let pendingMonthsCount = 0;
        if (calcMonth > lastMonthPaid) {
            pendingMonthsCount = calcMonth - lastMonthPaid;
            for (let m = lastMonthPaid + 1; m <= calcMonth; m++) {
                pendingAmount += calculateDueForMonth(m, group.startAmount || 0, group.installmentSchedule || []);
            }
        }

        const last10 = processedLedger.slice(-10).reverse();

        const getStatusBadge = (type) => {
            if(type === "Auction Payout") return `<span style="color: ${theme.auctionPurple}; font-weight: 800;">AUCTION</span>`;
            if(type === "Advance") return `<span style="color: ${theme.success}; font-weight: 800;">ADVANCE</span>`;
            return `<span style="color: ${theme.success}; font-weight: 800;">PAID</span>`;
        };

        // MOBILE LAYOUT FIX: Changed width to 540px and stacked the grid components using 1fr
        const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=SF+Pro+Display:wght@400;600;700;800&display=swap');
                body { background: ${theme.bg}; color: ${theme.textMain}; font-family: 'SF Pro Display', -apple-system, sans-serif; margin: 0; padding: 30px; width: 540px; box-sizing: border-box; display: flex; flex-direction: column; min-height: 1000px;}
                
                .header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 20px; border-bottom: 1px solid ${theme.borderColor}; margin-bottom: 24px;}
                .logo { font-size: 24px; font-weight: 800; letter-spacing: -1px; color: ${theme.textMain};}
                .badge { background: ${theme.brandBlueLight}; color: ${theme.brandBlue}; padding: 6px 14px; border-radius: 20px; font-weight: 800; font-size: 11px; text-transform: uppercase; letter-spacing: 1px;}
                
                .profile-card { display: flex; align-items: center; gap: 16px; background: ${theme.cardBg}; border: 1px solid ${theme.borderColor}; border-radius: 20px; padding: 24px; margin-bottom: 20px; box-shadow: ${isDarkTheme ? '0 10px 30px rgba(0,0,0,0.4)' : '0 10px 30px rgba(0,0,0,0.05)'};}
                .avatar { width: 64px; height: 64px; border-radius: 18px; background: linear-gradient(135deg, ${theme.brandBlue}, #004ba0); color: white; display: flex; justify-content: center; align-items: center; font-size: 28px; font-weight: 800; flex-shrink: 0; }
                .p-info h1 { margin: 0 0 6px 0; font-size: 28px; font-weight: 800; letter-spacing: -1px; text-transform: uppercase; line-height: 1.1;}
                .p-meta { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: ${theme.textMuted}; font-weight: 600; }
                .id-tag { font-family: monospace; background: ${theme.borderColor}; padding: 3px 6px; border-radius: 6px; color: ${theme.textMain}; display: inline-block;}

                .dashboard-grid { display: grid; grid-template-columns: 1fr; gap: 16px; margin-bottom: 20px; }
                
                .metric-card { background: ${theme.cardBg}; border: 1px solid ${theme.borderColor}; border-radius: 20px; padding: 20px; display: flex; flex-direction: column; justify-content: space-between; box-shadow: ${isDarkTheme ? 'none' : '0 4px 15px rgba(0,0,0,0.02)'};}
                
                /* Dynamic Pending Dues Card Styling */
                .metric-card.pending { background: linear-gradient(135deg, ${pendingAmount > 0 ? theme.danger : theme.success}, ${pendingAmount > 0 ? '#991b1b' : '#065f46'}); color: white; border: none; }
                .m-label { font-size: 11px; color: ${theme.textMuted}; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;}
                .metric-card.pending .m-label { color: rgba(255,255,255,0.8); }
                .m-val { font-size: 32px; font-weight: 800; margin: 0 0 12px 0; letter-spacing: -1px;}
                
                .progress-container { width: 100%; height: 8px; background: ${theme.borderColor}; border-radius: 4px; overflow: hidden; margin-top: auto;}
                .progress-fill { height: 100%; background: ${theme.success}; border-radius: 4px; width: ${progressPercent}%;}
                .p-text { font-size: 11px; font-weight: 700; color: ${theme.textMuted}; margin-top: 8px; display: flex; justify-content: space-between;}

                .ledger-box { flex: 1; background: ${theme.cardBg}; border: 1px solid ${theme.borderColor}; border-radius: 20px; padding: 20px; box-shadow: ${isDarkTheme ? 'none' : '0 4px 15px rgba(0,0,0,0.02)'}; margin-bottom: 20px;}
                .l-title { font-size: 16px; font-weight: 800; margin-bottom: 16px; color: ${theme.textMain}; text-transform: uppercase; letter-spacing: 0.5px;}
                
                table { width: 100%; border-collapse: collapse; }
                th { text-align: left; font-size: 10px; color: ${theme.textMuted}; padding: 10px 8px; text-transform: uppercase; font-weight: 800; border-bottom: 2px solid ${theme.borderColor};}
                td { padding: 12px 8px; font-size: 13px; font-weight: 600; border-bottom: 1px solid ${theme.borderColor}; }
                .pill { background: ${theme.brandBlueLight}; color: ${theme.brandBlue}; padding: 4px 8px; border-radius: 6px; font-size: 11px; font-family: monospace;}
                
                .footer { margin-top: auto; padding-top: 16px; display: flex; justify-content: space-between; font-size: 11px; font-weight: 600; color: ${theme.textMuted}; border-top: 1px solid ${theme.borderColor};}
            </style>
        </head>
        <body>
            <div class="header">
                <div class="logo">Meena Chitfunds</div>
                <div class="badge">Official Ledger</div>
            </div>

            <div class="profile-card">
                <div class="avatar">${user.name.charAt(0).toUpperCase()}</div>
                <div class="p-info">
                    <h1>${user.name}</h1>
                    <div class="p-meta">
                        <div><span class="id-tag">@${user.id}</span></div>
                        <div>👥 Group: ${group.groupName}</div>
                    </div>
                </div>
            </div>

            <div class="dashboard-grid">
                <div class="metric-card">
                    <div class="m-label">Total Invested</div>
                    <div class="m-val">₹${runningPaid.toLocaleString('en-IN')}</div>
                    <div class="progress-container"><div class="progress-fill"></div></div>
                    <div class="p-text"><span>Chit Progress</span><span>${lastMonthPaid} / ${totalMonths} Mo.</span></div>
                </div>

                <div class="metric-card pending">
                    <div class="m-label">Pending Dues (Up to Mo. ${calcMonth})</div>
                    <div class="m-val">₹${pendingAmount.toLocaleString('en-IN')}</div>
                    <div style="font-size:12px; font-weight:600; color:rgba(255,255,255,0.9); display:flex; justify-content:space-between; margin-top:auto;">
                        <span>${pendingAmount > 0 ? pendingMonthsCount + ' Month(s) Pending' : 'All Clear / Up to Date'}</span>
                        <span>${pendingAmount > 0 ? '⚠️ Action Required' : '✅ Good Standing'}</span>
                    </div>
                </div>
            </div>

            <div class="ledger-box">
                <div class="l-title">Recent Transactions</div>
                ${last10.length === 0 ? `<div style="text-align:center; padding:30px; color:${theme.textMuted}; font-size: 13px;">No records found.</div>` : `
                <table>
                    <thead><tr><th>Mo.</th><th>Date</th><th>Type</th><th>Amount</th><th style="text-align: right">Sum</th></tr></thead>
                    <tbody>
                        ${last10.map(p => `
                            <tr>
                                <td><span class="pill">${p.monthAttributed === 'Adv' ? 'Adv' : 'M' + p.monthAttributed}</span></td>
                                <td style="font-size: 11px;">${p.displayDate}</td>
                                <td>${getStatusBadge(p.type)}</td>
                                <td style="color:${theme.success}; font-weight:800;">₹${(parseFloat(p.amount)||0).toLocaleString('en-IN')}</td>
                                <td style="text-align:right; font-family:monospace; font-size:14px;">₹${p.cumulativePaid.toLocaleString('en-IN')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                `}
            </div>

            <div class="footer">
                <div>Generated: ${new Date().toLocaleString('en-IN')}</div>
                <div>System by <strong style="color:${theme.brandBlue}">Goorac AI</strong></div>
            </div>
        </body>
        </html>`;

        // --- CHROME TAB BUG FIX 2: Added Floating Timer Clear for setContent ---
        let contentTimeout;
        await Promise.race([
            page.setContent(htmlContent, { waitUntil: 'load' }),
            new Promise((_, reject) => { contentTimeout = setTimeout(() => reject(new Error("Puppeteer setContent timeout")), 15000); })
        ]).finally(() => clearTimeout(contentTimeout)); // Clears floating timer
        
        // BUG FIX: Attached a safe .catch() to prevent Unhandled Promise Rejections if the page closes too fast
        await Promise.race([ 
            page.evaluateHandle('document.fonts.ready').catch(() => null), 
            new Promise(resolve => setTimeout(resolve, 600)) 
        ]);
        
        // --- CHROME TAB BUG FIX 3: Added Floating Timer Clear for screenshot ---
        let screenTimeout;
        const imageBuffer = await Promise.race([
            page.screenshot({ type: 'png', omitBackground: true, fullPage: true }),
            new Promise((_, reject) => { screenTimeout = setTimeout(() => reject(new Error("Puppeteer screenshot timeout")), 15000); })
        ]).finally(() => clearTimeout(screenTimeout)); // Clears floating timer

        return imageBuffer;
        
    } catch (error) { 
        throw error; 
    } finally { 
        if (page && !page.isClosed()) {
            // AGGRESSIVE RAM OPTIMIZATION:
            // BUG FIX: Commented out about:blank to prevent the "Execution context destroyed" crash!
            // await page.goto('about:blank').catch(() => {});
            
            // Closing the page natively dumps the DOM from RAM safely
            await page.close().catch(() => {}); 
        } 
    }
}
