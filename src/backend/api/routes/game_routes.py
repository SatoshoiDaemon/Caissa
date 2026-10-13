from flask import Blueprint, current_app, jsonify, request

from ...app.errors import ApiError
from ...infrastructure.rate_limiter import RedisRateLimiter
from ...services.account_service import AccountService
from ...services.game_service import GameService
from ...services.player_service import PlayerService
from ..schemas import event_id as validate_event_id
from ..schemas import game_id as validate_game_id
from ..schemas import json_body, move_payload, player_name
from ..schemas import position as validate_position


def _service():
    return GameService(
        current_app.extensions["game_repository"],
        current_app.extensions["room_repository"],
        current_app.extensions["redis_client"],
        current_app.extensions["user_repository"],
    )


def _rate_limit(key, limit):
    if not RedisRateLimiter(current_app.extensions["redis_client"]).allow(key, limit, 60):
        raise ApiError("rate limit exceeded", 429)


def create_game_blueprint():
    blueprint = Blueprint("game_routes", __name__)

    @blueprint.post("")
    def create_game():
        _rate_limit(f"create:{request.remote_addr}", 10)
        data = json_body(request)
        name = player_name(data.get("player_name"))
        mode = data.get("mode", "online")
        if mode not in {"online", "local"}:
            raise ApiError("invalid game mode", 400)
        black_name = (
            player_name(data.get("black_player"), "black_player") if mode == "local" else None
        )
        account = AccountService(
            current_app.extensions["user_repository"], current_app.extensions["redis_client"]
        )
        user = account.optional_current_user()
        result, white_token, black_token, room_code = _service().create_game(
            name, mode, black_name, user
        )
        response = {
            "game_id": result["game_id"],
            "room_code": room_code,
            "player_color": "white",
            "player_token": white_token,
            "game_state": result,
        }
        if mode == "local":
            response["black_player_token"] = black_token
        return jsonify(response), 201

    @blueprint.get("/<game_id>")
    def get_game(game_id):
        return jsonify(_service().get_state(validate_game_id(game_id)))

    @blueprint.get("/<game_id>/replay")
    def get_replay(game_id):
        return jsonify(_service().get_replay(validate_game_id(game_id)))

    @blueprint.get("/<game_id>/pgn")
    def get_pgn(game_id):
        return current_app.response_class(
            _service().get_pgn(validate_game_id(game_id)), mimetype="application/x-chess-pgn"
        )

    @blueprint.post("/import")
    def import_game():
        data = json_body(request)
        pgn = data.get("pgn")
        if not isinstance(pgn, str):
            raise ApiError("pgn is required", 400)
        state = _service().import_pgn(pgn)
        return jsonify(state), 201

    @blueprint.post("/<game_id>/reconnect")
    def reconnect_game(game_id):
        game_id = validate_game_id(game_id)
        token = PlayerService.bearer_token(request)
        player = _service().authenticate(game_id, token)
        _service().set_presence(game_id, token, True, f"rest:{request.remote_addr}")
        state = _service().get_state(game_id)
        return jsonify({**state, "player_color": player["color"]})

    @blueprint.post("/<game_id>/moves")
    def make_move(game_id):
        _rate_limit(f"move:{request.remote_addr}", 60)
        game_id = validate_game_id(game_id)
        data = json_body(request)
        move_data = dict(data)
        move_data.pop("event_id", None)
        from_pos, to_pos, promotion = move_payload(move_data)
        token = PlayerService.bearer_token(request)
        return jsonify(
            _service().make_move(
                game_id, token, from_pos, to_pos, promotion, validate_event_id(data.get("event_id"))
            )
        )

    @blueprint.get("/<game_id>/moves/<position>")
    def get_possible_moves(game_id, position):
        return jsonify(
            {
                "possible_moves": _service().possible_moves(
                    validate_game_id(game_id), validate_position(position)
                )
            }
        )

    @blueprint.post("/<game_id>/resign")
    def resign_game(game_id):
        token = PlayerService.bearer_token(request)
        data = request.get_json(silent=True) or {}
        return jsonify(
            _service().finish(
                validate_game_id(game_id),
                token,
                "resignation",
                event_id=validate_event_id(data.get("event_id")),
            )
        )

    def draw_action(game_id, action):
        data = json_body(request)
        token = PlayerService.bearer_token(request)
        game_id = validate_game_id(game_id)
        event = validate_event_id(data.get("event_id"))
        if action == "offer":
            result = _service().offer_draw(game_id, token, event)
        elif action == "decline":
            result = _service().decline_draw(game_id, token, event)
        else:
            result = _service().finish(game_id, token, "draw", event_id=event)
        return jsonify(result)

    blueprint.add_url_rule(
        "/<game_id>/draw/offer",
        "offer_draw",
        lambda game_id: draw_action(game_id, "offer"),
        methods=["POST"],
    )
    blueprint.add_url_rule(
        "/<game_id>/draw/accept",
        "accept_draw",
        lambda game_id: draw_action(game_id, "accept"),
        methods=["POST"],
    )
    blueprint.add_url_rule(
        "/<game_id>/draw/decline",
        "decline_draw",
        lambda game_id: draw_action(game_id, "decline"),
        methods=["POST"],
    )

    return blueprint
