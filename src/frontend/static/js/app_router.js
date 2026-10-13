class CaissaRouter {
    constructor(ui) {
        this.ui = ui;
        this.currentPath = null;
        this.profileRequest = 0;
        this.replayRequest = 0;
        this.replayData = null;
        this.replayBoard = null;
    }

    initialize() {
        document.addEventListener('click', (event) => {
            const link = event.target.closest?.('[data-route]');
            if (!link) return;
            event.preventDefault();
            this.go(link.dataset.route || link.getAttribute('href') || '/home');
        });
        window.addEventListener('popstate', () => this.resolve(window.location.pathname, false));
        this.bindAuthForms();
        this.bindProfileSurface();
        this.bindReplaySurface();
        window.addEventListener('caissa:localechange', () => {
            if (this.currentPath === '/lobby') this.ui.renderPublicRooms();
            const profile = this.currentPath?.match(/^\/u\/([^/]+)$/);
            if (profile) this.showProfile(decodeURIComponent(profile[1]));
        });
        const initialPath = window.location.pathname === '/' ? '/home' : window.location.pathname;
        if (window.location.pathname === '/') history.replaceState({}, '', initialPath);
        this.resolve(initialPath, true);
    }

    go(path, replace = false) {
        const normalized = path || '/home';
        if (replace) history.replaceState({}, '', normalized);
        else if (window.location.pathname !== normalized) history.pushState({}, '', normalized);
        this.resolve(normalized, false);
        return true;
    }

    resolve(path, initial = false) {
        const normalized = path.replace(/\/$/, '') || '/home';
        if (this.currentPath === normalized && !initial) return;
        this.currentPath = normalized;
        document.querySelectorAll('.primary-nav [data-route]').forEach((link) => {
            const current = normalized === link.dataset.route || (link.dataset.route === '/lobby' && normalized.startsWith('/room/'));
            if (current) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        });
        const profileMatch = normalized.match(/^\/u\/([^/]+)$/);
        const roomMatch = normalized.match(/^\/room\/([^/]+)$/);
        const gameMatch = normalized.match(/^\/games\/([^/]+)$/);
        if (normalized === '/login') return this.showLogin('login');
        if (normalized === '/home') return this.showHome();
        if (normalized === '/lobby') return this.showLobby();
        if (profileMatch) return this.showProfile(decodeURIComponent(profileMatch[1]));
        if (roomMatch) return this.showRoom(decodeURIComponent(roomMatch[1]));
        if (gameMatch) return this.showReplay(decodeURIComponent(gameMatch[1]));
        this.go('/home', true);
    }

    hideSurfaces() {
        this.ui.closeAllDialogs();
        ['landing-page', 'login-page', 'profile-page', 'menu-principal', 'game-container', 'game-replay-page'].forEach((id) => document.getElementById(id)?.classList.add('hidden'));
    }

    showHome() {
        if (this.ui.game.gameId) {
            this.ui.game.reset();
            this.ui.currentRoomCode = null;
            this.ui.isLocalMode = false;
        }
        this.hideSurfaces();
        document.getElementById('landing-page').classList.remove('hidden');
    }

    showLobby() {
        if (this.ui.game.gameId) {
            this.ui.game.reset();
            this.ui.currentRoomCode = null;
            this.ui.isLocalMode = false;
        }
        this.hideSurfaces();
        document.getElementById('menu-principal').classList.remove('hidden');
        this.ui.loadPublicRooms();
    }

    showLogin(mode = 'login') {
        this.hideSurfaces();
        document.getElementById('login-page').classList.remove('hidden');
        this.setAuthMode(mode);
    }

    setAuthMode(mode) {
        document.querySelectorAll('[data-auth-mode]').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.authMode !== mode));
        const first = document.querySelector(`[data-auth-mode="${mode}"] input`);
        window.requestAnimationFrame(() => first?.focus());
    }

    async showProfile(username) {
        this.hideSurfaces();
        document.getElementById('profile-page').classList.remove('hidden');
        const requestId = ++this.profileRequest;
        const name = document.getElementById('profile-page-name');
        name.textContent = username;
        document.getElementById('profile-stats').innerHTML = `<p class="empty-state">${window.caissaI18n.t('loading.stats')}</p>`;
        document.getElementById('profile-games').innerHTML = `<p class="empty-state">${window.caissaI18n.t('loading.history')}</p>`;
        try {
            const encoded = encodeURIComponent(username);
            const [profileResponse, statsResponse, gamesResponse] = await Promise.all([
                fetch(`/api/v1/users/${encoded}`),
                fetch(`/api/v1/users/${encoded}/stats`),
                fetch(`/api/v1/users/${encoded}/games`),
            ]);
            if (!profileResponse.ok) throw new Error(window.caissaI18n.t('profile.missing'));
            const profile = (await profileResponse.json()).user;
            const stats = statsResponse.ok ? await statsResponse.json() : null;
            const games = gamesResponse.ok ? (await gamesResponse.json()).games || [] : [];
            if (requestId !== this.profileRequest) return;
            this.renderProfile(profile, stats, games);
        } catch (error) {
            if (requestId !== this.profileRequest) return;
            document.getElementById('profile-page-bio').textContent = error.message || window.caissaI18n.t('profile.unavailable');
            document.getElementById('profile-stats').innerHTML = `<p class="empty-state error-state">${window.caissaI18n.t('profile.unavailable')}</p>`;
            document.getElementById('profile-games').innerHTML = '';
        }
    }

    renderProfile(profile, stats, games) {
        const username = profile.username || (window.caissaI18n.current === 'en-US' ? 'Player' : 'Jogador');
        const isOwn = this.ui.currentUser && this.ui.currentUser.username.toLowerCase() === username.toLowerCase();
        document.getElementById('profile-page-name').textContent = username;
        document.getElementById('profile-page-status').textContent = profile.status || '';
        document.getElementById('profile-page-bio').textContent = profile.bio || window.caissaI18n.t('profile.bioEmpty');
        const avatar = document.getElementById('profile-page-avatar');
        avatar.textContent = '';
        if (profile.profile_image_url) {
            const image = document.createElement('img');
            image.src = profile.profile_image_url;
            image.alt = `Avatar de ${username}`;
            image.onerror = () => { avatar.textContent = username.slice(0, 1).toUpperCase(); };
            avatar.appendChild(image);
        } else avatar.textContent = username.slice(0, 1).toUpperCase();
        document.getElementById('profile-private-nav').classList.toggle('hidden', !isOwn);
        document.getElementById('profile-security-panel').classList.add('hidden');
        document.getElementById('btn-profile-edit-page').classList.toggle('hidden', !isOwn);
        this.renderStats(stats);
        this.renderGames(games);
    }

    renderStats(stats) {
        if (!stats) {
            document.getElementById('profile-stats').innerHTML = `<p class="empty-state">${window.caissaI18n.t('profile.noStats')}</p>`;
            return;
        }
        const overall = stats.overall || stats;
        const week = stats.week || {};
        const month = stats.month || {};
        const values = [
            [window.caissaI18n.t('profile.stats.games'), overall.total ?? overall.total_games ?? 0],
            [window.caissaI18n.t('profile.stats.wins'), overall.wins ?? 0],
            [window.caissaI18n.t('profile.stats.losses'), overall.losses ?? 0],
            [window.caissaI18n.t('profile.stats.draws'), overall.draws ?? 0],
            [window.caissaI18n.t('profile.stats.winRate'), `${overall.win_rate ?? 0}%`],
            [window.caissaI18n.t('profile.stats.week'), week.total ?? 0],
            [window.caissaI18n.t('profile.stats.month'), month.total ?? 0],
        ];
        document.getElementById('profile-stats').innerHTML = values.map(([label, value]) => `<div class="stat-cell"><strong>${this.escape(value)}</strong><span>${label}</span></div>`).join('');
    }

    renderGames(games) {
        document.getElementById('profile-games-count').textContent = String(games.length);
        if (!games.length) {
            document.getElementById('profile-games').innerHTML = `<p class="empty-state">${window.caissaI18n.t('profile.noGames')}</p>`;
            return;
        }
        document.getElementById('profile-games').innerHTML = games.slice(0, 12).map((game) => `<a class="profile-game-row" href="/games/${encodeURIComponent(game.game_id || '')}" data-route="/games/${encodeURIComponent(game.game_id || '')}"><strong>${this.escape(window.caissaI18n.t('profile.game', {id: game.game_id || ''}))}</strong><span>${this.escape(this.translateResult(game.result))} · ${this.escape(this.translateMode(game.mode))}</span><small>${this.escape(this.translateResult(game.status))}</small></a>`).join('');
    }

    async showRoom(roomCode) {
        if (this.ui.currentRoomCode === roomCode || this.ui.game.gameId === roomCode) {
            this.showArena();
            return;
        }
        try {
            const localSession = sessionStorage.getItem(`chess:${roomCode}:local`);
            if (localSession) {
                const local = JSON.parse(localSession);
                const response = await fetch(`/api/v1/games/${encodeURIComponent(roomCode)}`);
                const state = await response.json();
                if (!response.ok) throw new Error(state.error || 'Partida local não encontrada.');
                this.ui.currentRoomCode = roomCode;
                this.ui.game.gameId = roomCode;
                this.ui.game.gameMode = 'local';
                this.ui.game.isLocalGame = true;
                this.ui.game.isSpectator = false;
                this.ui.game.playerToken = local.whiteToken;
                this.ui.game.blackPlayerToken = local.blackToken;
                this.ui.game.whitePlayer = local.whitePlayer;
                this.ui.game.blackPlayer = local.blackPlayer;
                this.ui.game.applyGameState(state);
                this.ui.isLocalMode = true;
                this.ui.setSpectatorMode(false);
                this.showArena();
                return;
            }
            const response = await fetch(`/api/v1/rooms/${encodeURIComponent(roomCode)}`);
            if (!response.ok) throw new Error('Sala não encontrada.');
            const room = await response.json();
            this.ui.currentRoomCode = room.room_code || roomCode;
            const gameId = room.game_id || room.game_state?.game_id;
            const playerToken = sessionStorage.getItem(`chess:${gameId}:token`);

            if (playerToken) {
                await this.ui.game.reconnectPlayer(gameId, roomCode, playerToken, room.game_state);
                this.ui.isLocalMode = false;
                this.ui.setSpectatorMode(false);
            } else {
                const spectateResponse = await fetch(`/api/v1/rooms/${encodeURIComponent(roomCode)}/spectate`, {method: 'POST'});
                if (!spectateResponse.ok) {
                    if (spectateResponse.status === 403) throw new Error('Esta sala exige um token de jogador ou convite válido.');
                    throw new Error('Não foi possível abrir esta sala como espectador.');
                }
                const data = await spectateResponse.json();
                await this.ui.game.openSpectator(data.room_code, data.room.game_id, data.spectator_token, data.room.game_state);
                this.ui.isLocalMode = false;
                this.ui.setSpectatorMode(true);
            }
            this.showArena();
            this.ui.updateGameStatus();
        } catch (error) {
            this.ui.notify(error.message || 'Não foi possível abrir esta sala.', 'error');
            this.go('/lobby', true);
        }
    }

    showArena() {
        this.hideSurfaces();
        document.getElementById('game-container').classList.remove('hidden');
        this.ui.updateGameStatus();
    }

    async showReplay(gameId) {
        this.hideSurfaces();
        document.getElementById('game-replay-page').classList.remove('hidden');
        document.getElementById('replay-content').classList.add('hidden');
        document.getElementById('replay-unavailable').classList.add('hidden');
        document.getElementById('replay-message').textContent = window.caissaI18n.t('replay.loading');
        const requestId = ++this.replayRequest;
        try {
            const response = await fetch(`/api/v1/games/${encodeURIComponent(gameId)}/replay`);
            const data = await response.json();
            if (requestId !== this.replayRequest) return;
            if (response.status === 409) {
                this.showReplayUnavailable(window.caissaI18n.t('replay.active'));
                return;
            }
            if (response.status === 404) {
                this.showReplayUnavailable(window.caissaI18n.t('replay.notFound'));
                return;
            }
            if (!response.ok) throw new Error(data.error || window.caissaI18n.t('replay.failed'));
            this.renderReplay(data);
        } catch (error) {
            if (requestId !== this.replayRequest) return;
            this.showReplayUnavailable(error.message || window.caissaI18n.t('replay.failed'));
        }
    }

    showReplayUnavailable(message) {
        document.getElementById('replay-message').textContent = '';
        document.getElementById('replay-unavailable-copy').textContent = message;
        document.getElementById('replay-unavailable').classList.remove('hidden');
    }

    renderReplay(data) {
        this.replayData = data;
        document.getElementById('replay-message').textContent = data.move_history.length ? '' : window.caissaI18n.t('replay.empty');
        document.getElementById('replay-content').classList.remove('hidden');
        document.getElementById('replay-white-name').textContent = data.white_player || window.caissaI18n.t('replay.white');
        document.getElementById('replay-black-name').textContent = data.black_player || window.caissaI18n.t('replay.black');
        document.getElementById('replay-move-count').textContent = String(data.move_history.length);
        document.getElementById('replay-result').textContent = this.replayResult(data);
        const moves = document.getElementById('replay-move-list');
        moves.innerHTML = data.move_history.map((move, index) => {
            const number = Math.floor(index / 2) + 1;
            const side = index % 2 === 0 ? 'white' : 'black';
            const moveLabel = `${number}${side === 'black' ? '…' : '.'} ${move.san || `${move.from}–${move.to}`}`;
            return `<li><button class="replay-move" type="button" data-replay-ply="${index + 1}" aria-label="${this.escape(moveLabel)}">${this.escape(moveLabel)}</button></li>`;
        }).join('');
        if (!this.replayBoard) {
            this.replayBoard = new ChessBoard('replay-board');
            this.replayBoard.initialize();
        }
        this.replayBoard.container.querySelectorAll('.square').forEach((square) => {
            square.disabled = true;
            square.tabIndex = -1;
        });
        this.renderReplayAt(0);
    }

    renderReplayAt(ply) {
        if (!this.replayData) return;
        const last = this.replayData.positions.length - 1;
        this.replayPly = Math.max(0, Math.min(ply, last));
        this.replayBoard.updateBoard(this.replayData.positions[this.replayPly]);
        document.getElementById('replay-position').textContent = window.caissaI18n.t('replay.position', {current: this.replayPly, total: last});
        document.querySelectorAll('[data-replay-ply]').forEach((button) => button.classList.toggle('is-active', Number(button.dataset.replayPly) === this.replayPly));
        document.getElementById('replay-first').disabled = this.replayPly === 0;
        document.getElementById('replay-previous').disabled = this.replayPly === 0;
        document.getElementById('replay-next').disabled = this.replayPly === last;
        document.getElementById('replay-last').disabled = this.replayPly === last;
    }

    bindReplaySurface() {
        document.getElementById('replay-first').addEventListener('click', () => this.renderReplayAt(0));
        document.getElementById('replay-previous').addEventListener('click', () => this.renderReplayAt(this.replayPly - 1));
        document.getElementById('replay-next').addEventListener('click', () => this.renderReplayAt(this.replayPly + 1));
        document.getElementById('replay-last').addEventListener('click', () => this.renderReplayAt(this.replayData?.positions.length - 1));
        document.getElementById('replay-move-list').addEventListener('click', (event) => {
            const button = event.target.closest('[data-replay-ply]');
            if (button) this.renderReplayAt(Number(button.dataset.replayPly));
        });
        window.addEventListener('caissa:localechange', () => {
            if (!this.replayData) return;
            const ply = this.replayPly || 0;
            this.renderReplay(this.replayData);
            this.renderReplayAt(ply);
        });
    }

    replayResult(data) {
        if (data.winner === 'white') return window.caissaI18n.t('replay.result.whiteWon');
        if (data.winner === 'black') return window.caissaI18n.t('replay.result.blackWon');
        return this.translateResult(data.status);
    }

    translateResult(value) {
        const key = `replay.result.${value}`;
        return window.caissaI18n.t(key) === key ? (value || '—') : window.caissaI18n.t(key);
    }

    translateMode(value) {
        const modes = {bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical', local: window.caissaI18n.current === 'en-US' ? 'Local' : 'Local', online: window.caissaI18n.current === 'en-US' ? 'Online' : 'Online', imported: window.caissaI18n.current === 'en-US' ? 'Imported' : 'Importada'};
        return modes[value] || value || '—';
    }

    bindAuthForms() {
        document.getElementById('btn-page-open-register').addEventListener('click', () => { this.go('/login'); this.setAuthMode('register'); });
        document.getElementById('btn-page-open-recovery').addEventListener('click', () => { this.go('/login'); this.setAuthMode('recovery'); });
        document.getElementById('btn-page-open-login').addEventListener('click', () => this.setAuthMode('login'));
        document.getElementById('btn-page-recovery-login').addEventListener('click', () => this.setAuthMode('login'));
        document.getElementById('btn-page-back-home').addEventListener('click', () => this.go('/home'));
        document.getElementById('btn-page-finish-recovery').addEventListener('click', () => this.go('/home'));
        document.getElementById('page-login-form').addEventListener('submit', (event) => { event.preventDefault(); this.submitLogin(); });
        document.getElementById('page-register-form').addEventListener('submit', (event) => { event.preventDefault(); this.submitRegister(); });
        document.getElementById('page-recovery-form').addEventListener('submit', (event) => { event.preventDefault(); this.submitRecovery(); });
        document.getElementById('btn-page-copy-recovery').addEventListener('click', () => this.copyRecoveryCodes(this.pageRecoveryCodes));
        document.getElementById('btn-page-download-recovery').addEventListener('click', () => this.downloadCodes(this.pageRecoveryCodes));
    }

    async submitLogin() {
        const username = document.getElementById('page-login-username').value.trim();
        const password = document.getElementById('page-login-password').value;
        if (!username || !password) return this.setError('page-login-username', 'Preencha username e senha.');
        const button = document.getElementById('btn-page-login-submit');
        this.ui.setBusy(button, true, 'Entrando…');
        try {
            const response = await fetch('/api/v1/auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username, password})});
            if (!response.ok) throw new Error('Não foi possível entrar. Verifique seus dados.');
            this.ui.currentUser = (await response.json()).user;
            this.ui.renderAccount();
            this.ui.notify('Sessão iniciada.', 'success');
            this.go('/lobby');
        } catch (error) { this.setError('page-login-password', error.message || 'Servidor indisponível.'); }
        finally { this.ui.setBusy(button, false); }
    }

    async submitRegister() {
        const username = document.getElementById('page-register-username').value.trim();
        const password = document.getElementById('page-register-password').value;
        if (!/^[A-Za-z0-9_-]{3,24}$/.test(username)) return this.setError('page-register-username', 'Use 3–24 caracteres: letras, números, _ ou -.');
        if (password.length < 12) return this.setError('page-register-password', 'A senha precisa ter pelo menos 12 caracteres.');
        const button = document.getElementById('btn-page-register-submit');
        this.ui.setBusy(button, true, 'Criando…');
        try {
            const response = await fetch('/api/v1/auth/register', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username, password})});
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Não foi possível criar a conta.');
            this.ui.currentUser = data.user;
            this.ui.renderAccount();
            this.pageRecoveryCodes = data.recovery_codes || [];
            this.showPageRecoveryCodes();
        } catch (error) { this.setError('page-register-username', error.message || 'Servidor indisponível.'); }
        finally { this.ui.setBusy(button, false); }
    }

    async submitRecovery() {
        const username = document.getElementById('page-recovery-username').value.trim();
        const recoveryCode = document.getElementById('page-recovery-code').value.trim();
        const newPassword = document.getElementById('page-recovery-password').value;
        if (!username || !recoveryCode) return this.setError('page-recovery-code', 'Informe username e código.');
        if (newPassword.length < 12) return this.setError('page-recovery-password', 'A senha precisa ter pelo menos 12 caracteres.');
        const button = document.getElementById('btn-page-recovery-submit');
        this.ui.setBusy(button, true, 'Redefinindo…');
        try {
            const response = await fetch('/api/v1/auth/recovery', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username, recovery_code: recoveryCode, new_password: newPassword})});
            if (!response.ok) throw new Error('Não foi possível recuperar a conta.');
            this.ui.notify('Senha alterada. Entre novamente.', 'success');
            this.setAuthMode('login');
        } catch (error) { this.setError('page-recovery-code', error.message || 'Servidor indisponível.'); }
        finally { this.ui.setBusy(button, false); }
    }

    showPageRecoveryCodes() {
        document.getElementById('page-recovery-codes-output').textContent = `Username: ${this.ui.currentUser.username}\n\n${this.pageRecoveryCodes.join('\n')}`;
        this.setAuthMode('codes');
    }

    copyRecoveryCodes(codes = []) {
        const content = codes.join('\n');
        if (!content) return;
        navigator.clipboard?.writeText(content).then(() => this.ui.notify('Códigos copiados.', 'success')).catch(() => this.ui.notify('Não foi possível copiar os códigos.', 'error'));
    }

    downloadCodes(codes = []) {
        if (!codes.length) return;
        const content = `Caissa recovery codes\nUsername: ${this.ui.currentUser?.username || ''}\n\n${codes.join('\n')}\n`;
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([content], {type: 'text/plain'}));
        link.download = 'caissa-recovery-codes.txt';
        link.click();
        URL.revokeObjectURL(link.href);
    }

    bindProfileSurface() {
        document.getElementById('btn-profile-back').addEventListener('click', () => this.go('/lobby'));
        document.getElementById('btn-profile-edit-page').addEventListener('click', () => this.ui.showProfileDialog());
        document.getElementById('btn-profile-change-password').addEventListener('click', () => {
            document.getElementById('profile-password-form').classList.remove('hidden');
            document.getElementById('profile-rotate-form').classList.add('hidden');
            document.getElementById('profile-current-password').focus();
        });
        document.getElementById('btn-profile-rotate-codes').addEventListener('click', () => {
            document.getElementById('profile-rotate-form').classList.remove('hidden');
            document.getElementById('profile-password-form').classList.add('hidden');
            document.getElementById('profile-rotate-password').focus();
        });
        document.getElementById('profile-password-form').addEventListener('submit', (event) => { event.preventDefault(); this.changePassword(); });
        document.getElementById('profile-rotate-form').addEventListener('submit', (event) => { event.preventDefault(); this.rotateRecoveryCodes(); });
        document.querySelectorAll('[data-profile-tab]').forEach((tab) => tab.addEventListener('click', () => {
            document.querySelectorAll('[data-profile-tab]').forEach((item) => item.classList.toggle('is-active', item === tab));
            if (tab.dataset.profileTab === 'security') document.getElementById('profile-security-panel').classList.remove('hidden');
            else document.getElementById('profile-security-panel').classList.add('hidden');
            document.getElementById(tab.dataset.profileTab === 'history' ? 'profile-games' : tab.dataset.profileTab === 'stats' ? 'profile-stats' : 'profile-page').scrollIntoView({behavior: 'smooth', block: 'start'});
        }));
    }

    setError(fieldId, message) {
        const field = document.getElementById(fieldId);
        const error = document.getElementById(`${fieldId}-error`);
        if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
        if (error) error.textContent = window.caissaI18n.normalize(message);
    }

    async changePassword() {
        const button = document.getElementById('btn-profile-password-submit');
        this.ui.setBusy(button, true, 'Salvando…');
        try {
            const response = await fetch('/api/v1/auth/password', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({current_password: document.getElementById('profile-current-password').value, new_password: document.getElementById('profile-new-password').value})});
            if (!response.ok) throw new Error('Não foi possível alterar a senha.');
            this.ui.currentUser = null;
            this.ui.renderAccount();
            this.ui.notify('Senha alterada. Entre novamente.', 'success');
            this.go('/login');
        } catch (error) { this.ui.notify(error.message, 'error'); }
        finally { this.ui.setBusy(button, false); }
    }

    async rotateRecoveryCodes() {
        const button = document.getElementById('btn-profile-rotate-submit');
        const currentPassword = document.getElementById('profile-rotate-password').value;
        const recoveryCode = document.getElementById('profile-rotate-code').value;
        if (!currentPassword && !recoveryCode) { this.ui.notify('Informe a senha atual ou um código de recuperação.', 'error'); return; }
        this.ui.setBusy(button, true, 'Gerando…');
        try {
            const response = await fetch('/api/v1/auth/recovery-codes', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({current_password: currentPassword || null, recovery_code: recoveryCode || null})});
            const data = await response.json();
            if (!response.ok) throw new Error('Não foi possível gerar novos códigos.');
            this.ui.recoveryCodes = data.recovery_codes || [];
            this.ui.showRecoveryCodes();
        } catch (error) { this.ui.notify(error.message, 'error'); }
        finally { this.ui.setBusy(button, false); }
    }

    escape(value) {
        const element = document.createElement('span');
        element.textContent = value == null ? '' : value;
        return element.innerHTML;
    }
}

const initializeRouter = () => {
    if (window.uiHandler && !window.caissaRouter) {
        window.caissaRouter = new CaissaRouter(window.uiHandler);
        window.caissaRouter.initialize();
    }
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeRouter, {once: true});
else initializeRouter();
