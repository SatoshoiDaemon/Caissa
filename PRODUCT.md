# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Caissa serves real players who want a casual, fun browser chess experience, as well as portfolio reviewers and developers evaluating the system's real-time architecture.

## Product Purpose

Caissa is a usable local-oriented multiplayer chess product and portfolio demonstration. It makes it possible for real players to play casual games in the browser while demonstrating server-authoritative state, persistence, real-time synchronization, concurrency handling, accounts, rooms, spectators, reconnection, and competitive clocks.

Success means that the product is enjoyable and understandable to casual players, while a technical reviewer can inspect and experience credible real-time behavior with multiple users and persistent state.

## Positioning

Caissa is intentionally not positioned as a chess.com competitor. Its meaningful position is a compact, approachable chess product that turns real casual play into a demonstration of production-relevant real-time systems engineering.

## Operating Context

The product is evaluated and used in a browser, primarily as a local or self-hosted-style application backed by MongoDB and Redis. Players can create accounts, discover or create rooms, play local or online games, reconnect to active games, and spectate games. Portfolio reviewers may inspect the repository, run the services locally, and open multiple browser clients to observe synchronization and concurrency.

## Capabilities and Constraints

- Browser-based local chess and real-time multiplayer rooms.
- Server-authoritative chess state, moves, clocks, authorization, and terminal results.
- Persistent MongoDB state and Redis coordination for locks, presence, rate limiting, and pub/sub.
- Accounts use username and password without email; recovery uses one-time backup codes.
- Public rooms, code-only rooms, authenticated players, anonymous read-only spectators, and reconnection are supported.
- The frontend supports Brazilian Portuguese (`pt-BR`) and American English (`en-US`) user-facing copy, defaults to Portuguese, and remembers the selected language in the browser.
- Keyboard support and responsive mobile layout are required product constraints.
- The product is intended to remain casual and fun while retaining a credible path toward scaling into a real system.
- It is not required to provide chess.com-scale competition, rankings, matchmaking, AI, or a production-scale deployment.
- Existing technical terminology includes Caissa, rooms, players, spectators, Socket.IO, MongoDB, Redis, FEN, and server-authoritative state.

## Brand Commitments

The product name is Caissa. Existing chess identity, including the king symbols and chess terminology in the browser interface, is part of the current product identity. No additional visual or tonal direction was established during init.

## Evidence on Hand

- Runnable browser surface: `src/frontend/templates/index.html`, `src/frontend/static/css/style.css`, and `src/frontend/static/js/`.
- Backend and realtime implementation: `src/backend/`.
- Automated tests: `tests/`.
- Local infrastructure definition: `compose.yaml` for MongoDB and Redis.
- The repository contains real account, room, spectator, realtime, persistence, clock, and chess-rule flows. No external customer, usage, testimonial, or production-scale evidence is available and future work must not fabricate any.

## Product Principles

1. Real play should remain simple and enjoyable for casual users.
2. The server is the authority for state, time, permissions, and outcomes.
3. Technical behavior should be inspectable through real multi-client workflows.
4. Persistence and recovery should make a game survive normal application restarts.
5. Accessibility and responsive use are core product requirements, not polish added later.

## Accessibility & Inclusion

The interface must support keyboard operation and adapt to mobile layouts. Future interface work should preserve visible focus, usable dialog keyboard behavior, readable responsive states, and non-color-only communication of game status.
