# Real-game recording plan

**Goal:** record a few real games and use them to make the simulated games match the real game.
The model can't learn from recordings directly; that would take thousands of hours of play.
Instead, the recordings correct the simulation, and the model keeps training on it.

## 1. Record

Use the **Recording** panel (see README, "Recording real games").

- **Target:** 3–4 full games first (round 1 until you lose, or round 300+). That's about
  1,000–1,500 rounds, roughly 3–5 hours of play.
- Tick **Track game score** and keep the Score counter up to date before each push.
- Mark bombs on the Next Row as the game reveals them.
- Don't use **Random** for real games. Rows from it are flagged and left out.
- Reloads are fine: recording resumes in the same session. Re-enter the round, rows destroyed and
  score afterwards.

Long term: 5–10 games, 3,000–5,000 rounds. The bomb rate is the slowest number to pin down.

## 2. Analyze

Write a script that reads `recordings/*.json` and reports the following, with the current
generator settings alongside for comparison.

| Question | Current assumption | Rounds needed |
| --- | --- | --- |
| Block size odds by round (difficulty curve) | Linear ramp, round 30 → 200 | 5–10 games reaching round 250+ |
| 1 vs 2 empty cells, and where gaps fall | 50/50, uniform positions | ~500 |
| Bomb rate, bomb block size | ~1 per 80 rows, never 4-wide | 3,000–4,000 |
| Does the next row depend on the board? (unfair game) | No | ~1,000 |
| Score formula | Unknown | 200–500 rounds with score tracked |

## 3. Apply

**Row generator.** Update `DEFAULT_ROW_GENERATION` in `src/domain/puzzle/row-generator.ts`,
or a new generator shape if the real one doesn't fit it. Then retrain (`npm run train`, about
1 hour).

**Score instead of rounds.** Once the formula is known:

1. Add a function that computes the points for a turn in the engine. A turn's clears are
   already recorded per cascade step.
2. Change the reward in `src/application/puzzle/planning/return-model.ts` from "+1 per row
   survived" to "points scored". Survival still matters, because losing ends all future points.
3. Retrain from scratch (`npm run train -- --fresh`), since the value scale changes.
4. Compare models on average score, not rounds survived. Add score to `npm run evaluate`.

## Also worth checking with the same data

- **Engine rules:** turns flagged `boardEdited` mean the board was corrected by hand. Many
  corrections in similar situations point to a rule the engine gets wrong, e.g. push-up,
  gravity, bomb blast shape, or refill rows.
- **Starting position:** how the real game fills the first rows.
- **Model on real boards:** how often you followed its top move (`analysisRank`), and where it
  misjudged.
