import { ArrowUp, Bomb, Dices, MoveHorizontal, Trash2 } from "lucide-react";
import type { CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { COLS, ROWS } from "@/domain/puzzle/engine";
import { LIFT_MS, ROWS_PER_SECOND, type PuzzleWorkbench } from "../use-puzzle-workbench";
const CELL_SIZE = "var(--board-cell-size)";
const BLOCK_TONES = ["bg-block-1", "bg-block-2", "bg-block-3", "bg-block-4"];
const toneFor = (width: number) => BLOCK_TONES[(width - 1) % BLOCK_TONES.length];

export function PuzzleBoard({ workbench }: { workbench: PuzzleWorkbench }) {
  const { blocks, nextRow, drag, setHovered, preview, movePreview, dragPreview, motionBlocks, removingIds, hoveredBoardBlock, hoveredNextBlock, HoverToolIcon, lifting, nextFilled, animating, setNextRow, randomizeNextRow, turnsSurvived, resetAnalysis, startDrag, extendDrag, finishDrag, trackPointer } = workbench;
  return (
          <div className="board-frame">
            <div className="board-opening relative overflow-hidden border border-border-strong bg-secondary p-1">
               <div
                className="grid gap-1"
                 onPointerMove={(event) => trackPointer(event, "board")}
                  onPointerLeave={() => {
                    setHovered(null);
                    if (drag?.zone === "board") finishDrag();
                  }}
                 onPointerUp={finishDrag}
                style={{
                   gridTemplateColumns: `repeat(${COLS}, ${CELL_SIZE})`,
                   gridTemplateRows: `repeat(${ROWS}, ${CELL_SIZE})`,
                }}
              >
                {Array.from({ length: ROWS * COLS }).map((_, i) => {
                  const row = Math.floor(i / COLS);
                  const col = i % COLS;
                  return (
                    <Button variant="ghost"
                      key={i}
                      onPointerDown={(event) => {
                        event.currentTarget.setPointerCapture(event.pointerId);
                        startDrag("board", row, col);
                      }}
                      onPointerEnter={() => extendDrag("board", row, col)}
                      onPointerMove={() => setHovered({ zone: "board", row, col })}
                      aria-label={`Row ${row + 1} column ${col + 1}`}
                      className={`board-cell rounded-none p-0 transition-colors hover:bg-cell ${
                        row === 0 ? "bg-destructive/10" : "bg-background/50"
                      }`}
                    />
                  );
                })}
              </div>

              {/* Blocks + ghost overlay */}
              <div
                className="pointer-events-none absolute inset-1 grid gap-1"
                style={{
                   gridTemplateColumns: `repeat(${COLS}, ${CELL_SIZE})`,
                   gridTemplateRows: `repeat(${ROWS}, ${CELL_SIZE})`,
                }}
              >
                {blocks.map((b) => {
                  const inMotion = motionBlocks.some((motion) => motion.id === b.id);
                  const dim =
                    preview?.block?.id === b.id ||
                    (movePreview?.zone === "board" && movePreview.block.id === b.id && movePreview.targetCol !== b.col);
                  return (
                    <div
                      key={b.id}
                       className={`rune-block relative flex items-center justify-center rounded-[3px] transition-opacity duration-300 ${toneFor(b.w)} ${dim ? "opacity-30" : ""} ${inMotion ? "opacity-0" : ""} ${removingIds.includes(b.id) ? "animate-block-vanish" : ""}`}
                      style={{
                        gridColumn: `${b.col + 1} / span ${b.w}`,
                        gridRow: `${b.row + 1}`,
                      }}
                     >
                       {b.bomb ? <Bomb className="size-5 text-background drop-shadow" strokeWidth={2.4} /> : null}
                     </div>
                  );
                })}
                {motionBlocks.map((b) => (
                  <div
                    key={`motion-${b.id}`}
                    className={`rune-block relative z-40 flex items-center justify-center rounded-[3px] ${toneFor(b.w)} ${b.motion === "fall" ? "animate-block-fall" : "animate-block-lift"}`}
                    style={{
                      gridColumn: `${b.col + 1} / span ${b.w}`,
                      gridRow: `${b.row + 1}`,
                      "--travel-rows": b.travelRows,
                      animationDuration:
                        b.motion === "fall"
                          ? `${b.travelRows / ROWS_PER_SECOND}s`
                          : `${LIFT_MS}ms`,
                    } as CSSProperties}
                  >
                    {b.bomb ? <Bomb className="size-5 text-background drop-shadow" strokeWidth={2.4} /> : null}
                  </div>
                ))}
                {preview?.block ? (
                  <div
                    className="rounded-[3px] border-2 border-dashed border-primary-bright bg-primary/20"
                    style={{
                      gridColumn: `${preview.targetCol + 1} / span ${preview.block.w}`,
                      gridRow: `${preview.block.row + 1}`,
                    }}
                  />
                ) : null}
                {movePreview?.zone === "board" && movePreview.targetCol !== movePreview.block.col ? (
                  <div
                    className={`z-30 flex items-center justify-center rounded-[3px] border-2 border-dashed border-primary-bright/90 opacity-75 ${toneFor(movePreview.block.w)}`}
                    style={{
                      gridColumn: `${movePreview.targetCol + 1} / span ${movePreview.block.w}`,
                      gridRow: `${movePreview.block.row + 1}`,
                    }}
                  >
                    <MoveHorizontal className="size-4 text-primary-foreground" />
                  </div>
                ) : null}
                {hoveredBoardBlock && !drag ? (
                  <div
                    className="z-20 flex items-center justify-center rounded-[3px] border-2 border-primary-bright bg-primary/10 shadow-[inset_0_0_0_1px_var(--color-background)]"
                    style={{
                      gridColumn: `${hoveredBoardBlock.col + 1} / span ${hoveredBoardBlock.w}`,
                      gridRow: `${hoveredBoardBlock.row + 1}`,
                    }}
                  >
                    <HoverToolIcon className="size-4 text-foreground drop-shadow" />
                  </div>
                ) : null}
                {dragPreview?.zone === "board" ? (
                  <div
                    className={`z-30 flex items-center justify-center rounded-[3px] border-2 border-dashed font-mono text-[9px] font-bold ${
                      dragPreview.valid
                        ? `${toneFor(dragPreview.width)} border-primary-bright/90 opacity-70 text-primary-foreground`
                        : "border-destructive bg-destructive/20 text-destructive"
                    }`}
                    style={{
                      gridColumn: `${dragPreview.col + 1} / span ${dragPreview.width}`,
                      gridRow: `${dragPreview.row + 1}`,
                    }}
                  >
                    {dragPreview.width}×1
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mt-7 w-full">
              <div className="mb-3 flex h-8 items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs font-semibold"><ArrowUp className="size-3.5 text-primary" /> Next Row <span className="w-9 font-mono text-[10px] text-muted-foreground">{nextFilled}/8</span></span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={randomizeNextRow} disabled={animating} title={`Random row for turn ${turnsSurvived + 1}, from the generator the model is trained on`} className="h-7 px-2 text-[10px]"><Dices className="size-3" />Random</Button>
                  <Button variant="outline" size="sm" onClick={() => { setNextRow([]); resetAnalysis(); }} disabled={animating} className="h-7 px-2 text-[10px]"><Trash2 className="size-3" />Clear Next</Button>
                </div>
              </div>
              <div className="relative rounded border border-accent/60 bg-background p-1 shadow-inner">
                <div
                  className="grid gap-1"
                  onPointerMove={(event) => trackPointer(event, "next")}
                   onPointerLeave={() => {
                     setHovered(null);
                     if (drag?.zone === "next") finishDrag();
                   }}
                  onPointerUp={finishDrag}
                  style={{
                     gridTemplateColumns: `repeat(${COLS}, ${CELL_SIZE})`,
                     gridTemplateRows: CELL_SIZE,
                  }}
                >
                  {Array.from({ length: COLS }).map((_, col) => (
                    <Button variant="ghost"
                      key={col}
                      onPointerDown={(event) => {
                        event.currentTarget.setPointerCapture(event.pointerId);
                        startDrag("next", 0, col);
                      }}
                      onPointerEnter={() => extendDrag("next", 0, col)}
                       onPointerMove={() => setHovered({ zone: "next", row: 0, col })}
                      aria-label={`Incoming column ${col + 1}`}
                      className="board-cell rounded-none bg-secondary p-0 transition-colors hover:bg-cell"
                    />
                  ))}
                </div>
                <div
                  className="pointer-events-none absolute inset-1 grid gap-1"
                   style={{
                      gridTemplateColumns: `repeat(${COLS}, ${CELL_SIZE})`,
                      gridTemplateRows: CELL_SIZE,
                   }}
                >
                  {!lifting ? nextRow.map((r) => (
                    <div
                      key={r.id}
                       className={`rune-block flex items-center justify-center rounded-[3px] bg-block-2 ${movePreview?.zone === "next" && movePreview.block.id === r.id && movePreview.targetCol !== r.col ? "opacity-30" : ""}`}
                      style={{ gridColumn: `${r.col + 1} / span ${r.w}`, gridRow: 1 }}
                     >
                       {r.bomb ? <Bomb className="size-5 text-background" strokeWidth={2.4} /> : null}
                     </div>
                  )) : null}
                  {movePreview?.zone === "next" && movePreview.targetCol !== movePreview.block.col ? (
                    <div
                      className="z-30 flex items-center justify-center rounded-[3px] border-2 border-dashed border-primary-bright/90 bg-block-2 opacity-75"
                      style={{ gridColumn: `${movePreview.targetCol + 1} / span ${movePreview.block.w}`, gridRow: 1 }}
                    >
                      <MoveHorizontal className="size-4 text-accent-foreground" />
                    </div>
                  ) : null}
                  {hoveredNextBlock && !drag ? (
                    <div
                      className="z-20 flex items-center justify-center rounded-[3px] border-2 border-primary-bright bg-primary/10 shadow-[inset_0_0_0_1px_var(--color-background)]"
                      style={{ gridColumn: `${hoveredNextBlock.col + 1} / span ${hoveredNextBlock.w}`, gridRow: 1 }}
                    >
                      <HoverToolIcon className="size-4 text-foreground drop-shadow" />
                    </div>
                  ) : null}
                  {dragPreview?.zone === "next" ? (
                    <div
                      className={`z-30 flex items-center justify-center rounded-[3px] border-2 border-dashed font-mono text-[9px] font-bold ${
                        dragPreview.valid
                          ? "border-primary-bright/90 bg-block-2 text-accent-foreground"
                          : "border-destructive bg-destructive/20 text-destructive"
                      }`}
                      style={{ gridColumn: `${dragPreview.col + 1} / span ${dragPreview.width}`, gridRow: 1 }}
                    >
                      {dragPreview.width}×1
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
  );
}