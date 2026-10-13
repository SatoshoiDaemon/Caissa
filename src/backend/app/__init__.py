from flask import Flask, render_template

from .config import Settings
from .errors import register_error_handlers
from .extensions import cors, socketio


def create_app(
    settings: Settings | None = None,
    game_repository=None,
    room_repository=None,
    redis_client=None,
    user_repository=None,
) -> Flask:
    settings = settings or Settings.from_environment()
    app = Flask(
        __name__,
        template_folder=settings.template_folder,
        static_folder=settings.static_folder,
        static_url_path="",
    )
    app.config.update(
        SECRET_KEY=settings.secret_key,
        MAX_CONTENT_LENGTH=settings.max_content_length,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=settings.environment == "production",
        JSON_SORT_KEYS=False,
        TESTING=settings.testing,
    )

    cors.init_app(app, origins=settings.allowed_origins)
    socketio.init_app(
        app,
        cors_allowed_origins=settings.allowed_origins,
        message_queue=None if settings.testing else settings.redis_url,
        async_mode="threading",
        manage_session=False,
    )
    register_error_handlers(app)

    from ..api.routes.auth_routes import create_auth_blueprint
    from ..api.routes.game_routes import create_game_blueprint
    from ..api.routes.room_routes import create_room_blueprint
    from ..api.routes.user_routes import create_user_blueprint
    from ..infrastructure.mongo_client import get_mongo_database
    from ..infrastructure.redis_client import get_redis_client
    from ..infrastructure.repositories.memory_user_repository import MemoryUserRepository
    from ..infrastructure.repositories.mongo_game_repository import MongoGameRepository
    from ..infrastructure.repositories.mongo_room_repository import MongoRoomRepository
    from ..infrastructure.repositories.mongo_user_repository import MongoUserRepository
    from ..realtime.socket_events import register_socket_events

    mongo_database = None
    if game_repository is None or room_repository is None:
        mongo_database = get_mongo_database(settings)
    game_repository = game_repository or MongoGameRepository(mongo_database)
    room_repository = room_repository or MongoRoomRepository(mongo_database)
    user_repository = user_repository or (
        MongoUserRepository(mongo_database)
        if mongo_database is not None
        else MemoryUserRepository()
    )
    redis_client = redis_client or get_redis_client(settings)

    app.extensions["settings"] = settings
    app.extensions["game_repository"] = game_repository
    app.extensions["room_repository"] = room_repository
    app.extensions["redis_client"] = redis_client
    app.extensions["user_repository"] = user_repository

    app.register_blueprint(create_game_blueprint(), url_prefix="/api/v1/games")
    app.register_blueprint(create_room_blueprint(), url_prefix="/api/v1/rooms")
    app.register_blueprint(create_auth_blueprint(), url_prefix="/api/v1/auth")
    app.register_blueprint(create_user_blueprint(), url_prefix="/api/v1/users")
    register_socket_events(socketio, app)

    def frontend_entry(**_kwargs):
        return render_template("index.html")

    # Explicit application entry points keep deep-links refreshable without
    # catching API, static, or otherwise unknown paths.
    app.add_url_rule("/", "frontend_root", frontend_entry)
    app.add_url_rule("/home", "frontend_home", frontend_entry)
    app.add_url_rule("/lobby", "frontend_lobby", frontend_entry)
    app.add_url_rule("/login", "frontend_login", frontend_entry)
    app.add_url_rule("/u/<username>", "frontend_profile", frontend_entry)
    app.add_url_rule("/room/<room_code>", "frontend_room", frontend_entry)
    app.add_url_rule("/games/<game_id>", "frontend_game_review", frontend_entry)

    return app
