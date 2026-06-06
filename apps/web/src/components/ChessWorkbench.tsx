"use client";

import Link from "next/link";
import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ChessBoard } from "@/components/ChessBoard";
import { initialBoard } from "@/components/chessCore";

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
  library?: {
    saved: boolean;
    message: string;
  };
  engine: {
    stockfishAvailable: boolean;
    message: string;
  };
};

type AnalyticsSummary = {
  databaseAvailable: boolean;
  totalGames: number;
  message: string;
  playerName?: string;
  results?: {
    wins: number;
    losses: number;
    draws: number;
    unknown: number;
  };
  openings: Array<{
    name: string;
    eco?: string;
    games: number;
    wins: number;
    losses: number;
    draws: number;
  }>;
  struggles: Array<{
    title: string;
    count: number;
    examples: string[];
  }>;
  advice: string[];
  recentGames: Array<{
    title: string;
    white?: string;
    black?: string;
    result?: string;
    opening: string;
    createdAt?: string | null;
  }>;
};

export function ChessWorkbench() {
  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<UploadResponse | null>(null);
  const [selectedGameIndex, setSelectedGameIndex] = useState(0);
  const [selectedPly, setSelectedPly] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState(() =>
    typeof window === "undefined"
      ? ""
      : window.localStorage.getItem("chessAnalyticsPlayerName") ?? "",
  );
  const [perspective, setPerspective] = useState<"auto" | "white" | "black">(
    () => {
      if (typeof window === "undefined") {
        return "auto";
      }
      const savedPerspective = window.localStorage.getItem(
        "chessAnalyticsPerspective",
      );
      if (
        savedPerspective === "auto" ||
        savedPerspective === "white" ||
        savedPerspective === "black"
      ) {
        return savedPerspective;
      }
      return "auto";
    },
  );
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);

  const selectedGame = upload?.games[selectedGameIndex] ?? null;
  const selectedPosition = selectedGame?.positions[selectedPly] ?? null;
  const selectedOpening = selectedPosition?.opening ?? selectedGame?.opening ?? null;
  const boardOrientation = resolveBoardOrientation(
    selectedGame,
    playerName,
    perspective,
  );
  const topColor = boardOrientation === "white" ? "black" : "white";
  const bottomColor = boardOrientation;
  const movePairs = useMemo(
    () => pairMoves(selectedGame?.moves ?? []),
    [selectedGame],
  );

  const refreshAnalytics = useCallback(async (name: string) => {
    const params = new URLSearchParams();
    if (name.trim()) {
      params.set("player_name", name.trim());
    }

    try {
      const response = await fetch(`/api/analytics/summary?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as AnalyticsSummary;
      setAnalytics(payload);
    } catch {
      setAnalytics(null);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("chessAnalyticsPlayerName", playerName);
  }, [playerName]);

  useEffect(() => {
    window.localStorage.setItem("chessAnalyticsPerspective", perspective);
  }, [perspective]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refreshAnalytics(playerName);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [playerName, refreshAnalytics]);

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
      await refreshAnalytics(playerName);
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
    <main className="min-h-screen bg-[#302e2b] text-[#f5f0df]">
      <div className="grid min-h-screen lg:grid-cols-[86px_minmax(620px,1fr)_440px]">
        <ReviewRail />

        <section className="flex min-h-screen flex-col px-4 py-5 sm:px-6 lg:px-8">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-bold uppercase text-[#9acc5b]">
                Chess Analytics
              </p>
              <h1 className="text-3xl font-bold tracking-normal">Game Review</h1>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link
                href="/learn-openings"
                className="flex min-h-11 items-center justify-center bg-[#4b4843] px-4 text-sm font-bold text-[#efe7d2] hover:bg-[#5a554d] lg:hidden"
              >
                Learn Openings
              </Link>
              <UploadControls
                file={file}
                isUploading={isUploading}
                playerName={playerName}
                perspective={perspective}
                onFileChange={handleFileChange}
                onUpload={handleUpload}
                onPlayerNameChange={setPlayerName}
                onPerspectiveChange={setPerspective}
              />
            </div>
          </div>

          {error ? (
            <div className="mb-4 border border-[#d64b4b] bg-[#4a2928] px-4 py-3 text-sm font-bold text-[#ffd5d5]">
              {error}
            </div>
          ) : null}

          <div className="mx-auto flex w-full max-w-[820px] flex-1 flex-col justify-center">
            <PlayerBar
              name={playerNameForColor(selectedGame, topColor)}
              detail={selectedOpening?.name ?? "Upload a PGN to start"}
              clock={selectedGame ? "Review" : "--:--"}
              top
            />
            <ChessBoard
              board={selectedPosition?.board ?? initialBoard}
              lastMove={selectedPosition?.lastMove?.uci}
              orientation={boardOrientation}
            />
            <PlayerBar
              name={playerNameForColor(selectedGame, bottomColor)}
              detail={selectedGame?.result ?? "PGN analysis"}
              clock={selectedGame ? `${selectedPly}/${selectedGame.moves.length}` : "0/0"}
            />
          </div>
        </section>

        <AnalysisPanel
          upload={upload}
          analytics={analytics}
          selectedGame={selectedGame}
          selectedGameIndex={selectedGameIndex}
          selectedPly={selectedPly}
          selectedOpening={selectedOpening}
          movePairs={movePairs}
          onSelectGame={selectGame}
          onSelectPly={goToPly}
        />
      </div>
    </main>
  );
}

function ReviewRail() {
  return (
    <nav className="hidden min-h-screen flex-col items-center gap-3 bg-[#242321] px-3 py-5 lg:flex">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded bg-[#7fa650] text-xl font-black text-white">
        CA
      </div>
      <RailLink href="/upload" label="Review" active icon="A" />
      <RailLink href="/learn-openings" label="Learn" icon="L" />
    </nav>
  );
}

function RailLink({
  href,
  label,
  active = false,
  icon,
}: {
  href: string;
  label: string;
  active?: boolean;
  icon: string;
}) {
  return (
    <Link
      href={href}
      className={`flex w-full flex-col items-center gap-1 rounded px-2 py-3 text-xs font-bold transition ${
        active ? "bg-[#3f3d39] text-[#9acc5b]" : "text-[#b8b2a7] hover:bg-[#302e2b]"
      }`}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded bg-black/20 text-sm">
        {icon}
      </span>
      {label}
    </Link>
  );
}

function UploadControls({
  file,
  isUploading,
  playerName,
  perspective,
  onFileChange,
  onUpload,
  onPlayerNameChange,
  onPerspectiveChange,
}: {
  file: File | null;
  isUploading: boolean;
  playerName: string;
  perspective: "auto" | "white" | "black";
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onUpload: () => void;
  onPlayerNameChange: (name: string) => void;
  onPerspectiveChange: (perspective: "auto" | "white" | "black") => void;
}) {
  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto xl:flex-row">
      <input
        type="text"
        value={playerName}
        onChange={(event) => onPlayerNameChange(event.target.value)}
        placeholder="Your PGN name"
        className="min-h-11 bg-[#262421] px-3 text-sm font-bold text-[#efe7d2] outline-none ring-1 ring-white/10 placeholder:text-[#918b82] focus:ring-[#7fa650] sm:w-48"
      />
      <select
        value={perspective}
        onChange={(event) =>
          onPerspectiveChange(event.target.value as "auto" | "white" | "black")
        }
        className="min-h-11 bg-[#262421] px-3 text-sm font-bold text-[#efe7d2] outline-none ring-1 ring-white/10 focus:ring-[#7fa650]"
        aria-label="Board perspective"
      >
        <option value="auto">Auto color</option>
        <option value="white">White bottom</option>
        <option value="black">Black bottom</option>
      </select>
      <label className="flex min-h-11 w-full cursor-pointer items-center justify-center bg-[#262421] px-4 text-sm font-bold text-[#efe7d2] ring-1 ring-white/10 hover:bg-[#3a3733] sm:w-72">
        <input
          type="file"
          accept=".pgn"
          onChange={onFileChange}
          className="sr-only"
        />
        <span className="truncate">{file ? file.name : "Choose PGN"}</span>
      </label>
      <button
        type="button"
        onClick={onUpload}
        disabled={isUploading}
        className="min-h-11 bg-[#7fa650] px-6 text-sm font-bold text-white hover:bg-[#8fba59] disabled:cursor-not-allowed disabled:bg-[#4b4843] disabled:text-[#918b82]"
      >
        {isUploading ? "Analyzing" : "Upload"}
      </button>
    </div>
  );
}

function PlayerBar({
  name,
  detail,
  clock,
  top = false,
}: {
  name: string;
  detail: string;
  clock: string;
  top?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between bg-[#403d39] px-3 py-2 ${top ? "rounded-t" : "rounded-b"}`}>
      <div className="flex min-w-0 items-center gap-2">
        <div className="h-9 w-9 shrink-0 rounded bg-[#d8d2c3]" />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">{name}</p>
          <p className="truncate text-xs text-[#b8b2a7]">{detail}</p>
        </div>
      </div>
      <div className="rounded bg-[#262421] px-4 py-2 text-lg font-bold text-[#efe7d2]">
        {clock}
      </div>
    </div>
  );
}

function AnalysisPanel({
  upload,
  analytics,
  selectedGame,
  selectedGameIndex,
  selectedPly,
  selectedOpening,
  movePairs,
  onSelectGame,
  onSelectPly,
}: {
  upload: UploadResponse | null;
  analytics: AnalyticsSummary | null;
  selectedGame: ParsedGame | null;
  selectedGameIndex: number;
  selectedPly: number;
  selectedOpening: Opening | null;
  movePairs: Array<{ moveNumber: number; white: Move | null; black: Move | null }>;
  onSelectGame: (index: number) => void;
  onSelectPly: (ply: number) => void;
}) {
  return (
    <aside className="min-h-screen bg-[#262421] text-[#d6d1c7]">
      <div className="border-b border-white/10 p-4">
        <div className="grid grid-cols-4 gap-1 text-center text-xs font-bold text-[#a5a096]">
          <span className="border-b-2 border-[#7fa650] pb-3 text-white">Analysis</span>
          <Link href="/learn-openings" className="pb-3 hover:text-white">
            Openings
          </Link>
          <span className="pb-3">Games</span>
          <span className="pb-3">Report</span>
        </div>
      </div>

      <div className="max-h-[calc(100vh-76px)] overflow-auto p-4">
        <section className="rounded bg-[#312e2b] p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase text-[#9acc5b]">
                {selectedOpening?.eco ?? "PGN"}
              </p>
              <h2 className="truncate text-lg font-bold text-white">
                {selectedOpening?.name ?? "Upload a game"}
              </h2>
            </div>
            <span className="rounded bg-black/25 px-2 py-1 text-xs font-bold">
              Stockfish
            </span>
          </div>

          <div className="mt-4 grid grid-cols-5 gap-2">
            <ControlButton onClick={() => onSelectPly(0)} disabled={!selectedGame || selectedPly === 0}>
              {"|<"}
            </ControlButton>
            <ControlButton onClick={() => onSelectPly(selectedPly - 1)} disabled={!selectedGame || selectedPly === 0}>
              {"<"}
            </ControlButton>
            <div className="flex items-center justify-center bg-[#403d39] text-sm font-bold text-white">
              {selectedGame ? `${selectedPly}/${selectedGame.moves.length}` : "0/0"}
            </div>
            <ControlButton
              onClick={() => onSelectPly(selectedPly + 1)}
              disabled={!selectedGame || selectedPly >= selectedGame.moves.length}
            >
              {">"}
            </ControlButton>
            <ControlButton
              onClick={() => onSelectPly(selectedGame?.moves.length ?? 0)}
              disabled={!selectedGame || selectedPly >= (selectedGame?.moves.length ?? 0)}
            >
              {">|"}
            </ControlButton>
          </div>
        </section>

        <section className="mt-4 rounded bg-[#312e2b] p-4">
          <h3 className="text-sm font-bold uppercase text-[#efe7d2]">
            Saved Trends
          </h3>
          <AnalyticsPanel analytics={analytics} upload={upload} />
        </section>

        <section className="mt-4 rounded bg-[#312e2b] p-4">
          <h3 className="text-sm font-bold uppercase text-[#efe7d2]">Games</h3>
          <GameList
            upload={upload}
            selectedGameIndex={selectedGameIndex}
            onSelectGame={onSelectGame}
          />
        </section>

        <section className="mt-4 rounded bg-[#312e2b] p-4">
          <h3 className="text-sm font-bold uppercase text-[#efe7d2]">Moves</h3>
          <div className="mt-3 max-h-64 overflow-auto">
            {selectedGame ? (
              <MoveList
                movePairs={movePairs}
                selectedPly={selectedPly}
                onSelectPly={onSelectPly}
              />
            ) : (
              <EmptyState label="No moves loaded" />
            )}
          </div>
        </section>

        <ReportPanel game={selectedGame} engineMessage={upload?.engine.message} />
      </div>
    </aside>
  );
}

function AnalyticsPanel({
  analytics,
  upload,
}: {
  analytics: AnalyticsSummary | null;
  upload: UploadResponse | null;
}) {
  if (!analytics) {
    return <EmptyState label="Trend data is loading" />;
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="rounded bg-[#3a3733] p-3">
        <p className="text-sm font-bold text-white">
          {analytics.totalGames} saved game{analytics.totalGames === 1 ? "" : "s"}
        </p>
        <p className="mt-1 text-xs leading-5 text-[#c9c4b8]">
          {upload?.library?.message ?? analytics.message}
        </p>
      </div>

      {analytics.results ? (
        <div className="grid grid-cols-3 gap-2 text-center">
          <TrendStat label="Wins" value={analytics.results.wins} />
          <TrendStat label="Losses" value={analytics.results.losses} />
          <TrendStat label="Draws" value={analytics.results.draws} />
        </div>
      ) : null}

      {analytics.openings.length ? (
        <div>
          <p className="mb-2 text-xs font-bold uppercase text-[#a5a096]">
            Tough openings
          </p>
          <div className="space-y-2">
            {analytics.openings.slice(0, 3).map((opening) => (
              <div key={opening.name} className="rounded bg-[#3a3733] p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-bold text-white">
                    {opening.eco ? `${opening.eco} ` : ""}
                    {opening.name}
                  </p>
                  <span className="shrink-0 text-xs font-bold text-[#ffb86b]">
                    {opening.losses} losses
                  </span>
                </div>
                <p className="mt-1 text-xs text-[#c9c4b8]">
                  {opening.games} games saved in this line
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {analytics.struggles.length ? (
        <div>
          <p className="mb-2 text-xs font-bold uppercase text-[#a5a096]">
            Repeated issues
          </p>
          <div className="space-y-2">
            {analytics.struggles.slice(0, 3).map((struggle) => (
              <div key={struggle.title} className="rounded bg-[#3a3733] p-3">
                <p className="text-sm font-bold text-white">
                  {struggle.title} ({struggle.count})
                </p>
                <p className="mt-1 text-xs leading-5 text-[#c9c4b8]">
                  {struggle.examples[0]}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <p className="mb-2 text-xs font-bold uppercase text-[#a5a096]">
          Coach advice
        </p>
        <ul className="space-y-2">
          {analytics.advice.map((item) => (
            <li key={item} className="rounded bg-[#435d32] p-3 text-sm leading-6 text-white">
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function TrendStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded bg-[#3a3733] px-2 py-3">
      <p className="text-lg font-bold text-white">{value}</p>
      <p className="text-xs font-bold uppercase text-[#a5a096]">{label}</p>
    </div>
  );
}

function ControlButton({
  children,
  disabled,
  onClick,
}: {
  children: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-10 bg-[#403d39] text-sm font-bold text-white hover:bg-[#4b4843] disabled:cursor-not-allowed disabled:text-[#77716a]"
    >
      {children}
    </button>
  );
}

function GameList({
  upload,
  selectedGameIndex,
  onSelectGame,
}: {
  upload: UploadResponse | null;
  selectedGameIndex: number;
  onSelectGame: (index: number) => void;
}) {
  if (!upload) {
    return <EmptyState label="No games loaded" />;
  }

  return (
    <div className="mt-3 space-y-2">
      {upload.games.map((game, index) => (
        <button
          type="button"
          key={game.id}
          onClick={() => onSelectGame(index)}
          className={`w-full rounded p-3 text-left transition ${
            selectedGameIndex === index
              ? "bg-[#435d32] text-white"
              : "bg-[#3a3733] hover:bg-[#4b4843]"
          }`}
        >
          <span className="block truncate text-sm font-bold">{game.title}</span>
          <span className="mt-1 block truncate text-xs text-[#c9c4b8]">
            {game.opening ? `${game.opening.eco} ${game.opening.name}` : "Opening unknown"}
          </span>
        </button>
      ))}
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
          <div className="px-2 py-2 text-right font-bold text-[#a5a096]">
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
      className={`h-9 min-w-0 truncate px-2 text-left font-bold transition ${
        selectedPly === move.ply
          ? "bg-[#7fa650] text-white"
          : "bg-[#3a3733] text-[#efe7d2] hover:bg-[#4b4843]"
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
    return (
      <section className="mt-4 rounded bg-[#312e2b] p-4">
        <h3 className="text-sm font-bold uppercase text-[#efe7d2]">Report</h3>
        <EmptyState label="No report loaded" />
      </section>
    );
  }

  return (
    <section className="mt-4 rounded bg-[#312e2b] p-4">
      <h3 className="text-sm font-bold uppercase text-[#efe7d2]">Game Report</h3>
      <div className="mt-3 space-y-3">
        {game.report.summary.map((item) => (
          <div key={item} className="rounded bg-[#3a3733] px-3 py-2 text-sm text-[#efe7d2]">
            {item}
          </div>
        ))}

        {game.report.struggles.map((item) => (
          <article key={`${item.title}-${item.detail}`} className="rounded bg-[#3a3733] p-3">
            <h4 className="text-sm font-bold text-white">{item.title}</h4>
            <p className="mt-1 text-sm leading-6 text-[#c9c4b8]">{item.detail}</p>
          </article>
        ))}

        <article className="rounded bg-[#3a3733] p-3">
          <h4 className="text-sm font-bold text-white">Stockfish</h4>
          <p className="mt-1 text-sm leading-6 text-[#c9c4b8]">
            {engineMessage ?? game.report.stockfish.message}
          </p>
        </article>
      </div>
    </section>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex min-h-24 items-center justify-center px-4 py-6 text-center text-sm font-bold text-[#918b82]">
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

function resolveBoardOrientation(
  game: ParsedGame | null,
  playerName: string,
  perspective: "auto" | "white" | "black",
): "white" | "black" {
  if (perspective === "white" || perspective === "black") {
    return perspective;
  }

  const normalizedName = playerName.trim().toLowerCase();
  if (!game || !normalizedName) {
    return "white";
  }

  const whiteName = (game.headers.White ?? "").toLowerCase();
  const blackName = (game.headers.Black ?? "").toLowerCase();

  if (blackName.includes(normalizedName)) {
    return "black";
  }

  if (whiteName.includes(normalizedName)) {
    return "white";
  }

  return "white";
}

function playerNameForColor(game: ParsedGame | null, color: "white" | "black") {
  if (!game) {
    return color === "white" ? "White" : "Black";
  }

  return color === "white"
    ? game.headers.White ?? "White"
    : game.headers.Black ?? "Black";
}
