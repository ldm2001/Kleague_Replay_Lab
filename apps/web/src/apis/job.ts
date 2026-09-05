import { timingSafeEqual } from "node:crypto";
import type {
  ClaimInput,
  ClaimResult,
  JobProgress,
  JobStage,
  JobType,
  ProgressInput,
  ProgressResult,
  ResultInput,
  ResultResult,
  EvidenceInput,
  EvidenceResult,
} from "@replay/application";

export type JobApiDependencies = Readonly<{
  key: string;
  claim: (input: ClaimInput) => Promise<ClaimResult>;
  progress: (input: ProgressInput) => Promise<ProgressResult>;
  result: (input: ResultInput) => Promise<ResultResult>;
  evidence: (input: EvidenceInput) => Promise<EvidenceResult>;
}>;

// JSON 응답 생성
const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });

// Worker 인증 확인
const auth = (request: Request, key: string): boolean => {
  const value = request.headers.get("x-worker-key");
  if (!value || !key) return false;
  const left = Buffer.from(value, "utf8");
  const right = Buffer.from(key, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
};

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

// 작업 요청 변환
const payload = (value: Record<string, unknown>): ClaimInput | null => {
  // 작업 선점 필드 확인
  if (typeof value.workerId !== "string" || typeof value.jobType !== "string") {
    // 필수 필드가 없으면 입력 거부
    return null;
  }
  // 작업 선점 입력 반환
  return {
    workerId: value.workerId,
    jobType: value.jobType as JobType,
  };
};

// 진행 요청 변환
const progressInput = (value: Record<string, unknown>, jobId: string): ProgressInput | null => {
  if (
    typeof value.workerId !== "string" ||
    typeof value.jobRevision !== "number" ||
    typeof value.leaseToken !== "string" ||
    typeof value.stage !== "string" ||
    typeof value.progressPercent !== "number" ||
    (value.message !== undefined && typeof value.message !== "string")
  ) {
    // 진행 요청 형식 거부
    return null;
  }
  // 선택 메시지 정리
  const message = typeof value.message === "string" ? value.message : undefined;
  // 진행 입력 반환
  return {
    jobId,
    workerId: value.workerId,
    jobRevision: value.jobRevision,
    leaseToken: value.leaseToken,
    stage: value.stage as JobStage,
    progressPercent: value.progressPercent,
    ...(message === undefined ? {} : { message }),
  };
};

const resultInput = (value: Record<string, unknown>, jobId: string): ResultInput | null => {
  // 작업 결과 요청의 필수 필드 확인
  if (
    typeof value.workerId !== "string" ||
    typeof value.jobRevision !== "number" ||
    typeof value.leaseToken !== "string" ||
    typeof value.payload !== "object" ||
    value.payload === null ||
    Array.isArray(value.payload)
  ) {
    // 형식이 맞지 않는 요청 차단
    return null;
  }
  // 작업 결과 입력 구성
  return {
    jobId,
    workerId: value.workerId,
    jobRevision: value.jobRevision,
    leaseToken: value.leaseToken,
    payload: value.payload as ResultInput["payload"],
  };
};

const evidenceInput = (value: Record<string, unknown>, jobId: string): EvidenceInput | null => {
  // 증거 권한 요청의 공통 필드 확인
  if (
    typeof value.workerId !== "string" ||
    typeof value.jobRevision !== "number" ||
    typeof value.leaseToken !== "string" ||
    !Array.isArray(value.items)
  ) {
    // 형식이 맞지 않는 요청 차단
    return null;
  }
  // 증거 항목 배열 초기화
  const items: Array<EvidenceInput["items"][number]> = [];
  // 요청된 증거 항목 검증
  for (const item of value.items) {
    if (
      typeof item !== "object" || item === null || Array.isArray(item) ||
      typeof item.name !== "string" || typeof item.contentType !== "string" ||
      typeof item.sizeBytes !== "number"
    ) {
      // 잘못된 증거 항목 차단
      return null;
    }
    // 검증된 증거 항목 저장
    items.push({
      name: item.name,
      contentType: item.contentType as EvidenceInput["items"][number]["contentType"],
      sizeBytes: item.sizeBytes,
    });
  }
  // 증거 권한 입력 구성
  return {
    jobId,
    workerId: value.workerId,
    jobRevision: value.jobRevision,
    leaseToken: value.leaseToken,
    items,
  };
};

// 진행 상태 코드
const progressStatus = (result: JobProgress): number => {
  // 진행 처리 결과를 HTTP 상태로 변환
  switch (result.kind) {
    case "UPDATED": return 200;
    case "NOT_FOUND": return 404;
    case "STALE_LEASE": return 409;
  }
};

const resultStatus = (value: ResultResult): number => {
  // 작업 결과 처리 결과를 HTTP 상태로 변환
  switch (value.kind) {
    case "ACCEPTED": return 200;
    case "NOT_FOUND": return 404;
    case "STALE_LEASE": return 409;
    case "ALREADY_FINISHED": return 409;
    case "INVALID_INPUT": return 400;
  }
};

const evidenceStatus = (value: EvidenceResult): number => {
  // 증거 권한 처리 결과를 HTTP 상태로 변환
  switch (value.kind) {
    case "GRANTED": return 200;
    case "NOT_FOUND": return 404;
    case "STALE_LEASE": return 409;
    case "ALREADY_FINISHED": return 409;
    case "INVALID_INPUT": return 400;
  }
};

// 작업 선점 요청
export const claim = async (request: Request, dependencies: JobApiDependencies): Promise<Response> => {
  // Worker 인증 확인
  if (!auth(request, dependencies.key)) {
    // 인증 실패 응답
    return json({ kind: "UNAUTHORIZED" }, 401);
  }

  // 요청 본문 조회
  const value = await body(request);
  // 작업 요청 변환
  const input = value ? payload(value) : null;
  // 요청 형식 확인
  if (!input) {
    // 잘못된 요청 응답
    return json({ kind: "INVALID_REQUEST" }, 400);
  }

  // 작업 선점 유스케이스 호출
  const result = await dependencies.claim(input);
  // 입력 오류 응답
  if (result && "kind" in result && result.kind === "INVALID_INPUT") {
    return json(result, 400);
  }
  // 작업 없음 응답
  if (!result) {
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  }
  // 작업 선점 결과 응답
  return json(result, 200);
};

// 진행 상태 요청
export const progress = async (
  request: Request,
  params: Readonly<{ jobId: string }>,
  dependencies: JobApiDependencies,
): Promise<Response> => {
  // Worker 인증 확인
  if (!auth(request, dependencies.key)) {
    // 인증 실패 응답
    return json({ kind: "UNAUTHORIZED" }, 401);
  }
  // 요청 본문 조회
  const value = await body(request);
  // 진행 요청 변환
  const input = value ? progressInput(value, params.jobId) : null;
  // 요청 형식 확인
  if (!input) {
    // 잘못된 요청 응답
    return json({ kind: "INVALID_REQUEST" }, 400);
  }
  // 진행 유스케이스 호출
  const result = await dependencies.progress(input);
  // 입력 오류 응답
  if ("kind" in result && result.kind === "INVALID_INPUT") {
    return json(result, 400);
  }
  // 진행 결과 응답
  return json(result, progressStatus(result));
};

export const result = async (
  request: Request,
  params: Readonly<{ jobId: string }>,
  dependencies: JobApiDependencies,
): Promise<Response> => {
  // Worker 인증 확인
  if (!auth(request, dependencies.key)) {
    // 인증 실패 응답
    return json({ kind: "UNAUTHORIZED" }, 401);
  }
  // 요청 본문 조회
  const value = await body(request);
  // 작업 결과 입력 변환
  const input = value ? resultInput(value, params.jobId) : null;
  // 요청 형식 확인
  if (!input) {
    // 잘못된 요청 응답
    return json({ kind: "INVALID_REQUEST" }, 400);
  }
  // 작업 결과 유스케이스 호출
  const response = await dependencies.result(input);
  // 작업 결과 응답
  return json(response, resultStatus(response));
};

export const evidence = async (
  request: Request,
  params: Readonly<{ jobId: string }>,
  dependencies: JobApiDependencies,
): Promise<Response> => {
  // Worker 인증 확인
  if (!auth(request, dependencies.key)) {
    // 인증 실패 응답
    return json({ kind: "UNAUTHORIZED" }, 401);
  }
  // 요청 본문 조회
  const value = await body(request);
  // 증거 권한 입력 변환
  const input = value ? evidenceInput(value, params.jobId) : null;
  // 요청 형식 확인
  if (!input) return json({ kind: "INVALID_REQUEST" }, 400);
  // 증거 권한 유스케이스 호출
  const response = await dependencies.evidence(input);
  // 증거 권한 응답
  return json(response, evidenceStatus(response));
};
