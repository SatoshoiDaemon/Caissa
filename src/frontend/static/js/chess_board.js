class ChessBoard {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.squares = new Map();
        this.selectedSquare = null;
        this.highlightedSquares = new Set();
        this.focusedSquare = 'a8';
        this.previousBoardState = null;
        this.pieceSymbols = {
            p: '♟',
            r: '♜',
            n: '♞',
            b: '♝',
            q: '♛',
            k: '♚'
        };
    }

    initialize() {
        this.container.innerHTML = '';
        this.squares.clear();

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const square = document.createElement('button');
                const pos = this.rowColToPos(row, col);
                
                square.type = 'button';
                square.className = 'square';
                square.classList.add((row + col) % 2 === 0 ? 'light' : 'dark');
                square.dataset.pos = pos;
                square.tabIndex = pos === this.focusedSquare ? 0 : -1;
                square.setAttribute('aria-label', this.squareLabel(pos, null));
                square.addEventListener('click', () => {
                    this.focusSquare(pos, false);
                    this.onSquareClickCallback?.(pos);
                });
                square.addEventListener('keydown', (event) => this.handleKeydown(event, pos));

                this.container.appendChild(square);
                this.squares.set(pos, square);
            }
        }
        this.container.setAttribute('role', 'grid');
        this.container.setAttribute('aria-label', window.caissaI18n.current === 'en-US' ? 'Chessboard' : 'Tabuleiro de xadrez');
        window.addEventListener('caissa:localechange', () => {
            this.container.setAttribute('aria-label', window.caissaI18n.current === 'en-US' ? 'Chessboard' : 'Tabuleiro de xadrez');
            this.squares.forEach((square) => {
                const {row, col} = this.posToRowCol(square.dataset.pos);
                this.setSquareLabel(square, this.previousBoardState?.[row]?.[col] || null);
            });
        });
    }

    rowColToPos(row, col) {
        return String.fromCharCode(97 + col) + (8 - row);
    }

    posToRowCol(pos) {
        const col = pos.charCodeAt(0) - 97;
        const row = 8 - parseInt(pos[1]);
        return { row, col };
    }

    updateBoard(boardState) {
        const previousBoard = this.previousBoardState;
        this.clearPieces();

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = boardState[row][col];
                if (piece) {
                    const pos = this.rowColToPos(row, col);
                    const oldPiece = previousBoard?.[row]?.[col] || null;
                    const changed = !oldPiece || oldPiece.type !== piece.type || oldPiece.color !== piece.color;
                    this.setPiece(pos, piece, changed && Boolean(previousBoard));
                }
            }
        }
        this.previousBoardState = boardState.map((row) => row.map((piece) => piece ? { ...piece } : null));
        const focused = this.squares.get(this.focusedSquare);
        if (focused) focused.focus({ preventScroll: true });
    }

    setPiece(pos, piece, animate = false) {
        if (!piece) return;
        
        const square = this.squares.get(pos);
        if (!square) return;

        const pieceElement = document.createElement('span');
        pieceElement.className = 'piece';
        if (animate) pieceElement.classList.add('piece-arriving');
        pieceElement.innerHTML = this.getPieceSvg(piece.type, piece.color);

        square.innerHTML = '';
        square.appendChild(pieceElement);
        this.setSquareLabel(square, piece);
    }

    getPieceSymbol(type, color) {
        const baseSymbol = this.pieceSymbols[type];
        if (!baseSymbol) return '';
        
        return baseSymbol;
    }

    getPieceSvg(type, color) {
        const fill = color === 'white' ? '#f0d9b5' : '#3d2817';
        const stroke = color === 'white' ? '#6b4f32' : '#e0a33a';
        const shapes = {
            p: '<circle cx="50" cy="24" r="12"/><path d="M34 39c3-7 29-7 32 0l-5 18H39zM29 63h42l7 12H22z"/>',
            r: '<path d="M27 20h10v12h8V20h10v12h8V20h10v21H27zM35 42h30l6 30H29zM20 72h60v10H20z"/>',
            n: '<path d="M30 78c2-14 9-20 18-27-7-8-9-17-5-27l8-13 5 11 14 5c8 3 12 10 10 18-2 9-9 15-20 17l-3 6 13 10z"/><circle cx="61" cy="28" r="3" fill="'+stroke+'" stroke="none"/>',
            b: '<path d="M50 13c9 0 14 8 10 16-2 5-6 9-10 12 7 5 11 11 13 19H37c2-8 6-14 13-19-4-3-8-7-10-12-4-8 1-16 10-16zM27 68h46l7 12H20z"/><path d="M45 19l10 14" fill="none" stroke="'+stroke+'" stroke-width="4"/>',
            q: '<path d="M21 22l13 10 16-20 16 20 13-10-6 39H27zM25 67h50l7 13H18z"/><circle cx="34" cy="18" r="5"/><circle cx="50" cy="10" r="5"/><circle cx="66" cy="18" r="5"/>',
            k: '<path d="M44 10h12v12h12v10H56v10c9 4 14 11 15 20H29c1-9 6-16 15-20V32H32V22h12zM24 70h52l7 10H17z"/>'
        };
        return `<svg class="piece-svg" viewBox="0 0 100 90" role="img" aria-label="${this.getPieceName(type)}" style="fill:${fill};stroke:${stroke};stroke-width:2;stroke-linejoin:round;filter:drop-shadow(0 3px 2px rgba(0,0,0,.3))">${shapes[type] || ''}</svg>`;
    }

    clearPieces() {
        this.squares.forEach(square => {
            square.innerHTML = '';
            square.setAttribute('aria-label', this.squareLabel(square.dataset.pos, null));
        });
    }

    getPieceName(type) {
        const names = window.caissaI18n.current === 'en-US'
            ? {p: 'pawn', r: 'rook', n: 'knight', b: 'bishop', q: 'queen', k: 'king'}
            : {p: 'peão', r: 'torre', n: 'cavalo', b: 'bispo', q: 'dama', k: 'rei'};
        return names[type] || (window.caissaI18n.current === 'en-US' ? 'piece' : 'peça');
    }

    squareLabel(pos, piece) {
        if (window.caissaI18n.current === 'en-US') {
            return piece ? `Square ${pos}, ${piece.color}: ${this.getPieceName(piece.type)}` : `Square ${pos}, empty`;
        }
        return piece ? `Casa ${pos}, ${piece.color === 'white' ? 'brancas' : 'pretas'}: ${this.getPieceName(piece.type)}` : `Casa ${pos}, vazia`;
    }

    setSquareLabel(square, piece) {
        square.setAttribute('aria-label', this.squareLabel(square.dataset.pos, piece));
    }

    handleKeydown(event, pos) {
        const { row, col } = this.posToRowCol(pos);
        const directions = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
        if (directions[event.key]) {
            event.preventDefault();
            const [rowDelta, colDelta] = directions[event.key];
            const nextRow = Math.max(0, Math.min(7, row + rowDelta));
            const nextCol = Math.max(0, Math.min(7, col + colDelta));
            const next = this.rowColToPos(nextRow, nextCol);
            this.focusSquare(next, true);
            return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            this.onSquareClickCallback?.(pos);
        }
    }

    focusSquare(pos, moveFocus = true) {
        this.focusedSquare = pos;
        this.squares.forEach((square) => { square.tabIndex = square.dataset.pos === pos ? 0 : -1; });
        if (moveFocus) this.squares.get(pos)?.focus({ preventScroll: true });
    }

    selectSquare(pos) {
        this.deselectSquare();
        const square = this.squares.get(pos);
        if (square) {
            square.classList.add('selected');
            this.selectedSquare = pos;
        }
    }

    deselectSquare() {
        if (this.selectedSquare) {
            const square = this.squares.get(this.selectedSquare);
            if (square) {
                square.classList.remove('selected');
            }
            this.selectedSquare = null;
        }
    }

    highlightSquares(positions) {
        this.clearHighlights();
        positions.forEach(pos => {
            const square = this.squares.get(pos);
            if (square) {
                square.classList.add('highlight');
                this.highlightedSquares.add(pos);
            }
        });
    }

    clearHighlights() {
        this.highlightedSquares.forEach(pos => {
            const square = this.squares.get(pos);
            if (square) {
                square.classList.remove('highlight');
            }
        });
        this.highlightedSquares.clear();
    }

    getSelectedSquare() {
        return this.selectedSquare;
    }

    onSquareClick(callback) {
        this.onSquareClickCallback = callback;
    }

    setOnSquareClick(callback) {
        this.onSquareClickCallback = callback;
    }
}
