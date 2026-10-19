import { Scissors, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { troubleRisk } from "@/application/puzzle/planning/split-search";
import type { PuzzleWorkbench } from "../use-puzzle-workbench";

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * Appears above the board only when the danger check advises the split
 * power-up: no move survives the next row, or splitting now clearly beats
 * waiting and keeping the split as a last resort. Otherwise nothing is shown.
 */
export function SplitAlert({ workbench }: { workbench: PuzzleWorkbench }) {
  const { splitAdvice, splitCheck, splitAt, canSplit, dismissSplitAdvice } = workbench;
  const block = splitAdvice?.option.block;
  if (!splitAdvice || !block) return null;
  const rescue = splitAdvice.kind === "rescue";
  const baseline = splitCheck?.analysis?.baseline;
  const where = `the ${block.w}-wide block at row ${block.row + 1}, column ${block.col + 1}`;

  return (
    <div
      role="alert"
      className={`mb-4 flex w-full max-w-[420px] items-start gap-3 rounded border p-3 text-[11px] leading-5 ${rescue ? "border-destructive/70 bg-destructive/10" : "border-primary/70 bg-primary/10"}`}
    >
      <TriangleAlert className={`mt-0.5 size-4 shrink-0 ${rescue ? "text-destructive" : "text-primary"}`} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{rescue ? "No move survives the next row." : "Split now."}</p>
        <p className="text-muted-foreground">
          {rescue
            ? `Splitting ${where} is the way out.`
            : `Without it, ${pct(baseline ? troubleRisk(baseline) : 0)} of futures lose or need a last-resort split. Splitting ${where} now beats waiting by ${Math.round(splitAdvice.kind === "preempt" ? splitAdvice.advantage : 0)} value, after split costs.`}
          {splitAdvice.option.cleared > 0 ? ` It clears ${splitAdvice.option.cleared} row${splitAdvice.option.cleared === 1 ? "" : "s"}.` : ""}
        </p>
        <Button size="sm" onClick={() => void splitAt(block.id, "advised")} disabled={!canSplit} className="mt-2 h-7 text-[10px]">
          <Scissors />Split this block
        </Button>
      </div>
      {rescue ? null : (
        <Button variant="ghost" size="sm" onClick={dismissSplitAdvice} aria-label="Dismiss" className="h-6 w-6 p-0">
          <X />
        </Button>
      )}
    </div>
  );
}
