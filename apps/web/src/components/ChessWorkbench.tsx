"use client";

import { ChangeEvent, useMemo, useState } from "react";

type Opening = {
  eco: string;
  name: string;
  pgn: string;
  plies: number;
};

type Move = {
  ply: number;
  moveNumber: number;
  side: "white" | "black";
  san: string;
  uci: string;
  from: string;
  to: string;
  promotion: string | null;
  opening: Opening | null;
};

type Position = {
  ply: number;
  fen: string;
  turn: "white" | "black";
  board: Record<string, string>;
  lastMove: Move | null;
  isCheck: boolean;
  isCheckmate: boolean;
  opening: Opening | null;
  materialBalance: number;
};

type GameReport = {
  summary: string[];
  struggles: Array<{ title: string; detail: string }>;
  stockfish: {
    available: boolean;
    message: string;
    insights: Array<{ label: string; ply: number; detail: string }>;
  };
};

type ParsedGame = {
  id: string;
  number: number;
  title: string;
  headers: Record<string, string>;
  result: string;
  opening: Opening | null;
  firstUnbookedPly: number | null;
  moves: Move[];
  positions: Position[];
  report: GameReport;
};

type UploadResponse = {
  filename: string;
  gameCount: number;
  games: ParsedGame[];
  engine: {
    stockfishAvailable: boolean;
    message: string;
  };
};

const ranks = [8, 7, 6, 5, 4, 3, 2, 1];
const files = ["a", "b", "c", "d", "e", "f", "g", "h"];

const pieceGlyphs: Record<string, string> = {
  K: "♔",
  Q: "♕",
  R: "♖",
  B: "♗",
  N: "♘",
  P: "♙",
  k: "♚",
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};

export function ChessWorkbench() {
  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<UploadResponse | null>(null);
  const [selectedGameIndex, setSelectedGameIndex] = useState(0);
  const [selectedPly, setSelectedPly] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isReportOpen, setIsReportOpen] = useState(true);

  const selectedGame = upload?.games[selectedGameIndex] ?? null;
  const selectedPosition = selectedGame?.positions[selectedPly] ?? null;
  const selectedOpening = selectedPosition?.opening ?? selectedGame?.opening ?? null;
  const movePairs = useMemo(
    () => pairMoves(selectedGame?.moves ?? []),
    [selectedGame],
  );

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;
    setFile(nextFile);
    setError(null);
  }

  async function handleUpload() {
    if (!file) {
      setError("Choose a PGN file first.");
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/games/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail ?? "The PGN upload failed.");
      }

      const payload = (await response.json()) as UploadResponse;
      setUpload(payload);
      setSelectedGameIndex(0);
      setSelectedPly(0);
      setIsReportOpen(true);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "The PGN upload failed.",
      );
    } finally {
      setIsUploading(false);
    }
  }

  function selectGame(index: number) {
    setSelectedGameIndex(index);
    setSelectedPly(0);
    setIsReportOpen(true);
  }

  function goToPly(ply: number) {
    if (!selectedGame) {
      return;
    }
    const boundedPly = Math.min(
      Math.max(ply, 0),
      selectedGame.positions.length - 1,
    );
    setSelectedPly(boundedPly);
  }

  return (
    <main className="min-h-screen bg-[#f6f5f0] text-stone-950">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-stone-300 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">
              Chess Analytics
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-normal text-stone-950 sm:text-4xl">
              Game Review
            </h1>
          </div>

          <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
            <label className="flex min-h-11 flex-1 cursor-pointer items-center justify-center border border-stone-400 bg-white px-4 text-sm font-semibold text-stone-900 transition hover:bg-stone-100 lg:w-72">
              <input
                type="file"
                accept=".pgn"
                onChange={handleFileChange}
                className="sr-only"
              />
              <span className="truncate">
                {file ? file.name : "Choose PGN"}
              </span>
            </label>
            <button
              type="button"
              onClick={handleUpload}
              disabled={isUploading}
              className="min-h-11 border border-emerald-950 bg-emerald-950 px-5 text-sm font-semibold text-white transition hover:bg-emerald-900 disabled:cursor-not-allowed disabled:border-stone-400 disabled:bg-stone-500"
            >
              {isUploading ? "Analyzing" : "Upload"}
            </button>
          </div>
        </header>

        {error ? (
          <div className="border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            {error}
          </div>
        ) : null}

        <section className="grid flex-1 gap-5 lg:grid-cols-[280px_minmax(0,1fr)_340px]">
          <aside className="min-h-0 border border-stone-300 bg-white">
            <div className="border-b border-stone-300 px-4 py-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-700">
                Games
              </h2>
            </div>
            <div className="max-h-[280px] overflow-auto p-2 lg:max-h-[calc(100vh-210px)]">
              {upload ? (
                <div className="space-y-2">
                  {upload.games.map((game, index) => (
                    <button
                      type="button"
                      key={game.id}
                      onClick={() => selectGame(index)}
                      className={`w-full border px-3 py-3 text-left transition ${
                        selectedGameIndex === index
                          ? "border-emerald-800 bg-emerald-50"
                          : "border-stone-200 bg-white hover:bg-stone-50"
                      }`}
                    >
                      <span className="block truncate text-sm font-semibold text-stone-950">
                        {game.title}
                      </span>
                      <span className="mt-1 block truncate text-xs text-stone-600">
                        {game.opening
                          ? `${game.opening.eco} ${game.opening.name}`
                          : "Opening unknown"}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyState label="No games loaded" />
              )}
            </div>
          </aside>

          <section className="min-w-0 border border-stone-300 bg-white">
            <div className="flex flex-col gap-3 border-b border-stone-300 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold text-stone-950">
                  {selectedGame?.title ?? "PGN Review"}
                </h2>
                <p className="truncate text-sm text-stone-600">
                  {selectedOpening
                    ? `${selectedOpening.eco} ${selectedOpening.name}`
                    : "Opening will appear after upload"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => goToPly(0)}
                  disabled={!selectedGame || selectedPly === 0}
                  className="h-9 w-10 border border-stone-300 bg-white text-sm font-semibold disabled:opacity-40"
                  aria-label="Go to first move"
                >
                  {"<<"}
                </button>
                <button
                  type="button"
                  onClick={() => goToPly(selectedPly - 1)}
                  disabled={!selectedGame || selectedPly === 0}
                  className="h-9 w-10 border border-stone-300 bg-white text-sm font-semibold disabled:opacity-40"
                  aria-label="Go back one move"
                >
                  {"<"}
                </button>
                <span className="flex h-9 min-w-20 items-center justify-center border border-stone-300 bg-stone-50 px-3 text-sm font-semibold tabular-nums">
                  {selectedPly}
                  {selectedGame ? `/${selectedGame.moves.length}` : "/0"}
                </span>
                <button
                  type="button"
                  onClick={() => goToPly(selectedPly + 1)}
                  disabled={
                    !selectedGame || selectedPly >= selectedGame.moves.length
                  }
                  className="h-9 w-10 border border-stone-300 bg-white text-sm font-semibold disabled:opacity-40"
                  aria-label="Go forward one move"
                >
                  {">"}
                </button>
                <button
                  type="button"
                  onClick={() => goToPly(selectedGame?.moves.length ?? 0)}
                  disabled={
                    !selectedGame || selectedPly >= selectedGame.moves.length
                  }
                  className="h-9 w-10 border border-stone-300 bg-white text-sm font-semibold disabled:opacity-40"
                  aria-label="Go to final move"
                >
                  {">>"}
                </button>
              </div>
            </div>

            <div className="grid gap-5 p-4 xl:grid-cols-[minmax(320px,560px)_minmax(260px,1fr)]">
              <div className="mx-auto w-full max-w-xl">
                <ChessBoard position={selectedPosition} />
                <PositionStrip position={selectedPosition} />
              </div>

              <div className="min-w-0">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-700">
                    Moves
                  </h3>
                  <button
                    type="button"
                    onClick={() => setIsReportOpen((open) => !open)}
                    disabled={!selectedGame}
                    className="h-9 border border-stone-300 bg-stone-950 px-3 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    {isReportOpen ? "Hide Report" : "Report"}
                  </button>
                </div>

                <div className="max-h-[300px] overflow-auto border border-stone-200 bg-stone-50 p-2 xl:max-h-[480px]">
                  {selectedGame ? (
                    <MoveList
                      movePairs={movePairs}
                      selectedPly={selectedPly}
                      onSelectPly={goToPly}
                    />
                  ) : (
                    <EmptyState label="No moves loaded" />
                  )}
                </div>
              </div>
            </div>
          </section>

          <aside
            className={`border border-stone-300 bg-white ${
              isReportOpen ? "block" : "hidden lg:block"
            }`}
          >
            <div className="flex items-center justify-between border-b border-stone-300 px-4 py-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-700">
                Report
              </h2>
              <button
                type="button"
                onClick={() => setIsReportOpen(false)}
                className="h-8 w-8 border border-stone-300 bg-white text-sm font-semibold lg:hidden"
                aria-label="Close report"
              >
                x
              </button>
            </div>
            <ReportPanel game={selectedGame} engineMessage={upload?.engine.message} />
          </aside>
        </section>
      </div>
    </main>
  );
}

function ChessBoard({ position }: { position: Position | null }) {
  const lastMoveSquares = new Set(
    position?.lastMove
      ? [position.lastMove.from, position.lastMove.to]
      : [],
  );

  return (
    <div className="aspect-square w-full border border-stone-900 bg-stone-900">
      <div className="grid h-full w-full grid-cols-8 grid-rows-8">
        {ranks.flatMap((rank, rankIndex) =>
          files.map((fileName, fileIndex) => {
            const square = `${fileName}${rank}`;
            const piece = position?.board[square];
            const isDark = (rankIndex + fileIndex) % 2 === 1;
            const isLastMove = lastMoveSquares.has(square);

            return (
              <div
                key={square}
                className={`relative flex items-center justify-center ${
                  isDark ? "bg-[#779556]" : "bg-[#ebecd0]"
                } ${isLastMove ? "ring-4 ring-inset ring-amber-400" : ""}`}
                aria-label={square}
              >
                <span className="select-none text-[clamp(1.8rem,7vw,4.5rem)] leading-none text-stone-950 drop-shadow-sm">
                  {piece ? pieceGlyphs[piece] : ""}
                </span>
                <span className="absolute left-1 top-1 text-[10px] font-bold text-stone-800/70">
                  {fileIndex === 0 ? rank : ""}
                </span>
                <span className="absolute bottom-1 right-1 text-[10px] font-bold text-stone-800/70">
                  {rankIndex === 7 ? fileName : ""}
                </span>
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}

function PositionStrip({ position }: { position: Position | null }) {
  if (!position) {
    return (
      <div className="mt-3 grid grid-cols-3 border border-stone-300 bg-stone-50 text-center text-sm">
        <Metric label="Turn" value="-" />
        <Metric label="Material" value="0" />
        <Metric label="Status" value="Ready" />
      </div>
    );
  }

  return (
    <div className="mt-3 grid grid-cols-3 border border-stone-300 bg-stone-50 text-center text-sm">
      <Metric label="Turn" value={capitalize(position.turn)} />
      <Metric
        label="Material"
        value={position.materialBalance > 0 ? `+${position.materialBalance}` : `${position.materialBalance}`}
      />
      <Metric
        label="Status"
        value={
          position.isCheckmate ? "Mate" : position.isCheck ? "Check" : "Live"
        }
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-r border-stone-300 px-2 py-3 last:border-r-0">
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">
        {label}
      </div>
      <div className="mt-1 truncate font-semibold text-stone-950">{value}</div>
    </div>
  );
}

function MoveList({
  movePairs,
  selectedPly,
  onSelectPly,
}: {
  movePairs: Array<{ moveNumber: number; white: Move | null; black: Move | null }>;
  selectedPly: number;
  onSelectPly: (ply: number) => void;
}) {
  return (
    <div className="grid gap-1">
      {movePairs.map((pair) => (
        <div
          key={pair.moveNumber}
          className="grid grid-cols-[42px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-1 text-sm"
        >
          <div className="px-2 py-2 text-right font-semibold text-stone-500">
            {pair.moveNumber}.
          </div>
          <MoveButton
            move={pair.white}
            selectedPly={selectedPly}
            onSelectPly={onSelectPly}
          />
          <MoveButton
            move={pair.black}
            selectedPly={selectedPly}
            onSelectPly={onSelectPly}
          />
        </div>
      ))}
    </div>
  );
}

function MoveButton({
  move,
  selectedPly,
  onSelectPly,
}: {
  move: Move | null;
  selectedPly: number;
  onSelectPly: (ply: number) => void;
}) {
  if (!move) {
    return <div className="h-9" />;
  }

  return (
    <button
      type="button"
      onClick={() => onSelectPly(move.ply)}
      className={`h-9 min-w-0 truncate border px-2 text-left font-medium transition ${
        selectedPly === move.ply
          ? "border-emerald-800 bg-emerald-100 text-emerald-950"
          : "border-transparent bg-white text-stone-900 hover:border-stone-300"
      }`}
      title={move.opening ? `${move.opening.eco} ${move.opening.name}` : move.uci}
    >
      {move.san}
    </button>
  );
}

function ReportPanel({
  game,
  engineMessage,
}: {
  game: ParsedGame | null;
  engineMessage?: string;
}) {
  if (!game) {
    return <EmptyState label="No report loaded" />;
  }

  return (
    <div className="max-h-[360px] overflow-auto p-4 lg:max-h-[calc(100vh-210px)]">
      <div className="space-y-4">
        <section>
          <h3 className="text-sm font-semibold text-stone-950">Summary</h3>
          <ul className="mt-2 space-y-2">
            {game.report.summary.map((item) => (
              <li
                key={item}
                className="border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-800"
              >
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-stone-950">
            Struggle Points
          </h3>
          <div className="mt-2 space-y-2">
            {game.report.struggles.map((item) => (
              <article
                key={`${item.title}-${item.detail}`}
                className="border border-stone-200 bg-white px-3 py-3"
              >
                <h4 className="text-sm font-semibold text-stone-950">
                  {item.title}
                </h4>
                <p className="mt-1 text-sm leading-6 text-stone-700">
                  {item.detail}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-stone-950">Stockfish</h3>
          <p className="mt-2 border border-stone-200 bg-stone-50 px-3 py-2 text-sm leading-6 text-stone-700">
            {engineMessage ?? game.report.stockfish.message}
          </p>
        </section>
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex min-h-32 items-center justify-center px-4 py-8 text-center text-sm font-medium text-stone-500">
      {label}
    </div>
  );
}

function pairMoves(moves: Move[]) {
  const pairs: Array<{ moveNumber: number; white: Move | null; black: Move | null }> = [];

  for (let index = 0; index < moves.length; index += 2) {
    const white = moves[index] ?? null;
    const black = moves[index + 1] ?? null;
    pairs.push({
      moveNumber: white?.moveNumber ?? black?.moveNumber ?? index / 2 + 1,
      white,
      black,
    });
  }

  return pairs;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
