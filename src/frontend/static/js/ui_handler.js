class UIHandler {
    constructor() {
        this.game = new ChessGameClient();
        this.isLocalMode = false;
        this.currentRoomCode = null;
        this.currentUser = null;
        this.recoveryCodes = [];
        this.publicRooms = [];
        this.roomFilter = 'all';
        this.roomModeFilter = 'all';
        this.activeDialog = null;
        this.dialogReturnFocus = null;
        this.confirmationResolver = null;
        this.statusTimer = null;
        this.setupEventListeners();
        this.loadCurrentUser();
    }

    setupEventListeners() {
        document.getElementById('btn-login').addEventListener('click', () => window.caissaRouter?.go('/login') || this.showAccountDialog('login-dialog'));
        document.getElementById('btn-register').addEventListener('click', () => {
            if (window.caissaRouter) { window.caissaRouter.go('/login'); window.caissaRouter.setAuthMode('register'); }
            else this.showAccountDialog('register-dialog');
        });
        document.getElementById('btn-profile').addEventListener('click', () => window.caissaRouter?.go(`/u/${encodeURIComponent(this.currentUser?.username || '')}`) || this.showProfileDialog());
        document.getElementById('btn-logout').addEventListener('click', () => this.logout());
        document.getElementById('btn-login-submit').addEventListener('click', () => this.login());
        document.getElementById('btn-login-recovery').addEventListener('click', () => this.showAccountDialog('recovery-dialog'));
        document.getElementById('btn-login-cancel').addEventListener('click', () => this.hideAccountDialogs());
        document.getElementById('btn-register-submit').addEventListener('click', () => this.register());
        document.getElementById('btn-register-cancel').addEventListener('click', () => this.hideAccountDialogs());
        document.getElementById('btn-recovery-submit').addEventListener('click', () => this.recoverPassword());
        document.getElementById('btn-recovery-cancel').addEventListener('click', () => this.hideAccountDialogs());
        document.getElementById('btn-download-recovery').addEventListener('click', () => this.downloadRecoveryCodes());
        document.getElementById('btn-copy-recovery').addEventListener('click', () => window.caissaRouter?.copyRecoveryCodes(this.recoveryCodes) || this.copyRecoveryCodes());
        document.getElementById('btn-close-recovery').addEventListener('click', () => this.hideAccountDialogs());
        document.getElementById('btn-profile-save').addEventListener('click', () => this.saveProfile());
        document.getElementById('btn-profile-cancel').addEventListener('click', () => this.hideAccountDialogs());

        // Menu buttons
        document.getElementById('btn-local').addEventListener('click', () => this.showLocalDialog());
        document.getElementById('btn-online').addEventListener('click', () => this.showOnlineDialog());
        document.getElementById('btn-join-room-direct').addEventListener('click', () => this.showJoinRoomDialog());
        document.querySelectorAll('[data-close-dialog]').forEach((button) => {
            button.addEventListener('click', () => this.closeDialog(button.dataset.closeDialog));
        });
        document.getElementById('btn-confirm-action').addEventListener('click', () => this.resolveConfirmation(true));
        document.getElementById('btn-cancel-action').addEventListener('click', () => this.resolveConfirmation(false));
        document.getElementById('btn-retry-connection').addEventListener('click', () => this.retryConnection());
        document.addEventListener('keydown', (event) => this.handleGlobalKeydown(event));

        // Local game dialog
        document.getElementById('btn-start-local').addEventListener('click', () => this.startLocalGame());
        document.getElementById('btn-cancel-local').addEventListener('click', () => this.hideLocalDialog());

        // Online game dialog
        document.getElementById('btn-create-room').addEventListener('click', () => this.showCreateRoomDialog());
        document.getElementById('btn-join-room').addEventListener('click', () => this.showJoinRoomDialog());
        document.getElementById('btn-cancel-online').addEventListener('click', () => this.hideOnlineDialog());

        // Create room dialog
        document.getElementById('btn-create-submit').addEventListener('click', () => this.createRoom());
        document.getElementById('btn-cancel-create').addEventListener('click', () => this.showOnlineDialog());

        // Join room dialog
        document.getElementById('btn-join-submit').addEventListener('click', () => this.joinRoom());
        document.getElementById('btn-cancel-join').addEventListener('click', () => this.showOnlineDialog());
        document.getElementById('btn-refresh-rooms').addEventListener('click', () => this.loadPublicRooms());
        document.querySelectorAll('[data-room-filter]').forEach((button) => button.addEventListener('click', () => {
            this.roomFilter = button.dataset.roomFilter;
            document.querySelectorAll('[data-room-filter]').forEach((item) => item.classList.toggle('is-active', item === button));
            this.renderPublicRooms();
        }));
        document.getElementById('room-mode-filter').addEventListener('change', (event) => { this.roomModeFilter = event.target.value; this.renderPublicRooms(); });
        document.getElementById('btn-spectate-submit').addEventListener('click', () => this.spectateRoom());
        document.getElementById('btn-cancel-spectate').addEventListener('click', () => this.closeDialog('spectate-room-dialog'));

        // Room info dialog
        document.getElementById('btn-copy-code').addEventListener('click', () => this.copyRoomCode());
        document.getElementById('btn-close-room-info').addEventListener('click', () => this.hideRoomInfoDialog());

        // Game controls
        document.getElementById('btn-undo').addEventListener('click', () => this.undoMove());
        document.getElementById('btn-new-game').addEventListener('click', () => this.newGame());
        document.getElementById('btn-resign').addEventListener('click', () => this.resign());
        document.getElementById('btn-offer-draw').addEventListener('click', () => this.offerDraw());

        // Game footer
        document.getElementById('btn-back-menu').addEventListener('click', () => this.backToMenu());

        // Game end dialog
        document.getElementById('btn-play-again').addEventListener('click', () => this.playAgain());
        document.getElementById('btn-menu-final').addEventListener('click', () => this.backToMenu());

        // Update game status periodically
        this.statusTimer = window.setInterval(() => this.updateGameStatus(), 1000);
        window.addEventListener('caissa:localechange', () => this.updateGameStatus());
    }

    notify(message, kind = 'info') {
        const region = document.getElementById('toast-region');
        if (!region) return;
        const toast = document.createElement('div');
        toast.className = `toast ${kind}`;
        toast.textContent = window.caissaI18n.normalize(message);
        region.appendChild(toast);
        window.setTimeout(() => {
            toast.classList.add('toast-leaving');
            window.setTimeout(() => toast.remove(), 180);
        }, 4200);
    }

    setBusy(button, busy, busyLabel = 'Processando…') {
        if (!button) return;
        if (busy) {
            button.dataset.idleLabel = button.textContent;
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
            button.textContent = window.caissaI18n.normalize(busyLabel);
        } else {
            button.disabled = false;
            button.removeAttribute('aria-busy');
            if (button.dataset.idleLabel) button.textContent = button.dataset.idleLabel;
        }
    }

    focusables(dialog) {
        return [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href]')];
    }

    openDialog(id) {
        this.closeAllDialogs();
        const dialog = document.getElementById(id);
        if (!dialog) return;
        this.dialogReturnFocus = document.activeElement;
        this.activeDialog = id;
        dialog.classList.remove('hidden');
        document.body.classList.add('dialog-open');
        const first = this.focusables(dialog)[0];
        window.requestAnimationFrame(() => first?.focus());
    }

    closeDialog(id) {
        const dialog = document.getElementById(id);
        if (!dialog) return;
        dialog.classList.remove('dialog-entering');
        dialog.classList.add('dialog-closing');
        window.setTimeout(() => {
            if (!dialog.classList.contains('dialog-closing')) return;
            dialog.classList.add('hidden');
            dialog.classList.remove('dialog-closing');
            if (this.activeDialog === id) {
                this.activeDialog = null;
                document.body.classList.remove('dialog-open');
                if (this.dialogReturnFocus && document.contains(this.dialogReturnFocus)) this.dialogReturnFocus.focus();
            }
        }, 150);
    }

    closeAllDialogs() {
        if (this.confirmationResolver) {
            const resolver = this.confirmationResolver;
            this.confirmationResolver = null;
            resolver(false);
        }
        document.querySelectorAll('.dialog').forEach((dialog) => {
            dialog.classList.add('hidden');
            dialog.classList.remove('dialog-entering', 'dialog-closing');
        });
        this.activeDialog = null;
        document.body.classList.remove('dialog-open');
    }

    handleGlobalKeydown(event) {
        if (!this.activeDialog) return;
        const dialog = document.getElementById(this.activeDialog);
        if (!dialog) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            if (this.activeDialog === 'confirm-dialog') this.resolveConfirmation(false);
            else this.closeDialog(this.activeDialog);
            return;
        }
        if (event.key !== 'Tab') return;
        const items = this.focusables(dialog);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }

    requestConfirmation(title, message, confirmLabel = 'Confirmar') {
        if (this.confirmationResolver) this.resolveConfirmation(false);
        document.getElementById('confirm-title').textContent = title;
        document.getElementById('confirm-message').textContent = message;
        document.getElementById('btn-confirm-action').textContent = confirmLabel;
        this.openDialog('confirm-dialog');
        return new Promise((resolve) => { this.confirmationResolver = resolve; });
    }

    resolveConfirmation(value) {
        const resolver = this.confirmationResolver;
        this.confirmationResolver = null;
        this.closeDialog('confirm-dialog');
        resolver?.(value);
    }

    showLocalDialog() {
        this.openDialog('local-dialog');
    }

    hideLocalDialog() {
        this.closeDialog('local-dialog');
    }

    showOnlineDialog() {
        this.openDialog('online-dialog');
    }

    hideOnlineDialog() {
        this.closeDialog('online-dialog');
    }

    showCreateRoomDialog() {
        this.openDialog('create-room-dialog');
    }

    showJoinRoomDialog() {
        this.openDialog('join-room-dialog');
    }

    showRoomInfoDialog(roomCode) {
        document.getElementById('room-code-display').textContent = roomCode;
        this.openDialog('room-info-dialog');
    }

    hideRoomInfoDialog() {
        this.closeDialog('room-info-dialog');
        this.closeDialog('spectate-room-dialog');
    }

    async startLocalGame() {
        const whiteName = document.getElementById('white-player').value || 'Jogador 1';
        const blackName = document.getElementById('black-player').value || 'Jogador 2';

        this.hideLocalDialog();
        document.getElementById('menu-principal').classList.add('hidden');

        try {
            await this.game.createLocalGame(whiteName, blackName);
            this.isLocalMode = true;
            this.currentRoomCode = this.game.gameId;
            window.caissaRouter?.go(`/room/${encodeURIComponent(this.currentRoomCode)}`);
            this.setSpectatorMode(false);
            this.setConnectionStatus('Partida local', 'connected');
            document.getElementById('game-container').classList.remove('hidden');
            document.getElementById('online-controls').style.display = 'none';
            this.updateGameStatus();
        } catch (error) {
            this.notify('Não foi possível criar a partida local.', 'error');
            document.getElementById('menu-principal').classList.remove('hidden');
        }
    }

    async createRoom() {
        document.getElementById('create-room-dialog').classList.add('hidden');
        const submit = document.getElementById('btn-create-submit');
        this.setBusy(submit, true, 'Abrindo…');

        try {
            const result = await this.game.createOnlineRoom({
                name: document.getElementById('room-name').value,
                accessMode: document.getElementById('room-access').value,
                mode: document.getElementById('room-mode').value,
            });
            this.currentRoomCode = result.room_code;
            window.caissaRouter?.go(`/room/${encodeURIComponent(result.room_code)}`);
            document.getElementById('menu-principal').classList.add('hidden');
            document.getElementById('game-container').classList.remove('hidden');
            document.getElementById('online-controls').style.display = 'block';
            this.setSpectatorMode(false);
            this.showRoomInfoDialog(result.room_code);
            this.updateGameStatus();
        } catch (error) {
            this.notify(error.message || 'Não foi possível criar a sala.', 'error');
            this.showCreateRoomDialog();
        } finally { this.setBusy(submit, false); }
    }

    async joinRoom() {
        const roomCode = document.getElementById('room-code').value.toUpperCase();
        const playerName = document.getElementById('join-player-name').value || 'Jogador';

        if (!roomCode) {
            this.notify('Digite o código da sala.', 'error');
            return;
        }

        document.getElementById('join-room-dialog').classList.add('hidden');
        const submit = document.getElementById('btn-join-submit');
        this.setBusy(submit, true, 'Entrando…');

        try {
            const result = await this.game.joinOnlineGame(roomCode, playerName);
            this.currentRoomCode = roomCode;
            window.caissaRouter?.go(`/room/${encodeURIComponent(roomCode)}`);
            document.getElementById('menu-principal').classList.add('hidden');
            document.getElementById('game-container').classList.remove('hidden');
            document.getElementById('online-controls').style.display = 'block';
            this.setSpectatorMode(false);
            this.updateGameStatus();
        } catch (error) {
            this.notify(error.message || 'Não foi possível entrar na sala.', 'error');
            this.showJoinRoomDialog();
        } finally { this.setBusy(submit, false); }
    }

    copyRoomCode() {
        const code = this.currentRoomCode || document.getElementById('room-code-display').textContent;
        navigator.clipboard.writeText(code).then(() => {
            this.notify(`Código ${code} copiado.`, 'success');
        });
    }

    updateGameStatus() {
        if (!this.game.gameId || !this.game.gameState) return;

        document.getElementById('white-player-name').textContent = this.game.whitePlayer;
        document.getElementById('black-player-name').textContent = this.game.blackPlayer;
        const modeLabel = document.getElementById('game-mode-label');
        if (modeLabel) modeLabel.textContent = String(this.game.gameMode || 'partida').toUpperCase();
        this.updateClocks();
        this.renderPlayerProfile('white', this.game.gameState && this.game.gameState.white_profile);
        this.renderPlayerProfile('black', this.game.gameState && this.game.gameState.black_profile);

        const statusText = this.game.getGameStatus();
        const nextStatusText = this.game.isSpectator ? window.caissaI18n.t('game.spectatingStatus', {status: statusText}) : statusText;
        const moveText = document.getElementById('move-text');
        if (moveText.textContent !== nextStatusText) moveText.textContent = nextStatusText;
        const moveCount = document.getElementById('move-count');
        const nextMoveCount = String(this.game.moveHistory.length);
        if (moveCount && moveCount.textContent !== nextMoveCount) moveCount.textContent = nextMoveCount;

        // Update move history
        const historyDiv = document.getElementById('move-history');
        const moves = this.game.getMoveHistory();
        const nextHistory = moves || window.caissaI18n.t('game.emptyHistory');
        if (historyDiv.textContent !== nextHistory) historyDiv.textContent = nextHistory;

        // Update captured pieces
        if (this.game.gameState) {
            const whiteCaptured = this.getCapturedPieces('white');
            const blackCaptured = this.getCapturedPieces('black');
            document.getElementById('white-captured').textContent = whiteCaptured;
            document.getElementById('black-captured').textContent = blackCaptured;
        }

        // Check if game is over
        if (this.game.isGameOver()) {
            setTimeout(() => this.showGameEndDialog(), 500);
        }

        // Disable/enable moves based on whose turn it is
        if (!this.game.isLocalGame) {
            document.getElementById('btn-undo').style.opacity = 
                this.game.canMove() ? '1' : '0.5';
            document.getElementById('btn-undo').disabled = !this.game.canMove();
        }
    }

    getCapturedPieces(color) {
        const moveHistory = this.game.moveHistory;
        const pieceSymbols = {
            p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚'
        };

        let captured = [];
        
        // Analyze board to find captured pieces
        const initialBoard = this.getInitialBoard();
        const currentBoard = this.game.gameState.board;

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const initialPiece = initialBoard[row][col];
                const currentPiece = currentBoard[row][col];

                if (initialPiece && !currentPiece) {
                    // Piece was captured
                    if ((color === 'white' && initialPiece.color === 'black') ||
                        (color === 'black' && initialPiece.color === 'white')) {
                        captured.push(pieceSymbols[initialPiece.type] || '?');
                    }
                }
            }
        }

        return captured.join(' ');
    }

    getInitialBoard() {
        return [
            [
                {type: 'r', color: 'black'}, {type: 'n', color: 'black'},
                {type: 'b', color: 'black'}, {type: 'q', color: 'black'},
                {type: 'k', color: 'black'}, {type: 'b', color: 'black'},
                {type: 'n', color: 'black'}, {type: 'r', color: 'black'}
            ],
            [
                {type: 'p', color: 'black'}, {type: 'p', color: 'black'},
                {type: 'p', color: 'black'}, {type: 'p', color: 'black'},
                {type: 'p', color: 'black'}, {type: 'p', color: 'black'},
                {type: 'p', color: 'black'}, {type: 'p', color: 'black'}
            ],
            [null, null, null, null, null, null, null, null],
            [null, null, null, null, null, null, null, null],
            [null, null, null, null, null, null, null, null],
            [null, null, null, null, null, null, null, null],
            [
                {type: 'p', color: 'white'}, {type: 'p', color: 'white'},
                {type: 'p', color: 'white'}, {type: 'p', color: 'white'},
                {type: 'p', color: 'white'}, {type: 'p', color: 'white'},
                {type: 'p', color: 'white'}, {type: 'p', color: 'white'}
            ],
            [
                {type: 'r', color: 'white'}, {type: 'n', color: 'white'},
                {type: 'b', color: 'white'}, {type: 'q', color: 'white'},
                {type: 'k', color: 'white'}, {type: 'b', color: 'white'},
                {type: 'n', color: 'white'}, {type: 'r', color: 'white'}
            ]
        ];
    }

    undoMove() {
        // Note: This is simplified - a full implementation would require backend support
        this.notify('Desfazer movimento não está disponível nesta versão.', 'error');
    }

    newGame() {
        this.requestConfirmation('Começar um novo jogo?', 'A partida atual será deixada. O estado persistido não será alterado.', 'Voltar ao lobby')
            .then((confirmed) => { if (confirmed) this.backToMenu(); });
    }

    resign() {
        this.requestConfirmation('Desistir da partida?', 'A desistência encerra a partida imediatamente e dá a vitória ao oponente.', 'Desistir')
            .then((confirmed) => { if (confirmed) {
            if (this.game.isSpectator) return;
            if (this.game.isLocalGame) {
                this.game.resignLocal().catch((error) => this.notify(error.message, 'error'));
            } else if (this.game.multiplayer) {
                this.game.multiplayer.resign();
            } else {
                this.notify('A partida ainda não está conectada.', 'error');
            }
        }});
    }

    offerDraw() {
        if (!this.game.isLocalGame && !this.game.isSpectator && this.game.multiplayer) this.game.multiplayer.offerDraw();
    }

    showGameEndDialog(winner = null, reason = null) {
        const title = document.getElementById('game-end-title');
        const message = document.getElementById('game-end-message');

        if (winner === null || winner === 'draw') {
            title.textContent = window.caissaI18n.t('game.drawTitle');
            message.textContent = reason ? window.caissaI18n.normalize(reason) : window.caissaI18n.t('game.drawEnded');
        } else {
            const winnerName = winner === 'white' ? this.game.whitePlayer : this.game.blackPlayer;
            title.textContent = window.caissaI18n.t('game.wonTitle', {name: winnerName});
            
            if (!reason) {
                if (this.game.gameState.is_checkmate) {
                    reason = window.caissaI18n.t('replay.result.checkmate');
                } else if (this.game.gameState.is_stalemate) {
                    reason = window.caissaI18n.t('replay.result.stalemate');
                }
            }
            message.textContent = reason ? window.caissaI18n.normalize(reason) : '';
        }

        this.openDialog('game-end-dialog');
    }

    hideGameEndDialog() {
        this.closeDialog('game-end-dialog');
    }

    playAgain() {
        this.hideGameEndDialog();
        const isLocal = this.isLocalMode;
        this.backToMenu();
        
        if (isLocal) {
            setTimeout(() => this.showLocalDialog(), 300);
        }
    }

    backToMenu() {
        this.closeAllDialogs();
        document.getElementById('game-container').classList.add('hidden');
        document.getElementById('menu-principal').classList.remove('hidden');
        
        this.game.reset();
        this.currentRoomCode = null;
        this.isLocalMode = false;
        this.setSpectatorMode(false);
        document.getElementById('opponent-status').classList.add('hidden');
        document.getElementById('btn-retry-connection').classList.add('hidden');
        if (window.caissaRouter && window.caissaRouter.currentPath !== '/lobby') window.caissaRouter.go('/lobby');
        else this.loadPublicRooms();
    }

    updateClocks() {
        const state = this.game.gameState;
        const clock = state && (state.clock || state);
        if (!clock) return;
        ['white', 'black'].forEach((color) => {
            const value = clock[`${color}_time_remaining_ms`] ?? clock[`${color}_time_ms`];
            if (typeof value === 'number') {
                const minutes = Math.floor(value / 60000).toString().padStart(2, '0');
                const seconds = Math.floor((value % 60000) / 1000).toString().padStart(2, '0');
                document.getElementById(`${color}-clock`).textContent = `${minutes}:${seconds}`;
            }
        });
    }

    renderPlayerProfile(color, profile) {
        const avatar = document.getElementById(`${color}-player-avatar`);
        const status = document.getElementById(`${color}-player-status`);
        const name = document.getElementById(`${color}-player-name`);
        if (!profile) {
            avatar.textContent = color === 'white' ? '♔' : '♚';
            name.textContent = color === 'white' ? 'Brancas' : 'Pretas';
            name.removeAttribute('data-route');
            name.setAttribute('href', '#');
            status.textContent = '';
            return;
        }
        name.textContent = profile.username || (color === 'white' ? 'Brancas' : 'Pretas');
        if (profile.username) {
            name.href = `/u/${encodeURIComponent(profile.username)}`;
            name.dataset.route = `/u/${encodeURIComponent(profile.username)}`;
        }
        avatar.textContent = '';
        if (profile.profile_image_url) {
            const image = document.createElement('img');
            image.src = profile.profile_image_url;
            image.alt = `Avatar de ${profile.username}`;
            image.onerror = () => { avatar.textContent = '♙'; };
            avatar.appendChild(image);
        } else {
            avatar.textContent = profile.username.slice(0, 1).toUpperCase();
        }
        status.textContent = profile.status || '';
    }

    showAccountDialog(id) {
        this.openDialog(id);
    }

    hideAccountDialogs() {
        this.closeAllDialogs();
    }

    setSpectatorMode(active) {
        const game = document.getElementById('game-container');
        game.classList.toggle('spectator-mode', active);
        document.getElementById('spectator-banner').classList.toggle('hidden', !active);
        document.getElementById('spectator-controls').classList.toggle('hidden', !active);
        document.getElementById('online-controls').style.display = active ? 'none' : (this.currentRoomCode ? 'flex' : 'none');
        ['btn-resign', 'btn-offer-draw'].forEach((id) => {
            document.getElementById(id).classList.toggle('hidden', active);
        });
    }

    setConnectionStatus(label, state = 'connected') {
        const status = document.getElementById('connection-status');
        const retry = document.getElementById('btn-retry-connection');
        status.innerHTML = `<i></i> ${this.escapeHtml(label)}`;
        status.dataset.state = state;
        status.classList.toggle('is-offline', state !== 'connected' && state !== 'reconnected');
        retry.classList.toggle('hidden', !['lost', 'expired'].includes(state));
        retry.disabled = false;
        retry.textContent = window.caissaI18n.t(state === 'expired' ? 'game.retryLogin' : 'game.retry');
    }

    setOpponentStatus(message) {
        const target = document.getElementById('opponent-status');
        target.textContent = message || '';
        target.classList.toggle('hidden', !message);
    }

    retryConnection() {
        if (!this.game.multiplayer) return;
        if (document.getElementById('connection-status').dataset.state === 'expired') {
            this.showAccountDialog('login-dialog');
            return;
        }
        this.setConnectionStatus(window.caissaI18n.t('game.reconnecting'), 'reconnecting');
        this.game.multiplayer.retry();
    }

    async loadCurrentUser() {
        try {
            const response = await fetch('/api/v1/auth/me');
            if (response.ok) {
                this.currentUser = (await response.json()).user;
                this.renderAccount();
                if (window.caissaRouter?.currentPath === `/u/${encodeURIComponent(this.currentUser.username)}`) window.caissaRouter.showProfile(this.currentUser.username);
            }
        } catch (_error) {
            this.notify('Não foi possível verificar sua sessão agora.', 'error');
        }
    }

    async loadPublicRooms() {
        const container = document.getElementById('rooms-list');
        try {
            const response = await fetch('/api/v1/rooms?limit=20');
            if (!response.ok) throw new Error('rooms unavailable');
            this.publicRooms = (await response.json()).rooms || [];
            this.renderPublicRooms();
        } catch (_error) {
            container.innerHTML = `<div class="empty-state error-state">${window.caissaI18n.t('room.loadError')}<br><button class="button button-ghost button-small" data-retry-rooms="true">${window.caissaI18n.t('room.retry')}</button></div>`;
            container.querySelector('[data-retry-rooms]')?.addEventListener('click', () => this.loadPublicRooms());
        }
    }

    renderPublicRooms() {
        const container = document.getElementById('rooms-list');
        const rooms = this.publicRooms.filter((room) => {
            const statusMatch = this.roomFilter === 'all' || room.status === this.roomFilter;
            const modeMatch = this.roomModeFilter === 'all' || room.mode === this.roomModeFilter;
            return statusMatch && modeMatch;
        });
        if (!rooms.length) {
            container.innerHTML = `<p class="empty-state">${window.caissaI18n.t('room.emptyFilter')}<br><small>${window.caissaI18n.t('room.emptyHint')}</small></p>`;
            return;
        }
        const formatRoomClock = (value) => typeof value === 'number' ? `${Math.floor(value / 60000).toString().padStart(2, '0')}:${Math.floor((value % 60000) / 1000).toString().padStart(2, '0')}` : '—:—';
        container.innerHTML = rooms.map((room) => `
                <article class="room-card"><div><strong>${this.escapeHtml(room.name)}</strong><span>${this.escapeHtml(this.roomModeLabel(room.mode))}</span></div>
                <p>${this.escapeHtml(room.white_player || window.caissaI18n.t('room.waiting'))} ${room.black_player ? `× ${this.escapeHtml(room.black_player)}` : `× ${window.caissaI18n.t('room.waitingOpponent')}`}</p>
                <small>${formatRoomClock(room.clock?.white_time_remaining_ms)} × ${formatRoomClock(room.clock?.black_time_remaining_ms)} · ${window.caissaI18n.t('room.spectators', {count: room.spectator_count || 0})} · ${this.escapeHtml(this.roomStatusLabel(room.status))}</small>
                <div class="room-card-actions"><button class="button button-amber button-small" data-room-join="${this.escapeHtml(room.room_code || '')}">${window.caissaI18n.t('room.join')}</button><button class="button button-ghost button-small" data-room-spectate="${this.escapeHtml(room.room_code || '')}">${window.caissaI18n.t('room.watch')}</button></div></article>`).join('');
        container.querySelectorAll('[data-room-join]').forEach((button) => button.addEventListener('click', () => { document.getElementById('room-code').value = button.dataset.roomJoin; this.showJoinRoomDialog(); }));
        container.querySelectorAll('[data-room-spectate]').forEach((button) => button.addEventListener('click', () => this.startSpectating(button.dataset.roomSpectate)));
    }

    startSpectating(roomCode) {
        document.getElementById('spectate-room-code').value = roomCode;
        this.openDialog('spectate-room-dialog');
    }

    roomModeLabel(mode) {
        const labels = {bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical'};
        return labels[mode] || mode || '—';
    }

    roomStatusLabel(status) {
        if (status === 'waiting') return window.caissaI18n.t('room.waiting');
        if (status === 'active') return window.caissaI18n.current === 'en-US' ? 'In game' : 'Em jogo';
        return status || '—';
    }

    async spectateRoom() {
        const roomCode = document.getElementById('spectate-room-code').value.toUpperCase();
        const submit = document.getElementById('btn-spectate-submit');
        this.setBusy(submit, true, 'Conectando…');
        try {
            const response = await fetch(`/api/v1/rooms/${roomCode}/spectate`, { method: 'POST' });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Não foi possível espectar');
            this.closeDialog('spectate-room-dialog');
            this.currentRoomCode = data.room_code;
            document.getElementById('menu-principal').classList.add('hidden');
            document.getElementById('game-container').classList.remove('hidden');
            await this.game.openSpectator(data.room_code, data.room.game_id, data.spectator_token, data.room.game_state);
            this.setSpectatorMode(true);
            this.updateGameStatus();
            window.caissaRouter?.go(`/room/${encodeURIComponent(data.room_code)}`);
        } catch (error) { this.notify(error.message || 'Não foi possível entrar como espectador.', 'error'); }
        finally { this.setBusy(submit, false); }
    }

    escapeHtml(value) {
        const element = document.createElement('span');
        element.textContent = value == null ? '' : value;
        return element.innerHTML;
    }

    renderAccount() {
        const authenticated = Boolean(this.currentUser);
        document.getElementById('account-label').textContent = authenticated
            ? `@${this.currentUser.username}` : 'Convidado';
        document.getElementById('btn-login').classList.toggle('hidden', authenticated);
        document.getElementById('btn-register').classList.toggle('hidden', authenticated);
        document.getElementById('btn-profile').classList.toggle('hidden', !authenticated);
        document.getElementById('btn-logout').classList.toggle('hidden', !authenticated);
    }

    async login() {
        const submit = document.getElementById('btn-login-submit');
        this.setBusy(submit, true, 'Entrando…');
        try {
            const response = await fetch('/api/v1/auth/login', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ username: document.getElementById('login-username').value, password: document.getElementById('login-password').value })
            });
            if (!response.ok) { this.notify('Não foi possível entrar. Verifique seus dados.', 'error'); return; }
            this.currentUser = (await response.json()).user;
            this.hideAccountDialogs();
            this.renderAccount();
            this.notify('Sessão iniciada.', 'success');
        } catch (_error) { this.notify('Servidor indisponível. Tente novamente.', 'error'); }
        finally { this.setBusy(submit, false); }
    }

    async register() {
        const submit = document.getElementById('btn-register-submit');
        this.setBusy(submit, true, 'Criando…');
        try {
            const response = await fetch('/api/v1/auth/register', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ username: document.getElementById('register-username').value, password: document.getElementById('register-password').value })
            });
            const data = await response.json();
            if (!response.ok) { this.notify(data.error || 'Não foi possível criar a conta.', 'error'); return; }
            this.currentUser = data.user;
            this.recoveryCodes = data.recovery_codes;
            this.showRecoveryCodes();
            this.renderAccount();
        } catch (_error) { this.notify('Servidor indisponível. Tente novamente.', 'error'); }
        finally { this.setBusy(submit, false); }
    }

    async logout() {
        try { await fetch('/api/v1/auth/logout', {method: 'POST'}); }
        catch (_error) { this.notify('Sessão removida localmente; o servidor não respondeu.', 'error'); }
        this.currentUser = null;
        this.renderAccount();
        this.notify('Você saiu da conta.', 'success');
    }

    async recoverPassword() {
        const submit = document.getElementById('btn-recovery-submit');
        this.setBusy(submit, true, 'Redefinindo…');
        try {
            const response = await fetch('/api/v1/auth/recovery', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ username: document.getElementById('recovery-username').value, recovery_code: document.getElementById('recovery-code').value, new_password: document.getElementById('recovery-password').value })
            });
            if (!response.ok) { this.notify('Não foi possível recuperar a conta.', 'error'); return; }
            this.notify('Senha alterada. Entre novamente.', 'success');
            this.showAccountDialog('login-dialog');
        } catch (_error) { this.notify('Servidor indisponível. Tente novamente.', 'error'); }
        finally { this.setBusy(submit, false); }
    }

    showRecoveryCodes() {
        document.getElementById('recovery-codes-output').textContent =
            `Username: ${this.currentUser.username}\n\n${this.recoveryCodes.join('\n')}`;
        this.openDialog('recovery-codes-dialog');
    }

    downloadRecoveryCodes() {
        if (window.caissaRouter) return window.caissaRouter.downloadCodes(this.recoveryCodes);
        const content = `Caissa recovery codes\nUsername: ${this.currentUser.username}\n\n${this.recoveryCodes.join('\n')}\n`;
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([content], {type: 'text/plain'}));
        link.download = 'caissa-recovery-codes.txt';
        link.click();
        URL.revokeObjectURL(link.href);
    }

    copyRecoveryCodes() {
        const content = this.recoveryCodes.join('\n');
        if (!content) return;
        navigator.clipboard?.writeText(content).then(() => this.notify('Códigos copiados.', 'success')).catch(() => this.notify('Não foi possível copiar os códigos.', 'error'));
    }

    showProfileDialog() {
        document.getElementById('profile-avatar').value = this.currentUser.profile_image_url || '';
        document.getElementById('profile-bio').value = this.currentUser.bio || '';
        document.getElementById('profile-emoji').value = this.currentUser.status_emoji || '';
        document.getElementById('profile-status').value = this.currentUser.status_message || '';
        document.getElementById('profile-timezone').value = this.currentUser.timezone || 'UTC';
        this.showAccountDialog('profile-dialog');
    }

    async saveProfile() {
        const submit = document.getElementById('btn-profile-save');
        this.setBusy(submit, true, 'Salvando…');
        try {
            const response = await fetch('/api/v1/users/me/profile', {
                method: 'PATCH', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ profile_image_url: document.getElementById('profile-avatar').value || null, bio: document.getElementById('profile-bio').value, status_emoji: document.getElementById('profile-emoji').value || null, status_message: document.getElementById('profile-status').value, timezone: document.getElementById('profile-timezone').value })
            });
            if (!response.ok) { this.notify('Não foi possível salvar o perfil.', 'error'); return; }
            this.currentUser = (await response.json()).user;
            this.hideAccountDialogs();
            this.renderAccount();
            if (window.caissaRouter?.currentPath === `/u/${encodeURIComponent(this.currentUser.username)}`) window.caissaRouter.showProfile(this.currentUser.username);
            this.notify('Perfil atualizado.', 'success');
        } catch (_error) { this.notify('Servidor indisponível. Tente novamente.', 'error'); }
        finally { this.setBusy(submit, false); }
    }
}

// Initialize the UI whether this script loads before or after DOMContentLoaded.
const initializeUi = () => {
    if (!window.uiHandler) {
        window.uiHandler = new UIHandler();
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeUi, { once: true });
} else {
    initializeUi();
}
