import uuid
from datetime import datetime, timedelta, timezone

from ..app.errors import ApiError
from ..chess_logic.chess_game import ChessGame, Color
from ..chess_logic.pgn import export_pgn, import_pgn
from ..infrastructure.rate_limiter import GameLock
from .player_service import PlayerService

FINAL_STATUSES = {
    "checkmate",
    "stalemate",
    "draw",
    "resignation",
    "timeout",
    "abandonment",
    "imported",
}
RECONNECT_GRACE_SECONDS = 60
CLOCK_PRESETS = {
    "bullet": {"time_ms": 60_000, "increment_ms": 0},
    "blitz": {"time_ms": 300_000, "increment_ms": 0},
    "rapid": {"time_ms": 600_000, "increment_ms": 0},
    "classical": {"time_ms": 1_800_000, "increment_ms": 0},
}


class GameService:
    def __init__(self, game_repository, room_repository, redis_client, user_repository=None):
        self.games = game_repository
        self.rooms = room_repository
        self.redis = redis_client
        self.users = user_repository

    @staticmethod
    def _clock_document(mode):
        preset = CLOCK_PRESETS.get(mode, CLOCK_PRESETS["blitz"])
        return {
            "white_time_remaining_ms": preset["time_ms"],
            "black_time_remaining_ms": preset["time_ms"],
            "active_clock_color": None,
            "clock_started_at": None,
            "clock_increment_ms": preset["increment_ms"],
            "clock_version": 0,
        }

    def create_game(self, player_name, mode="online", black_name=None, user=None):
        game_id = str(uuid.uuid4())
        room_code = None
        white_token, white_hash = PlayerService.issue_token()
        black_token = black_hash = None
        if black_name:
            black_token, black_hash = PlayerService.issue_token()
        chess_game = ChessGame()
        now = datetime.now(timezone.utc)
        clock = self._clock_document(mode)
        document = {
            "_id": game_id,
            "mode": mode,
            "status": "active",
            "winner": None,
            "version": 0,
            "current_player": "white",
            "fen": chess_game.to_fen(),
            "initial_fen": chess_game.to_fen(),
            "castling_rights": chess_game._castling_rights_string(),
            "en_passant_target": chess_game.en_passant_target,
            "halfmove_clock": chess_game.halfmove_clock,
            "fullmove_number": chess_game.fullmove_number,
            "move_history": [],
            "position_history": [chess_game.position_key()],
            "draw_reason": None,
            "white": {
                "name": player_name,
                "user_id": user["_id"] if user else None,
                "profile_snapshot": self._profile_snapshot(user),
                "token_hash": white_hash,
                "connected": False,
                "last_seen_at": None,
                "socket_id": None,
                "disconnected_at": None,
                "reconnect_deadline_at": None,
            },
            "black": (
                {
                    "name": black_name,
                    "token_hash": black_hash,
                    "connected": False,
                    "last_seen_at": None,
                    "socket_id": None,
                    "disconnected_at": None,
                    "reconnect_deadline_at": None,
                }
                if black_name
                else None
            ),
            **clock,
            "clock": clock,
            "draw_offer": {"offered_by": None, "offered_at": None, "version": 0},
            "processed_event_ids": {},
            "last_activity_at": now,
            "created_at": now,
            "updated_at": now,
        }
        self.games.create(document)
        if mode == "online":
            room_code = self._new_room_code()
            self.rooms.create(
                {
                    "_id": room_code,
                    "game_id": game_id,
                    "status": "waiting",
                    "white": document["white"],
                    "black": None,
                    "last_activity_at": now,
                    "created_at": now,
                    "updated_at": now,
                }
            )
        return self._response(document, chess_game), white_token, black_token, room_code

    def create_room(
        self,
        user,
        name,
        access_mode="public",
        mode="blitz",
        initial_time_seconds=300,
        increment_seconds=0,
    ):
        if not user:
            raise ApiError("authentication required", 401)
        if access_mode not in {"public", "code_only"}:
            raise ApiError("invalid room access mode", 400)
        if mode not in {"bullet", "blitz", "rapid", "classical"}:
            raise ApiError("invalid game mode", 400)
        if not isinstance(initial_time_seconds, int) or not 1 <= initial_time_seconds <= 86_400:
            raise ApiError("initial_time_seconds must be between 1 and 86400", 400)
        if not isinstance(increment_seconds, int) or not 0 <= increment_seconds <= 60:
            raise ApiError("increment_seconds must be between 0 and 60", 400)
        result, white_token, _, room_code = self.create_game(user["username"], "online", user=user)
        now = datetime.now(timezone.utc)
        preset = CLOCK_PRESETS[mode]
        clock = {
            "white_time_remaining_ms": preset["time_ms"],
            "black_time_remaining_ms": preset["time_ms"],
            "active_clock_color": None,
            "clock_started_at": None,
            "clock_increment_ms": preset["increment_ms"],
            "clock_version": 0,
        }
        self.games.update_state(
            result["game_id"],
            0,
            {**clock, "clock": clock, "mode": mode, "last_activity_at": now},
        )
        self.rooms.update_metadata(
            room_code,
            {
                "name": name,
                "creator_user_id": user["_id"],
                "creator_snapshot": self._profile_snapshot(user),
                "access_mode": access_mode,
                "mode": mode,
                **clock,
                "clock": clock,
                "expires_at": now + timedelta(minutes=30),
            },
        )
        return (
            self._response(
                self._get_game(result["game_id"]),
                self._load_game(self._get_game(result["game_id"])),
            ),
            white_token,
            room_code,
        )

    def join_room(self, room_code, player_name=None, token=None, user=None):
        with GameLock(self.redis, f"room:{room_code}"):
            room = self.rooms.get(room_code)
            if not room:
                raise ApiError("room not found", 404)
            game = self._get_game(room["game_id"])
            if token:
                player = self._authenticate(game, token)
                if player["color"] not in {"white", "black"}:
                    raise ApiError("invalid player token", 401)
                return (
                    self._response(game, self._load_game(game)),
                    token,
                    room_code,
                    player["color"],
                )
            if not player_name:
                raise ApiError("player_name is required", 400)
            token, token_hash = PlayerService.issue_token()
            player = {
                "name": player_name,
                "user_id": user["_id"] if user else None,
                "profile_snapshot": self._profile_snapshot(user),
                "token_hash": token_hash,
                "connected": False,
                "last_seen_at": None,
                "socket_id": None,
            }
            if not self.rooms.assign_black_player(room_code, player):
                raise ApiError("room is full", 409)
            if not self.games.assign_black_player(room["game_id"], player):
                self.rooms.release_black_player(room_code)
                raise ApiError("room is already occupied", 409)
            self.rooms.mark_active(room_code)
            if hasattr(self.games, "start_clock"):
                self.games.start_clock(room["game_id"], datetime.now(timezone.utc))
            if hasattr(self.rooms, "touch"):
                self.rooms.touch(room_code, datetime.now(timezone.utc), "active")
            game = self._get_game(room["game_id"])
            if hasattr(self.rooms, "update_metadata"):
                self.rooms.update_metadata(room_code, {"clock": game.get("clock", {})})
            return self._response(game, self._load_game(game)), token, room_code, "black"

    def get_state(self, game_id):
        document = self.games.get(game_id)
        if not document:
            raise ApiError("game not found", 404)
        for color in ("white", "black"):
            player = document.get(color) or {}
            deadline = player.get("reconnect_deadline_at")
            if deadline and not player.get("connected"):
                if isinstance(deadline, str):
                    deadline = datetime.fromisoformat(deadline)
                if deadline.tzinfo is None:
                    deadline = deadline.replace(tzinfo=timezone.utc)
                if deadline <= datetime.now(timezone.utc) and document.get("status") == "active":
                    self.abandon_if_expired(game_id, color)
                    document = self.games.get(game_id)
                    break
        document = self._clock_snapshot(document)
        if document.get("status") == "active" and document.get("active_clock_color"):
            clock = self._clock_from_document(document)
            active = clock["active_clock_color"]
            if clock.get(f"{active}_time_remaining_ms") == 0:
                self.timeout_if_expired(game_id)
                document = self.games.get(game_id)
        return self._response(document, self._load_game(document))

    def get_pgn(self, game_id):
        return export_pgn(self._get_game(game_id))

    def get_replay(self, game_id):
        state = self.get_state(game_id)
        if state["status"] not in FINAL_STATUSES:
            raise ApiError("game is still in progress", 409)

        document = self._get_game(game_id)
        replay = ChessGame()
        initial_fen = document.get("initial_fen")
        if initial_fen:
            replay.load_from_fen(initial_fen)

        positions = [replay.get_board_state()]
        for move in document.get("move_history", []):
            if not replay.move(move["from"], move["to"], move.get("promotion")):
                raise ApiError("stored game history is invalid", 500)
            positions.append(replay.get_board_state())

        return {
            **state,
            "initial_fen": initial_fen or ChessGame().to_fen(),
            "positions": positions,
        }

    def import_pgn(self, pgn):
        try:
            game, headers, result = import_pgn(pgn)
        except Exception as error:
            if isinstance(error, ApiError):
                raise
            raise ApiError(str(error), 400) from error
        now = datetime.now(timezone.utc)
        initial_fen = headers.get("FEN", ChessGame().to_fen())
        document = {
            "_id": str(uuid.uuid4()),
            "mode": "imported",
            "status": "imported",
            "winner": None,
            "draw_reason": None,
            "version": 0,
            "current_player": game.current_player.value,
            "fen": game.to_fen(),
            "initial_fen": initial_fen,
            "castling_rights": game._castling_rights_string(),
            "en_passant_target": game.en_passant_target,
            "halfmove_clock": game.halfmove_clock,
            "fullmove_number": game.fullmove_number,
            "move_history": game.move_history,
            "position_history": self._replay_position_history(initial_fen, game.move_history),
            "white": {"name": headers.get("White", "White")},
            "black": {"name": headers.get("Black", "Black")},
            "draw_offer": {"offered_by": None, "offered_at": None, "version": 0},
            "processed_event_ids": {},
            "pgn_headers": headers,
            "pgn_result": result,
            **self._clock_document("blitz"),
            "last_activity_at": now,
            "created_at": now,
            "updated_at": now,
        }
        self.games.create(document)
        return self._response(document, game)

    def possible_moves(self, game_id, position):
        document = self._get_game(game_id)
        game = self._load_game(document)
        return game.get_possible_moves(position)

    def make_move(self, game_id, token, from_pos, to_pos, promotion=None, event_id=None):
        with GameLock(self.redis, game_id):
            document = self._get_game(game_id)
            player = self._authenticate(document, token)
            if self._event_was_processed(document, event_id):
                return self._response(document, self._load_game(document))
            if document["status"] in FINAL_STATUSES:
                raise ApiError("game has already ended", 409)
            game = self._load_game(document)
            moving_color = game.current_player.value
            if player["color"] != moving_color:
                raise ApiError("it is not this player's turn", 403)
            if self._consume_clock(document, moving_color):
                winner = "black" if moving_color == "white" else "white"
                timeout_update = self._state_document(
                    game,
                    "timeout",
                    winner,
                    document.get("clock"),
                    None,
                    self._position_history(document, game),
                )
                if not self.games.finish(
                    game_id, document["version"], timeout_update, "timeout", winner
                ):
                    raise ApiError("game state changed, retry the move", 409)
                stored = dict(document)
                stored.update(timeout_update)
                stored.update(
                    {"status": "timeout", "winner": winner, "version": document["version"] + 1}
                )
                self._record_results(stored, "timeout", winner)
                self._finish_room_for_game(game_id)
                state = self._response(stored, self._load_game(stored))
                self._publish(
                    game_id, {"game_id": game_id, "game_state": state, "reason": "timeout"}
                )
                raise ApiError("game time expired", 409)
            if not game.move(from_pos, to_pos, promotion):
                raise ApiError("invalid move", 400)
            self._switch_clock_after_move(document, moving_color, game.current_player.value)
            position_history = self._position_history(document, game)
            position_history.append(game.position_key())
            status, winner, draw_reason = self._result(game, position_history)
            new_document = self._state_document(
                game, status, winner, document.get("clock"), draw_reason, position_history
            )
            new_document["draw_offer"] = {
                "offered_by": None,
                "offered_at": None,
                "version": (document.get("draw_offer") or {}).get("version", 0) + 1,
            }
            self._mark_event(new_document, document, event_id)
            if status == "active":
                if not self.games.update_state(game_id, document["version"], new_document):
                    raise ApiError("game state changed, retry the move", 409)
            elif not self.games.finish(game_id, document["version"], new_document, status, winner):
                raise ApiError("game state changed, retry the move", 409)
            stored = dict(document)
            stored.update(new_document)
            stored.update({"status": status, "winner": winner, "version": document["version"] + 1})
            self._sync_room(game_id, stored)
            state = self._response(stored, game)
            if status != "active":
                self._record_results(stored, status, winner)
                self._finish_room_for_game(game_id)
            self._publish(game_id, {"game_id": game_id, "game_state": state})
            return state

    def offer_draw(self, game_id, token, event_id=None):
        with GameLock(self.redis, game_id):
            document = self._get_game(game_id)
            player = self._authenticate(document, token)
            if self._event_was_processed(document, event_id):
                return self._response(document, self._load_game(document))
            if document.get("status") in FINAL_STATUSES:
                return self._response(document, self._load_game(document))
            offer = document.get("draw_offer") or {}
            if offer.get("offered_by"):
                raise ApiError("draw offer already pending", 409)
            now = datetime.now(timezone.utc)
            update = {
                "draw_offer": {
                    "offered_by": player["color"],
                    "offered_at": now,
                    "version": document.get("version", 0) + 1,
                },
                "last_activity_at": now,
            }
            self._mark_event(update, document, event_id)
            if not self.games.update_state(game_id, document["version"], update):
                raise ApiError("game state changed, retry the action", 409)
            stored = dict(document)
            stored.update(update)
            stored["version"] = document["version"] + 1
            state = self._response(stored, self._load_game(stored))
            self._publish(
                game_id, {"game_id": game_id, "game_state": state, "reason": "draw_offered"}
            )
            return state

    def decline_draw(self, game_id, token, event_id=None):
        with GameLock(self.redis, game_id):
            document = self._get_game(game_id)
            player = self._authenticate(document, token)
            if self._event_was_processed(document, event_id):
                return self._response(document, self._load_game(document))
            offer = document.get("draw_offer") or {}
            if not offer.get("offered_by"):
                return self._response(document, self._load_game(document))
            if offer.get("offered_by") == player["color"]:
                raise ApiError("the opponent must decline the offer", 403)
            update = {
                "draw_offer": {
                    "offered_by": None,
                    "offered_at": None,
                    "version": offer.get("version", 0) + 1,
                },
                "last_activity_at": datetime.now(timezone.utc),
            }
            self._mark_event(update, document, event_id)
            if not self.games.update_state(game_id, document["version"], update):
                raise ApiError("game state changed, retry the action", 409)
            stored = dict(document)
            stored.update(update)
            stored["version"] = document["version"] + 1
            state = self._response(stored, self._load_game(stored))
            self._publish(
                game_id, {"game_id": game_id, "game_state": state, "reason": "draw_declined"}
            )
            return state

    def finish(self, game_id, token, status, winner=None, event_id=None):
        with GameLock(self.redis, game_id):
            document = self._get_game(game_id)
            player = self._authenticate(document, token)
            if self._event_was_processed(document, event_id):
                return self._response(document, self._load_game(document))
            if document.get("status") in FINAL_STATUSES:
                return self._response(document, self._load_game(document))
            if status not in {"draw", "resignation"}:
                raise ApiError("invalid finish status", 400)
            offer = document.get("draw_offer") or {}
            if status == "draw":
                if not offer.get("offered_by"):
                    raise ApiError("no draw offer pending", 409)
                if offer.get("offered_by") == player["color"]:
                    raise ApiError("the opponent must accept the offer", 403)
            winner = (
                ("black" if player["color"] == "white" else "white")
                if status == "resignation"
                else None
            )
            now = datetime.now(timezone.utc)
            update = {
                "last_activity_at": now,
                **self._state_document(
                    self._load_game(document),
                    status,
                    winner,
                    self._clock_from_document(document),
                    "agreement" if status == "draw" else None,
                    self._position_history(document, self._load_game(document)),
                ),
                "draw_offer": {
                    "offered_by": None,
                    "offered_at": None,
                    "version": offer.get("version", 0) + 1,
                },
            }
            self._mark_event(update, document, event_id)
            if not self.games.finish(game_id, document["version"], update, status, winner):
                raise ApiError("game has already ended", 409)
            stored = dict(document)
            stored.update(update)
            stored.update({"status": status, "winner": winner, "version": document["version"] + 1})
            self._sync_room(game_id, stored)
            state = self._response(stored, self._load_game(stored))
            self._record_results(stored, status, winner)
            self._finish_room_for_game(game_id)
            self._publish(game_id, {"game_id": game_id, "game_state": state})
            return state

    def authenticate(self, game_id, token):
        return self._authenticate(self._get_game(game_id), token)

    def set_presence(self, game_id, token, connected, socket_id=None):
        document = self._get_game(game_id)
        player = self._authenticate(document, token)
        timestamp = datetime.now(timezone.utc)
        if hasattr(self.games, "set_player_presence"):
            self.games.set_player_presence(
                game_id, player["color"], connected, timestamp, socket_id
            )
        return player

    def abandon_if_expired(self, game_id, color):
        with GameLock(self.redis, game_id):
            document = self._get_game(game_id)
            player = document.get(color) or {}
            deadline = player.get("reconnect_deadline_at")
            if document.get("status") in FINAL_STATUSES or player.get("connected") or not deadline:
                return self._response(document, self._load_game(document))
            if isinstance(deadline, str):
                deadline = datetime.fromisoformat(deadline)
            if deadline.tzinfo is None:
                deadline = deadline.replace(tzinfo=timezone.utc)
            if deadline > datetime.now(timezone.utc):
                return self._response(document, self._load_game(document))
            winner = "black" if color == "white" else "white"
            update = self._state_document(
                self._load_game(document), "abandonment", winner, document
            )
            update["draw_offer"] = {"offered_by": None, "offered_at": None, "version": 0}
            if not self.games.finish(game_id, document["version"], update, "abandonment", winner):
                return self._response(
                    self._get_game(game_id), self._load_game(self._get_game(game_id))
                )
            stored = dict(document)
            stored.update(update)
            stored.update(
                {"status": "abandonment", "winner": winner, "version": document["version"] + 1}
            )
            self._record_results(stored, "abandonment", winner)
            self._finish_room_for_game(game_id)
            state = self._response(stored, self._load_game(stored))
            self._publish(
                game_id, {"game_id": game_id, "game_state": state, "reason": "abandonment"}
            )
            return state

    def timeout_if_expired(self, game_id):
        with GameLock(self.redis, game_id):
            document = self._get_game(game_id)
            if document.get("status") in FINAL_STATUSES:
                return self._response(document, self._load_game(document))
            clock = self._clock_from_document(document)
            color = clock.get("active_clock_color")
            if not color or clock.get(f"{color}_time_remaining_ms") != 0:
                return self._response(document, self._load_game(document))
            winner = "black" if color == "white" else "white"
            update = self._state_document(self._load_game(document), "timeout", winner, clock)
            if not self.games.finish(game_id, document["version"], update, "timeout", winner):
                current = self._get_game(game_id)
                return self._response(current, self._load_game(current))
            stored = dict(document)
            stored.update(update)
            stored.update(
                {"status": "timeout", "winner": winner, "version": document["version"] + 1}
            )
            self._record_results(stored, "timeout", winner)
            self._finish_room_for_game(game_id)
            state = self._response(stored, self._load_game(stored))
            self._publish(game_id, {"game_id": game_id, "game_state": state, "reason": "timeout"})
            return state

    def clear_presence(self, game_id, color, socket_id):
        if hasattr(self.games, "clear_player_presence"):
            self.games.clear_player_presence(game_id, color, socket_id)

    def _get_game(self, game_id):
        document = self.games.get(game_id)
        if not document:
            raise ApiError("game not found", 404)
        return document

    def _authenticate(self, document, token):
        for color in ("white", "black"):
            player = document.get(color)
            if not player:
                continue
            try:
                PlayerService.verify_token(token, player.get("token_hash"))
                return dict(player, color=color)
            except ApiError:
                continue
        raise ApiError("invalid player token", 401)

    @staticmethod
    def _load_game(document):
        game = ChessGame()
        if document.get("fen"):
            game.load_from_fen(document["fen"])
        game.move_history = document.get("move_history", [])
        return game

    @staticmethod
    def _position_history(document, game):
        history = document.get("position_history")
        if history:
            return [tuple(item) for item in history]
        replay = ChessGame()
        if document.get("initial_fen"):
            replay.load_from_fen(document["initial_fen"])
        positions = [replay.position_key()]
        for move in document.get("move_history", []):
            if not replay.move(move["from"], move["to"], move.get("promotion")):
                return [game.position_key()]
            positions.append(replay.position_key())
        return positions

    @staticmethod
    def _replay_position_history(initial_fen, move_history):
        replay = ChessGame()
        if initial_fen:
            replay.load_from_fen(initial_fen)
        positions = [replay.position_key()]
        for move in move_history:
            replay.move(move["from"], move["to"], move.get("promotion"))
            positions.append(replay.position_key())
        return positions

    @staticmethod
    def _state_document(
        game, status="active", winner=None, clock=None, draw_reason=None, position_history=None
    ):
        now = datetime.now(timezone.utc)
        stored_clock = GameService._normalize_clock(clock or {})
        if status != "active":
            stored_clock["active_clock_color"] = None
            stored_clock["clock_started_at"] = None
        return {
            "status": status,
            "winner": winner,
            "draw_reason": draw_reason,
            "current_player": game.current_player.value,
            "fen": game.to_fen(),
            "castling_rights": game._castling_rights_string(),
            "en_passant_target": game.en_passant_target,
            "halfmove_clock": game.halfmove_clock,
            "fullmove_number": game.fullmove_number,
            "move_history": game.move_history,
            "position_history": position_history or [game.position_key()],
            **stored_clock,
            "clock": stored_clock,
            "last_activity_at": now,
        }

    @staticmethod
    def _response(document, game):
        state = game.get_game_status()
        clock = GameService._normalize_clock(document)
        if isinstance(clock.get("clock_started_at"), datetime):
            clock["clock_started_at"] = clock["clock_started_at"].isoformat()
        last_activity_at = document.get("last_activity_at")
        if isinstance(last_activity_at, datetime):
            last_activity_at = last_activity_at.isoformat()
        state.update(
            {
                "game_id": document["_id"],
                "mode": document.get("mode", "online"),
                "status": document.get("status", "active"),
                "winner": document.get("winner"),
                "draw_reason": document.get("draw_reason"),
                "pgn_result": document.get("pgn_result"),
                "last_move_san": (
                    (document.get("move_history") or [])[-1].get("san")
                    if document.get("move_history")
                    else None
                ),
                "version": document.get("version", 0),
                "draw_offer": document.get(
                    "draw_offer", {"offered_by": None, "offered_at": None, "version": 0}
                ),
                "white_connected": document.get("white", {}).get("connected", False),
                "black_connected": (document.get("black") or {}).get("connected", False),
                "white_reconnect_deadline_at": document.get("white", {}).get(
                    "reconnect_deadline_at"
                ),
                "black_reconnect_deadline_at": (document.get("black") or {}).get(
                    "reconnect_deadline_at"
                ),
                "white_time_remaining_ms": clock["white_time_remaining_ms"],
                "black_time_remaining_ms": clock["black_time_remaining_ms"],
                "active_clock_color": clock["active_clock_color"],
                "clock_started_at": clock["clock_started_at"],
                "clock_increment_ms": clock["clock_increment_ms"],
                "clock_version": clock["clock_version"],
                "white_player": document.get("white", {}).get("name"),
                "black_player": (document.get("black") or {}).get("name"),
                "white_profile": document.get("white", {}).get("profile_snapshot"),
                "black_profile": (document.get("black") or {}).get("profile_snapshot"),
                "clock": clock,
                "last_activity_at": last_activity_at,
            }
        )
        return state

    @staticmethod
    def _normalize_clock(source):
        nested = source.get("clock", source) if isinstance(source, dict) else {}
        if "white_time_remaining_ms" in source:
            return {
                "white_time_remaining_ms": source.get("white_time_remaining_ms"),
                "black_time_remaining_ms": source.get("black_time_remaining_ms"),
                "active_clock_color": source.get("active_clock_color"),
                "clock_started_at": source.get("clock_started_at"),
                "clock_increment_ms": source.get("clock_increment_ms", 0),
                "clock_version": source.get("clock_version", 0),
            }
        return {
            "white_time_remaining_ms": nested.get("white_time_ms"),
            "black_time_remaining_ms": nested.get("black_time_ms"),
            "active_clock_color": nested.get("active_color"),
            "clock_started_at": nested.get("started_at"),
            "clock_increment_ms": nested.get("increment_ms", 0),
            "clock_version": nested.get("clock_version", 0),
        }

    @staticmethod
    def _result(game, position_history=None):
        if game.is_checkmate(game.current_player):
            return "checkmate", "white" if game.current_player == Color.BLACK else "black", None
        if game.is_stalemate(game.current_player):
            return "draw", None, "stalemate"
        if game.is_insufficient_material():
            return "draw", None, "insufficient_material"
        if game.is_fifty_move_draw():
            return "draw", None, "fifty_move_rule"
        if position_history and game.is_threefold_repetition(position_history):
            return "draw", None, "threefold_repetition"
        return "active", None, None

    def _new_room_code(self):
        while True:
            code = uuid.uuid4().hex[:8].upper()
            if not self.rooms.get(code):
                return code

    @staticmethod
    def _profile_snapshot(user):
        if not user:
            return None
        emoji = user.get("status_emoji") or ""
        message = user.get("status_message") or ""
        return {
            "user_id": user["_id"],
            "username": user["username"],
            "bio": user.get("bio", ""),
            "profile_image_url": user.get("profile_image_url"),
            "status": f"{emoji} {message}".strip(),
        }

    def _record_results(self, document, status, winner):
        if not self.users:
            return
        completed_at = datetime.now(timezone.utc)
        for color in ("white", "black"):
            player = document.get(color) or {}
            user_id = player.get("user_id")
            if not user_id:
                continue
            result = "draw"
            if winner:
                result = "win" if winner == color else "loss"
            opponent = document.get("black" if color == "white" else "white") or {}
            self.users.record_result(
                {
                    "_id": str(uuid.uuid4()),
                    "game_id": document["_id"],
                    "user_id": user_id,
                    "opponent_user_id": opponent.get("user_id"),
                    "color": color,
                    "result": result,
                    "status": status,
                    "mode": document.get("mode", "online"),
                    "completed_at": completed_at,
                }
            )

    def _publish(self, game_id, payload):
        if hasattr(self.redis, "publish"):
            import json

            self.redis.publish(f"game_events:{game_id}", json.dumps(payload, default=str))

    @staticmethod
    def _event_was_processed(document, event_id):
        return bool(event_id and event_id in document.get("processed_event_ids", []))

    @staticmethod
    def _mark_event(update, document, event_id):
        if not event_id:
            return
        event_ids = list(document.get("processed_event_ids", []))
        if event_id not in event_ids:
            event_ids.append(event_id)
        update["processed_event_ids"] = event_ids[-100:]

    @staticmethod
    def _consume_clock(document, active_color):
        clock = GameService._clock_from_document(document)
        started_at = clock.get("clock_started_at")
        if not started_at or clock.get("active_clock_color") != active_color:
            return False
        if isinstance(started_at, str):
            started_at = datetime.fromisoformat(started_at)
        if started_at.tzinfo is None:
            started_at = started_at.replace(tzinfo=timezone.utc)
        remaining = clock.get(f"{active_color}_time_remaining_ms")
        if not isinstance(remaining, int):
            return False
        elapsed = max(0, int((datetime.now(timezone.utc) - started_at).total_seconds() * 1000))
        clock[f"{active_color}_time_remaining_ms"] = max(0, remaining - elapsed)
        clock["clock_started_at"] = datetime.now(timezone.utc)
        GameService._store_clock(document, clock)
        return clock[f"{active_color}_time_remaining_ms"] == 0

    @staticmethod
    def _switch_clock_after_move(document, moving_color, next_color):
        clock = GameService._clock_from_document(document)
        if not clock.get("clock_started_at") or not isinstance(
            clock.get(f"{moving_color}_time_remaining_ms"), int
        ):
            return
        clock[f"{moving_color}_time_remaining_ms"] += clock.get("clock_increment_ms", 0)
        clock["active_clock_color"] = next_color
        clock["clock_started_at"] = datetime.now(timezone.utc)
        clock["clock_version"] += 1
        GameService._store_clock(document, clock)

    @staticmethod
    def _clock_from_document(document):
        return GameService._normalize_clock(document)

    @staticmethod
    def _clock_snapshot(document):
        if not document:
            return document
        snapshot = dict(document)
        clock = GameService._clock_from_document(document)
        started_at = clock.get("clock_started_at")
        active = clock.get("active_clock_color")
        if active and started_at and document.get("status") == "active":
            if started_at.tzinfo is None:
                started_at = started_at.replace(tzinfo=timezone.utc)
            elapsed = max(0, int((datetime.now(timezone.utc) - started_at).total_seconds() * 1000))
            key = f"{active}_time_remaining_ms"
            if isinstance(clock.get(key), int):
                clock[key] = max(0, clock[key] - elapsed)
        GameService._store_clock(snapshot, clock)
        return snapshot

    @staticmethod
    def _store_clock(document, clock):
        document.update(clock)
        document["clock"] = dict(clock)

    def _finish_room_for_game(self, game_id):
        if not hasattr(self.rooms, "mark_finished"):
            return
        for code in self._room_codes_for_game(game_id):
            self.rooms.mark_finished(code, datetime.now(timezone.utc) + timedelta(hours=2))

    def _sync_room(self, game_id, document):
        if not hasattr(self.rooms, "find_by_game") or not hasattr(self.rooms, "update_metadata"):
            return
        room = self.rooms.find_by_game(game_id)
        if room:
            self.rooms.update_metadata(
                room["_id"],
                {
                    "clock": document.get("clock", {}),
                    "last_activity_at": document.get(
                        "last_activity_at", datetime.now(timezone.utc)
                    ),
                    "status": "active" if document.get("status") == "active" else "finished",
                },
            )

    def _room_codes_for_game(self, game_id):
        if hasattr(self.rooms, "find_by_game"):
            room = self.rooms.find_by_game(game_id)
            return [room["_id"]] if room else []
        return []
