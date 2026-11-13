export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const notFound = (what = "Resource") => new ApiError(404, "not_found", `${what} not found`);
export const badRequest = (msg: string, details?: unknown) => new ApiError(400, "bad_request", msg, details);
export const conflict = (msg: string, details?: unknown) => new ApiError(409, "conflict", msg, details);
export const forbidden = (msg: string, details?: unknown) => new ApiError(403, "forbidden", msg, details);
export const notConfigured = (integration: string, how: string) =>
  new ApiError(409, "integration_not_configured", `${integration} is not configured. ${how}`, { integration });
