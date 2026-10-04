import { describe, expect, it } from "vitest";
import { decision, facts } from "../../src/apis/candidate.js";
import { evidence } from "../../src/apis/evidence.js";
import { analysis } from "../../src/apis/result.js";
import { media, recent } from "../../src/apis/status.js";
import { completion, upload } from "../../src/apis/upload.js";

// 세션 식별자 시험용 11111111 1111 4111 8111 111111111111 준비
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
// 퍼센트 인코딩이 끊긴 세션 쿠키
const BROKEN = "replay_session=%E0%A4%A";
// 하루 유효 기간의 익명 세션 정책
const DAY = { ttlMs: 24 * 60 * 60 * 1000 };

// 손상된 세션 쿠키를 담은 요청 생성
const request = (init: RequestInit = {}): Request =>
    new Request("http://localhost/api", { ...init, headers: { cookie: BROKEN } });

// 세션 확인 전에 호출되면 안 되는 의존 기능
const never = async (): Promise<never> => {
    throw new Error("unexpected dependency call");
};

// 세션 조회 기능을 받아 각 경로를 호출하는 형식
type Call = (resolve: (value: string) => Promise<null>) => Promise<Response>;

describe("session routes", () => {
    it.each<[string, Call]>([
        [
            "media status",
            (resolve) =>
                media(request(), { videoAssetId: "video" }, { resolve, status: never, latest: never })
        ],
        ["recent upload", (resolve) => recent(request(), { resolve, status: never, latest: never })],
        [
            "analysis result",
            (resolve) => analysis(request(), { analysisId: "analysis" }, { resolve, report: never })
        ],
        [
            "evidence",
            (resolve) =>
                evidence(
                    request(),
                    { analysisId: "analysis", evidenceId: "evidence" },
                    { resolve, asset: never, body: never }
                )
        ],
        [
            "candidate facts",
            (resolve) =>
                facts(
                    request({ method: "POST", body: "{}" }),
                    { analysisId: "analysis", candidateId: "candidate" },
                    { resolve, facts: never, decision: never }
                )
        ],
        [
            "candidate decision",
            (resolve) =>
                decision(
                    request({ method: "POST" }),
                    { analysisId: "analysis", candidateId: "candidate" },
                    { resolve, facts: never, decision: never }
                )
        ],
        [
            "upload completion",
            (resolve) =>
                completion(
                    request({ method: "POST" }),
                    { intentId: "intent" },
                    { resolve, issue: never, upload: never, complete: never, session: DAY }
                )
        ]
    ])("answers %s with unauthorized for a corrupted session cookie", async (_name, call) => {
        // 세션 조회에 전달된 토큰 기록
        const seen: string[] = [];

        // 손상된 쿠키 요청 처리
        const response = await call(async (value) => {
            // 전달된 토큰 기록
            seen.push(value);
            // 세션 없음 반환
            return null;
        });

        // 예외 대신 인증 실패 응답 확인
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ kind: "UNAUTHORIZED" });
        // 손상된 값은 토큰 없음으로 조회 확인
        expect(seen).toEqual([""]);
    });

    it("issues a fresh session when an upload carries a corrupted session cookie", async () => {
        // 세션 조회에 전달된 토큰 기록
        const seen: string[] = [];

        // 손상된 쿠키를 가진 새 업로드 요청 처리
        const response = await upload(
            request({
                method: "POST",
                body: JSON.stringify({
                    expectedSizeBytes: 128,
                    declaredContentType: "video/mp4",
                    rightsConfirmed: true
                })
            }),
            {
                issue: async () => ({ sessionId: SESSION_ID, token: "fresh-token" }),
                resolve: async (value) => {
                    // 전달된 토큰 기록
                    seen.push(value);
                    // 세션 없음 반환
                    return null;
                },
                upload: async (input) => ({
                    kind: "CREATED",
                    uploadIntentId: input.anonymousSessionId,
                    objectKey: "uploads/session/object.upload",
                    uploadUrl: "http://minio.test/upload-token",
                    expiresAt: "2030-01-01T13:00:00.000Z"
                }),
                complete: never,
                session: DAY
            }
        );

        // 새 세션으로 업로드 허가 확인
        expect(response.status).toBe(201);
        expect(await response.json()).toMatchObject({ uploadIntentId: SESSION_ID });
        // 세션 정책의 유효 기간을 담은 새 세션 쿠키 발급 확인
        expect(response.headers.get("set-cookie")).toBe(
            "replay_session=fresh-token; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400"
        );
        // 손상된 값은 토큰 없음으로 조회 확인
        expect(seen).toEqual([""]);
    });
});
