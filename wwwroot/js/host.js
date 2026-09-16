// ═══════════════════════════════════════════════════════
//  HOST.JS - Game Dân Chủ Host Controller
// ═══════════════════════════════════════════════════════

(function () {
    'use strict';

    // ── State ──
    let roomCode = null;
    let currentRound = 0;
    let optionAText = '';
    let optionBText = '';

    // ── DOM Elements ──
    const $ = (id) => document.getElementById(id);

    // Sections
    const sectionCreate = $('section-create');
    const sectionLobby = $('section-lobby');
    const sectionRoundSetup = $('section-round-setup');
    const sectionRoundActive = $('section-round-active');
    const sectionRoundResult = $('section-round-result');
    const sectionFinalResult = $('section-final-result');
    const hostHeader = $('host-header');

    // ── Show/Hide Sections ──
    function showSection(section) {
        [sectionCreate, sectionLobby, sectionRoundSetup,
         sectionRoundActive, sectionRoundResult, sectionFinalResult
        ].forEach(s => s.classList.add('hidden'));

        section.classList.remove('hidden');

        // Header visible khi đã tạo phòng
        if (section !== sectionCreate) {
            hostHeader.classList.remove('hidden');
        }
    }

    // ── SignalR Connection ──
    const connection = new signalR.HubConnectionBuilder()
        .withUrl('/gamehub')
        .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
        .configureLogging(signalR.LogLevel.Warning)
        .build();

    // Connection status
    function updateConnectionStatus(connected) {
        $('connection-dot').classList.toggle('connected', connected);
        $('connection-text').textContent = connected ? 'Đã kết nối' : 'Mất kết nối...';
    }

    connection.onreconnecting(() => updateConnectionStatus(false));
    connection.onreconnected(() => updateConnectionStatus(true));
    connection.onclose(() => updateConnectionStatus(false));

    // ═══════════════════════════════════════════════════
    //  EVENT HANDLERS - Server → Client
    // ═══════════════════════════════════════════════════

    // Room đã tạo thành công
    connection.on('RoomCreated', (code) => {
        roomCode = code;
        $('lobby-room-code').textContent = code;
        $('header-room-code').textContent = code;

        // Tạo QR Code
        generateQRCode(code);

        showSection(sectionLobby);
        console.log('[Host] Room created:', code);
    });

    // Người chơi tham gia
    connection.on('PlayerJoined', (name, total, playerNames) => {
        $('lobby-player-count').textContent = total;
        $('header-total').textContent = total;
        $('header-active').textContent = total;
        $('header-eliminated').textContent = '0';

        renderPlayerList(playerNames);

        // Enable Start khi có ít nhất 2 người
        $('btn-start-game').disabled = total < 2;

        console.log('[Host] Player joined:', name, 'Total:', total);
    });

    // Người chơi disconnect
    connection.on('PlayerDisconnected', (name, total, playerNames) => {
        $('lobby-player-count').textContent = total;
        renderPlayerList(playerNames);
    });

    // Game đã bắt đầu
    connection.on('GameStarted', () => {
        currentRound = 0;
        $('setup-round-number').textContent = '1';
        showSection(sectionRoundSetup);
        console.log('[Host] Game started');
    });

    // Round bắt đầu
    connection.on('RoundStarted', (round, title, question, optA, optB) => {
        currentRound = round;
        optionAText = optA;
        optionBText = optB;

        $('active-round-badge').textContent = 'Vòng ' + round;
        $('active-question-title').textContent = title;
        $('active-question-text').textContent = question;

        // Reset vote chart
        $('vote-count-a').textContent = '0';
        $('vote-count-b').textContent = '0';
        $('vote-label-a').textContent = optA;
        $('vote-label-b').textContent = optB;
        $('vote-bar-a').style.flexBasis = '50%';
        $('vote-bar-b').style.flexBasis = '50%';
        $('chart-label-a').textContent = optA;
        $('chart-label-b').textContent = optB;
        $('vote-total').textContent = '0';

        $('header-round-badge').textContent = '🔄 Vòng ' + round;

        showSection(sectionRoundActive);
        console.log('[Host] Round', round, 'started');
    });

    // Final bắt đầu
    connection.on('FinalStarted', (round, title, question, optA, optB) => {
        currentRound = round;
        optionAText = optA;
        optionBText = optB;

        $('active-round-badge').textContent = '🏆 Vòng Cuối';
        $('active-question-title').textContent = title;
        $('active-question-text').textContent = question;

        $('vote-count-a').textContent = '0';
        $('vote-count-b').textContent = '0';
        $('vote-label-a').textContent = optA;
        $('vote-label-b').textContent = optB;
        $('vote-bar-a').style.flexBasis = '50%';
        $('vote-bar-b').style.flexBasis = '50%';
        $('chart-label-a').textContent = optA;
        $('chart-label-b').textContent = optB;
        $('vote-total').textContent = '0';

        $('header-round-badge').textContent = '🏆 Vòng Cuối';

        showSection(sectionRoundActive);
        console.log('[Host] Final round started');
    });


    // Vote update realtime (chỉ host nhận)
    connection.on('VoteUpdated', (countA, countB, totalVoted, activePlayers) => {
        $('vote-count-a').textContent = countA;
        $('vote-count-b').textContent = countB;
        $('vote-total').textContent = totalVoted;
        $('vote-of-active').textContent = activePlayers;

        // Update bar chart
        const total = countA + countB;
        if (total > 0) {
            const pctA = (countA / total) * 100;
            const pctB = (countB / total) * 100;
            $('vote-bar-a').style.flexBasis = Math.max(pctA, 10) + '%';
            $('vote-bar-b').style.flexBasis = Math.max(pctB, 10) + '%';
        }
    });

    // Round kết thúc
    connection.on('RoundEnded', (round, countA, countB, winner, optA, optB, activePlayers, eliminatedPlayers) => {
        $('result-round-number').textContent = round;
        $('result-count-a').textContent = countA;
        $('result-count-b').textContent = countB;
        $('result-label-a').textContent = optA;
        $('result-label-b').textContent = optB;

        const total = countA + countB;
        if (total > 0) {
            $('result-bar-a').style.flexBasis = Math.max((countA / total) * 100, 10) + '%';
            $('result-bar-b').style.flexBasis = Math.max((countB / total) * 100, 10) + '%';
        }

        const winnerText = winner === 'A' ? optA : optB;
        $('result-winner-text').textContent = '🏆 ' + winnerText;
        $('result-active-count').textContent = activePlayers;
        $('result-eliminated-count').textContent = eliminatedPlayers;

        $('header-active').textContent = activePlayers;
        $('header-eliminated').textContent = eliminatedPlayers;

        showSection(sectionRoundResult);
        console.log('[Host] Round', round, 'ended. Winner:', winnerText);
    });

    // Final result
    connection.on('FinalResult', (countA, countB, winner, optA, optB) => {
        const winnerText = winner === 'A' ? optA : optB;

        $('final-winner-text').textContent = winnerText;
        $('final-score-text').textContent = `${optA}: ${countA} — ${optB}: ${countB}`;
        $('final-count-a').textContent = countA;
        $('final-count-b').textContent = countB;
        $('final-label-a').textContent = optA;
        $('final-label-b').textContent = optB;

        const total = countA + countB;
        if (total > 0) {
            $('final-bar-a').style.flexBasis = Math.max((countA / total) * 100, 10) + '%';
            $('final-bar-b').style.flexBasis = Math.max((countB / total) * 100, 10) + '%';
        }

        showSection(sectionFinalResult);
        showCelebration();
        console.log('[Host] Final result:', winnerText);
    });

    // Next round ready
    connection.on('NextRoundReady', (activePlayers) => {
        $('header-active').textContent = activePlayers;
        currentRound++;
        $('setup-round-number').textContent = currentRound + 1;
        showSection(sectionRoundSetup);
    });

    // Game reset
    connection.on('GameReset', () => {
        currentRound = 0;
        showSection(sectionLobby);
        $('header-active').textContent = $('header-total').textContent;
        $('header-eliminated').textContent = '0';
        $('header-round-badge').textContent = '';
    });

    // Error
    connection.on('Error', (msg) => {
        alert('Lỗi: ' + msg);
    });

    // ═══════════════════════════════════════════════════
    //  BUTTON HANDLERS
    // ═══════════════════════════════════════════════════

    // Tạo phòng
    $('btn-create-room').addEventListener('click', () => {
        connection.invoke('CreateRoom').catch(err => console.error(err));
    });

    // Start game
    $('btn-start-game').addEventListener('click', () => {
        connection.invoke('StartGame', roomCode).catch(err => console.error(err));
    });

    // Start round
    $('btn-start-round').addEventListener('click', () => {
        const title = $('input-question-title').value.trim() || 'Câu hỏi';
        const question = $('input-question').value.trim() || 'Bạn chọn phương án nào?';
        const optA = $('input-option-a').value.trim() || 'A';
        const optB = $('input-option-b').value.trim() || 'B';
        connection.invoke('StartRound', roomCode, title, question, optA, optB)
            .catch(err => console.error(err));
    });

    // Start final
    $('btn-start-final').addEventListener('click', () => {
        const title = $('input-question-title').value.trim() || 'Biểu quyết cuối cùng';
        const question = $('input-question').value.trim() || 'Quyết định cuối cùng của nhóm?';
        const optA = $('input-option-a').value.trim() || 'A';
        const optB = $('input-option-b').value.trim() || 'B';
        connection.invoke('StartFinal', roomCode, title, question, optA, optB)
            .catch(err => console.error(err));
    });

    // End round sớm
    $('btn-end-round').addEventListener('click', () => {
        connection.invoke('EndRound', roomCode).catch(err => console.error(err));
    });

    // Next round
    $('btn-next-round').addEventListener('click', () => {
        connection.invoke('NextRound', roomCode).catch(err => console.error(err));
    });

    // Reset game (2 nút)
    $('btn-reset-game').addEventListener('click', () => {
        if (confirm('Bạn có chắc muốn reset game?')) {
            connection.invoke('ResetGame', roomCode).catch(err => console.error(err));
        }
    });
    $('btn-reset-game-final').addEventListener('click', () => {
        if (confirm('Bạn có chắc muốn reset game?')) {
            connection.invoke('ResetGame', roomCode).catch(err => console.error(err));
        }
    });

    // ═══════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════

    // Render danh sách người chơi
    function renderPlayerList(names) {
        const container = $('lobby-player-list');
        container.innerHTML = '';
        names.forEach(name => {
            const tag = document.createElement('span');
            tag.className = 'player-tag';
            tag.textContent = name;
            container.appendChild(tag);
        });
    }

    // Tạo QR Code
    function generateQRCode(code) {
        const qrContainer = $('qr-code');
        qrContainer.innerHTML = '';

        // Detect IP (fallback to localhost)
        const host = window.location.host;
        const url = `${window.location.protocol}//${host}/player.html?room=${code}`;

        $('qr-url').textContent = url;

        try {
            new QRCode(qrContainer, {
                text: url,
                width: 200,
                height: 200,
                colorDark: '#000000',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.M
            });
        } catch (e) {
            qrContainer.innerHTML = '<p style="color: var(--text-muted); padding: 20px;">QR Code không khả dụng</p>';
        }
    }

    // Celebration particles
    function showCelebration() {
        const container = $('celebration');
        container.classList.remove('hidden');
        container.innerHTML = '';

        const colors = ['#f6c343', '#f43f5e', '#3b82f6', '#10b981', '#8b5cf6', '#06b6d4'];
        for (let i = 0; i < 60; i++) {
            const particle = document.createElement('div');
            particle.className = 'celebration-particle';
            particle.style.left = Math.random() * 100 + '%';
            particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            particle.style.animationDelay = Math.random() * 2 + 's';
            particle.style.animationDuration = (2 + Math.random() * 2) + 's';
            particle.style.width = (6 + Math.random() * 8) + 'px';
            particle.style.height = (6 + Math.random() * 8) + 'px';
            container.appendChild(particle);
        }

        // Ẩn sau 4 giây
        setTimeout(() => container.classList.add('hidden'), 4000);
    }

    // ═══════════════════════════════════════════════════
    //  CONNECT
    // ═══════════════════════════════════════════════════

    async function start() {
        try {
            await connection.start();
            updateConnectionStatus(true);
            console.log('[Host] Connected to SignalR');
        } catch (err) {
            console.error('[Host] Connection failed:', err);
            setTimeout(start, 3000);
        }
    }

    start();
})();
