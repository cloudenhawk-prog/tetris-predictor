import { Circle, Download, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PuzzleWorkbench } from "../use-puzzle-workbench";

const diskLabels = {
  saved: "Saved to recordings/ on disk",
  unavailable: "Browser storage only (no dev server); use Export",
  error: "Saving to disk failed; browser copy kept",
} as const;

/**
 * Records real games: board, round, Next Row (bombs included), and every clear.
 * Recording keeps going across page reloads until stopped.
 */
export function RecordingControls({ workbench }: { workbench: PuzzleWorkbench }) {
  const { recorder, toggleRecording, animating, trackScore, toggleTrackScore } = workbench;
  const { session, recording, storedSessions, diskStatus, localSaveFailed } = recorder;
  const reloads = session?.events.filter((e) => e.type === "page-loaded").length ?? 0;

  return (
    <div className="space-y-3">
      <Button
        variant={recording ? "default" : "outline"}
        onClick={toggleRecording}
        disabled={animating}
        aria-pressed={recording}
        className="mt-5 h-11 w-full"
      >
        {recording ? <Square /> : <Circle className="text-destructive" />}
        {recording ? "Stop recording" : "Record real game"}
      </Button>
      <div className="text-[10px] leading-5 text-muted-foreground" role="status">
        {recording && session ? (
          <>
            <p className="flex items-center gap-2 text-foreground">
              <span className="size-2 animate-pulse rounded-full bg-destructive" />
              {session.turns.length} turn{session.turns.length === 1 ? "" : "s"} recorded
              {reloads > 0 ? ` · resumed after ${reloads} reload${reloads === 1 ? "" : "s"}` : ""}
            </p>
            <p className="font-mono">{session.id}</p>
          </>
        ) : (
          <p>
            Saves the board, round, Next Row and clears every turn. Mark bombs on the Next Row as they appear in the
            game: they are recorded, but the model never sees them in advance.
          </p>
        )}
        {diskStatus ? <p className={diskStatus === "saved" ? "" : "text-destructive"}>{diskLabels[diskStatus]}</p> : null}
        {localSaveFailed ? <p className="text-destructive">Browser storage is full or blocked; export soon.</p> : null}
      </div>
      <label className="flex items-start gap-2 text-[10px] leading-5 text-muted-foreground">
        <input type="checkbox" checked={trackScore} onChange={toggleTrackScore} disabled={animating} className="mt-1 accent-primary" />
        <span>
          <span className="text-foreground">Track game score</span> · shows a Score counter under Simulation. Update it
          to the game's score after each round, before pushing the row.
        </span>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" onClick={recorder.exportAll} disabled={storedSessions === 0} className="text-[10px]">
          <Download />Export ({storedSessions})
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (window.confirm(`Delete ${storedSessions} recording(s) from this browser? Files in recordings/ are kept.`)) recorder.clearAll();
          }}
          disabled={recording || storedSessions === 0}
          className="text-[10px]"
          title={recording ? "Stop recording first" : undefined}
        >
          <Trash2 />Delete
        </Button>
      </div>
    </div>
  );
}
