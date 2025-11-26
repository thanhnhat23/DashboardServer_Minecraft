// Modern Dashboard App - Socket.io Real-time Updates
let socket;
let statsHistory = {
    cpu: [],
    mem: [],
    tps: [],
    ping: [],
    timestamps: []
};

// Sparkline chart instances
let cpuSparkline = null;
let memSparkline = null;
let tpsSparkline = null;
let pingSparkline = null;

// Ping tracking
let pingValue = 0;

// Peak tracking
let cpuPeak = 0;
let memPeak = 0;
let peakResetInterval = null;

// Uptime tracking for realtime increment
let uptimeSeconds = 0;
let uptimeInterval = null;

// Toast notification system
function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) {
        console.warn('Toast container not found');
        return;
    }
    
    const toast = document.createElement('div');
    const id = 'toast-' + Date.now();
    toast.id = id;
    
    const colors = {
        success: 'bg-green-600 border-green-500',
        error: 'bg-red-600 border-red-500',
        warning: 'bg-yellow-600 border-yellow-500',
        info: 'bg-blue-600 border-blue-500'
    };
    
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };
    
    toast.className = `${colors[type]} border-l-4 p-4 rounded shadow-lg transform transition-all duration-300 translate-x-full opacity-0`;
    toast.innerHTML = `
        <div class="flex items-center gap-3">
            <i class="fas ${icons[type]} text-white text-xl"></i>
            <span class="text-white font-medium">${message}</span>
            <button onclick="document.getElementById('${id}').remove()" class="ml-auto text-white hover:text-gray-200">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;
    
    container.appendChild(toast);
    
    // Animate in
    setTimeout(() => {
        toast.classList.remove('translate-x-full', 'opacity-0');
    }, 10);
    
    // Auto remove
    setTimeout(() => {
        toast.classList.add('translate-x-full', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// Show input modal for ban reason
function showBanReasonModal(title, defaultReason, callback) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/60 flex items-center justify-center z-[9999]';
    modal.innerHTML = `
        <div class="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-2xl border border-gray-700">
            <h3 class="text-xl font-bold text-white mb-4">${title}</h3>
            <input type="text" id="ban-reason-input" value="${defaultReason}" 
                class="w-full bg-gray-700 text-white border border-gray-600 rounded px-4 py-2 mb-4 focus:outline-none focus:border-blue-500" 
                placeholder="Nhập lý do...">
            <div class="flex gap-3 justify-end">
                <button onclick="this.closest('.fixed').remove()" 
                    class="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded transition">
                    Hủy
                </button>
                <button id="confirm-ban-btn" 
                    class="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded transition">
                    Xác nhận
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    const input = document.getElementById('ban-reason-input');
    const confirmBtn = document.getElementById('confirm-ban-btn');
    
    input.focus();
    input.select();
    
    const submit = () => {
        const reason = input.value.trim() || defaultReason;
        modal.remove();
        callback(reason);
    };
    
    confirmBtn.onclick = submit;
    input.onkeypress = (e) => {
        if (e.key === 'Enter') submit();
    };
    
    modal.onclick = (e) => {
        if (e.target === modal) modal.remove();
    };
}

// Start peak reset timer (every 10 seconds)
function startPeakResetTimer() {
    if (peakResetInterval) clearInterval(peakResetInterval);
    peakResetInterval = setInterval(() => {
        cpuPeak = 0;
        memPeak = 0;
        document.getElementById('cpu-peak').textContent = '0%';
    }, 10000); // Reset every 10 seconds
}

function stopPeakResetTimer() {
    if (peakResetInterval) {
        clearInterval(peakResetInterval);
        peakResetInterval = null;
    }
}

// Initialize sparkline charts
function initSparklines() {
    const cpuCanvas = document.getElementById('cpu-sparkline');
    const memCanvas = document.getElementById('mem-sparkline');
    const tpsCanvas = document.getElementById('tps-sparkline');
    const pingCanvas = document.getElementById('ping-sparkline');
    
    if (!cpuCanvas || !memCanvas || !tpsCanvas || !pingCanvas) {
        console.warn('Sparkline canvases not found, skipping initialization');
        return;
    }
    
    const sparklineConfig = (color) => ({
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                data: [],
                borderColor: color,
                backgroundColor: color + '20',
                borderWidth: 2,
                fill: true,
                pointRadius: 0,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: {
                x: { display: false },
                y: { display: false, min: 0, max: 100 }
            },
            animation: { duration: 0 },
            events: []
        }
    });

    try {
        cpuSparkline = new Chart(cpuCanvas, sparklineConfig('#3b82f6'));
        memSparkline = new Chart(memCanvas, sparklineConfig('#a855f7'));
        tpsSparkline = new Chart(tpsCanvas, {
            ...sparklineConfig('#22c55e'),
            options: {
                ...sparklineConfig('#22c55e').options,
                scales: { x: { display: false }, y: { display: false, min: 0, max: 20 } }
            }
        });
        pingSparkline = new Chart(pingCanvas, {
            ...sparklineConfig('#3b82f6'),
            options: {
                ...sparklineConfig('#3b82f6').options,
                // Start with a tighter max so small pings are visible; will auto-scale later
                scales: { x: { display: false }, y: { display: false, min: 0, max: 100 } },
                // Add slight animation so the area appears to move up smoothly
                animation: { duration: 150 }
            }
        });

        // Seed ping chart with baseline zeros so a line is visible by default
        if (pingSparkline) {
            pingSparkline.data.labels = Array.from({ length: 30 }, (_, i) => i);
            pingSparkline.data.datasets[0].data = Array(30).fill(0);
            pingSparkline.update();
        }
    } catch (e) {
        console.error('Failed to initialize sparkline charts:', e);
    }
}

// Measure ping to server
function measurePing() {
    const pingEl = document.getElementById('ping-value');
    if (!pingEl) return;
    
    const start = Date.now();
    fetch('/api/ping')
        .then(r => r.json())
        .then(() => {
            pingValue = Date.now() - start;
            pingEl.textContent = pingValue + 'ms';
        })
        .catch(() => {
            pingEl.textContent = '---';
        });
}

// Start realtime uptime ticker
function startUptimeTicker(initialSeconds) {
    uptimeSeconds = initialSeconds;
    if (uptimeInterval) clearInterval(uptimeInterval);
    uptimeInterval = setInterval(() => {
        uptimeSeconds++;
        const hours = Math.floor(uptimeSeconds / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);
        const seconds = uptimeSeconds % 60;
        document.getElementById('sidebar-uptime').textContent = `${hours}h ${minutes}m ${seconds}s`;
    }, 1000);
}

function stopUptimeTicker() {
    if (uptimeInterval) {
        clearInterval(uptimeInterval);
        uptimeInterval = null;
    }
    uptimeSeconds = 0;
}

// Initialize socket connection
function initSocket() {
    socket = io();
    
    socket.on('connect', () => {
        console.log('Connected to dashboard server');
        // Query status immediately on connect to get current state
        fetch('/api/status').then(r => r.json()).then(stats => {
            handleStatsUpdate(stats);
        });
    });
    
    socket.on('disconnect', () => {
        console.log('Disconnected from dashboard server');
        // Ensure UI clears when socket disconnects
        resetUI();
    });
    
    socket.on('stats_update', (data) => {
        console.log('Stats update received:', data);
        handleStatsUpdate(data);
    });
    
    socket.on('player_joined', (data) => {
        addConsoleLine(`[Server] ${data.player} joined the game`, 'success');
    });
    
    socket.on('player_left', (data) => {
        addConsoleLine(`[Server] ${data.player} left the game`, 'warn');
    });
    
    socket.on('console_log', (line) => {
        addConsoleLine(line);
    });
}

// Reset UI to known offline baseline (avoid stale state on refresh)
function resetUI() {
    updateStatus(false);
    stopUptimeTicker();
    stopPeakResetTimer();
    cpuPeak = 0;
    memPeak = 0;
    document.getElementById('cpu-value').textContent = '0%';
    document.getElementById('cpu-bar').style.width = '0%';
    document.getElementById('cpu-peak').textContent = '0%';
    document.getElementById('mem-value').textContent = '0%';
    document.getElementById('mem-bar').style.width = '0%';
    document.getElementById('mem-mb-value').textContent = '0 MB';
    document.getElementById('tps-value').textContent = '20.0';
    document.getElementById('nav-players').textContent = '0/20';
    document.getElementById('player-count').textContent = 0;
    document.getElementById('online-count').textContent = 0;
    document.getElementById('circle-percent').textContent = '0%';
    updatePlayerCircle(0);
    renderPlayers([]);
}

// Update status
function updateStatus(online) {
    const statusEl = document.getElementById('sidebar-status');
    const navStatus = document.getElementById('nav-status');
    
    if (online) {
        statusEl.textContent = 'Online';
        statusEl.className = 'font-semibold text-green-400';
        navStatus.textContent = 'Online';
        navStatus.className = 'font-normal px-2 py-1 rounded bg-green-500/20 text-green-400 minecraft-font';
        document.getElementById('btn-start').disabled = true;
        document.getElementById('btn-stop').disabled = false;
        document.getElementById('btn-restart').disabled = false;
        
        // Enable quick commands when online
        document.querySelectorAll('.quick-cmd').forEach(btn => btn.disabled = false);
        document.getElementById('cmd-input').disabled = false;
        document.getElementById('btn-send').disabled = false;
    } else {
        statusEl.textContent = 'Offline';
        statusEl.className = 'font-semibold text-red-400';
        navStatus.textContent = 'Offline';
        navStatus.className = 'font-normal px-2 py-1 rounded bg-red-500/20 text-red-400 minecraft-font';
        document.getElementById('btn-start').disabled = false;
        document.getElementById('btn-stop').disabled = true;
        document.getElementById('btn-restart').disabled = true;
        
        // Disable quick commands when offline
        document.querySelectorAll('.quick-cmd').forEach(btn => btn.disabled = true);
        document.getElementById('cmd-input').disabled = true;
        document.getElementById('btn-send').disabled = true;
    }
}

// Handle stats update from server
function handleStatsUpdate(stats) {
    console.log('[DEBUG] Stats:', {
        spark: stats.spark_enabled,
        disk: stats.disk_percent,
        tps: stats.tps,
        cpu: stats.cpu,
        mem: stats.mem
    });
    
    const isOnline = stats.online === true;
    updateStatus(isOnline);
    
    // Fetch banned lists
    fetchBannedLists();

    // Update CPU (clamp to 0-100)
    const cpu = Math.min(Math.max(stats.cpu || 0, 0), 100);
    document.getElementById('cpu-value').textContent = cpu.toFixed(1) + '%';
    document.getElementById('cpu-bar').style.width = cpu + '%';
    
    // Update CPU peak
    if (cpu > cpuPeak) {
        cpuPeak = cpu;
        document.getElementById('cpu-peak').textContent = cpu.toFixed(1) + '%';
    }
    
    // Update CPU sparkline
    statsHistory.cpu.push(cpu);
    if (statsHistory.cpu.length > 30) statsHistory.cpu.shift();
    if (cpuSparkline) {
        cpuSparkline.data.labels = statsHistory.cpu.map((_, i) => i);
        cpuSparkline.data.datasets[0].data = statsHistory.cpu;
        cpuSparkline.update();
    }
    
    // Update Memory (clamp to 0-100)
    const mem = Math.min(Math.max(stats.mem || 0, 0), 100);
    document.getElementById('mem-value').textContent = mem.toFixed(1) + '%';
    document.getElementById('mem-bar').style.width = mem + '%';
    document.getElementById('mem-mb-value').textContent = (stats.mem_mb || 0).toFixed(0) + ' MB';
    
    // Update Memory peak
    if (stats.mem_mb > memPeak) {
        memPeak = stats.mem_mb;
    }
    
    // Update Memory sparkline
    statsHistory.mem.push(mem);
    if (statsHistory.mem.length > 30) statsHistory.mem.shift();
    if (memSparkline) {
        memSparkline.data.labels = statsHistory.mem.map((_, i) => i);
        memSparkline.data.datasets[0].data = statsHistory.mem;
        memSparkline.update();
    }
    
    // Update TPS (0 when offline)
    const tps = isOnline ? (typeof stats.tps === 'number' ? stats.tps : 0) : 0;
    document.getElementById('tps-value').textContent = tps.toFixed(1);
    document.getElementById('sidebar-tps').textContent = tps.toFixed(1);
    updateTPSIndicator(tps, isOnline);
    
    // Update TPS sparkline
    statsHistory.tps.push(tps);
    if (statsHistory.tps.length > 30) statsHistory.tps.shift();
    if (tpsSparkline) {
        tpsSparkline.data.labels = statsHistory.tps.map((_, i) => i);
        tpsSparkline.data.datasets[0].data = statsHistory.tps;
        tpsSparkline.update();
    }
    
    // Show Spark indicator if enabled
    const tpsValueEl = document.getElementById('tps-value');
    if (stats.spark_enabled) {
        if (!tpsValueEl.classList.contains('spark-active')) {
            tpsValueEl.classList.add('spark-active');
            tpsValueEl.title = 'TPS/CPU/Memory từ Spark mod';
        }
    } else {
        tpsValueEl.classList.remove('spark-active');
        tpsValueEl.title = '';
    }
    
    // Update Player Count
    const playerCount = isOnline && stats.online_players ? stats.online_players.length : 0;
    const maxPlayers = Number(stats.max_players) || 20;
    document.getElementById('player-count').textContent = `${playerCount}/${maxPlayers}`;
    document.getElementById('online-count').textContent = playerCount;
    document.getElementById('circle-percent').textContent = ((playerCount / maxPlayers) * 100).toFixed(0) + '%';
    updatePlayerCircle((playerCount / maxPlayers) * 100);
    
    // Update Navigation
    document.getElementById('nav-players').textContent = `${playerCount}/${maxPlayers}`;
    
    // Update uptime and start realtime ticker
    const uptimeStr = stats.uptime || '0h 0m 0s';
    document.getElementById('sidebar-uptime').textContent = uptimeStr;
    
    // Update Disk Usage (from Spark)
    if (stats.disk_percent !== undefined && stats.disk_percent > 0) {
        document.getElementById('disk-value').textContent = stats.disk_percent + '%';
        document.getElementById('disk-bar').style.width = stats.disk_percent + '%';
        document.getElementById('disk-used').textContent = stats.disk_used_gb.toFixed(1);
        document.getElementById('disk-total').textContent = stats.disk_total_gb.toFixed(1);
    } else {
        document.getElementById('disk-value').textContent = '0%';
        document.getElementById('disk-bar').style.width = '0%';
        document.getElementById('disk-used').textContent = '0';
        document.getElementById('disk-total').textContent = '0';
    }
    
    // Update Server Ping (show actual ping in ms if available)
    const pingEl = document.getElementById('ping-value');
    if (isOnline && stats.server_ping_ms > 0) {
        // Show ping in ms with color coding
        pingEl.textContent = stats.server_ping_ms + 'ms';
        if (stats.server_ping_ms < 50) {
            pingEl.className = 'text-green-400';
        } else if (stats.server_ping_ms < 150) {
            pingEl.className = 'text-yellow-400';
        } else {
            pingEl.className = 'text-red-400';
        }
        
        // Update ping sparkline with auto-scaling
        statsHistory.ping.push(stats.server_ping_ms);
        if (statsHistory.ping.length > 30) statsHistory.ping.shift();
        if (pingSparkline) {
            pingSparkline.data.labels = statsHistory.ping.map((_, i) => i);
            pingSparkline.data.datasets[0].data = statsHistory.ping;
            // Auto-scale Y so small ping values are still visible
            const maxPing = Math.max(...statsHistory.ping);
            const yMax = Math.max(50, Math.ceil(maxPing / 10) * 10 + 10); // headroom
            if (pingSparkline.options.scales && pingSparkline.options.scales.y) {
                pingSparkline.options.scales.y.max = yMax;
            }
            pingSparkline.update();
        }
    } else if (isOnline) {
        // Server online but no ping data yet
        pingEl.textContent = 'Measuring...';
        pingEl.className = 'text-gray-400';
        // Keep ping sparkline baseline progressing with zeros
        statsHistory.ping.push(0);
        if (statsHistory.ping.length > 30) statsHistory.ping.shift();
        if (pingSparkline) {
            pingSparkline.data.labels = statsHistory.ping.map((_, i) => i);
            pingSparkline.data.datasets[0].data = statsHistory.ping;
            if (pingSparkline.options.scales && pingSparkline.options.scales.y) {
                pingSparkline.options.scales.y.max = 50; // compact scale for baseline
            }
            pingSparkline.update();
        }
    } else {
        // Server offline
        pingEl.textContent = 'Offline';
        pingEl.className = 'text-red-400';
        // Maintain a visible baseline when offline
        statsHistory.ping.push(0);
        if (statsHistory.ping.length > 30) statsHistory.ping.shift();
        if (pingSparkline) {
            pingSparkline.data.labels = statsHistory.ping.map((_, i) => i);
            pingSparkline.data.datasets[0].data = statsHistory.ping;
            if (pingSparkline.options.scales && pingSparkline.options.scales.y) {
                pingSparkline.options.scales.y.max = 50;
            }
            pingSparkline.update();
        }
    }
    
    // Parse uptime to seconds for realtime increment
    if (isOnline) {
        const match = uptimeStr.match(/(\d+)h (\d+)m (\d+)s/);
        if (match) {
            const hours = parseInt(match[1]);
            const minutes = parseInt(match[2]);
            const seconds = parseInt(match[3]);
            const totalSeconds = hours * 3600 + minutes * 60 + seconds;
            startUptimeTicker(totalSeconds);
        }
    } else {
        stopUptimeTicker();
    }
    
    // Render players list (clear when offline)
    renderPlayers(isOnline ? (stats.online_players || []) : []);
    
    // Update Chart (ALWAYS update with clamped values)
    if (typeof addStatsPoint === 'function') {
        addStatsPoint(cpu, mem);
    }
}

// Update TPS Indicator
function updateTPSIndicator(tps, online = true) {
    const dot = document.getElementById('tps-indicator');
    const label = document.getElementById('tps-status');
    if (!dot || !label) return;

    // Reset to base Tailwind classes so the dot keeps size/shape
    dot.className = 'inline-block w-3 h-3 rounded-full';

    if (!online) {
        // Offline state
        dot.classList.add('bg-gray-500');
        label.textContent = 'Offline';
        label.className = 'text-gray-400';
        return;
    }

    // Default: optimal (green)
    let statusText = 'Optimal';
    let labelClass = 'text-green-400';
    let dotColor = 'bg-green-500';

    if (tps < 15) {
        statusText = 'Critical';
        labelClass = 'text-red-400';
        dotColor = 'bg-red-500';
    } else if (tps < 19) {
        statusText = 'Degraded';
        labelClass = 'text-yellow-400';
        dotColor = 'bg-yellow-500';
    }

    dot.classList.add(dotColor);
    label.textContent = statusText;
    label.className = labelClass;
}

// Update Player Circle Progress
function updatePlayerCircle(percent) {
    const circle = document.getElementById('player-circle');
    if (!circle) return; // Guard against missing element
    const dashArray = 282;
    const dashOffset = dashArray - (dashArray * percent / 100);
    circle.style.strokeDashoffset = dashOffset;
}

// Render players list
function renderPlayers(players) {
    const list = document.getElementById('players-list');
    
    if (!players || players.length === 0) {
        list.innerHTML = `
            <div class="text-center py-12 text-gray-400">
                <i class="fas fa-user-slash text-4xl mb-2 block"></i>
                <p>No players online</p>
            </div>
        `;
        return;
    }
    
    list.innerHTML = players.map(player => {
        const name = player.name;
            const isOp = !!player.is_op;
            const isBanned = !!player.is_banned;
        const opLabel = isOp ? 'De-OP' : 'OP';
        const opColor = isOp ? 'bg-orange-600 hover:bg-orange-500' : 'bg-green-600 hover:bg-green-500';
        
        // Creeper-like avatar via inline SVG
        const avatarSVG = `
            <svg viewBox="0 0 100 100" class="w-8 h-8 rounded overflow-hidden">
                <rect width="100" height="100" fill="#3CB043"></rect>
                <rect x="20" y="20" width="20" height="20" fill="#111"></rect>
                <rect x="60" y="20" width="20" height="20" fill="#111"></rect>
                <rect x="40" y="45" width="20" height="30" fill="#111"></rect>
                <rect x="25" y="65" width="15" height="20" fill="#111"></rect>
                <rect x="60" y="65" width="15" height="20" fill="#111"></rect>
            </svg>`;
        
        return `
        <div class="flex items-center justify-between bg-gray-700/40 rounded px-4 py-3">
            <div class="flex items-center gap-3">
                <div class="shrink-0">${avatarSVG}</div>
                <div class="player-name font-medium">${name}</div>
            </div>
            <div class="flex items-center gap-2">
                <button class="player-action-btn ${opColor} text-white px-3 py-1 rounded text-xs" onclick="toggleOp('${name}')">${opLabel}</button>
                    <button class="player-action-btn ${isBanned ? 'bg-gray-600 hover:bg-gray-500' : 'bg-red-600 hover:bg-red-500'} text-white px-3 py-1 rounded text-xs" onclick="toggleBan('${name}', ${isBanned})">${isBanned ? 'Unban' : 'Ban'}</button>
                    <button class="player-action-btn bg-purple-600 hover:bg-purple-500 text-white px-3 py-1 rounded text-xs" onclick="banIP('${name}')">Ban IP</button>
                    <button class="player-action-btn bg-red-600 hover:bg-red-500 text-white px-3 py-1 rounded text-xs" onclick="playerAction('kick', '${name}')">Kick</button>
            </div>
        </div>`;
    }).join('');
}

function toggleOp(playerName) {
    fetch('/api/player/op_toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: playerName })
    }).then(r => r.json()).then(res => {
        if (!res.success) throw new Error(res.error || 'OP toggle failed');
        return fetch('/api/status');
    }).then(r => r.json()).then(stats => {
        renderPlayers(stats.online ? (stats.online_players || []) : []);
    }).catch(err => {
        addConsoleLine(`[Dashboard] OP toggle error: ${err.message}`, 'error');
    });
}

function toggleBan(playerName, isBanned) {
    if (isBanned) {
        // Unban - no reason needed
        fetch('/api/player/ban_toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: playerName, action: 'pardon' })
        }).then(r => r.json()).then(res => {
            if (!res.success) throw new Error(res.error || 'Unban failed');
            showToast(`Đã unban player ${playerName}`, 'success');
            return fetch('/api/status');
        }).then(r => r.json()).then(stats => {
            renderPlayers(stats.online ? (stats.online_players || []) : []);
            fetchBannedLists();
        }).catch(err => {
            showToast(`Lỗi unban: ${err.message}`, 'error');
            addConsoleLine(`[Dashboard] Unban error: ${err.message}`, 'error');
        });
    } else {
        // Ban - show modal for reason
        showBanReasonModal(
            `Ban player ${playerName}`,
            'Vi phạm quy tắc server',
            (reason) => {
                const command = `ban ${playerName} ${reason}`;
                console.log('[DEBUG] Sending ban command:', command);
                
                fetch('/api/command', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ command: command })
                }).then(r => {
                    console.log('[DEBUG] Response status:', r.status);
                    if (!r.ok) {
                        throw new Error(`HTTP ${r.status}: ${r.statusText}`);
                    }
                    return r.json();
                }).then(res => {
                    console.log('[DEBUG] Response data:', JSON.stringify(res, null, 2));
                    if (!res.success) {
                        throw new Error(res.error || 'Server không online hoặc command thất bại');
                    }
                    showToast(`Đã ban player ${playerName}`, 'success');
                    addConsoleLine(`[Dashboard] Banned ${playerName}: ${reason}`, 'success');
                    return fetch('/api/status');
                }).then(r => r.json()).then(stats => {
                    renderPlayers(stats.online ? (stats.online_players || []) : []);
                    fetchBannedLists();
                }).catch(err => {
                    console.error('[DEBUG] Ban error details:', err);
                    showToast(`Lỗi ban: ${err.message}`, 'error');
                    addConsoleLine(`[Dashboard] Ban error: ${err.message}`, 'error');
                });
            }
        );
    }
}

function banIP(playerName) {
    showBanReasonModal(
        `Ban IP của player ${playerName}`,
        'Vi phạm nghiêm trọng',
        (reason) => {
            fetch('/api/command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: `ban-ip ${playerName} ${reason}` })
            }).then(r => r.json()).then(res => {
                if (res.success) {
                    showToast(`Đã ban IP của player ${playerName}`, 'warning');
                    addConsoleLine(`[Dashboard] Banned IP for player ${playerName}: ${reason}`, 'success');
                    fetchBannedLists();
                    // Refresh player list after short delay
                    setTimeout(() => {
                        fetch('/api/status').then(r => r.json()).then(stats => {
                            renderPlayers(stats.online ? (stats.online_players || []) : []);
                        });
                    }, 1000);
                } else {
                    throw new Error(res.error || 'Ban IP failed');
                }
            }).catch(err => {
                showToast(`Lỗi ban IP: ${err.message}`, 'error');
                addConsoleLine(`[Dashboard] Ban IP error: ${err.message}`, 'error');
            });
        }
    );
}

function fetchBannedLists() {
    fetch('/api/banned_players')
        .then(r => r.json())
        .then(data => renderBannedPlayers(data.banned_players || []))
        .catch(err => console.error('Failed to fetch banned players:', err));
    
    fetch('/api/banned_ips')
        .then(r => r.json())
        .then(data => renderBannedIPs(data.banned_ips || []))
        .catch(err => console.error('Failed to fetch banned IPs:', err));
}

function renderBannedPlayers(bannedList) {
    const container = document.getElementById('banned-players-list');
    const countEl = document.getElementById('banned-count');
    countEl.textContent = bannedList.length;
    
    if (bannedList.length === 0) {
        container.innerHTML = '<div class="text-xs text-gray-400 text-center py-2">No banned players</div>';
        return;
    }
    
    container.innerHTML = bannedList.map(ban => {
        const name = ban.name || 'Unknown';
        // Wither skull icon (black/dark)
        const witherSkull = `
            <svg viewBox="0 0 100 100" class="w-5 h-5 shrink-0">
                <rect width="100" height="100" fill="#1a1a1a"></rect>
                <rect x="15" y="15" width="25" height="25" fill="#3a3a3a"></rect>
                <rect x="60" y="15" width="25" height="25" fill="#3a3a3a"></rect>
                <rect x="35" y="35" width="30" height="35" fill="#2a2a2a"></rect>
                <rect x="25" y="50" width="15" height="15" fill="#ffffff" opacity="0.9"></rect>
                <rect x="60" y="50" width="15" height="15" fill="#ffffff" opacity="0.9"></rect>
            </svg>`;
        return `
            <div class="flex items-center gap-2 bg-gray-800/50 rounded px-2 py-1.5 text-xs">
                <div class="shrink-0">${witherSkull}</div>
                <span class="text-gray-300 truncate flex-1">${name}</span>
                <button onclick="unbanPlayer('${name}')" 
                    class="text-red-400 hover:text-red-300 transition text-xs px-2 py-0.5 rounded hover:bg-gray-700 shrink-0">
                    <i class="fas fa-unlock"></i>
                </button>
            </div>`;
    }).join('');
}

function renderBannedIPs(bannedIPs) {
    const container = document.getElementById('banned-ips-list');
    const countEl = document.getElementById('banned-ips-count');
    countEl.textContent = bannedIPs.length;
    
    if (bannedIPs.length === 0) {
        container.innerHTML = '<div class="text-xs text-gray-400 text-center py-2">No banned IPs</div>';
        return;
    }
    
    container.innerHTML = bannedIPs.map(ban => {
        const ip = ban.ip || 'Unknown';
        // Ghostly skull icon (white on red)
        const ghostSkull = `
            <svg viewBox="0 0 100 100" class="w-5 h-5 shrink-0">
                <rect width="100" height="100" fill="#8B0000"></rect>
                <rect x="15" y="15" width="25" height="25" fill="#C0C0C0"></rect>
                <rect x="60" y="15" width="25" height="25" fill="#C0C0C0"></rect>
                <rect x="35" y="35" width="30" height="35" fill="#E0E0E0"></rect>
                <rect x="25" y="50" width="15" height="15" fill="#000000"></rect>
                <rect x="60" y="50" width="15" height="15" fill="#000000"></rect>
            </svg>`;
        return `
            <div class="flex items-center gap-2 bg-gray-800/50 rounded px-2 py-1.5 text-xs">
                <div class="shrink-0">${ghostSkull}</div>
                <span class="text-gray-300 font-mono truncate flex-1">${ip}</span>
                <button onclick="unbanIP('${ip}')" 
                    class="text-red-400 hover:text-red-300 transition text-xs px-2 py-0.5 rounded hover:bg-gray-700 shrink-0">
                    <i class="fas fa-unlock"></i>
                </button>
            </div>`;
    }).join('');
}

function unbanPlayer(name) {
    fetch('/api/player/unban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    }).then(r => r.json()).then(res => {
        if (res.success) {
            addConsoleLine(`[Dashboard] Unbanned player: ${name}`, 'success');
            fetchBannedLists();
            fetch('/api/status').then(r => r.json()).then(stats => {
                renderPlayers(stats.online ? (stats.online_players || []) : []);
            });
        }
    }).catch(err => {
        addConsoleLine(`[Dashboard] Unban error: ${err.message}`, 'error');
    });
}

function unbanIP(ip) {
    fetch('/api/ip/unban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip })
    }).then(r => r.json()).then(res => {
        if (res.success) {
            addConsoleLine(`[Dashboard] Unbanned IP: ${ip}`, 'success');
            fetchBannedLists();
        }
    }).catch(err => {
        addConsoleLine(`[Dashboard] Unban IP error: ${err.message}`, 'error');
    });
}

// Player actions
function playerAction(action, playerName) {
    const commands = {
        'tp': `tp ${playerName} 0 100 0`,
        'kick': `kick ${playerName}`,
        'op': `op ${playerName}`,
        'deop': `deop ${playerName}`
    };
    
    if (commands[action]) {
        sendCommand(commands[action]);
    }
}

// Add console line
function addConsoleLine(line, type = '') {
    const console_el = document.getElementById('console-log');
    const lineEl = document.createElement('div');
    lineEl.className = 'console-line' + (type ? ` ${type}` : '');
    lineEl.textContent = line;
    
    console_el.appendChild(lineEl);
    
    // Keep only last 500 lines
    const lines = console_el.querySelectorAll('.console-line');
    if (lines.length > 500) {
        lines[0].remove();
    }
    
    // Auto scroll to bottom
    console_el.scrollTop = console_el.scrollHeight;
}

// Send command
function sendCommand(cmd) {
    fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd: cmd })
    }).then(r => r.json()).then(data => {
        if (data.success) {
            addConsoleLine(`[Dashboard] Command sent: ${cmd}`, 'info');
        } else {
            addConsoleLine(`[Dashboard] Error: ${data.error}`, 'error');
        }
    }).catch(err => {
        addConsoleLine(`[Dashboard] Error: ${err.message}`, 'error');
    });
}

// Chart data handler
function addChartData(cpu, mem) {
    if (typeof addStatsPoint === 'function') {
        addStatsPoint(cpu, mem);
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    // Baseline reset to avoid stale UI
    resetUI();
    // Initialize socket
    initSocket();
    
    // Initialize sparklines
    initSparklines();
    
    // Start peak reset timer
    startPeakResetTimer();
    
    // Load initial status
    fetch('/api/status').then(r => r.json()).then(stats => {
        console.log('Initial status:', stats);
        handleStatsUpdate(stats);
    });
    
    // Server controls
    document.getElementById('btn-start').addEventListener('click', () => {
        document.getElementById('btn-start').disabled = true;
        document.getElementById('btn-stop').disabled = true;
        document.getElementById('btn-restart').disabled = true;
        
        fetch('/api/start', { method: 'POST' }).then(r => r.json()).then(data => {
            addConsoleLine('[Dashboard] Server starting...', 'info');
            // Query status after start to update UI accurately
            setTimeout(() => {
                fetch('/api/status').then(r => r.json()).then(stats => {
                    handleStatsUpdate(stats);
                    // Ensure buttons are in correct state after start
                    if (stats.online) {
                        document.getElementById('btn-start').disabled = true;
                        document.getElementById('btn-stop').disabled = false;
                        document.getElementById('btn-restart').disabled = false;
                    }
                });
            }, 2000);
        }).catch(err => {
            addConsoleLine(`[Dashboard] Start error: ${err.message}`, 'error');
            document.getElementById('btn-start').disabled = false;
            document.getElementById('btn-stop').disabled = true;
            document.getElementById('btn-restart').disabled = true;
        });
    });
    
    document.getElementById('btn-stop').addEventListener('click', () => {
        document.getElementById('btn-start').disabled = true;
        document.getElementById('btn-stop').disabled = true;
        document.getElementById('btn-restart').disabled = true;
        
        fetch('/api/stop', { method: 'POST' }).then(r => r.json()).then(data => {
            addConsoleLine('[Dashboard] Server stopping...', 'warn');
            // Query status after stop to update UI accurately
            setTimeout(() => {
                fetch('/api/status').then(r => r.json()).then(stats => {
                    handleStatsUpdate(stats);
                    // Ensure buttons are in correct state after stop
                    if (!stats.online) {
                        document.getElementById('btn-start').disabled = false;
                        document.getElementById('btn-stop').disabled = true;
                        document.getElementById('btn-restart').disabled = true;
                    }
                });
            }, 1000);
        }).catch(err => {
            addConsoleLine(`[Dashboard] Stop error: ${err.message}`, 'error');
            document.getElementById('btn-start').disabled = false;
            document.getElementById('btn-stop').disabled = true;
            document.getElementById('btn-restart').disabled = true;
        });
    });
    
    document.getElementById('btn-restart').addEventListener('click', () => {
        document.getElementById('btn-start').disabled = true;
        document.getElementById('btn-stop').disabled = true;
        document.getElementById('btn-restart').disabled = true;
        
        fetch('/api/restart', { method: 'POST' }).then(r => r.json()).then(data => {
            addConsoleLine('[Dashboard] Server restarting...', 'info');
            // Query status after restart to update UI accurately
            setTimeout(() => {
                fetch('/api/status').then(r => r.json()).then(stats => {
                    handleStatsUpdate(stats);
                    // Ensure buttons are in correct state after restart
                    if (stats.online) {
                        document.getElementById('btn-start').disabled = true;
                        document.getElementById('btn-stop').disabled = false;
                        document.getElementById('btn-restart').disabled = false;
                    }
                });
            }, 3000);
        }).catch(err => {
            addConsoleLine(`[Dashboard] Restart error: ${err.message}`, 'error');
            fetch('/api/status').then(r => r.json()).then(stats => {
                handleStatsUpdate(stats);
            });
        });
    });
    
    // Quick commands
    document.querySelectorAll('.quick-cmd').forEach(btn => {
        btn.addEventListener('click', () => {
            const cmd = btn.getAttribute('data-cmd');
            sendCommand(cmd);
        });
    });
    
    // Command input
    document.getElementById('cmd-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const cmd = e.target.value.trim();
            if (cmd) {
                sendCommand(cmd);
                e.target.value = '';
            }
        }
    });
    
    document.getElementById('btn-send').addEventListener('click', () => {
        const cmd = document.getElementById('cmd-input').value.trim();
        if (cmd) {
            sendCommand(cmd);
            document.getElementById('cmd-input').value = '';
        }
    });
    
    // Clear console
    document.getElementById('btn-clear-log').addEventListener('click', () => {
        document.getElementById('console-log').innerHTML = '';
        addConsoleLine('[Dashboard] Console cleared', 'info');
    });
    
    // Get initial status
    fetch('/api/status').then(r => r.json()).then(data => {
        handleStatsUpdate(data);
    });
});
