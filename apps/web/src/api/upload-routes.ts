import type {
  CompleteUploadInput,
  CompleteUploadResult,
  CreateUploadInput,
  CreateUploadResult,
  SessionGrant,
  SessionRecord,
} from "@replay/application";

export type UploadApiDependencies = Readonly<{
  issue: () => Promise<SessionGrant>;
  resolve: (token: string) => Promise<SessionRecord | null>;
  upload: (input: CreateUploadInput) => Promise<CreateUploadResult>;
  complete: (input: CompleteUploadInput) => Promise<CompleteUploadResult>;
}>;

const COOKIE = "replay_session";
const COOKIE_MAX_AGE = 24 * 60 * 60;

const json = (body: unknown, status: number, headers?: Record<string, string>): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });

const cookie = (request: Request): string | null => {
  const value = request.headers.get("cookie");
  if (!value) return null;
  for (const item of value.split(";")) {
    const [name, ...parts] = item.trim().split("=");
    if (name === COOKIE) return decodeURIComponent(parts.join("="));
  }
  return null;
};

const sessionCookie = (token: string): string =>
  `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`;

const body = async (request: Request): Promise<Record<string, unknown> | null> => {
  try {
    const value: unknown = await request.json();
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
};

const uploadInput = (value: Record<string, unknown>): Omit<CreateUploadInput, "anonymousSessionId"> | null => {
  if (
    typeof value.expectedSizeBytes !== "number" ||
    !Number.isSafeInteger(value.expectedSizeBytes) ||
    typeof value.declaredContentType !== "string" ||
    typeof value.rightsConfirmed !== "boolean"
  ) {
    return null;
  }
  return {
    expectedSizeBytes: value.expectedSizeBytes,
    declaredContentType: value.declaredContentType,
    rightsConfirmed: value.rightsConfirmed,
  };
};

const uploadStatus = (result: CreateUploadResult): number => {
  switch (result.kind) {
    case "CREATED": return 201;
    case "SESSION_UNAVAILABLE": return 401;
    default: return 400;
  }
};

const completeStatus = (result: CompleteUploadResult): number => {
  switch (result.kind) {
    case "COMPLETED": return 202;
    case "UPLOAD_NOT_FOUND": return 404;
    case "UPLOAD_ALREADY_COMPLETED": return 409;
    case "UPLOAD_NOT_READY": return 409;
    case "UPLOAD_INVALID": return 422;
    default: return 400;
  }
};

export const uploadApi = async (
  request: Request,
  dependencies: UploadApiDependencies,
): Promise<Response> => {
  const value = await body(request);
  const input = value ? uploadInput(value) : null;
  if (!input) {
    return json({ kind: "INVALID_REQUEST" }, 400);
  }

  let record = await dependencies.resolve(cookie(request) ?? "");
  let issued: SessionGrant | null = null;
  if (!record) {
    issued = await dependencies.issue();
    record = issued;
  }

  const result = await dependencies.upload({ ...input, anonymousSessionId: record.sessionId });
  return json(result, uploadStatus(result), issued ? { "set-cookie": sessionCookie(issued.token) } : undefined);
};

export const completeApi = async (
  request: Request,
  params: Readonly<{ intentId: string }>,
  dependencies: UploadApiDependencies,
): Promise<Response> => {
  const record = await dependencies.resolve(cookie(request) ?? "");
  if (!record) {
    return json({ kind: "UNAUTHORIZED" }, 401);
  }

  const result = await dependencies.complete({
    anonymousSessionId: record.sessionId,
    uploadIntentId: params.intentId,
  });
  return json(result, completeStatus(result));
};

export const postUpload = uploadApi;
export const postComplete = completeApi;
