"use client";

import {
  BoardMap,
  boardFiles,
  boardRanks,
  moveSquares,
  pieceGlyphs,
} from "@/components/chessCore";

type ChessBoardProps = {
  board: BoardMap | null;
  lastMove?: string | null;
  selectedSquare?: string | null;
  hintSquares?: string[];
  onSquareClick?: (square: string) => void;
  compact?: boolean;
};

export function ChessBoard({
  board,
  lastMove,
  selectedSquare,
  hintSquares = [],
  onSquareClick,
  compact = false,
}: ChessBoardProps) {
  const lastMoveSquares = moveSquares(lastMove);
  const hintSquareSet = new Set(hintSquares);

  return (
    <div className="aspect-square w-full overflow-hidden bg-[#312e2b] shadow-2xl shadow-black/25">
      <div className="grid h-full w-full grid-cols-8 grid-rows-8">
        {boardRanks.flatMap((rank, rankIndex) =>
          boardFiles.map((fileName, fileIndex) => {
            const square = `${fileName}${rank}`;
            const piece = board?.[square];
            const isDark = (rankIndex + fileIndex) % 2 === 1;
            const isLastMove = lastMoveSquares.has(square);
            const isSelected = selectedSquare === square;
            const isHint = hintSquareSet.has(square);

            return (
              <button
                type="button"
                key={square}
                onClick={() => onSquareClick?.(square)}
                className={`relative flex items-center justify-center ${
                  isDark ? "bg-[#769656]" : "bg-[#eeeed2]"
                } ${onSquareClick ? "cursor-pointer" : "cursor-default"}`}
                aria-label={square}
              >
                {isLastMove ? (
                  <span className="absolute inset-0 bg-[#f6f669]/60" />
                ) : null}
                {isSelected ? (
                  <span className="absolute inset-1 border-4 border-[#f0d95a]" />
                ) : null}
                {isHint ? (
                  <span className="absolute h-1/3 w-1/3 rounded-full bg-black/20" />
                ) : null}
                <span
                  className={`relative select-none leading-none drop-shadow-[0_2px_1px_rgba(0,0,0,0.35)] ${
                    compact
                      ? "text-[clamp(1.5rem,6vw,3.8rem)]"
                      : "text-[clamp(2.4rem,7vw,5.8rem)]"
                  } ${piece && piece === piece.toLowerCase() ? "text-[#403d39]" : "text-[#faf8ef]"}`}
                >
                  {piece ? pieceGlyphs[piece] : ""}
                </span>
                <span className="absolute left-2 top-1 text-sm font-bold text-[#5e7d42]/80">
                  {fileIndex === 0 ? rank : ""}
                </span>
                <span className="absolute bottom-1 right-2 text-sm font-bold text-[#5e7d42]/80">
                  {rankIndex === 7 ? fileName : ""}
                </span>
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}
