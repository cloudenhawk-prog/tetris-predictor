# Tetris Predictor

Interactive rising-row puzzle workbench and move analyzer.

## Stack

- React + TypeScript + Vite
- TanStack Router + React Query
- Tailwind CSS v4
- Vitest

## Architecture

The codebase follows a light clean-architecture split:

- `src/domain`: Pure puzzle rules and core entities (`puzzle/engine.ts`)
- `src/application`: Use-case orchestration (`puzzle/evaluate-moves.ts`)
- `src/infrastructure`: Adapter implementations for runtime concerns and model backends
- `src/features`: UI behavior and view-specific state
- `src/routes`: App routes and shell
- `src/lib`: Cross-cutting helpers and compatibility re-exports

### Move analysis

- Contracts: `src/application/puzzle/contracts/move-analysis.ts` (`PuzzleMoveAnalyzer`, `BoardValueModel`)
- UI analysis: `searchMoves` (`src/application/puzzle/planning/move-search.ts`) running in a Web
  Worker (`src/infrastructure/puzzle/search-worker/`) on the trained value network
  (`src/infrastructure/puzzle/value-network/`, weights in `weights.json`)
- Synchronous one-step analyzer: `LookaheadMoveAnalyzer` (same network, no search)
- Baseline: `HeuristicMoveAnalyzer` + `WeightedLinearScoringModel` (hand-tuned weights)

## Machine learning

### Game model

- **Board**: 8 columns × 10 rows (`COLS`/`ROWS` in `src/domain/puzzle/engine.ts`).
- **Player move**: from one decision point to the next. The player must slide one block
  (staying put is not a move); the slide is played
  against the known incoming row, then forced refill rows keep spawning while the board is too
  empty (≤ 1 occupied row, then until 3 rows are occupied). See `resolvePlayerMove` in
  `src/domain/puzzle/engine.ts`.
- **Loss**: a block is in the top row once everything has settled, i.e. at the start of the
  next turn (or a block is pushed out of the grid).
- **Bombs are hidden**: whether an incoming block is a bomb is only revealed once its row is pushed
  into the grid. The planner strips bombs from the known incoming row (`hideBombs` in the engine),
  so neither the analysis nor training targets can rely on them; the real row, bombs included,
  still decides what actually happens.
- **Turn**: one pushed row. The UI's "Turns survived" counter is passed to the analyzer
  as the game turn. It's editable, so you can join a game in progress at the right difficulty.

### How the model works

The network learns `V(board, turn)`: the expected discounted number of future rows survived
from a decision point, before the next row is known. To pick a move, the analyzer plays every
legal move against the known incoming row (sampling refill rows when needed) and picks the
best `rewards + γ^k · V(next board)` (`src/application/puzzle/planning/move-planner.ts`).

Training is self-play TD learning (value iteration on afterstates). Nothing about strategy is
hard-coded and no hand-made "realistic" boards are needed. The agent generates its own positions
by playing random rows. Half of the episodes start mid-game at a random turn, after a few rows
pushed with random moves, so crowded, messy boards and every difficulty level are covered.
The network input is the raw grid (occupancy, bombs, block starts, block widths) plus a few
generic summaries (column heights, row fill, gaps, difficulty progress). It is a small
dependency-free MLP (`mlp.ts`) that runs in both Node and the browser.

### One overall model + search from the current board

There is one overall model, trained offline and loaded by the app automatically. For a specific
position, "Compute Optimal" first ranks every move with the network (instant) and then refines
the best ones by simulating futures from the current board. For each candidate it samples the
next incoming rows, plays `Lookahead` further moves with the network, and averages the outcomes.
**Apply & advance** on a ranked move slides the block and plays the turn in one click. You
can also slide a block yourself and press Advance Turn. The sliders under Simulation set the
search budget:

| Slider | Default | Effect |
| --- | --- | --- |
| Think time | 2 s | Longer means more simulated futures per move and less noise (0 = network only) |
| Lookahead | 3 moves | Deeper catches slower dangers but costs more per future |
| Moves searched | top 6 | How many of the network's best moves get refined |

We don't train a separate model per board in the browser: a few seconds of single-threaded
training would be far weaker than the overall model, and the search uses that time on exactly
this board instead.

### Difficulty schedule

Incoming rows come from `src/domain/puzzle/row-generator.ts`. Block-width odds interpolate
linearly from `earlyWidthWeights` (before `rampStartTurn`) to `lateWidthWeights` (capped at
`rampEndTurn`). The bomb odds (`bombRowChance`, about one bomb per 80 rows, at most one per row and
never on a block wider than `bombMaxWidth` = 3) and the 1-vs-2 empty-cell odds are also set there. The model
receives the difficulty progress as an input, so it plans for harder rows later in the game.
After changing `DEFAULT_ROW_GENERATION`, retrain.

### When to retrain

Retrain whenever the rules, the board size or the row generator change.

- **Board size or encoder changed:** the old weights can't load. `npm run train` detects this and
  starts fresh automatically. Until then the app falls back to a basic heuristic and shows a
  warning under the search progress.
- **Only rules or row odds changed:** the old weights still load, but they learned the old game.
  `npm run train -- --fresh` gives a clean model; plain `npm run train` adapts the old one.

### Commands

```bash
npm run train                       # continue improving weights.json (60 min by default)
npm run train -- --minutes 15       # shorter session
npm run train -- --fresh            # start over from random weights
npm run evaluate                    # network vs heuristic vs random on seeded games
npm run evaluate -- --policies network,search --search-depth 2 --search-rounds 4
```

`npm run train` first evaluates the current `weights.json` as a baseline. It only overwrites
the file when the new model scores better on the same seeded games, so training never makes
the app worse. The dev server reloads the new weights automatically. Each session is
self-contained: Ctrl+C keeps the best model saved so far, and the next run continues from it.

Episodes run up to 2000 turns and evaluation games up to 3000 turns (`--eval-max-turns`).
Other useful flags: `--workers`, `--decisions` (self-play decisions per iteration),
`--hidden 128,64` (with `--fresh`), `--lr`, `--epsilon-start/--epsilon-end`, `--eval-every`,
`--eval-games`, `--out`, `--seed`.

## Recording real games

The **Recording** panel records games played with the tool, so the real game's rows and bombs can
later be compared with the generator. Press **Record real game**, then play as usual; mark bombs
on the Next Row when the game reveals them (they are recorded, but the model never sees them in
advance). Each pushed row stores:

- the round number, the board before the move and after the turn, and the move (by hand or applied
  from the ranking, with its rank and the analysis' top move when one was computed)
- the Next Row as pushed, bombs included, and whether it came from **Random** (not real data)
- every clear in order (rows, blocks destroyed by width, blast victims, bombs detonated), plus
  rows destroyed for the turn (the combo) and the "Rows destroyed" counter
- optionally the game's score (`scoreAfter`), see below

A session lasts from Record to Stop and **survives page reloads**: after a reload it keeps recording
into the same session and logs a `page-loaded` event, so a game isn't split in two. Re-entering
"Turns survived" or "Rows destroyed" (both editable) is logged too, and a turn whose board differs
from the previous turn's result is flagged `boardEdited` (the board was corrected by hand).

**Score tracking** (temporary, to work out the scoring formula): tick **Track game score** in the
Recording panel and a Score counter appears next to the other counters. Keep it at the game's score
after each round, updated before pushing the row; each turn stores it as `scoreAfter` (`null` while
tracking is off, so "not tracked" never looks like 0). Edits are logged as `score-set` events.
Because points only come from destroyed rows, and destroying rows always scores, `scoreGains` in
`game-recording.ts` derives each turn's points and flags the ones not to trust: a score that didn't
change after destroyed rows was not updated (`missing`, including a score left at 0), the next change
lumps several turns (`catch-up`), and changes without destroyed rows are `inconsistent`.

Sessions are kept in browser storage and, under `npm run dev`, also written to
`recordings/<session id>.json`. **Export** downloads every session in this browser as one JSON file.
The format is documented in `src/features/puzzle/recording/game-recording.ts`. Recordings aren't
used for training yet.

## Run

```bash
npm install
npm run dev
```

pnpm works too (`pnpm install && pnpm dev`). `pnpm-workspace.yaml` allows esbuild's install
script, which pnpm 10+ blocks by default and which vite and tsx need.

## Verify

```bash
npm run typecheck
npm test
npm run build
```
