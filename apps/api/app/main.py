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
from sqlalchemy import JSON, Column, DateTime, Integer, String, Text, create_engine, func
from sqlalchemy.orm import Session, declarative_base, sessionmaker


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


APP_VERSION = "analytics-library-2026-06-06"
Base = declarative_base()
SessionLocal: sessionmaker[Session] | None = None

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


class ImportedGame(Base):
    __tablename__ = "imported_games"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    filename = Column(String(255), nullable=False)
    title = Column(String(500), nullable=False)
    white = Column(String(255), nullable=True)
    black = Column(String(255), nullable=True)
    result = Column(String(20), nullable=True)
    opening_eco = Column(String(20), nullable=True)
    opening_name = Column(String(500), nullable=True)
    first_unbooked_ply = Column(Integer, nullable=True)
    move_count = Column(Integer, nullable=False, default=0)
    headers = Column(JSON, nullable=False)
    report = Column(JSON, nullable=False)
    pgn_text = Column(Text, nullable=True)


@app.get("/health")
def health():
    return {"status": "ok", "version": APP_VERSION}


@app.get("/analytics/summary")
def analytics_summary(player_name: str | None = None):
    return _analytics_summary(player_name)


@app.get("/engine/status")
def engine_status():
    try:
        stockfish_path = _find_stockfish_path()
        opening_count = len(_load_opening_book())
        return {
            "version": APP_VERSION,
            "stockfishAvailable": stockfish_path is not None,
            "stockfishPath": stockfish_path,
            "openingCount": opening_count,
        }
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Engine status failed: {type(error).__name__}: {error}",
        ) from error


@app.post("/games/upload")
async def upload_games(file: UploadFile = File(...)):
    filename = file.filename or "uploaded.pgn"
    if not filename.lower().endswith(".pgn"):
        raise HTTPException(status_code=400, detail="Please upload a .pgn file.")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="The uploaded PGN file is empty.")

    text = raw.decode("utf-8", errors="replace")
    try:
        games = _parse_pgn(text)
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"PGN parsing failed: {type(error).__name__}: {error}",
        ) from error
    if not games:
        raise HTTPException(status_code=400, detail="No chess games were found in that PGN.")

    library = _store_games(filename, text, games)

    return {
        "filename": filename,
        "gameCount": len(games),
        "games": games,
        "library": library,
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


def _store_games(filename: str, pgn_text: str, games: list[dict[str, Any]]) -> dict[str, Any]:
    session_factory = _get_session_factory()
    if session_factory is None:
        return {
            "saved": False,
            "message": "DATABASE_URL is not configured, so this upload was analyzed but not saved.",
        }

    try:
        session = session_factory()
        try:
            rows = [_imported_game_row(filename, pgn_text, game) for game in games]
            session.add_all(rows)
            session.commit()
            return {
                "saved": True,
                "message": f"Saved {len(rows)} game(s) to your analysis library.",
            }
        finally:
            session.close()
    except Exception as error:
        return {
            "saved": False,
            "message": f"Upload analyzed, but database save failed: {type(error).__name__}: {error}",
        }


def _imported_game_row(filename: str, pgn_text: str, game: dict[str, Any]) -> ImportedGame:
    opening = game.get("opening") or {}
    headers = game.get("headers") or {}
    moves = game.get("moves") or []

    return ImportedGame(
        filename=filename,
        title=game.get("title") or filename,
        white=headers.get("White"),
        black=headers.get("Black"),
        result=game.get("result"),
        opening_eco=opening.get("eco"),
        opening_name=opening.get("name"),
        first_unbooked_ply=game.get("firstUnbookedPly"),
        move_count=(len(moves) + 1) // 2,
        headers=headers,
        report=game.get("report") or {},
        pgn_text=pgn_text,
    )


def _analytics_summary(player_name: str | None = None) -> dict[str, Any]:
    session_factory = _get_session_factory()
    if session_factory is None:
        return {
            "databaseAvailable": False,
            "totalGames": 0,
            "message": "DATABASE_URL is not configured yet.",
            "advice": [
                "Connect Railway to your PostgreSQL DATABASE_URL so uploaded PGNs can be remembered across sessions."
            ],
            "openings": [],
            "struggles": [],
            "recentGames": [],
        }

    try:
        session = session_factory()
        try:
            rows = (
                session.query(ImportedGame)
                .order_by(ImportedGame.created_at.desc())
                .limit(500)
                .all()
            )
        finally:
            session.close()
    except Exception as error:
        return {
            "databaseAvailable": False,
            "totalGames": 0,
            "message": f"Could not read analytics database: {type(error).__name__}: {error}",
            "advice": ["Check the backend DATABASE_URL and redeploy Railway."],
            "openings": [],
            "struggles": [],
            "recentGames": [],
        }

    player = (player_name or "").strip().lower()
    opening_stats: dict[str, dict[str, Any]] = {}
    struggle_stats: dict[str, dict[str, Any]] = {}
    result_stats = {"wins": 0, "losses": 0, "draws": 0, "unknown": 0}

    for row in rows:
        opening_key = row.opening_name or "Unknown opening"
        opening_entry = opening_stats.setdefault(
            opening_key,
            {
                "name": opening_key,
                "eco": row.opening_eco,
                "games": 0,
                "wins": 0,
                "losses": 0,
                "draws": 0,
            },
        )
        opening_entry["games"] += 1

        result_bucket = _result_bucket(row, player)
        result_stats[result_bucket] += 1
        if result_bucket in {"wins", "losses", "draws"}:
            opening_entry[result_bucket] += 1

        report = row.report if isinstance(row.report, dict) else {}
        for struggle in report.get("struggles", []):
            title = struggle.get("title") or "General issue"
            entry = struggle_stats.setdefault(
                title,
                {
                    "title": title,
                    "count": 0,
                    "examples": [],
                },
            )
            entry["count"] += 1
            if len(entry["examples"]) < 3:
                entry["examples"].append(struggle.get("detail") or row.title)

    openings = sorted(
        opening_stats.values(),
        key=lambda item: (item["losses"], item["games"]),
        reverse=True,
    )[:8]
    struggles = sorted(
        struggle_stats.values(),
        key=lambda item: item["count"],
        reverse=True,
    )[:8]

    return {
        "databaseAvailable": True,
        "totalGames": len(rows),
        "message": "Your uploaded games are being remembered.",
        "playerName": player_name or "",
        "results": result_stats,
        "openings": openings,
        "struggles": struggles,
        "advice": _advice_from_summary(openings, struggles, result_stats),
        "recentGames": [
            {
                "title": row.title,
                "white": row.white,
                "black": row.black,
                "result": row.result,
                "opening": row.opening_name or "Unknown opening",
                "createdAt": row.created_at.isoformat() if row.created_at else None,
            }
            for row in rows[:10]
        ],
    }


def _result_bucket(row: ImportedGame, player: str) -> str:
    result = row.result or "*"
    if result == "1/2-1/2":
        return "draws"
    if result not in {"1-0", "0-1"}:
        return "unknown"

    if not player:
        return "wins" if result == "1-0" else "losses"

    white_name = (row.white or "").lower()
    black_name = (row.black or "").lower()
    if player in white_name:
        return "wins" if result == "1-0" else "losses"
    if player in black_name:
        return "wins" if result == "0-1" else "losses"
    return "unknown"


def _advice_from_summary(
    openings: list[dict[str, Any]],
    struggles: list[dict[str, Any]],
    results: dict[str, int],
) -> list[str]:
    advice: list[str] = []

    if not openings:
        return [
            "Upload a few PGNs first. Once there are enough games, this panel will show patterns instead of one-game guesses."
        ]

    top_struggle = struggles[0]["title"] if struggles else ""
    if top_struggle == "Opening memory":
        advice.append(
            "Your most repeated issue is leaving known opening lines early. Spend 10 minutes in Learn Openings memory mode before playing ranked games."
        )
    elif top_struggle == "Material swing":
        advice.append(
            "Material swings are showing up repeatedly. Before every forcing move, pause and ask what your opponent can capture next."
        )
    elif top_struggle == "King pressure":
        advice.append(
            "Your kings are coming under pressure often. Prioritize development, king safety, and pawn moves that do not open files near your own king."
        )
    elif top_struggle.startswith("Stockfish"):
        advice.append(
            "Engine mistakes are clustering in your games. Review the first two Stockfish-marked moments after each upload and replay the position twice."
        )

    worst_opening = openings[0]
    if worst_opening.get("losses", 0) > 0:
        advice.append(
            f"Your toughest repeated opening is {worst_opening['name']}. Build a short response file for the first 8-10 moves and drill it until it is automatic."
        )

    total_decisive = results.get("wins", 0) + results.get("losses", 0)
    if total_decisive and results.get("losses", 0) > results.get("wins", 0):
        advice.append(
            "Your saved sample has more losses than wins. Focus on one opening repair and one tactical habit instead of trying to fix everything at once."
        )

    return advice or [
        "Your saved games do not show one dominant weakness yet. Keep uploading PGNs after sessions so the trend report gets sharper."
    ]


@lru_cache(maxsize=1)
def _get_session_factory() -> sessionmaker[Session] | None:
    database_url = _database_url()
    if not database_url:
        return None

    engine = create_engine(database_url, pool_pre_ping=True)
    Base.metadata.create_all(bind=engine)
    return sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _database_url() -> str | None:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        return None
    if database_url.startswith("postgres://"):
        return database_url.replace("postgres://", "postgresql+psycopg://", 1)
    if database_url.startswith("postgresql://"):
        return database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    return database_url


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
        repo_root / "ChessCoach" / "tools" / "win" / "stockfish_13_win_x64_bmi2" / "stockfish_13_win_x64_bmi2.exe",
        repo_root / "ChessCoach" / "tools" / "deb" / "stockfish_13_linux_x64_bmi2" / "stockfish_13_linux_x64_bmi2",
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
        if (
            (parent / "chess-openings").exists()
            or (parent / "Stockfish").exists()
            or (parent / "ChessCoach").exists()
        ):
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
