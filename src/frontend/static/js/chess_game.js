class ChessGameClient {
    constructor(apiBaseUrl = '/api/v1') {
        this.apiBaseUrl = apiBaseUrl;
        this.gameId = null;
        this.gameMode = null;
        this.currentPlayer = null;
        this.board = new ChessBoard('chessboard');
        this.gameState = null;
        this.moveHistory = [];
        this.selectedPiece = null;
        this.whitePlayer = 'White';
        this.blackPlayer = 'Black';
        this.playerColor = null;
        this.isLocalGame = true;
        this.playerToken = null;
        this.blackPlayerToken = null;
        this.multiplayer = null;
        this.promotionPending = false;
        this.isSpectator = false;

        this.board.initialize();
        this.setupBoardClickHandler();
    }

    setupBoardClickHandler() {
        this.board.setOnSquareClick((pos) => {
            this.handleSquareClick(pos);
        });

    }

    handleSquareClick(pos) {
        if (this.promotionPending) return;
        if (this.selectedPiece === null) {
            // Select a piece
            if (this.isPieceOfCurrentPlayer(pos)) {
                this.selectedPiece = pos;
                this.board.selectSquare(pos);
                this.showPossibleMoves(pos);
            }
        } else {
            // Try to move the piece
            if (pos === this.selectedPiece) {
                // Deselect
                this.selectedPiece = null;
                this.board.deselectSquare();
                this.board.clearHighlights();
            } else {
                // Make move
                this.makeMove(this.selectedPiece, pos);
            }
        }
    }

    isPieceOfCurrentPlayer(pos) {
        const rowCol = this.board.posToRowCol(pos);
        const piece = this.gameState.board[rowCol.row][rowCol.col];
        
        if (!piece) return false;

        if (this.isLocalGame) {
            return piece.color === this.gameState.current_player;
        } else {
            return piece.color === this.playerColor;
        }
    }

    showPossibleMoves(pos) {
        this.getPossibleMoves(pos).then(moves => {
            this.board.highlightSquares(moves);
        });
    }

    async createLocalGame(whiteName, blackName) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/games`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mode: 'local',
                    player_name: whiteName,
                    white_player: whiteName,
                    black_player: blackName
                })
            });

            if (!response.ok) throw new Error('Failed to create game');

            const data = await response.json();
            this.gameId = data.game_id;
            this.gameMode = 'local';
            this.isLocalGame = true;
            this.whitePlayer = whiteName;
            this.blackPlayer = blackName;
            this.gameState = data.game_state;
            this.playerToken = data.player_token;
            this.blackPlayerToken = data.black_player_token;
            this.currentPlayer = this.gameState.current_player;

            sessionStorage.setItem(`chess:${this.gameId}:local`, JSON.stringify({
                gameId: this.gameId,
                whitePlayer: whiteName,
                blackPlayer: blackName,
                whiteToken: this.playerToken,
                blackToken: this.blackPlayerToken,
            }));

            this.board.updateBoard(this.gameState.board);
            return data;
        } catch (error) {
            console.error('Error creating game:', error);
            throw error;
        }
    }

    async createOnlineGame(playerName) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/games`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mode: 'online',
                    player_name: playerName
                })
            });

            if (!response.ok) throw new Error('Failed to create game');

            const data = await response.json();
            this.gameId = data.game_id;
            this.gameMode = 'online';
            this.isLocalGame = false;
            this.playerColor = 'white';
            this.whitePlayer = playerName;
            this.gameState = data.game_state;
            this.playerToken = data.player_token;
            sessionStorage.setItem(`chess:${this.gameId}:token`, this.playerToken);
            this.multiplayer = new MultiplayerHandler(this);
            this.multiplayer.connect();
            this.multiplayer.joinRoom(data.room_code, this.gameId, this.playerToken);

            this.board.updateBoard(this.gameState.board);
            return data;
        } catch (error) {
            console.error('Error creating online game:', error);
            throw error;
        }
    }

    async joinOnlineGame(roomCode, playerName) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/rooms/${roomCode}/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    player_name: playerName
                })
            });

            if (!response.ok) throw new Error('Failed to join game');

            const data = await response.json();
            this.gameId = data.game_id;
            this.gameMode = 'online';
            this.isLocalGame = false;
            this.playerColor = data.player_color;
            this.whitePlayer = data.game_state?.white_player || data.white_player || 'Brancas';
            this.blackPlayer = data.game_state?.black_player || data.black_player || 'Aguardando';
            this.gameState = data.game_state;
            this.playerToken = data.player_token;
            sessionStorage.setItem(`chess:${this.gameId}:token`, this.playerToken);
            this.multiplayer = new MultiplayerHandler(this);
            this.multiplayer.connect();
            this.multiplayer.joinRoom(roomCode, this.gameId, this.playerToken);

            this.board.updateBoard(this.gameState.board);
            return data;
        } catch (error) {
            console.error('Error joining game:', error);
            throw error;
        }
    }

    isPromotionMove(fromPos, toPos) {
        const from = this.board.posToRowCol(fromPos);
        const to = this.board.posToRowCol(toPos);
        const piece = this.gameState.board[from.row][from.col];
        return piece && piece.type === 'p' && (to.row === 0 || to.row === 7);
    }

    async createOnlineRoom(options) {
        const response = await fetch(`${this.apiBaseUrl}/rooms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: options.name,
                access_mode: options.accessMode,
                mode: options.mode,
            }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to create room');
        this.gameId = data.game_id;
        this.gameMode = data.room.mode;
        this.isLocalGame = false;
        this.isSpectator = false;
        this.playerColor = 'white';
        this.gameState = data.game_state;
        this.whitePlayer = data.game_state.white_player;
        this.blackPlayer = data.game_state.black_player || 'Aguardando';
        this.playerToken = data.player_token;
        sessionStorage.setItem(`chess:${this.gameId}:token`, this.playerToken);
        this.multiplayer = new MultiplayerHandler(this);
        this.multiplayer.connect();
        this.multiplayer.joinRoom(data.room_code, this.gameId, this.playerToken);
        this.board.updateBoard(this.gameState.board);
        return data;
    }

    async openSpectator(roomCode, gameId, spectatorToken, initialState) {
        this.gameId = gameId;
        this.gameMode = initialState.mode || 'online';
        this.isLocalGame = false;
        this.isSpectator = true;
        this.playerColor = null;
        this.playerToken = null;
        this.gameState = initialState;
        this.whitePlayer = initialState.white_player || 'Brancas';
        this.blackPlayer = initialState.black_player || 'Aguardando';
        this.multiplayer = new MultiplayerHandler(this);
        this.multiplayer.connect();
        this.multiplayer.spectateRoom(roomCode, this.gameId, spectatorToken);
        this.board.updateBoard(this.gameState.board);
    }

    applyGameState(state) {
        if (!state) return;
        this.gameState = state;
        this.currentPlayer = state.current_player;
        this.moveHistory = state.move_history || [];
        this.whitePlayer = state.white_player || this.whitePlayer;
        this.blackPlayer = state.black_player || this.blackPlayer;
        this.board.updateBoard(state.board);
        this.selectedPiece = null;
        this.promotionPending = false;
        this.board.deselectSquare();
        this.board.clearHighlights();
        window.uiHandler?.updateGameStatus();
    }

    async reconnectPlayer(gameId, roomCode, token, initialState) {
        const response = await fetch(`${this.apiBaseUrl}/games/${encodeURIComponent(gameId)}/reconnect`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Não foi possível reconectar à partida.');
        this.gameId = gameId;
        this.gameMode = data.mode || initialState?.mode || 'online';
        this.isLocalGame = false;
        this.isSpectator = false;
        this.playerToken = token;
        this.playerColor = data.player_color;
        this.applyGameState(data);
        this.multiplayer = new MultiplayerHandler(this);
        this.multiplayer.connect();
        this.multiplayer.joinRoom(roomCode, gameId, token);
        return data;
    }

    choosePromotion(color) {
        this.promotionPending = true;
        const dialog = document.getElementById('promotion-dialog');
        if (window.uiHandler) window.uiHandler.openDialog('promotion-dialog');
        else dialog.classList.remove('hidden');
        const buttons = [...dialog.querySelectorAll('.promotion-option')];
        buttons.forEach((button) => {
            button.style.color = color === 'white' ? '#f0d9b5' : '#3d2817';
            button.onclick = () => {
                this.promotionPending = false;
                if (window.uiHandler) window.uiHandler.closeDialog('promotion-dialog');
                else dialog.classList.add('hidden');
                document.removeEventListener('keydown', this._promotionKeyHandler);
                this._promotionResolver(button.dataset.promotion);
                this._promotionResolver = null;
            };
        });
        return new Promise((resolve) => {
            this._promotionResolver = resolve;
            this._promotionKeyHandler = (event) => {
                if (event.key === 'Escape') {
                    this.promotionPending = false;
                    if (window.uiHandler) window.uiHandler.closeDialog('promotion-dialog');
                    else dialog.classList.add('hidden');
                    document.removeEventListener('keydown', this._promotionKeyHandler);
                    this._promotionResolver(null);
                    this._promotionResolver = null;
                }
            };
            document.addEventListener('keydown', this._promotionKeyHandler);
            buttons[0].focus();
        });
    }

    async makeMove(fromPos, toPos) {
        let promotion = null;
        if (this.isPromotionMove(fromPos, toPos)) {
            const from = this.board.posToRowCol(fromPos);
            promotion = await this.choosePromotion(this.gameState.board[from.row][from.col].color);
        }
        if (!this.isLocalGame && this.multiplayer && this.multiplayer.isConnected) {
            this.multiplayer.makeMove(fromPos, toPos, promotion);
            return true;
        }
        try {
            const token = this.isLocalGame && this.gameState.current_player === 'black'
                ? this.blackPlayerToken : this.playerToken;
            const response = await fetch(`${this.apiBaseUrl}/games/${this.gameId}/moves`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                    from: fromPos,
                    to: toPos,
                    event_id: crypto.randomUUID(),
                    ...(promotion ? { promotion } : {})
                })
            });

            if (!response.ok) {
                const error = await response.json();
                console.error('Invalid move:', error);
                return false;
            }

            const data = await response.json();
            this.applyGameState(data);
            this.board.deselectSquare();
            this.board.clearHighlights();
            this.selectedPiece = null;

            return true;
        } catch (error) {
            console.error('Error making move:', error);
            return false;
        }
    }

    async getPossibleMoves(pos) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/games/${this.gameId}/moves/${pos}`);
            if (!response.ok) return [];

            const data = await response.json();
            return data.possible_moves || [];
        } catch (error) {
            console.error('Error getting possible moves:', error);
            return [];
        }
    }

    async getGameState() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/games/${this.gameId}`);
            if (!response.ok) throw new Error('Failed to get game state');

            const data = await response.json();
            this.gameState = data;
            this.currentPlayer = data.current_player;
            this.moveHistory = data.move_history;

            this.board.updateBoard(data.board);
            return data;
        } catch (error) {
            console.error('Error getting game state:', error);
            throw error;
        }
    }

    getMoveHistory() {
        return this.moveHistory.map(move => {
            const notation = `${move.from}${move.to}`;
            if (move.captured) {
                return `${notation}x`;
            }
            return notation;
        }).join(' ');
    }

    getGameStatus() {
        if (this.gameState.is_checkmate) {
            const winner = this.gameState.current_player === 'white' ? 'black' : 'white';
            const label = winner === 'white'
                ? (window.caissaI18n.current === 'en-US' ? 'White' : 'Brancas')
                : (window.caissaI18n.current === 'en-US' ? 'Black' : 'Pretas');
            return window.caissaI18n.t('game.checkmateStatus', {winner: label});
        } else if (this.gameState.is_stalemate) {
            return window.caissaI18n.t('game.stalemateStatus');
        } else if (this.gameState.in_check) {
            const player = this.gameState.current_player === 'white'
                ? (window.caissaI18n.current === 'en-US' ? 'White' : 'Brancas')
                : (window.caissaI18n.current === 'en-US' ? 'Black' : 'Pretas');
            return window.caissaI18n.t('game.checkStatus', {player});
        } else {
            const currentPlayerName = this.gameState.current_player === 'white'
                ? this.whitePlayer
                : this.blackPlayer;
            return window.caissaI18n.t('game.turnStatus', {player: currentPlayerName});
        }
    }

    getHalfmoveClock() {
        return this.gameState.halfmove_clock;
    }

    isGameOver() {
        return Boolean(this.gameState && (this.gameState.is_checkmate || this.gameState.is_stalemate || ['draw', 'resignation', 'timeout', 'abandonment'].includes(this.gameState.status)));
    }

    finish(result, reason = null) {
        if (!this.gameState) return;
        if (window.uiHandler) window.uiHandler.showGameEndDialog(result, reason);
    }

    async resignLocal() {
        if (!this.isLocalGame || !this.gameState || this.isGameOver()) return;
        const token = this.gameState.current_player === 'black' ? this.blackPlayerToken : this.playerToken;
        const response = await fetch(`${this.apiBaseUrl}/games/${encodeURIComponent(this.gameId)}/resign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ event_id: crypto.randomUUID() }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Não foi possível registrar a desistência.');
        this.applyGameState(data);
        this.finish(data.winner, 'Desistência');
    }

    getWinner() {
        if (this.gameState.is_checkmate) {
            return this.gameState.current_player === 'white' ? 'black' : 'white';
        } else if (this.gameState.is_stalemate) {
            return 'draw';
        }
        return null;
    }

    canMove() {
        if (this.isSpectator) return false;
        if (this.isLocalGame) {
            return true;
        }
        return this.playerColor === this.gameState.current_player;
    }

    getBoardAnalysis() {
        const analysis = {
            whitePieces: 0,
            blackPieces: 0,
            whiteValue: 0,
            blackValue: 0
        };

        const pieceValues = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = this.gameState.board[row][col];
                if (piece) {
                    const value = pieceValues[piece.type] || 0;
                    if (piece.color === 'white') {
                        analysis.whitePieces++;
                        analysis.whiteValue += value;
                    } else {
                        analysis.blackPieces++;
                        analysis.blackValue += value;
                    }
                }
            }
        }

        return analysis;
    }

    reset() {
        const previousGameId = this.gameId;
        if (this.multiplayer) this.multiplayer.disconnect();
        this.gameId = null;
        this.gameMode = null;
        this.gameState = null;
        this.moveHistory = [];
        this.playerToken = null;
        this.blackPlayerToken = null;
        if (previousGameId) {
            sessionStorage.removeItem(`chess:${previousGameId}:local`);
            sessionStorage.removeItem(`chess:${previousGameId}:token`);
        }
        this.promotionPending = false;
        this.isSpectator = false;
        this.multiplayer = null;
        this.selectedPiece = null;
        this.board.clearHighlights();
        this.board.deselectSquare();
    }
}
