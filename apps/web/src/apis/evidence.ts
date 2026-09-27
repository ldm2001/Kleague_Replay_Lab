// 분석 처리 유스케이스와 저장소 계약 및 구간 불충족 오류 가져옴
import {
    RangeNotSatisfiableError,
    type AssetInput,
    type AssetResult,
    type EvidenceBody,
    type SessionRecord
} from "@replay/application";

// 증거 요청 처리 의존 기능 계약 정의
export type EvidenceApiDependencies = Readonly<{
    // 접근 토큰에서 세션 기록을 찾는 기능
    resolve: (token: string) => Promise<SessionRecord | null>;
    // 소유권에 맞는 증거 자산 조회 기능
    asset: (input: AssetInput) => Promise<AssetResult>;
    // 요청 바이트 구간이 있으면 해당 구간만 읽는 자료 본문
    body: (objectKey: string, range?: string) => Promise<EvidenceBody>;
}>;

// 시작과 끝 또는 끝에서부터 길이로 표현한 단일 바이트 구간 형식
const RANGE = /^bytes=(?:(\d{1,15})-(\d{0,15})|-(\d{1,15}))$/;

// 세션 쿠키 추출
const token = (request: Request): string | null => {
    // 요청 쿠키 헤더 조회
    const value = request.headers.get("cookie");
    // 쿠키가 없으면 빈 결과 반환
    if (!value) return null;
    // 세션 쿠키 항목 탐색
    for (const item of value.split(";")) {
        // 쿠키 이름과 값 분리
        const [name, ...parts] = item.trim().split("=");
        // 세션 토큰 반환
        if (name === "replay_session") return decodeURIComponent(parts.join("="));
    }
    // 세션 토큰 없음 반환
    return null;
};

// 저장소에 전달할 단일 바이트 구간 추출
const range = (request: Request): string | undefined => {
    // 검증 값을 비교할 수 없는 조건부 구간 요청은 전체 본문으로 응답
    if (request.headers.has("if-range")) return undefined;
    // 단일 구간 형식 해석
    const match = RANGE.exec(request.headers.get("range")?.trim() ?? "");
    // 다중 구간과 다른 단위 및 형식 오류는 무시
    if (!match) return undefined;
    // 시작과 끝 및 끝에서부터 길이 분리
    const [, start, end, suffix] = match;
    // 길이 0 접미 구간 무시
    if (suffix !== undefined) return Number(suffix) > 0 ? `bytes=-${suffix}` : undefined;
    // 끝이 시작보다 앞선 구간 무시
    if (end && Number(end) < Number(start)) return undefined;
    // 정규화한 시작과 끝 구간 반환
    return `bytes=${start}-${end}`;
};

// 오류 응답 생성
const error = (kind: string, status: number): Response =>
    new Response(JSON.stringify({ kind }), {
        // 처리 상태 또는 요청 응답 상태
        status,
        // 자료 형식과 캐시 및 보안을 전달하는 응답 헤더
        headers: {
            // 다른 요청에 비공개 결과가 재사용되지 않도록 하는 캐시 정책
            "cache-control": "private, no-store",
            // 응답 본문의 자료 형식
            "content-type": "application/json; charset=utf-8",
        },
    });

// 증거 스트림 생성
const stream = (body: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> => {
    // 비동기 본문 반복자 생성
    const iterator = body[Symbol.asyncIterator]();
    // 스트림 변환 객체 반환
    return new ReadableStream<Uint8Array>({
        // 미디어 스트림의 다음 청크 전달
        async pull(controller) {
            // 다음 본문 청크 조회
            const next = await iterator.next();
            // 마지막 청크면 스트림 종료
            if (next.done) controller.close();
            // 본문 청크 전송
            else controller.enqueue(next.value);
        },

        // 미디어 전송 취소와 자원 정리
        async cancel() {
            // 요청 취소 시 반복자 종료
            await iterator.return?.();
        },
    });
};

// 증거 처리
export const evidence = async (
    request: Request,
    params: Readonly<{ analysisId: string; evidenceId: string }>,
    dependencies: EvidenceApiDependencies,
): Promise<Response> => {
    // 세션 쿠키로 익명 세션 조회
    const record = await dependencies.resolve(token(request) ?? "");
    // 세션이 없으면 증거 조회 차단
    if (!record) return error("UNAUTHORIZED", 401);
    // 증거 접근 권한 조회
    const asset = await dependencies.asset({
        // 업로드 소유자를 구별하는 익명 세션 식별자
        anonymousSessionId: record.sessionId,
        // 분석 기록의 식별자
        analysisId: params.analysisId,
        // 저장된 증거 자산의 식별자
        evidenceId: params.evidenceId,
    });
    // 권한 오류 응답
    if (asset && "kind" in asset) return error(asset.kind, 400);
    // 증거 없음 응답
    if (!asset) return error("NOT_FOUND", 404);
    // 요청한 단일 바이트 구간
    const requested = range(request);
    // 요청 구간을 반영한 저장소 증거 본문
    let object: EvidenceBody;
    try {
        // 저장소 증거 본문 조회
        object = await dependencies.body(asset.objectKey, requested);
    } catch (failure) {
        // 객체 크기 밖 구간 요청 응답
        if (failure instanceof RangeNotSatisfiableError) return error("RANGE_NOT_SATISFIABLE", 416);
        // 저장소 오류 전달
        throw failure;
    }
    // 저장소가 실제로 적용한 부분 전송 구간
    const partial = requested ? object.contentRange : undefined;
    // 증거 스트림 응답
    return new Response(stream(object.body), {
        // 부분 전송 또는 전체 전송 응답 상태
        status: partial ? 206 : 200,
        // 자료 형식과 캐시 및 보안을 전달하는 응답 헤더
        headers: {
            // 영상 탐색에 필요한 바이트 구간 요청 지원 표시
            "accept-ranges": "bytes",
            // 다른 요청에 비공개 결과가 재사용되지 않도록 하는 캐시 정책
            "cache-control": "private, no-store",
            // 증거 파일을 브라우저에 표시하는 방식
            "content-disposition": "inline",
            // 저장소가 알려준 전송 본문 길이
            ...(object.sizeBytes === undefined ? {} : { "content-length": String(object.sizeBytes) }),
            // 부분 전송의 바이트 구간과 전체 길이
            ...(partial ? { "content-range": partial } : {}),
            // 응답 본문의 자료 형식
            "content-type": asset.contentType,
            // 브라우저의 임의 콘텐츠 형식 추측 방지
            "x-content-type-options": "nosniff",
        },
    });
};
