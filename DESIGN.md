# Caissa visual system

<!-- impeccable:design-schema 1 -->

## Direction

Caissa is a real-time chess concourse: a precise live board where players, clocks, rooms, and state changes are held in one readable gaze. The visual reference is a rail split-flap board translated into a warm, casual chess arena—not a literal transport interface and not a Chess.com/Lichess imitation.

## Visual language

- Deep charcoal is the operating surface; amber is the live signal and primary action.
- Matte panels and hairline rules define structure. Depth comes from one soft shadow system, not decorative glass.
- Fixed-cell grids, tabular numerals, uppercase metadata, and small state lamps make live changes legible.
- The chessboard remains the visual anchor. Side rail content supports the board instead of competing with it.
- Brazilian Portuguese is the default product language, with American English available; technical system labels remain short and secondary.

## Typography

- `Bricolage Grotesque` carries display headings, player names, and controls.
- `DM Mono` carries system metadata, room codes, clock values, move counts, and state labels.
- Display headings use a strong size step and tight tracking. Body copy stays short and readable.

## Palette

```text
deep       #111416
panel      #191d1e
panel-2    #202627
line       #303738
ink        #edf0e7
muted      #8c9693
amber      #f3b33d
amber-soft #ffd477
red        #ee6d5f
green      #83d39f
board-light #ead8b8
board-dark  #9b6849
```

## Surfaces and flows

- Landing: a concise product explanation with a direct path into play.
- Lobby: a game-first surface with three direct actions and live public rooms.
- Game review: a read-only board with move-by-move navigation and result context.
- Account dialogs: compact, focused tasks with strong labels and recovery copy.
- Arena: board, player strips, clocks, state module, actions, and move history.
- Spectator: same arena state with an explicit read-only banner and no mutation affordance.
- Result: a protected end-state dialog that keeps the result and next action visible.

## Interaction and motion

- One restrained dialog entrance communicates a protected transition.
- Hover motion is small and functional; it never displaces the board or changes meaning.
- Server events own game state and clock values. The frontend renders received values and does not simulate time.
- Reduced-motion users receive the same state without entrance or hover animation.

## Responsive behavior

- Desktop uses a board plus rail composition.
- Below 900px the rail becomes a compact two-column support area.
- Below 600px the board takes priority, cards become stacked rows, and dialogs become narrow single-column tasks.
- Keyboard focus is visible, dialogs expose labelled controls, and critical state is announced through live regions.
