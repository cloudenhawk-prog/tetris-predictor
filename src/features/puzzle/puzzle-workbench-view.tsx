import { ArrowRight, ArrowUp, Bomb, Circle, Check, ChevronRight, Compass, Eraser, Layers3, Pencil, RotateCcw, Scissors, Shield, Sparkles, Swords, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { COLS, ROWS } from "@/domain/puzzle/engine";
import { PuzzleBoard } from "./components/puzzle-board";
import { RecordingControls } from "./components/recording-controls";
import { SearchControls } from "./components/search-controls";
import { SplitPanel } from "./components/split-panel";
import { usePuzzleWorkbench } from "./use-puzzle-workbench";

const tools = [
  { value: "draw", label: "Draw", icon: Pencil },
  { value: "erase", label: "Erase", icon: Eraser },
  { value: "bomb", label: "Bomb", icon: Bomb },
  { value: "split", label: "Split", icon: Scissors },
] as const;

export function PuzzleWorkbenchView() {
  const game = usePuzzleWorkbench();
  const { tool, setTool, turnsSurvived, setTurn, rowsDestroyed, setRowsDestroyed, score, setScore, commitScore, trackScore, recorder, status, animating, refilling, nextValid, nextFilled, movedThisTurn, canAdvance, forcedPush, analysis, ranked, selected, setSelected, compute, advanceTurn, applyMove, clearBoard } = game;
  const guidance = forcedPush
    ? "Refill required. Push Next Rows until three rows are occupied."
    : !nextValid
      ? `Next Row required. Leave 1–2 empty cells; ${8 - nextFilled} are empty.`
      : movedThisTurn
        ? "Block moved. Advance the turn, or return it to its origin to move another or split."
        : "Next Row ready. Slide a block (staying put is not a move), or apply a ranked move.";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="app-navigation">
        <a href="/" className="flex items-center gap-3" aria-label="Block Engine home">
          <span className="brand-emblem"><Layers3 className="size-5" /></span>
          <span className="font-display text-base font-semibold">Block Engine</span>
        </a>
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="status-dot" /> Puzzle workbench</div>
      </header>

      <div className="citadel-banner">
        <div className="banner-art" aria-hidden="true" />
        <div className="banner-content">
          <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary"><Compass className="size-3.5" /> The strategist’s table</div>
          <h1 className="font-display text-4xl font-semibold">Block Engine<span className="text-primary">.</span></h1>
          <p className="mt-2 text-sm text-muted-foreground">Every move, a little more foresight.</p>
        </div>
        <div className="banner-seal" aria-hidden="true"><Shield className="size-8" /><span>VIII · X</span></div>
      </div>

      <main className="workbench-layout">
        <aside className="left-rail">
          <section className="rail-section">
            <div className="section-heading"><Pencil className="size-4" /><h2>Board editor</h2><span>01</span></div>
            <div className="mt-5 grid grid-cols-4 gap-2">
              {tools.map(({ value, label, icon: Icon }) => (
                <Button key={value} variant="ghost" onClick={() => setTool(value)} aria-pressed={tool === value} disabled={animating} className={`editor-tool ${tool === value ? "editor-tool-active" : ""}`} title={label}>
                  <Icon className="size-5" /><span>{label}</span>
                </Button>
              ))}
            </div>
            <div className="mt-6 flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground"><span className="h-px flex-1 bg-border" /> Block sizes <span className="h-px flex-1 bg-border" /></div>
            <div className="block-key" aria-hidden="true">
              {["bg-block-1", "bg-block-2", "bg-block-3", "bg-block-4"].map((tone, i) => <div key={tone} className="flex flex-col items-center gap-2"><span className={`mini-rune ${tone}`} /><span>{i + 1}</span></div>)}
            </div>
            <Button variant="outline" onClick={clearBoard} disabled={animating} className="mt-4 w-full text-xs"><RotateCcw />Clear Board State</Button>
          </section>

          <section className="rail-section mt-8">
            <div className="section-heading"><Trophy className="size-4" /><h2>Simulation</h2><span>02</span></div>
            <div className="simulation-stats">
              <div title="Set this when joining a game in progress; it drives the difficulty the model expects"><input id="turns-survived" type="number" min={0} step={1} value={turnsSurvived} onChange={(event) => setTurn(Number(event.target.value))} disabled={animating} aria-label="Turns survived" className="stat-value w-full max-w-24 border-b border-dashed border-border bg-transparent outline-none focus:border-primary" /><label htmlFor="turns-survived" className="stat-label">Turns survived · editable</label></div>
              <div title="Restore this after a page reload; recordings also store the rows destroyed each turn"><input id="rows-destroyed" type="number" min={0} step={1} value={rowsDestroyed} onChange={(event) => setRowsDestroyed(Number(event.target.value))} disabled={animating} aria-label="Rows destroyed" className="stat-value w-full max-w-24 border-b border-dashed border-border bg-transparent text-accent outline-none focus:border-primary" /><label htmlFor="rows-destroyed" className="stat-label">Rows destroyed · editable</label></div>
            </div>
            {recorder.recording && trackScore ? (
              <div className="simulation-stats" style={{ paddingTop: 0 }}>
                <div title="The game's score after this round; update it before pushing the row"><input id="game-score" type="number" min={0} step={1} value={score} onChange={(event) => setScore(Number(event.target.value))} onBlur={commitScore} disabled={animating} aria-label="Game score" className="stat-value w-full border-b border-dashed border-border bg-transparent outline-none focus:border-primary" /><label htmlFor="game-score" className="stat-label">Game score · after round</label></div>
              </div>
            ) : null}
            <div className="guidance" role="status"><Shield className="size-4 shrink-0 text-primary" /><p>{guidance}</p></div>
            <SearchControls workbench={game} />
            <Button onClick={compute} disabled={animating || forcedPush} variant="outline" className="mt-4 h-11 w-full"><Sparkles />Compute Optimal</Button>
            <Button onClick={advanceTurn} disabled={animating || !canAdvance} className="mt-2 h-11 w-full">{animating ? "Resolving…" : forcedPush ? "Push Next Row" : "Advance Turn"}<ArrowUp /></Button>
          </section>
          <section className="rail-section mt-8">
            <div className="section-heading"><Circle className="size-4" /><h2>Recording</h2><span>04</span></div>
            <RecordingControls workbench={game} />
          </section>
          <div className="mt-7 flex items-center justify-between border-t border-border pt-4 text-[10px] text-muted-foreground"><span>Encounter status</span><span className={status === "lost" ? "text-destructive" : "text-primary"}>{status === "lost" ? "Topped out" : animating ? "Resolving" : "Ready"}</span></div>
        </aside>

        <section className="board-stage" aria-label="Puzzle board">
          <div className="board-title"><span className="flex items-center gap-2"><Swords className="size-4 text-primary" />The field</span><span className="font-mono text-[10px] text-muted-foreground">{COLS} × {ROWS}</span></div>
          <PuzzleBoard workbench={game} />
          <div className="mt-4 flex items-center justify-center gap-2 text-[10px] text-muted-foreground"><span className="h-px w-6 bg-border" /><span>Rising-row puzzle</span><span className="h-px w-6 bg-border" /></div>
        </section>

        <aside className="analysis-rail">
          <div className="section-heading"><Compass className="size-4" /><h2>Move analysis</h2><span>03</span></div>
          <div className="mt-5 flex items-center justify-between text-[10px] text-muted-foreground"><span>RANKED MOVES</span><span className="font-mono">{analysis?.length ?? "—"} paths</span></div>
          {!analysis ? <div className="analysis-empty"><div className="compass-mark"><Compass strokeWidth={1} className="size-12" /></div><h3 className="font-display text-lg">Uncharted possibilities</h3><span className="mt-2 text-xs text-muted-foreground">Awaiting analysis</span><div className="mt-7 flex gap-2" aria-hidden="true"><span /><span /><span /></div></div> : (
            <div className="mt-4 space-y-2">
              {ranked.map((entry, i) => (
                <div key={`${entry.move.blockId}-${entry.move.delta}`} className={`move-entry ${selected === i ? "move-entry-active" : ""}`}>
                  <Button variant="ghost" className="move-select" onClick={() => setSelected(i)} aria-pressed={selected === i}>
                    <span className="move-rank">{String(i + 1).padStart(2, "0")}</span>
                    <span className="min-w-0 flex-1 text-left"><span className="block text-[11px] font-semibold leading-5">{entry.label}</span><span className="block text-[10px] font-normal text-muted-foreground">{entry.rationale}</span></span>
                    {selected === i ? <Check className="text-primary" /> : <ChevronRight className="text-muted-foreground" />}
                  </Button>
                  {selected === i ? <div className="flex items-center justify-between px-3 pb-3"><span className={`font-mono text-[10px] ${entry.lost ? "text-destructive" : "text-primary"}`}>{entry.lost ? "LOSS" : entry.scoreLabel}</span><Button variant="outline" size="sm" onClick={() => void applyMove(entry)} disabled={animating || refilling || !nextValid || status === "lost"} className="h-7 text-[10px]">Apply &amp; advance<ArrowRight /></Button></div> : null}
                </div>
              ))}
            </div>
          )}
          <SplitPanel workbench={game} />
          <div className="analysis-summary"><div><span>Moves considered</span><span className="font-mono text-foreground">{analysis?.length ?? "—"}</span></div><div><span>Best clearances</span><span className="font-mono text-foreground">{ranked[0]?.cleared ?? "—"}</span></div></div>
        </aside>
      </main>
      <footer className="workbench-footer"><span className="flex items-center gap-2"><Layers3 className="size-3.5" />Block Engine</span><span>Strategy over chance.</span><span className="font-mono">{COLS} columns · {ROWS} rows · 1–4 wide</span></footer>
    </div>
  );
}