export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function checkProvider(response: Response, service: string) {
  if (response.ok) return;
  if (response.status === 429)
    throw new AppError(
      "RATE_LIMIT",
      `${service} is temporarily overloaded. Try again in a moment.`,
      429,
    );
  if (response.status === 401 || response.status === 403)
    throw new AppError(
      "PROVIDER_ACCESS",
      `Access to ${service} is unavailable. Check the project configuration.`,
      503,
    );
  if (response.status === 402)
    throw new AppError(
      "PROVIDER_CREDITS",
      `There is not enough credit available on ${service}.`,
      503,
    );
  throw new AppError(
    "PROVIDER_ERROR",
    `${service} could not complete the request. Try again.`,
    502,
  );
}
export function errorResponse(error: unknown) {
  if (error instanceof AppError)
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  console.error(
    "Interpreter request failed",
    error instanceof Error ? error.name : "Unknown",
  );
  return Response.json(
    {
      error: "The request did not complete. Try again in a moment.",
      code: "UNEXPECTED",
    },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}
