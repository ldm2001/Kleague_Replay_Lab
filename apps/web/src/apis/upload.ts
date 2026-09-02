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

// JSON 응답 생성
const json = (body: unknown, status: number, headers?: Record<string, string>): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });

// 세션 쿠키 조회
const cookie = (request: Request): string | null => {
  const value = request.headers.get("cookie");
  if (!value) return null;
  for (const item of value.split(";")) {
    const [name, ...parts] = item.trim().split("=");
    if (name === COOKIE) return decodeURIComponent(parts.join("="));
  }
  return null;
};

// 세션 쿠키 헤더 생성
const headerCookie = (token: string): string =>
  `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`;

// 요청 본문 읽기
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

// 업로드 입력 변환
const payload = (value: Record<string, unknown>): Omit<CreateUploadInput, "anonymousSessionId"> | null => {
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

// 업로드 상태 코드
const uploadCode = (result: CreateUploadResult): number => {
  switch (result.kind) {
    case "CREATED": return 201;
    case "SESSION_UNAVAILABLE": return 401;
    default: return 400;
  }
};

// 완료 상태 코드
const completionCode = (result: CompleteUploadResult): number => {
  switch (result.kind) {
    case "COMPLETED": return 202;
    case "UPLOAD_NOT_FOUND": return 404;
    case "UPLOAD_ALREADY_COMPLETED": return 409;
    case "UPLOAD_NOT_READY": return 409;
    case "UPLOAD_INVALID": return 422;
    default: return 400;
  }
};

// 업로드 요청
export const upload = async (
  request: Request,
  dependencies: UploadApiDependencies,
): Promise<Response> => {
  // 요청 본문 조회
  const value = await body(request);
  // 입력 자료 변환
  const input = value ? payload(value) : null;
  // 입력 검증
  if (!input) {
    // 잘못된 요청 응답
    return json({ kind: "INVALID_REQUEST" }, 400);
  }

  // 기존 세션 조회
  let record = await dependencies.resolve(cookie(request) ?? "");
  // 새 세션 기본값
  let issued: SessionGrant | null = null;
  // 세션 존재 확인
  if (!record) {
    // 익명 세션 발급
    issued = await dependencies.issue();
    // 발급 세션 적용
    record = issued;
  }

  // 업로드 유스케이스 호출
  const result = await dependencies.upload({ ...input, anonymousSessionId: record.sessionId });
  // 업로드 결과 응답
  return json(result, uploadCode(result), issued ? { "set-cookie": headerCookie(issued.token) } : undefined);
};

// 업로드 완료 요청
export const completion = async (
  request: Request,
  params: Readonly<{ intentId: string }>,
  dependencies: UploadApiDependencies,
): Promise<Response> => {
  // 세션 쿠키 확인
  const record = await dependencies.resolve(cookie(request) ?? "");
  // 세션 권한 확인
  if (!record) {
    // 인증 실패 응답
    return json({ kind: "UNAUTHORIZED" }, 401);
  }

  // 완료 유스케이스 호출
  const result = await dependencies.complete({
    anonymousSessionId: record.sessionId,
    uploadIntentId: params.intentId,
  });
  // 완료 결과 응답
  return json(result, completionCode(result));
};
