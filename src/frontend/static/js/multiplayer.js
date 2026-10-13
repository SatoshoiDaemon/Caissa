class MultiplayerHandler {
    constructor(gameClient) {
        this.gameClient = gameClient;
        this.socket = null;
        this.roomCode = null;
        this.isConnected = false;
        this.isSpectator = false;
        this.spectatorToken = null;
        this.hasConnected = false;
        this.manualDisconnect = false;
        this.lastEndedVersion = null;
    }

    connect() {
        this.socket = io();

        this.socket.on('connect', () => {
            this.isConnected = true;
            const reconnect = this.hasConnected;
            this.hasConnected = true;
            this.setConnectionStatus(window.caissaI18n.t(reconnect ? 'game.connection.reconnected' : 'game.connection.connected'), reconnect ? 'reconnected' : 'connected');
            if (reconnect) this.gameClient.notify('Conexão restaurada. Estado sincronizado.', 'success');
            if (this.roomCode && this.gameClient.gameId) {
                if (this.isSpectator && this.spectatorToken) this.spectateRoom(this.roomCode, this.gameClient.gameId, this.spectatorToken);
                else if (this.gameClient.playerToken) this.joinRoom(this.roomCode, this.gameClient.gameId, this.gameClient.playerToken);
            }
        });

        this.socket.on('disconnect', () => {
            this.isConnected = false;
            if (!this.manualDisconnect) {
                this.setConnectionStatus(window.caissaI18n.t('game.connection.lost'), 'lost');
                this.gameClient.notify('Conexão perdida. Tentando reconectar…', 'error');
            }
            this.manualDisconnect = false;
        });

        this.socket.on('connect_error', (error) => {
            const expired = /auth|unauthori|forbidden|session/i.test(error?.message || '');
            this.setConnectionStatus(window.caissaI18n.t(expired ? 'game.connection.expired' : 'game.connection.offline'), expired ? 'expired' : 'lost');
            this.gameClient.notify(expired ? 'Sua sessão expirou. Entre novamente.' : 'Não foi possível conectar ao servidor.', 'error');
        });

        this.socket.on('player_joined', (data) => {
            this.gameClient.notify(window.caissaI18n.t('game.playerJoined', {name: data.player_name, color: data.player_color === 'white' ? (window.caissaI18n.current === 'en-US' ? 'White' : 'brancas') : (window.caissaI18n.current === 'en-US' ? 'Black' : 'pretas')}), 'success');
        });

        this.socket.on('move_made', (data) => {
            this.gameClient.applyGameState(data.game_state);
        });

        this.socket.on('draw_offered', () => {
            if (this.isSpectator) return;
            this.gameClient.requestConfirmation(window.caissaI18n.t('game.drawOfferTitle'), window.caissaI18n.t('game.drawOfferMessage'), window.caissaI18n.t('game.drawOfferAccept'))
                .then((accepted) => { if (accepted) this.acceptDraw(); else this.declineDraw(); });
        });

        this.socket.on('draw_accepted', () => {
            this.gameClient.notify('Oponente aceitou o empate.', 'success');
            this.gameClient.finish('draw', null);
        });

        this.socket.on('game_ended', (data) => {
            const state = data.game_state;
            if (!state) return;
            const version = state.version ?? null;
            if (version !== null && this.lastEndedVersion === version) return;
            this.lastEndedVersion = version;
            this.gameClient.applyGameState(state);
            const winner = state.status === 'draw' || state.status === 'stalemate' ? 'draw' : state.winner;
            this.gameClient.finish(winner, this.translateReason(data.reason || state.status || 'Partida encerrada'));
        });

        this.socket.on('server_error', (data) => {
            console.error('Server error:', data.message);
            this.gameClient.notify(data.error || data.message || 'O servidor rejeitou a ação.', 'error');
        });

        this.socket.on('draw_declined', () => this.gameClient.notify('A oferta de empate foi recusada.', 'info'));
        this.socket.on('player_disconnected', (data) => {
            const color = data.player_color === 'white' ? (window.caissaI18n.current === 'en-US' ? 'White' : 'brancas') : (window.caissaI18n.current === 'en-US' ? 'Black' : 'pretas');
            this.gameClient.notify(window.caissaI18n.t('game.playerDisconnected', {color, seconds: data.reconnect_grace_seconds}), 'info');
            if (data.player_color !== this.gameClient.playerColor) this.gameClient.setOpponentStatus(window.caissaI18n.t('game.opponentDisconnected', {seconds: data.reconnect_grace_seconds}));
        });
        this.socket.on('player_reconnected', (data) => {
            const color = data.player_color === 'white' ? (window.caissaI18n.current === 'en-US' ? 'White' : 'brancas') : (window.caissaI18n.current === 'en-US' ? 'Black' : 'pretas');
            this.gameClient.notify(window.caissaI18n.t('game.playerReconnected', {color}), 'success');
            if (data.player_color !== this.gameClient.playerColor) this.gameClient.setOpponentStatus(window.caissaI18n.t('game.opponentReconnected'));
        });

        this.socket.on('room_state', (data) => {
            if (!data.game_state) return;
            this.gameClient.applyGameState(data.game_state);
        });

        this.socket.on('clock_updated', (data) => {
            if (data.game_state) {
                this.gameClient.applyGameState(data.game_state);
            }
        });
    }

    setConnectionStatus(label, state) {
        window.uiHandler?.setConnectionStatus(label, state);
    }

    translateReason(reason) {
        const names = {checkmate: 'replay.result.checkmate', stalemate: 'replay.result.stalemate', draw: 'replay.result.draw', resignation: 'replay.result.resignation', timeout: 'replay.result.timeout', abandonment: 'replay.result.abandonment', 'Partida encerrada': 'game.ended'};
        return names[reason] ? window.caissaI18n.t(names[reason]) : window.caissaI18n.normalize(reason);
    }

    joinRoom(roomCode, gameId, playerToken) {
        this.roomCode = roomCode;
        this.isSpectator = false;
        
        this.socket.emit('join_room', {
            room_code: roomCode,
            game_id: gameId,
            player_token: playerToken
        });
    }

    spectateRoom(roomCode, gameId, spectatorToken) {
        this.roomCode = roomCode;
        this.isSpectator = true;
        this.spectatorToken = spectatorToken;
        this.socket.emit('spectate_room', { room_code: roomCode, game_id: gameId, spectator_token: spectatorToken });
    }

    makeMove(fromPos, toPos, promotion = null) {
        if (this.isSpectator) return;
        if (!this.isConnected) {
            console.error('Not connected to server');
            return;
        }

        this.socket.emit('make_move', {
            room_code: this.roomCode,
            game_id: this.gameClient.gameId,
            player_token: this.gameClient.playerToken,
            event_id: crypto.randomUUID(),
            move: {
                from: fromPos,
                to: toPos,
                ...(promotion ? { promotion } : {})
            }
        });
    }

    offerDraw() {
        if (!this.isConnected || this.isSpectator) return;

        this.socket.emit('offer_draw', {
            room_code: this.roomCode,
            game_id: this.gameClient.gameId,
            player_token: this.gameClient.playerToken,
            event_id: crypto.randomUUID()
        });
    }

    acceptDraw() {
        if (!this.isConnected || this.isSpectator) return;

        this.socket.emit('accept_draw', {
            room_code: this.roomCode,
            game_id: this.gameClient.gameId,
            player_token: this.gameClient.playerToken,
            event_id: crypto.randomUUID()
        });
    }

    resign() {
        if (!this.isConnected || this.isSpectator) return;

        this.socket.emit('resign_game', {
            room_code: this.roomCode,
            game_id: this.gameClient.gameId,
            player_token: this.gameClient.playerToken,
            event_id: crypto.randomUUID()
        });
    }

    declineDraw() {
        if (!this.isConnected || this.isSpectator) return;
        this.socket.emit('decline_draw', {
            room_code: this.roomCode,
            game_id: this.gameClient.gameId,
            player_token: this.gameClient.playerToken,
            event_id: crypto.randomUUID()
        });
    }

    disconnect() {
        if (this.socket) {
            this.manualDisconnect = true;
            this.socket.disconnect();
        }
    }

    retry() {
        if (this.socket) {
            this.manualDisconnect = true;
            this.socket.disconnect();
        }
        this.connect();
    }
}

// Global instance to be used with the game
let multiplayerHandler = null;

document.addEventListener('DOMContentLoaded', () => {
    // Multiplayer handler will be initialized when needed
});
