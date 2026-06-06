import { NextResponse } from "next/server";

export const runtime = "nodejs";

function getApiUrl() {
  return (
    process.env.API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:8000"
  ).replace(/\/$/, "");
}

export async function POST(request: Request) {
  const apiUrl = getApiUrl();

  try {
    const incomingForm = await request.formData();
    const file = incomingForm.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { detail: "Choose a PGN file before uploading." },
        { status: 400 },
      );
    }

    const forwardedForm = new FormData();
    forwardedForm.append("file", file, file.name);

    const response = await fetch(`${apiUrl}/games/upload`, {
      method: "POST",
      body: forwardedForm,
    });

    const contentType = response.headers.get("content-type") ?? "application/json";
    const body = await response.text();

    return new Response(body, {
      status: response.status,
      headers: {
        "content-type": contentType,
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
