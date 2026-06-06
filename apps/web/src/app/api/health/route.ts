import { NextResponse } from "next/server";

export const runtime = "nodejs";

function getApiUrl() {
  return (
    process.env.API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:8000"
  ).replace(/\/$/, "");
}

export async function GET() {
  const apiUrl = getApiUrl();

  try {
    const response = await fetch(`${apiUrl}/health`, {
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
        status: "error",
        detail: `Vercel could not reach the backend at ${apiUrl}. Error: ${message}`,
      },
      { status: 502 },
    );
  }
}
