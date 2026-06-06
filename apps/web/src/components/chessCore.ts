export type BoardMap = Record<string, string>;

export const boardRanks = [8, 7, 6, 5, 4, 3, 2, 1];
export const boardFiles = ["a", "b", "c", "d", "e", "f", "g", "h"];

export const pieceGlyphs: Record<string, string> = {
  K: "\u2654",
  Q: "\u2655",
  R: "\u2656",
  B: "\u2657",
  N: "\u2658",
  P: "\u2659",
  k: "\u265A",
  q: "\u265B",
  r: "\u265C",
  b: "\u265D",
  n: "\u265E",
  p: "\u265F",
};

export const initialBoard: BoardMap = {
  a1: "R",
  b1: "N",
  c1: "B",
  d1: "Q",
  e1: "K",
  f1: "B",
  g1: "N",
  h1: "R",
  a2: "P",
  b2: "P",
  c2: "P",
  d2: "P",
  e2: "P",
  f2: "P",
  g2: "P",
  h2: "P",
  a7: "p",
  b7: "p",
  c7: "p",
  d7: "p",
  e7: "p",
  f7: "p",
  g7: "p",
  h7: "p",
  a8: "r",
  b8: "n",
  c8: "b",
  d8: "q",
  e8: "k",
  f8: "b",
  g8: "n",
  h8: "r",
};

export function applyUciMove(board: BoardMap, uci: string): BoardMap {
  const nextBoard = { ...board };
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.slice(4, 5);
  const piece = nextBoard[from];

  if (!piece) {
    return nextBoard;
  }

  delete nextBoard[from];

  if (
    piece.toLowerCase() === "p" &&
    from[0] !== to[0] &&
    !nextBoard[to]
  ) {
    const capturedPawnSquare = `${to[0]}${from[1]}`;
    delete nextBoard[capturedPawnSquare];
  }

  if (piece === "K" && from === "e1" && to === "g1") {
    nextBoard.g1 = "K";
    nextBoard.f1 = "R";
    delete nextBoard.h1;
    return nextBoard;
  }

  if (piece === "K" && from === "e1" && to === "c1") {
    nextBoard.c1 = "K";
    nextBoard.d1 = "R";
    delete nextBoard.a1;
    return nextBoard;
  }

  if (piece === "k" && from === "e8" && to === "g8") {
    nextBoard.g8 = "k";
    nextBoard.f8 = "r";
    delete nextBoard.h8;
    return nextBoard;
  }

  if (piece === "k" && from === "e8" && to === "c8") {
    nextBoard.c8 = "k";
    nextBoard.d8 = "r";
    delete nextBoard.a8;
    return nextBoard;
  }

  if (promotion) {
    nextBoard[to] = piece === piece.toUpperCase() ? promotion.toUpperCase() : promotion;
  } else {
    nextBoard[to] = piece;
  }

  return nextBoard;
}

export function boardAfterMoves(moves: string[]) {
  return moves.reduce((board, move) => applyUciMove(board, move), initialBoard);
}

export function moveSquares(uci?: string | null) {
  if (!uci) {
    return new Set<string>();
  }

  return new Set([uci.slice(0, 2), uci.slice(2, 4)]);
}
