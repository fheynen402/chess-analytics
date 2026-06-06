import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UploadedFileLike = {
  name?: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
  type?: string;
};

function getApiUrl() {
  return (
    process.env.API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:8000"
  ).replace(/\/$/, "");
}

function isUploadedFileLike(value: unknown): value is UploadedFileLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    typeof value.arrayBuffer === "function"
  );
}

export async function POST(request: Request) {
  const apiUrl = getApiUrl();

  try {
    const incomingForm = await request.formData();
    const file = incomingForm.get("file");

    if (!isUploadedFileLike(file)) {
      return NextResponse.json(
        { detail: "Choose a PGN file before uploading." },
        { status: 400 },
      );
    }

    const filename = file.name || "uploaded-game.pgn";
    const contentType = file.type || "application/x-chess-pgn";
    const bytes = await file.arrayBuffer();
    const forwardedForm = new FormData();
    forwardedForm.append("file", new Blob([bytes], { type: contentType }), filename);

    const response = await fetch(`${apiUrl}/games/upload`, {
      method: "POST",
      body: forwardedForm,
    });

    const responseContentType =
      response.headers.get("content-type") ?? "application/json";
    const body = await response.text();

    return new Response(body, {
      status: response.status,
      headers: {
        "content-type": responseContentType,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    return NextResponse.json(
      {
        detail: `Vercel could not reach the backend at ${apiUrl}. Check API_URL or NEXT_PUBLIC_API_URL in Vercel and make sure Railway is redeployed. Error: ${message}`,
      },
      { status: 502 },
    );
  }
}
