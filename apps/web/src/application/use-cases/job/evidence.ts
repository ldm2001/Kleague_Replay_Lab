// 유효 기한 계산에 필요한 시계 계약 가져옴
import type { Clock } from "../../ports/clock/clock";
// 내용 동일성 확인에 필요한 해시 계약 가져옴
import type { Hasher } from "../../ports/hashing/hasher";
// 증거 자산 접근과 저장 계약 가져옴
import type { EvidenceAccess, EvidenceStore } from "../../ports/repositories/evidence-store";
// 증거 자산 접근과 저장 계약 가져옴
import type { EvidenceStorage } from "../../ports/storage/evidence-storage";

// 외부 식별자의 고유 식별자 형식 검사 패턴 생성
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// 경로 조작을 막는 증거 파일 이름 검사 패턴 생성
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
// 증거 업로드에서 허용하는 파일 형식 목록 정의
const TYPES = ["image/jpeg", "video/mp4", "application/gzip"] as const;
// 내용 해시의 소문자 16진수 형식 검사 패턴 생성
const SHA256 = /^[a-f0-9]{64}$/;
// 한 번에 발급할 증거 업로드 항목 수 제한
const MAX_ITEMS = 128;
// 증거 이미지와 영상의 개별 파일 크기 제한
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
// 비공개 압축 진단 파일의 크기 제한
const MAX_DIAGNOSTIC_BYTES = 128 * 1024 * 1024;
// 한 요청의 전체 업로드 바이트 합계 제한
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

// 증거 파일 입력
export type EvidenceItem = Readonly<{
    // 저장소 요청에서 사용하는 파일 이름
    name: string;
    // 파일의 실제 또는 허용 콘텐츠 형식
    contentType: (typeof TYPES)[number];
    // 파일의 바이트 크기
    sizeBytes: number;
    // 파일 내용의 동일성을 대조하는 해시
    contentSha256?: string;
}>;

// 증거 입력 계약 정의
export type EvidenceInput = Readonly<{
    // 처리 작업의 식별자
    jobId: string;
    // 작업을 수행하는 실행자의 식별자
    workerId: string;
    // 재실행 이전 요청을 구분하는 작업 판본
    jobRevision: number;
    // 현재 작업 임대를 증명하는 비밀 토큰
    leaseToken: string;
    // 한 요청에서 처리할 항목 목록
    items: readonly EvidenceItem[];
}>;

// 증거 결과 정의
export type EvidenceResult =
    | Readonly<{
          // 처리 분기 또는 자료 종류를 구별하는 값
          kind: "GRANTED";
          // 한 요청에서 처리할 항목 목록
          items: readonly Readonly<{
              // 저장소 요청에서 사용하는 파일 이름
              name: string;
              // 객체 저장소에서 파일을 찾는 경로
              objectKey: string;
              // 파일을 직접 전송할 기한부 서명 주소
              uploadUrl: string;
              // 자료 형식과 캐시 및 보안을 전달하는 응답 헤더
              headers?: Readonly<Record<string, string>>;
          }>[];
      }>
    | Exclude<EvidenceAccess, Readonly<{ kind: "AUTHORIZED"; analysisId: string }>>
    | Readonly<{ kind: "UNAVAILABLE" }>
    | Readonly<{
          // 처리 분기 또는 자료 종류를 구별하는 값
          kind: "INVALID_INPUT";
          // 입력 거부 또는 처리 보류 사유
          reason: "JOB" | "WORKER" | "REVISION" | "LEASE" | "ITEMS";
      }>;

// 증거 의존 기능 계약 정의
export type EvidenceDependencies = Readonly<{
    // 유효 기한 계산에 사용하는 시계
    clock: Clock;
    // 비밀 토큰과 파일의 내용 해시 계산 기능
    hasher: Hasher;
    // 기록을 조회하고 보존하는 저장소 기능
    repository: EvidenceStore;
    // 원본과 증거 파일을 다루는 저장소 기능
    storage: EvidenceStorage;
}>;

// 업로드할 증거의 개수·용량·파일 형식 확인
const validItems = (items: readonly EvidenceItem[]): boolean => {
    // 증거 항목 개수 확인
    if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) return false;
    // 전체 증거 용량 초기화
    let total = 0;
    // 비공개 압축 진단 파일 개수 초기화
    let gzip = 0;
    // 증거 항목별 형식과 크기 확인
    for (const item of items) {
        // 경로 조작을 막는 파일 이름과 허용 콘텐츠 형식 확인
        if (!NAME.test(item.name) || !TYPES.includes(item.contentType)) return false;
        // 증거 파일 크기가 양의 안전한 정수인지 확인
        if (!Number.isSafeInteger(item.sizeBytes) || item.sizeBytes <= 0) return false;
        // 비공개 압축 진단과 일반 증거 파일의 별도 제한 적용
        if (item.contentType === "application/gzip") {
            // 요청 안의 비공개 압축 진단 파일 개수 누적
            gzip += 1;
            // 진단 파일 한 개 제한과 크기 상한 및 필수 해시 확인
            if (
                gzip > 1 ||
                item.sizeBytes > MAX_DIAGNOSTIC_BYTES ||
                typeof item.contentSha256 !== "string" ||
                !SHA256.test(item.contentSha256)
            ) {
                // 허용 조건을 벗어난 비공개 진단 업로드 거부 반환
                return false;
            }
        } else if (
            item.sizeBytes > MAX_MEDIA_BYTES ||
            (item.contentSha256 !== undefined && !SHA256.test(item.contentSha256))
        ) {
            // 허용 조건을 벗어난 일반 증거 업로드 거부 반환
            return false;
        }
        // 요청 전체의 파일 크기 합계 누적
        total += item.sizeBytes;
    }
    // 전체 증거 용량 제한 확인
    return total <= MAX_TOTAL_BYTES;
};

// 증거 처리
export const evidence =
    ({ clock, hasher, repository, storage }: EvidenceDependencies) =>
    async (input: EvidenceInput): Promise<EvidenceResult> => {
        // 작업 입력 검증
        if (!UUID.test(input.jobId)) return { kind: "INVALID_INPUT", reason: "JOB" };
        // 작업자 식별자를 문자열로 한정하고 앞뒤 공백 제거
        const workerId = typeof input.workerId === "string" ? input.workerId.trim() : "";
        // 작업자 식별자의 빈 값과 길이 상한 확인
        if (!workerId || workerId.length > 128) return { kind: "INVALID_INPUT", reason: "WORKER" };
        // 작업 판본이 양의 안전한 정수인지 확인
        if (!Number.isSafeInteger(input.jobRevision) || input.jobRevision < 1) {
            // 잘못된 작업 판본 입력 오류 반환
            return { kind: "INVALID_INPUT", reason: "REVISION" };
        }
        // 임대 토큰의 문자열 형식과 빈 값 확인
        if (typeof input.leaseToken !== "string" || !input.leaseToken.trim()) {
            // 잘못된 임대 토큰 입력 오류 반환
            return { kind: "INVALID_INPUT", reason: "LEASE" };
        }
        // 파일 개수와 크기 및 형식을 통과하지 못한 증거 요청 거부
        if (!validItems(input.items)) return { kind: "INVALID_INPUT", reason: "ITEMS" };

        // 작업 임대 권한 확인
        const access = await repository.access({
            // 처리 작업의 식별자
            jobId: input.jobId.toLowerCase(),
            // 작업을 수행하는 실행자의 식별자
            workerId,
            // 재실행 이전 요청을 구분하는 작업 판본
            jobRevision: input.jobRevision,
            // 작업 임대 권한 비교용 토큰 해시
            leaseTokenHash: Uint8Array.from(await hasher.sha256(input.leaseToken)),
            // 유효 기한 판단에 사용하는 현재 시각
            now: clock.now().toISOString()
        });
        // 권한이 없으면 저장소 접근 차단
        if (access.kind !== "AUTHORIZED") return access;
        // 요청에 비공개 압축 진단 업로드가 포함되었는지 확인
        const diagnostic = input.items.some((item) => item.contentType === "application/gzip");
        // 비공개 진단 저장 기능이 없으면 권한 발급 중단
        if (diagnostic && !storage.perception) return { kind: "UNAVAILABLE" };
        // 증거 업로드 주소 병렬 발급
        const items = await Promise.all(
            input.items.map(async (item) => {
                // 비공개 압축 진단에는 별도의 고정 경로 권한 발급
                if (item.contentType === "application/gzip") {
                    // 작업 판본과 해시에 묶인 비공개 관측 업로드 권한 반환
                    return {
                        // 저장소 요청에서 사용하는 파일 이름
                        name: item.name,
                        ...(await storage.perception!({
                            // 분석 기록의 식별자
                            analysisId: access.analysisId,
                            // 처리 작업의 식별자
                            jobId: input.jobId.toLowerCase(),
                            // 재실행 이전 요청을 구분하는 작업 판본
                            jobRevision: input.jobRevision,
                            // 파일 내용의 동일성을 대조하는 해시
                            contentSha256: item.contentSha256!,
                            // 파일의 바이트 크기
                            sizeBytes: item.sizeBytes
                        }))
                    };
                }
                // 증거 파일의 이름과 업로드 권한 및 보호 조건 반환
                return {
                    // 저장소 요청에서 사용하는 파일 이름
                    name: item.name,
                    ...(await storage.evidence({
                        // 분석 기록의 식별자
                        analysisId: access.analysisId,
                        // 처리 작업의 식별자
                        jobId: input.jobId.toLowerCase(),
                        // 저장소 요청에서 사용하는 파일 이름
                        name: item.name,
                        // 파일의 실제 또는 허용 콘텐츠 형식
                        contentType: item.contentType,
                        // 파일의 바이트 크기
                        sizeBytes: item.sizeBytes,
                        ...(item.contentSha256 === undefined
                            ? {}
                            : { jobRevision: input.jobRevision, contentSha256: item.contentSha256 })
                    }))
                };
            })
        );
        // 증거 업로드 주소 반환
        return { kind: "GRANTED", items };
    };
