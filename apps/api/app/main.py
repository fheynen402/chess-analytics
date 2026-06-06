import csv
import os
from dataclasses import dataclass
from functools import lru_cache
from io import StringIO
from pathlib import Path
from typing import Any

import chess
import chess.engine
import chess.pgn
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware


app = FastAPI(title="Chess Analytics API")


def _allowed_origins() -> list[str]:
    raw_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000")
    origins = [origin.strip() for origin in raw_origins.split(",") if origin.strip()]
    return origins or ["http://localhost:3000"]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


PIECE_VALUES = {
    chess.PAWN: 1,
    chess.KNIGHT: 3,
    chess.BISHOP: 3,
    chess.ROOK: 5,
    chess.QUEEN: 9,
    chess.KING: 0,
}


@dataclass(frozen=True)
class Opening:
    eco: str
    name: str
    pgn: str
    plies: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "eco": self.eco,
            "name": self.name,
            "pgn": self.pgn,
            "plies": self.plies,
        }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/engine/status")
def engine_status():
    stockfish_path = _find_stockfish_path()
    return {
        "stockfishAvailable": stockfish_path is not None,
        "stockfishPath": stockfish_path,
        "openingCount": len(_load_opening_book()),
    }


@app.post("/games/upload")
async def upload_games(file: UploadFile = File(...)):
    filename = file.filename or "uploaded.pgn"
    if not filename.lower().endswith(".pgn"):
        raise HTTPException(status_code=400, detail="Please upload a .pgn file.")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="The uploaded PGN file is empty.")

    text = raw.decode("utf-8", errors="replace")
    games = _parse_pgn(text)
    if not games:
        raise HTTPException(status_code=400, detail="No chess games were found in that PGN.")

    return {
        "filename": filename,
        "gameCount": len(games),
        "games": games,
        "engine": {
            "stockfishAvailable": _find_stockfish_path() is not None,
            "message": _stockfish_message(),
        },
    }


def _parse_pgn(text: str) -> list[dict[str, Any]]:
    stream = StringIO(text)
    games: list[dict[str, Any]] = []

    while True:
        game = chess.pgn.read_game(stream)
        if game is None:
            break
        games.append(_game_to_payload(game, len(games) + 1))

    return games


def _game_to_payload(game: chess.pgn.Game, game_number: int) -> dict[str, Any]:
    board = game.board()
    headers = dict(game.headers)
    moves: list[dict[str, Any]] = []
    positions = [_position_payload(board, 0, None)]
    matched_opening: Opening | None = None
    first_unbooked_ply: int | None = None
    check_counts = {"white": 0, "black": 0}
    material_balances = [material_balance(board)]

    for ply, move in enumerate(game.mainline_moves(), start=1):
        mover = "white" if board.turn == chess.WHITE else "black"
        san = board.san(move)
        from_square = chess.square_name(move.from_square)
        to_square = chess.square_name(move.to_square)
        board.push(move)

        opening = _load_opening_book().get(board.epd())
        if opening:
            matched_opening = opening
        elif matched_opening and first_unbooked_ply is None:
            first_unbooked_ply = ply

        if board.is_check():
            checked_side = "white" if board.turn == chess.WHITE else "black"
            check_counts[checked_side] += 1

        move_payload = {
            "ply": ply,
            "moveNumber": (ply + 1) // 2,
            "side": mover,
            "san": san,
            "uci": move.uci(),
            "from": from_square,
            "to": to_square,
            "promotion": chess.piece_symbol(move.promotion) if move.promotion else None,
            "opening": opening.to_dict() if opening else None,
        }
        moves.append(move_payload)
        positions.append(_position_payload(board, ply, move_payload, opening))
        material_balances.append(material_balance(board))

    if matched_opening and first_unbooked_ply is None and len(moves) > matched_opening.plies:
        first_unbooked_ply = matched_opening.plies + 1

    engine_insights = _stockfish_insights(positions, moves)
    report = _game_report(
        headers=headers,
        moves=moves,
        matched_opening=matched_opening,
        first_unbooked_ply=first_unbooked_ply,
        material_balances=material_balances,
        check_counts=check_counts,
        engine_insights=engine_insights,
    )

    return {
        "id": f"game-{game_number}",
        "number": game_number,
        "title": _game_title(headers, game_number),
        "headers": headers,
        "result": headers.get("Result", "*"),
        "opening": matched_opening.to_dict() if matched_opening else None,
        "firstUnbookedPly": first_unbooked_ply,
        "moves": moves,
        "positions": positions,
        "report": report,
    }


def _position_payload(
    board: chess.Board,
    ply: int,
    last_move: dict[str, Any] | None,
    opening: Opening | None = None,
) -> dict[str, Any]:
    return {
        "ply": ply,
        "fen": board.fen(),
        "turn": "white" if board.turn == chess.WHITE else "black",
        "board": {
            chess.square_name(square): piece.symbol()
            for square in chess.SQUARES
            if (piece := board.piece_at(square)) is not None
        },
        "lastMove": last_move,
        "isCheck": board.is_check(),
        "isCheckmate": board.is_checkmate(),
        "opening": opening.to_dict() if opening else None,
        "materialBalance": material_balance(board),
    }


@lru_cache(maxsize=1)
def _load_opening_book() -> dict[str, Opening]:
    opening_book: dict[str, Opening] = {}
    for opening_file in _opening_files():
        with opening_file.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle, delimiter="\t")
            for row in reader:
                opening = _opening_from_row(row)
                if opening is None:
                    continue
                board = chess.Board()
                parsed_game = chess.pgn.read_game(StringIO(opening.pgn))
                if parsed_game is None:
                    continue
                try:
                    for move in parsed_game.mainline_moves():
                        board.push(move)
                except ValueError:
                    continue
                epd = board.epd()
                existing = opening_book.get(epd)
                if existing is None or opening.plies >= existing.plies:
                    opening_book[epd] = opening
    return opening_book


def _opening_files() -> list[Path]:
    app_dir = Path(__file__).resolve().parent
    candidates = [
        app_dir / "data" / "openings",
        _repo_root() / "chess-openings",
    ]
    for candidate in candidates:
        if candidate.exists():
            files = sorted(candidate.glob("*.tsv"))
            if files:
                return files
    return []


def _opening_from_row(row: dict[str, str]) -> Opening | None:
    eco = (row.get("eco") or "").strip()
    name = (row.get("name") or "").strip()
    pgn = (row.get("pgn") or "").strip()
    if not eco or not name or not pgn:
        return None

    plies = 0
    parsed_game = chess.pgn.read_game(StringIO(pgn))
    if parsed_game is not None:
        plies = sum(1 for _ in parsed_game.mainline_moves())

    return Opening(eco=eco, name=name, pgn=pgn, plies=plies)


def _game_title(headers: dict[str, str], game_number: int) -> str:
    white = headers.get("White", "White")
    black = headers.get("Black", "Black")
    result = headers.get("Result", "*")
    return f"{game_number}. {white} vs {black} ({result})"


def material_balance(board: chess.Board) -> int:
    white_total = 0
    black_total = 0
    for piece_type, value in PIECE_VALUES.items():
        white_total += len(board.pieces(piece_type, chess.WHITE)) * value
        black_total += len(board.pieces(piece_type, chess.BLACK)) * value
    return white_total - black_total


def _game_report(
    headers: dict[str, str],
    moves: list[dict[str, Any]],
    matched_opening: Opening | None,
    first_unbooked_ply: int | None,
    material_balances: list[int],
    check_counts: dict[str, int],
    engine_insights: list[dict[str, Any]],
) -> dict[str, Any]:
    result = headers.get("Result", "*")
    opening_text = (
        f"{matched_opening.eco} {matched_opening.name}"
        if matched_opening
        else "No named opening found"
    )
    summary = [
        f"Result: {result}",
        f"Opening: {opening_text}",
        f"Moves: {(len(moves) + 1) // 2}",
    ]

    struggles: list[dict[str, str]] = []
    if matched_opening:
        if first_unbooked_ply:
            move_label = _ply_label(first_unbooked_ply)
            struggles.append(
                {
                    "title": "Opening memory",
                    "detail": (
                        f"The game followed {matched_opening.name} through "
                        f"{matched_opening.plies} plies, then left the book around {move_label}."
                    ),
                }
            )
        else:
            struggles.append(
                {
                    "title": "Opening phase",
                    "detail": f"The game stayed inside the known {matched_opening.name} line.",
                }
            )
    else:
        struggles.append(
            {
                "title": "Opening recognition",
                "detail": "The moves did not match a named line in the opening database.",
            }
        )

    material_issue = _largest_material_drop(material_balances, moves)
    if material_issue:
        struggles.append(material_issue)

    if check_counts["white"] or check_counts["black"]:
        struggles.append(
            {
                "title": "King pressure",
                "detail": (
                    f"White was checked {check_counts['white']} times and "
                    f"Black was checked {check_counts['black']} times."
                ),
            }
        )

    if engine_insights:
        struggles.extend(
            {
                "title": insight["label"],
                "detail": insight["detail"],
            }
            for insight in engine_insights[:3]
        )

    return {
        "summary": summary,
        "struggles": struggles,
        "stockfish": {
            "available": _find_stockfish_path() is not None,
            "message": _stockfish_message(),
            "insights": engine_insights,
        },
    }


def _largest_material_drop(
    material_balances: list[int],
    moves: list[dict[str, Any]],
) -> dict[str, str] | None:
    biggest_drop = 0
    biggest_move: dict[str, Any] | None = None

    for index in range(1, len(material_balances)):
        move = moves[index - 1]
        before = material_balances[index - 1]
        after = material_balances[index]
        drop = before - after if move["side"] == "white" else after - before
        if drop > biggest_drop:
            biggest_drop = drop
            biggest_move = move

    if biggest_move is None or biggest_drop < 2:
        return None

    return {
        "title": "Material swing",
        "detail": (
            f"The largest material drop was about {biggest_drop} points after "
            f"{_move_label(biggest_move)} {biggest_move['san']}."
        ),
    }


def _stockfish_insights(
    positions: list[dict[str, Any]],
    moves: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    stockfish_path = _find_stockfish_path()
    if stockfish_path is None or not moves:
        return []

    max_positions = int(os.getenv("STOCKFISH_MAX_POSITIONS", "32"))
    depth = int(os.getenv("STOCKFISH_DEPTH", "10"))
    limited_positions = positions[: max_positions + 1]
    evaluations: list[int | None] = []

    try:
        with chess.engine.SimpleEngine.popen_uci(stockfish_path) as engine:
            for position in limited_positions:
                board = chess.Board(position["fen"])
                info = engine.analyse(board, chess.engine.Limit(depth=depth))
                score = info["score"].white().score(mate_score=100000)
                evaluations.append(score)
    except Exception:
        return []

    insights: list[dict[str, Any]] = []
    for index in range(1, len(evaluations)):
        before = evaluations[index - 1]
        after = evaluations[index]
        if before is None or after is None:
            continue
        move = moves[index - 1]
        centipawn_drop = before - after if move["side"] == "white" else after - before
        if centipawn_drop < 80:
            continue
        if centipawn_drop >= 300:
            label = "Stockfish blunder"
        elif centipawn_drop >= 150:
            label = "Stockfish mistake"
        else:
            label = "Stockfish inaccuracy"
        insights.append(
            {
                "label": label,
                "ply": move["ply"],
                "centipawnDrop": centipawn_drop,
                "detail": (
                    f"{_move_label(move)} {move['san']} changed the engine evaluation "
                    f"by about {centipawn_drop} centipawns."
                ),
            }
        )

    insights.sort(key=lambda item: item.get("centipawnDrop", 0), reverse=True)
    return insights[:5]


@lru_cache(maxsize=1)
def _find_stockfish_path() -> str | None:
    env_path = os.getenv("STOCKFISH_PATH")
    if env_path and Path(env_path).exists():
        return env_path

    repo_root = _repo_root()
    candidates = [
        Path("/usr/games/stockfish"),
        Path("/usr/bin/stockfish"),
        repo_root / "Stockfish" / "src" / "stockfish.exe",
        repo_root / "Stockfish" / "src" / "stockfish",
        repo_root / "Stockfish" / "stockfish.exe",
        repo_root / "Stockfish" / "stockfish",
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return None


def _repo_root() -> Path:
    current = Path(__file__).resolve()
    for parent in current.parents:
        if (parent / "chess-openings").exists() or (parent / "Stockfish").exists():
            return parent
        if (parent / "apps" / "api").exists():
            return parent
    return current.parent


def _stockfish_message() -> str:
    stockfish_path = _find_stockfish_path()
    if stockfish_path:
        return f"Stockfish is configured at {stockfish_path}."
    return "Stockfish source is present, but no executable engine path is configured yet."


def _move_label(move: dict[str, Any]) -> str:
    suffix = "." if move["side"] == "white" else "..."
    return f"{move['moveNumber']}{suffix}"


def _ply_label(ply: int) -> str:
    move_number = (ply + 1) // 2
    suffix = "." if ply % 2 == 1 else "..."
    return f"{move_number}{suffix}"
