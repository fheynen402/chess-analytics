import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getApiUrl() {
  return (
    process.env.API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:8000"
  ).replace(/\/$/, "");
}

export async function GET(request: Request) {
  const apiUrl = getApiUrl();
  const url = new URL(request.url);
  const playerName = url.searchParams.get("player_name") ?? "";
  const backendUrl = new URL(`${apiUrl}/analytics/summary`);
  if (playerName) {
    backendUrl.searchParams.set("player_name", playerName);
  }

  try {
    const response = await fetch(backendUrl, {
      cache: "no-store",
    });
    const body = await response.text();

    return new Response(body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    return NextResponse.json(
      {
        databaseAvailable: false,
        totalGames: 0,
        message: `Vercel could not reach analytics at ${apiUrl}. Error: ${message}`,
        advice: ["Check API_URL in Vercel and make sure Railway is running."],
        openings: [],
        struggles: [],
        recentGames: [],
      },
      { status: 502 },
    );
  }
}
