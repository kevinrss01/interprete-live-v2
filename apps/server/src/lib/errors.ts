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
      `${service} est momentanément saturé. Réessaie dans quelques instants.`,
      429,
    );
  if (response.status === 401 || response.status === 403)
    throw new AppError(
      "PROVIDER_ACCESS",
      `L’accès à ${service} n’est pas disponible. Vérifie la configuration du projet.`,
      503,
    );
  if (response.status === 402)
    throw new AppError(
      "PROVIDER_CREDITS",
      `Le crédit disponible sur ${service} est insuffisant.`,
      503,
    );
  throw new AppError(
    "PROVIDER_ERROR",
    `${service} n’a pas pu terminer la demande. Réessaie.`,
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
      error: "La demande n’a pas abouti. Réessaie dans quelques instants.",
      code: "UNEXPECTED",
    },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}
