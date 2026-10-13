from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
INDEX_HTML = PROJECT_ROOT / "src" / "frontend" / "templates" / "index.html"
FRONTEND_JS = PROJECT_ROOT / "src" / "frontend" / "static" / "js"


def test_frontend_entry_points_are_refreshable(client):
    for path in "/", "/home", "/lobby", "/login", "/u/demo", "/room/ABC12345", "/games/demo-game":
        response = client.get(path)
        assert response.status_code == 200
        assert b"<title>Caissa" in response.data


def test_unknown_paths_and_static_assets_keep_their_own_behavior(client):
    assert client.get("/does-not-exist").status_code == 404
    assert client.get("/css/style.css").status_code == 200
    assert client.get("/api/v1/rooms").status_code == 200


def test_game_state_exposes_server_clock_contract(client):
    response = client.post(
        "/api/v1/games",
        json={"mode": "local", "player_name": "White", "black_player": "Black"},
    )
    assert response.status_code == 201
    state = response.get_json()["game_state"]
    assert "white_time_remaining_ms" in state
    assert "black_time_remaining_ms" in state
    assert "active_clock_color" in state
    assert "clock_version" in state


def test_frontend_uses_official_room_contracts():
    html = INDEX_HTML.read_text()
    chess_game = (FRONTEND_JS / "chess_game.js").read_text()
    ui_handler = (FRONTEND_JS / "ui_handler.js").read_text()
    assert "initial_time_seconds" not in html
    assert "increment_seconds" not in chess_game
    assert "white_time_remaining_ms" in ui_handler
    assert "/reconnect" in chess_game


def test_frontend_contains_distinct_landing_lobby_and_replay_surfaces():
    html = INDEX_HTML.read_text()
    router = (FRONTEND_JS / "app_router.js").read_text()
    assert 'id="landing-page"' in html
    assert 'id="menu-principal"' in html
    assert 'id="game-replay-page"' in html
    assert "normalized === '/lobby'" in router
    assert "showReplay(decodeURIComponent(gameMatch[1]))" in router
