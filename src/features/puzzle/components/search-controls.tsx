import { Scissors, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PuzzleWorkbench } from "../use-puzzle-workbench";

const sliders = [
  { key: "thinkSeconds", label: "Think time", min: 0, max: 20, step: 0.5, format: (v: number) => (v === 0 ? "instant" : `${v}s`) },
  { key: "depth", label: "Lookahead", min: 1, max: 8, step: 1, format: (v: number) => `${v} move${v === 1 ? "" : "s"}` },
  { key: "candidates", label: "Moves searched", min: 2, max: 12, step: 1, format: (v: number) => `top ${v}` },
] as const;

/**
 * Search budget for "Compute Optimal": the network ranks every move instantly,
 * then the top moves are refined by simulating futures from the current board.
 */
export function SearchControls({ workbench }: { workbench: PuzzleWorkbench }) {
  const { searchSettings, setSearchSettings, searchProgress, stopSearch, splitCheck, splitAdvice, canCheckSplits, checkSplitsNow, animating } = workbench;
  const running = searchProgress !== null && !searchProgress.done;
  const fraction = searchProgress ? Math.min(1, searchProgress.elapsedMs / Math.max(1, searchProgress.thinkMs)) : 0;
  const splitRunning = splitCheck !== null && !splitCheck.done;
  const splitFraction = splitCheck ? Math.min(1, splitCheck.elapsedMs / Math.max(1, splitCheck.thinkMs)) : 0;
  const splitSummary =
    splitCheck?.done && splitCheck.advice
      ? splitCheck.advice.kind === "rescue"
        ? "Split rescue found."
        : splitCheck.advice.kind === "preempt"
          ? "Split now is better than waiting."
          : splitCheck.advice.reason
      : null;

  return (
    <div className="mt-4 space-y-3">
      {sliders.map(({ key, label, min, max, step, format }) => (
        <label key={key} className="block text-[10px] text-muted-foreground">
          <span className="flex items-center justify-between">
            <span className="uppercase tracking-[0.12em]">{label}</span>
            <span className="font-mono text-foreground">{format(searchSettings[key])}</span>
          </span>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={searchSettings[key]}
            disabled={animating || running}
            onChange={(event) => setSearchSettings({ ...searchSettings, [key]: Number(event.target.value) })}
            className="mt-1 w-full accent-primary"
          />
        </label>
      ))}
      {searchProgress ? (
        <div className="text-[10px] text-muted-foreground" role="status">
          <div className="h-1 overflow-hidden rounded bg-border">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${(searchProgress.done ? 1 : fraction) * 100}%` }} />
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span>
              {running ? "Searching…" : "Search complete"} · {searchProgress.samples} futures per move
            </span>
            {running ? (
              <Button variant="ghost" size="sm" onClick={stopSearch} className="h-6 px-2 text-[10px]">
                <Square />Stop
              </Button>
            ) : null}
          </div>
          {searchProgress.warning ? <p className="mt-1 text-destructive">{searchProgress.warning}</p> : null}
        </div>
      ) : null}
      <div className="text-[10px] text-muted-foreground" role="status">
        <div className="flex items-center justify-between">
          <span>
            {splitRunning ? "Checking split options..." : "Split check"}
            {splitCheck ? ` · ${splitCheck.samples} futures per option` : ""}
          </span>
          <Button variant="ghost" size="sm" onClick={checkSplitsNow} disabled={animating || running || splitRunning || !canCheckSplits} className="h-6 px-2 text-[10px]">
            <Scissors />Check splits now
          </Button>
        </div>
        {splitCheck ? (
          <>
            <div className="mt-1 h-1 overflow-hidden rounded bg-border">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${(splitCheck.done ? 1 : splitFraction) * 100}%` }} />
            </div>
            {splitCheck.warning ? <p className="mt-1 text-destructive">{splitCheck.warning}</p> : null}
            {splitSummary ? (
              <p className={`mt-1 ${splitAdvice ? "text-primary" : "text-muted-foreground"}`}>{splitSummary}</p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
