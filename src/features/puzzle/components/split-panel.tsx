import { Scissors, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type SplitOption, splitGain } from "@/application/puzzle/planning/split-search";
import type { PuzzleWorkbench } from "../use-puzzle-workbench";

const SHOWN = 4;

const pct = (x: number) => `${Math.round(x * 100)}%`;
const signed = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x * 10) / 10)}`;
const describeSplit = (option: SplitOption) =>
  option.block ? `SPLIT W${option.block.w} · R${option.block.row + 1}C${option.block.col + 1}` : "NO SPLIT";

/**
 * The split power-up: which block is best to split before this turn's move.
 * Runs on its own after Compute Optimal when no move survives or the board is
 * crowded, or on request.
 */
export function SplitPanel({ workbench }: { workbench: PuzzleWorkbench }) {
  const { splitCheck, checkSplits, splitAt, canSplit, setSplitPreviewId, stopSearch, nextValid, forcedPush, searchProgress } = workbench;
  const moveSearchRunning = searchProgress !== null && !searchProgress.done;
  const running = splitCheck !== null && !splitCheck.done;
  const analysis = splitCheck?.analysis ?? null;
  const advice = splitCheck?.advice ?? null;
  const advisedId = advice && advice.kind !== "none" ? advice.option.block?.id : undefined;

  return (
    <div className="mt-6 border-t border-border pt-4">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="flex items-center gap-2"><Scissors className="size-3.5" />SPLIT POWER-UP</span>
        {running ? (
          <Button variant="ghost" size="sm" onClick={stopSearch} className="h-6 px-2 text-[10px]"><Square />Stop</Button>
        ) : (
          <Button variant="outline" size="sm" onClick={checkSplits} disabled={!canSplit || !nextValid || forcedPush || moveSearchRunning} title="Value splitting each block before this turn's move" className="h-6 px-2 text-[10px]">Check splits</Button>
        )}
      </div>

      {splitCheck === null ? (
        <p className="mt-2 text-[10px] text-muted-foreground">Checked after Compute Optimal when no move survives or fewer than 5 rows are free.</p>
      ) : (
        <div className="mt-3 space-y-2" role="status">
          {running ? (
            <p className="text-[10px] text-muted-foreground">
              {splitCheck.auto ? "Board in danger, checking splits…" : "Checking splits…"} {splitCheck.samples} futures per option
            </p>
          ) : advice?.kind === "rescue" ? (
            <p className="rounded border border-destructive/60 bg-destructive/10 p-2 text-[11px]">No move survives the next row. Splitting is the way out.</p>
          ) : advice?.kind === "preempt" ? (
            <p className="rounded border border-primary/60 bg-primary/10 p-2 text-[11px]">Split recommended: {signed(advice.gain)} value, loss risk {pct(analysis?.baseline.lossRisk ?? 0)} → {pct(advice.option.lossRisk)}.</p>
          ) : advice ? (
            <p className="text-[10px] text-muted-foreground">{advice.reason}</p>
          ) : null}
          {splitCheck.warning ? <p className="text-[10px] text-destructive">{splitCheck.warning}</p> : null}

          {analysis ? (
            <ul className="space-y-1">
              {[analysis.baseline, ...analysis.splits.slice(0, SHOWN)].map((option) => {
                const id = option.block?.id;
                const gain = splitGain(option, analysis.baseline);
                return (
                  <li
                    key={id ?? "baseline"}
                    onPointerEnter={() => setSplitPreviewId(id ?? null)}
                    onPointerLeave={() => setSplitPreviewId(null)}
                    className={`flex items-center justify-between gap-2 rounded border px-2 py-1.5 ${id !== undefined && id === advisedId ? "border-primary" : "border-border"}`}
                  >
                    <span className="min-w-0">
                      <span className="block text-[11px] font-semibold">{describeSplit(option)}{option.cleared > 0 ? ` · clears ${option.cleared}` : ""}</span>
                      <span className={`block font-mono text-[10px] ${option.doomed ? "text-destructive" : "text-muted-foreground"}`}>
                        {option.doomed
                          ? "LOSS: no move survives"
                          : `${option.block ? `${signed(gain)} vs no split` : `value ${Math.round(option.value * 10) / 10}`} · risk ${option.samples > 0 ? pct(option.lossRisk) : "—"}`}
                      </span>
                    </span>
                    {option.block ? (
                      <Button variant="outline" size="sm" onClick={() => void splitAt(option.block!.id, "advised")} disabled={!canSplit || running} className="h-7 shrink-0 text-[10px]">Split</Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}
