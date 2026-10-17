import { createFileRoute } from "@tanstack/react-router";
import { PuzzleWorkbenchView } from "@/features/puzzle/puzzle-workbench-view";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Block Engine — Rising Block Puzzle Solver" },
      {
        name: "description",
        content:
          "Draw your 8x10 board and the incoming row, then compute ranked slide moves with clearance and gap analysis.",
      },
      { property: "og:title", content: "Block Engine — Rising Block Puzzle Solver" },
      { property: "og:type", content: "website" },
      {
        property: "og:description",
        content:
          "Draw your 8x10 board and the incoming row, then compute ranked slide moves with clearance and gap analysis.",
      },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PuzzleWorkbenchView,
});

