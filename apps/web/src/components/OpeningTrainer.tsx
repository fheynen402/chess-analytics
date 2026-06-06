"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { ChessBoard } from "@/components/ChessBoard";
import { boardAfterMoves } from "@/components/chessCore";
import { openingCourses, OpeningCourse, OpeningLine } from "@/components/openingTrainerData";

type Phase = "guided" | "memory";

export function OpeningTrainer() {
  const [courseId, setCourseId] = useState<OpeningCourse["id"]>("sicilian");
  const [lineIndex, setLineIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("guided");
  const [plyIndex, setPlyIndex] = useState(0);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const [message, setMessage] = useState("White will move first. Get ready to answer as Black.");
  const [showHint, setShowHint] = useState(false);

  const course = openingCourses.find((item) => item.id === courseId) ?? openingCourses[0];
  const line = course.lines[lineIndex] ?? course.lines[0];
  const playedMoves = line.moves.slice(0, plyIndex);
  const board = boardAfterMoves(playedMoves.map((move) => move.uci));
  const currentMove = line.moves[plyIndex] ?? null;
  const lastMove = playedMoves.at(-1)?.uci ?? null;
  const progress = Math.round((plyIndex / line.moves.length) * 100);
  const userMoveNumber = Math.floor(plyIndex / 2) + 1;
  const isLineComplete = plyIndex >= line.moves.length;
  const isUserTurn = currentMove?.side === "black";
  const hintSquares =
    isUserTurn && (phase === "guided" || showHint)
      ? [currentMove.uci.slice(0, 2), currentMove.uci.slice(2, 4)]
      : [];

  useEffect(() => {
    if (!currentMove || currentMove.side !== "white") {
      return;
    }

    const timeout = window.setTimeout(() => {
      setPlyIndex((value) => value + 1);
      setSelectedSquare(null);
      setShowHint(false);
      const answer = line.moves[plyIndex + 1];
      if (answer?.side === "black") {
        setMessage(
          phase === "guided"
            ? `Your move: ${answer.san}. ${answer.idea}`
            : "Your move. Recall the response without the guide.",
        );
      }
    }, 650);

    return () => window.clearTimeout(timeout);
  }, [currentMove, line.moves, phase, plyIndex]);

  function chooseCourse(nextCourseId: OpeningCourse["id"]) {
    setCourseId(nextCourseId);
    resetLine(0, "guided");
  }

  function resetLine(nextLineIndex = lineIndex, nextPhase: Phase = phase) {
    setLineIndex(nextLineIndex);
    setPhase(nextPhase);
    setPlyIndex(0);
    setSelectedSquare(null);
    setMistakes(0);
    setShowHint(false);
    setMessage("White will move first. Get ready to answer as Black.");
  }

  function handleSquareClick(square: string) {
    if (!currentMove || currentMove.side !== "black") {
      return;
    }

    const expectedFrom = currentMove.uci.slice(0, 2);
    const expectedTo = currentMove.uci.slice(2, 4);

    if (!selectedSquare) {
      setSelectedSquare(square);
      if (phase === "guided" && square !== expectedFrom) {
        setMessage(`Select the piece on ${expectedFrom}, then move it to ${expectedTo}.`);
      }
      return;
    }

    const attemptedMove = `${selectedSquare}${square}`;
    if (attemptedMove === currentMove.uci.slice(0, 4)) {
      setPlyIndex((value) => value + 1);
      setSelectedSquare(null);
      setShowHint(false);
      setMessage(
        phase === "guided"
          ? `Correct: ${currentMove.san}. ${currentMove.idea}`
          : "Correct. Keep the line in your head.",
      );
      return;
    }

    setMistakes((value) => value + 1);
    setSelectedSquare(null);
    setMessage(
      phase === "guided"
        ? `Not that one. The move is ${currentMove.san}: ${currentMove.idea}`
        : "Not quite. Try to remember the exact move from the guided pass.",
    );
  }

  return (
    <main className="min-h-screen bg-[#302e2b] text-[#f5f0df]">
      <div className="grid min-h-screen lg:grid-cols-[86px_minmax(560px,1fr)_460px]">
        <SideRail active="openings" />

        <section className="flex min-h-screen flex-col px-4 py-5 sm:px-6 lg:px-8">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-bold uppercase text-[#9acc5b]">Chess Analytics</p>
              <h1 className="text-3xl font-bold tracking-normal">Learn Openings</h1>
            </div>
            <div className="grid grid-cols-2 gap-2 rounded bg-[#262421] p-1">
              {openingCourses.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => chooseCourse(item.id)}
                  className={`px-4 py-2 text-sm font-bold transition ${
                    item.id === course.id
                      ? "bg-[#7fa650] text-white"
                      : "text-[#d6d1c7] hover:bg-[#3d3a35]"
                  }`}
                >
                  {item.shortName}
                </button>
              ))}
            </div>
          </div>

          <div className="grid flex-1 gap-5 xl:grid-cols-[minmax(420px,760px)_minmax(280px,360px)]">
            <div className="mx-auto flex w-full max-w-[760px] flex-col justify-center">
              <PlayerBar name="Opponent" clock="Auto" top />
              <ChessBoard
                board={board}
                lastMove={lastMove}
                selectedSquare={selectedSquare}
                hintSquares={hintSquares}
                onSquareClick={handleSquareClick}
              />
              <PlayerBar name="You play Black" clock={phase === "guided" ? "Coach" : "Memory"} />
            </div>

            <aside className="min-h-0 rounded bg-[#262421] shadow-xl shadow-black/20">
              <div className="border-b border-white/10 p-4">
                <p className="text-sm font-bold uppercase text-[#9acc5b]">{course.name}</p>
                <h2 className="mt-1 text-xl font-bold">{line.title}</h2>
                <p className="mt-2 text-sm leading-6 text-[#c9c4b8]">{line.goal}</p>
              </div>

              <div className="space-y-4 p-4">
                <ModeCard
                  phase={phase}
                  progress={progress}
                  mistakes={mistakes}
                  isLineComplete={isLineComplete}
                  onStartMemory={() => resetLine(lineIndex, "memory")}
                  onReset={() => resetLine(lineIndex, phase)}
                />

                <section className="rounded bg-[#312e2b] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-bold uppercase text-[#d6d1c7]">
                      Move Coach
                    </h3>
                    <span className="rounded bg-black/25 px-2 py-1 text-xs font-bold text-[#9acc5b]">
                      {isLineComplete ? "Done" : `Move ${userMoveNumber}`}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[#efe7d2]">{message}</p>
                  {isUserTurn && currentMove ? (
                    <div className="mt-4 rounded bg-[#403d39] p-3">
                      <p className="text-xs font-bold uppercase text-[#a5a096]">
                        {phase === "guided" ? "Recommended response" : "Memory challenge"}
                      </p>
                      <p className="mt-1 text-2xl font-bold">
                        {phase === "guided" ? currentMove.san : "Hidden"}
                      </p>
                      {phase === "guided" ? (
                        <p className="mt-2 text-sm leading-6 text-[#c9c4b8]">
                          {currentMove.idea}
                        </p>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setShowHint(true)}
                          className="mt-3 w-full bg-[#4b4843] px-3 py-2 text-sm font-bold hover:bg-[#5a554d]"
                        >
                          Show Hint
                        </button>
                      )}
                    </div>
                  ) : null}
                </section>

                <section className="rounded bg-[#312e2b] p-4">
                  <h3 className="text-sm font-bold uppercase text-[#d6d1c7]">
                    Opening Ideas
                  </h3>
                  <ul className="mt-3 space-y-2">
                    {course.plans.map((plan) => (
                      <li key={plan} className="text-sm leading-6 text-[#c9c4b8]">
                        <span className="mr-2 text-[#9acc5b]">+</span>
                        {plan}
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            </aside>
          </div>
        </section>

        <LessonPanel
          course={course}
          activeLine={line}
          activeIndex={lineIndex}
          phase={phase}
          plyIndex={plyIndex}
          onChooseLine={(index) => resetLine(index, "guided")}
        />
      </div>
    </main>
  );
}

function SideRail({ active }: { active: "review" | "openings" }) {
  return (
    <nav className="hidden min-h-screen flex-col items-center gap-3 bg-[#242321] px-3 py-5 lg:flex">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded bg-[#7fa650] text-xl font-black text-white">
        CA
      </div>
      <RailLink href="/upload" label="Review" active={active === "review"} icon="A" />
      <RailLink href="/learn-openings" label="Learn" active={active === "openings"} icon="L" />
    </nav>
  );
}

function RailLink({
  href,
  label,
  active,
  icon,
}: {
  href: string;
  label: string;
  active: boolean;
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

function PlayerBar({ name, clock, top = false }: { name: string; clock: string; top?: boolean }) {
  return (
    <div className={`flex items-center justify-between bg-[#403d39] px-3 py-2 ${top ? "rounded-t" : "rounded-b"}`}>
      <div className="flex items-center gap-2">
        <div className="h-9 w-9 rounded bg-[#d8d2c3]" />
        <div>
          <p className="text-sm font-bold text-white">{name}</p>
          <p className="text-xs text-[#b8b2a7]">Opening trainer</p>
        </div>
      </div>
      <div className="rounded bg-[#262421] px-4 py-2 text-lg font-bold text-[#efe7d2]">
        {clock}
      </div>
    </div>
  );
}

function ModeCard({
  phase,
  progress,
  mistakes,
  isLineComplete,
  onStartMemory,
  onReset,
}: {
  phase: Phase;
  progress: number;
  mistakes: number;
  isLineComplete: boolean;
  onStartMemory: () => void;
  onReset: () => void;
}) {
  return (
    <section className="rounded bg-[#312e2b] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase text-[#a5a096]">Mode</p>
          <h3 className="text-lg font-bold">
            {phase === "guided" ? "Guided rehearsal" : "Memory drill"}
          </h3>
        </div>
        <span className="rounded bg-black/25 px-2 py-1 text-xs font-bold text-[#efe7d2]">
          {mistakes} misses
        </span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded bg-black/30">
        <div className="h-full bg-[#7fa650]" style={{ width: `${progress}%` }} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onReset}
          className="bg-[#4b4843] px-3 py-2 text-sm font-bold hover:bg-[#5a554d]"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={onStartMemory}
          disabled={!isLineComplete && phase === "guided"}
          className="bg-[#7fa650] px-3 py-2 text-sm font-bold text-white hover:bg-[#8fba59] disabled:cursor-not-allowed disabled:bg-[#4b4843] disabled:text-[#918b82]"
        >
          Memory
        </button>
      </div>
    </section>
  );
}

function LessonPanel({
  course,
  activeLine,
  activeIndex,
  phase,
  plyIndex,
  onChooseLine,
}: {
  course: OpeningCourse;
  activeLine: OpeningLine;
  activeIndex: number;
  phase: Phase;
  plyIndex: number;
  onChooseLine: (index: number) => void;
}) {
  return (
    <aside className="min-h-screen bg-[#262421] text-[#d6d1c7]">
      <div className="border-b border-white/10 p-4">
        <div className="grid grid-cols-4 gap-1 text-center text-xs font-bold text-[#a5a096]">
          <span className="border-b-2 border-[#7fa650] pb-3 text-white">Openings</span>
          <span className="pb-3">Lines</span>
          <span className="pb-3">Coach</span>
          <span className="pb-3">Stats</span>
        </div>
      </div>

      <div className="max-h-[calc(100vh-76px)] overflow-auto p-4">
        <section className="rounded bg-[#312e2b] p-4">
          <p className="text-xs font-bold uppercase text-[#9acc5b]">{course.name}</p>
          <p className="mt-2 text-sm leading-6">{course.summary}</p>
        </section>

        <section className="mt-4">
          <h2 className="text-sm font-bold uppercase text-[#efe7d2]">
            Ten common lines
          </h2>
          <div className="mt-3 space-y-2">
            {course.lines.map((line, index) => (
              <button
                type="button"
                key={line.id}
                onClick={() => onChooseLine(index)}
                className={`w-full rounded p-3 text-left transition ${
                  index === activeIndex
                    ? "bg-[#435d32] text-white"
                    : "bg-[#312e2b] hover:bg-[#3a3733]"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-bold">
                    {index + 1}. {line.title}
                  </span>
                  <span className="shrink-0 rounded bg-black/25 px-2 py-1 text-[11px] font-bold">
                    {line.difficulty}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#c9c4b8]">
                  {line.goal}
                </p>
              </button>
            ))}
          </div>
        </section>

        <section className="mt-4 rounded bg-[#312e2b] p-4">
          <h2 className="text-sm font-bold uppercase text-[#efe7d2]">
            Current sequence
          </h2>
          <div className="mt-3 grid grid-cols-[34px_1fr_1fr] gap-1 text-sm">
            {activeLine.moves
              .filter((_, index) => index % 2 === 0)
              .map((whiteMove, index) => {
                const blackMove = activeLine.moves[index * 2 + 1];
                const whitePly = index * 2 + 1;
                const blackPly = index * 2 + 2;
                return (
                  <div className="contents" key={`${whiteMove.uci}-${blackMove?.uci}`}>
                    <div className="px-2 py-2 text-right font-bold text-[#a5a096]">
                      {index + 1}.
                    </div>
                    <MoveCell active={plyIndex === whitePly}>{whiteMove.san}</MoveCell>
                    <MoveCell active={plyIndex === blackPly}>
                      {phase === "memory" && plyIndex <= blackPly ? "--" : blackMove?.san}
                    </MoveCell>
                  </div>
                );
              })}
          </div>
        </section>
      </div>
    </aside>
  );
}

function MoveCell({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <div className={`px-2 py-2 font-bold ${active ? "bg-[#7fa650] text-white" : "bg-[#3a3733]"}`}>
      {children}
    </div>
  );
}
