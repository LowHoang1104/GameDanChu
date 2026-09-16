// ═══════════════════════════════════════════════════════
//  PLAYER.JS - Game Dân Chủ Player Controller
// ═══════════════════════════════════════════════════════

(function () {
    'use strict';

    // ── State ──
    let playerId = null;
    let roomCode = null;
    let playerName = null;
    let isEliminated = false;
    let hasVoted = false;

    // ── DOM Elements ──
    const $ = (id) => document.getElementById(id);

    // Sections
    const sectionJoin = $('section-join');
    const sectionWaiting = $('section-waiting');
    const sectionVoting = $('section-voting');
    const sectionVoted = $('section-voted');
    const sectionPlayerResult = $('section-player-result');
    const sectionEliminated = $('section-eliminated');
    const sectionFinalResult = $('section-final-result');

    // ── Show/Hide Sections ──
    function showSection(section) {
        [sectionJoin, sectionWaiting, sectionVoting, sectionVoted,
         sectionPlayerResult, sectionEliminated, sectionFinalResult
        ].forEach(s => s.classList.add('hidden'));

        section.classList.remove('hidden');
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
    connection.onreconnected(() => {
        updateConnectionStatus(true);
        // Tự động rejoin khi reconnect
        if (playerId && roomCode) {
            connection.invoke('Rejoin', roomCode, playerId).catch(err => console.error(err));
        }
    });
    connection.onclose(() => updateConnectionStatus(false));

    // ═══════════════════════════════════════════════════
    //  EVENT HANDLERS - Server → Client
    // ═══════════════════════════════════════════════════

    // Join thành công
    connection.on('JoinedRoom', (id, code, status) => {
        playerId = id;
        roomCode = code;

        // Lưu vào localStorage
        localStorage.setItem('gdc_playerId', id);
        localStorage.setItem('gdc_roomCode', code);
        localStorage.setItem('gdc_playerName', playerName);

        $('waiting-room-code').textContent = code;
        $('waiting-player-name').textContent = playerName;

        showSection(sectionWaiting);
        console.log('[Player] Joined room:', code, 'ID:', id);
    });

    // Rejoin thành công
    connection.on('Rejoined', (id, code, name) => {
        playerId = id;
        roomCode = code;
        playerName = name;

        console.log('[Player] Rejoined room:', code, 'as', name);
    });

    // Player joined notification (cập nhật số người)
    connection.on('PlayerJoined', (name, total, playerNames) => {
        $('waiting-player-count').textContent = total;
    });

    connection.on('PlayerDisconnected', (name, total, playerNames) => {
        $('waiting-player-count').textContent = total;
    });

    // Game bắt đầu
    connection.on('GameStarted', () => {
        // Vẫn ở waiting, chờ round
        console.log('[Player] Game started, waiting for round...');
    });

    // Round bắt đầu
    connection.on('RoundStarted', (round, title, question, optA, optB) => {
        if (isEliminated) return;

        hasVoted = false;

        $('voting-round-badge').textContent = 'Vòng ' + round;
        $('voting-question-title').textContent = title;
        $('voting-question-text').textContent = question;
        $('vote-text-a').textContent = optA;
        $('vote-text-b').textContent = optB;

        // Reset button states
        $('btn-vote-a').classList.remove('selected');
        $('btn-vote-b').classList.remove('selected');
        $('btn-vote-a').disabled = false;
        $('btn-vote-b').disabled = false;

        showSection(sectionVoting);
        console.log('[Player] Round', round, 'started');
    });

    // Final bắt đầu
    connection.on('FinalStarted', (round, title, question, optA, optB) => {
        if (isEliminated) return;

        hasVoted = false;

        $('voting-round-badge').textContent = '🏆 Vòng Cuối';
        $('voting-question-title').textContent = title;
        $('voting-question-text').textContent = question;
        $('vote-text-a').textContent = optA;
        $('vote-text-b').textContent = optB;

        $('btn-vote-a').classList.remove('selected');
        $('btn-vote-b').classList.remove('selected');
        $('btn-vote-a').disabled = false;
        $('btn-vote-b').disabled = false;

        showSection(sectionVoting);
        console.log('[Player] Final round started');
    });


    // Vote confirmed
    connection.on('VoteConfirmed', (choice) => {
        hasVoted = true;
        $('voted-choice').textContent = choice === 'A'
            ? $('vote-text-a').textContent
            : $('vote-text-b').textContent;

        showSection(sectionVoted);
        console.log('[Player] Vote confirmed:', choice);
    });

    // Kết quả round (riêng cho từng player)
    connection.on('PlayerResult', (isWinner, message, myChoice, winner, round) => {
        if (isWinner) {
            $('player-result-icon').textContent = '🎉';
            $('player-result-text').className = 'status-text status-winner';
            $('player-result-text').textContent = 'Bạn được đi tiếp!';
            $('player-result-subtext').textContent = message;
        } else {
            isEliminated = true;
            $('player-result-icon').textContent = '😢';
            $('player-result-text').className = 'status-text status-loser';
            $('player-result-text').textContent = 'Bạn đã bị loại';
            $('player-result-subtext').textContent = message;

            $('eliminated-text').textContent = 'Bạn đã dừng cuộc chơi';
            $('eliminated-round-text').textContent = 'Dừng ở Vòng ' + round;
        }

        showSection(sectionPlayerResult);

        // Sau 4 giây chuyển sang trạng thái phù hợp
        setTimeout(() => {
            if (isEliminated) {
                showSection(sectionEliminated);
            }
            // Nếu thắng, chờ NextRoundReady / FinalStarted / RoundStarted
        }, 4000);
    });

    // Round kết thúc (broadcast cho cả phòng)
    connection.on('RoundEnded', (round, countA, countB, winner, optA, optB, activePlayers, eliminatedPlayers) => {
        // Player result sẽ handle UI riêng qua PlayerResult event
    });

    // Next round ready
    connection.on('NextRoundReady', (activePlayers) => {
        if (!isEliminated) {
            $('waiting-player-name').textContent = playerName;
            showSection(sectionWaiting);
            $('waiting-player-count').textContent = activePlayers + ' người còn lại';
        }
    });

    // Final result
    connection.on('FinalResult', (countA, countB, winner, optA, optB) => {
        const winnerText = winner === 'A' ? optA : optB;
        $('player-final-result-text').innerHTML = `
            <div style="font-size: 2rem; font-weight: 800; color: var(--accent-gold); margin: 12px 0;">
                ${winnerText}
            </div>
            <div style="margin-top: 8px;">
                ${optA}: <strong>${countA}</strong> — ${optB}: <strong>${countB}</strong>
            </div>
            <div style="margin-top: 16px; font-size: 0.9rem; color: var(--text-muted);">
                Cảm ơn bạn đã tham gia biểu quyết!
            </div>
        `;
        showSection(sectionFinalResult);
        showCelebration();
    });

    // Game reset
    connection.on('GameReset', () => {
        isEliminated = false;
        hasVoted = false;
        $('waiting-player-name').textContent = playerName;
        $('waiting-player-count').textContent = '';
        showSection(sectionWaiting);
    });

    // Full state (khi rejoin)
    connection.on('FullState', (state) => {
        console.log('[Player] Full state received:', state);

        // Tìm player info
        const myPlayer = null; // Server không gửi player detail, dùng state chung

        switch (state.status) {
            case 'Lobby':
                $('waiting-room-code').textContent = state.roomCode;
                $('waiting-player-name').textContent = playerName;
                $('waiting-player-count').textContent = state.totalPlayers;
                showSection(sectionWaiting);
                break;

            case 'Playing':
            case 'RoundEnded':
                if (isEliminated) {
                    showSection(sectionEliminated);
                } else {
                    showSection(sectionWaiting);
                }
                break;

            case 'RoundActive':
                if (isEliminated) {
                    showSection(sectionEliminated);
                } else if (hasVoted) {
                    showSection(sectionVoted);
                } else {
                    // Hiển thị câu hỏi
                    $('voting-round-badge').textContent = 'Vòng ' + state.currentRound;
                    $('voting-question-title').textContent = state.questionTitle;
                    $('voting-question-text').textContent = state.question;
                    $('voting-countdown').textContent = state.remainingSeconds;
                    $('vote-text-a').textContent = state.optionA;
                    $('vote-text-b').textContent = state.optionB;
                    showSection(sectionVoting);
                }
                break;

            case 'FinalActive':
                if (isEliminated) {
                    showSection(sectionEliminated);
                } else {
                    $('voting-round-badge').textContent = '🏆 Vòng Cuối';
                    $('voting-question-title').textContent = state.questionTitle;
                    $('voting-question-text').textContent = state.question;
                    $('voting-countdown').textContent = state.remainingSeconds;
                    $('vote-text-a').textContent = state.optionA;
                    $('vote-text-b').textContent = state.optionB;
                    showSection(sectionVoting);
                }
                break;

            case 'FinalEnded':
            case 'Finished':
                showSection(sectionFinalResult);
                break;

            default:
                showSection(sectionWaiting);
        }
    });

    // Error
    connection.on('Error', (msg) => {
        $('join-error').textContent = msg;
        console.error('[Player] Error:', msg);
    });

    // ═══════════════════════════════════════════════════
    //  BUTTON HANDLERS
    // ═══════════════════════════════════════════════════

    // Join room
    $('btn-join').addEventListener('click', () => {
        playerName = $('input-player-name').value.trim();
        const code = $('input-room-code').value.trim().toUpperCase();

        if (!playerName) {
            $('join-error').textContent = 'Vui lòng nhập tên';
            return;
        }
        if (!code || code.length < 4) {
            $('join-error').textContent = 'Mã phòng không hợp lệ';
            return;
        }

        $('join-error').textContent = '';
        roomCode = code;
        connection.invoke('JoinRoom', code, playerName).catch(err => {
            $('join-error').textContent = 'Không thể kết nối';
            console.error(err);
        });
    });

    // Enter key để join
    $('input-room-code').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') $('btn-join').click();
    });
    $('input-player-name').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') $('input-room-code').focus();
    });

    // Vote buttons
    $('btn-vote-a').addEventListener('click', () => {
        if (hasVoted) return;
        $('btn-vote-a').classList.add('selected');
        $('btn-vote-b').disabled = true;
        connection.invoke('Vote', roomCode, playerId, 'A').catch(err => console.error(err));
    });

    $('btn-vote-b').addEventListener('click', () => {
        if (hasVoted) return;
        $('btn-vote-b').classList.add('selected');
        $('btn-vote-a').disabled = true;
        connection.invoke('Vote', roomCode, playerId, 'B').catch(err => console.error(err));
    });

    // ═══════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════

    // Celebration particles
    function showCelebration() {
        const container = $('celebration');
        container.classList.remove('hidden');
        container.innerHTML = '';

        const colors = ['#f6c343', '#f43f5e', '#3b82f6', '#10b981', '#8b5cf6'];
        for (let i = 0; i < 40; i++) {
            const particle = document.createElement('div');
            particle.className = 'celebration-particle';
            particle.style.left = Math.random() * 100 + '%';
            particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            particle.style.animationDelay = Math.random() * 2 + 's';
            particle.style.animationDuration = (2 + Math.random() * 2) + 's';
            container.appendChild(particle);
        }

        setTimeout(() => container.classList.add('hidden'), 4000);
    }

    // Check URL params cho room code tự động
    function checkUrlParams() {
        const params = new URLSearchParams(window.location.search);
        const room = params.get('room');
        if (room) {
            $('input-room-code').value = room.toUpperCase();
        }
    }

    // Try rejoin từ localStorage
    function tryRejoin() {
        const savedId = localStorage.getItem('gdc_playerId');
        const savedRoom = localStorage.getItem('gdc_roomCode');
        const savedName = localStorage.getItem('gdc_playerName');

        if (savedId && savedRoom && savedName) {
            playerId = savedId;
            roomCode = savedRoom;
            playerName = savedName;

            connection.invoke('Rejoin', savedRoom, savedId).catch(err => {
                console.log('[Player] Rejoin failed, showing join screen');
                localStorage.removeItem('gdc_playerId');
                localStorage.removeItem('gdc_roomCode');
                localStorage.removeItem('gdc_playerName');
                showSection(sectionJoin);
            });
        }
    }

    // ═══════════════════════════════════════════════════
    //  CONNECT
    // ═══════════════════════════════════════════════════

    async function start() {
        try {
            await connection.start();
            updateConnectionStatus(true);
            console.log('[Player] Connected to SignalR');

            checkUrlParams();

            // Thử rejoin nếu có saved state
            const savedId = localStorage.getItem('gdc_playerId');
            if (savedId) {
                tryRejoin();
            }
        } catch (err) {
            console.error('[Player] Connection failed:', err);
            setTimeout(start, 3000);
        }
    }

    start();
})();
