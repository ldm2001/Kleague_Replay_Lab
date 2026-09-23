"use client";

// 화면 구성에 필요한 기능과 공유 자료 형식 읽음
import { useEffect, useRef, useState } from "react";
import * as React from "react";
import type { MediaView } from "@replay/application";

// 업로드 단계 값
type Phase =
    | "idle"
    | "selected"
    | "uploading"
    | "completing"
    | "validating"
    | "analyzing"
    | "candidateReady"
    | "completed"
    | "error";
// 부모 화면에 분석 결과를 알리는 입력 형식 정의
type UploadPanelProps = Readonly<{ onView?: (view: MediaView | null) => void }>;
// 선택 영상 파일과 미리보기 주소 묶음 정의
type Selection = Readonly<{ file: File; url: string }>;

// 단계별 안내 문구
const message: Record<Phase, string> = {
    // 파일 선택 대기 상태의 안내 문구 연결
    idle: "영상 파일을 선택해 주세요",
    // 선택 영상 확인 상태의 안내 문구 연결
    selected: "선택한 영상을 확인해 주세요",
    // 영상 전송 상태의 안내 문구 연결
    uploading: "영상 업로드 중",
    // 업로드 완료 확인 상태의 안내 문구 연결
    completing: "업로드 확인 중",
    // 서버 영상 검증 상태의 안내 문구 연결
    validating: "영상 검증 중",
    // 후보 분석 상태의 안내 문구 연결
    analyzing: "후보 장면 분석 중",
    // 기초 후보 탐색 완료 상태의 안내 문구 연결
    candidateReady: "기초 장면 탐색 완료",
    // 전체 분석 완료 상태의 안내 문구 연결
    completed: "분석 완료",
    // 업로드 실패 시 재시도 안내 문구 연결
    error: "업로드를 다시 시도해 주세요",
};

// 크기 처리
const size = (bytes: number): string => {
    // 바이트 단위 파일 크기 표시
    if (bytes < 1024) return `${bytes} B`;
    // 메가바이트보다 작은 파일 크기를 킬로바이트로 반환
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    // 큰 파일 크기를 소수점 한 자리 메가바이트 문구로 반환
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// 객체 저장소 파일 전송
const transfer = (
    url: string,
    file: File,
    progress: (value: number) => void,
    attach: (request: XMLHttpRequest) => void,
): Promise<void> => new Promise((resolve, reject) => {
    // 업로드 요청 생성
    const request = new XMLHttpRequest();
    // 요청 외부 참조 연결
    attach(request);
    // 저장소 업로드 주소 설정
    request.open("PUT", url);
    // 파일 미디어 타입 설정
    request.setRequestHeader("Content-Type", file.type);
    // 업로드 진행률 전달
    request.upload.onprogress = (event) => {
        // 총 전송량이 알려져 진행률을 계산할 수 있는지 확인
        if (event.lengthComputable && event.total > 0) {
            // 전송 바이트 비율을 백분율로 바꾸고 최대 백으로 제한
            progress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
        }
    };
    // 업로드 응답 처리
    request.onload = () => {
        // 성공 응답은 전송 약속을 완료하고 나머지는 실패로 전환
        if (request.status >= 200 && request.status < 300) resolve();
        else reject(new Error("upload-failed"));
    };
    // 업로드 오류 처리
    request.onerror = () => reject(new Error("upload-failed"));
    // 업로드 취소 처리
    request.onabort = () => reject(new Error("upload-aborted"));
    // 파일 전송 시작
    request.send(file);
});

// 요청 경로 응답 본문 확인
const body = async (response: Response): Promise<Record<string, unknown>> => {
    // 직렬화 자료 응답 파싱
    const value: unknown = await response.json();
    // 응답 본문이 배열이나 빈 값이 아닌 객체인지 확인
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        // 서버 응답의 실패를 오류 경로로 전달
        throw new Error("invalid-response");
    }
    // 형식을 확인한 응답 객체 반환
    return value as Record<string, unknown>;
};

// 업로드 상태와 진행률 화면
export function UploadPanel({ onView }: UploadPanelProps = {}) {
    // 사용자 입력은 파일 선택으로 제한하고 대회·시즌·분석 조건은 서버 정책으로 처리
    // 파일 입력 참조
    const input = useRef<HTMLInputElement>(null);
    // 현재 전송 참조
    const request = useRef<XMLHttpRequest | null>(null);
    // 영상 미리보기 참조
    const preview = useRef<string | null>(null);
    // 전송 진행률 참조
    const progress = useRef(0);
    // 진행률 타이머 참조
    const timer = useRef<ReturnType<typeof globalThis.setInterval> | null>(null);
    // 상태 조회 타이머 참조
    const poll = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
    // 상태 응답 서명
    const snapshot = useRef("");
    // 컴포넌트 활성 상태
    const alive = useRef(true);
    // 업로드 단계 상태
    const [phase, setPhase] = useState<Phase>("idle");
    // 화면 진행률 상태
    const [value, setValue] = useState(0);
    // 분석 결과 상태
    const [view, setView] = useState<MediaView | null>(null);
    // 선택 영상 상태
    const [selection, setSelection] = useState<Selection | null>(null);
    // 파일 선택 오류 안내
    const [notice, noticeState] = useState("");

    // 진행률 갱신 중지
    const timerEnd = () => {
        // 타이머 존재 확인
        if (timer.current !== null) {
            // 타이머 제거
            globalThis.clearInterval(timer.current);
            // 타이머 참조 초기화
            timer.current = null;
        }
    };

    // 진행률 갱신 시작
    const timerStart = () => {
        // 기존 타이머 제거
        timerEnd();
        // 진행률 타이머 생성
        timer.current = globalThis.setInterval(() => {
            // 진행률 상태 갱신
            setValue((current) => {
                // 현재 전송률 조회
                const next = progress.current;
                // 동일 값 갱신 생략
                return current === next ? current : next;
            });
        }, 120);
    };

    // 상태 조회 중지
    const pollEnd = () => {
        // 상태 조회 예약 취소
        if (poll.current !== null) {
            // 예약된 서버 상태 조회 취소
            globalThis.clearTimeout(poll.current);
            // 상태 조회 예약이 없음을 참조에 기록
            poll.current = null;
        }
    };

    // 컴포넌트 종료 정리
    useEffect(() => {
        // 컴포넌트 활성 상태 설정
        alive.current = true;
        // 화면 종료 시 실행할 자원 정리 함수 반환
        return () => {
            // 화면 종료 후 비동기 응답의 상태 갱신 차단
            alive.current = false;
            // 화면 진행률 갱신 타이머 정리
            timerEnd();
            // 이전 영상의 상태 조회 예약 정리
            pollEnd();
            // 진행 중인 영상 전송이 있으면 중단
            request.current?.abort();
            // 남아 있는 미리보기 주소의 브라우저 자원 해제
            if (preview.current) URL.revokeObjectURL(preview.current);
        };
    }, []);

    // 부모 알림 함수나 분석 결과가 바뀔 때 상태 전달 효과 연결
    useEffect(() => {
        // 부모 화면에 분석 상태 전달
        onView?.(view);
    }, [onView, view]);

    // 분석 상태 조회
    const polling = async (videoAssetId: string): Promise<void> => {
        // 업로드 뒤에는 서버가 갱신하는 파이프라인 상태만 읽고 별도 분석 설정을 수신 제외
        // 영상 상태 조회
        try {
            // 상태 요청 경로 호출
            const response = await fetch(`/api/uploads/${videoAssetId}`, { cache: "no-store" });
            // 서버 응답이 성공 조건과 기대 형식을 충족하는지 확인
            if (!response.ok) throw new Error("status-failed");
            // 상태 본문 변환
            const next = (await response.json()) as MediaView;
            // 화면이 남아 있을 때만 후속 상태 갱신 허용
            if (!alive.current) return;
            // 상태 변경 여부 계산
            const signature = JSON.stringify(next);
            // 이전 응답과 비교해 분석 상태가 변경되었는지 확인
            if (snapshot.current !== signature) {
                // 새 서버 응답 서명을 저장해 같은 응답의 중복 반영 방지
                snapshot.current = signature;
                // 새로 받은 영상 분석 결과를 화면 상태에 반영
                setView(next);
            }
            // 실패 상태 표시
            if (next.videoStatus === "REJECTED" || next.analysis?.status === "FAILED") {
                // 실패 단계로 화면 상태 전환
                setPhase("error");
                // 현재 단계가 종료되어 추가 상태 조회 중단
                return;
            }
            // 후보 준비 완료 상태 표시
            if (next.analysis?.status === "CANDIDATES_READY") {
                // 화면 진행률을 완료 비율로 반영
                setValue(100);
                // 기초 후보 탐색 완료 단계로 화면 상태 전환
                setPhase("candidateReady");
                // 현재 단계가 종료되어 추가 상태 조회 중단
                return;
            }
            // 전체 평가 완료 상태 표시
            if (next.analysis?.status === "COMPLETED") {
                // 화면 진행률을 완료 비율로 반영
                setValue(100);
                // 전체 분석 완료 단계로 화면 상태 전환
                setPhase("completed");
                // 현재 단계가 종료되어 추가 상태 조회 중단
                return;
            }
            // 서버가 분석 작업을 생성했는지 확인
            if (next.analysis) {
                // 서버 분석 진행률을 최소 십 퍼센트 이상으로 표시
                setValue(Math.max(10, next.analysis.progressPercent));
                // 후보 분석 단계로 화면 상태 전환
                setPhase("analyzing");
            } else {
                // 영상 검증을 시작하는 초기 진행률 반영
                setValue(5);
                // 영상 검증 단계로 화면 상태 전환
                setPhase("validating");
            }
            // 다음 상태 조회 예약
            poll.current = globalThis.setTimeout(() => {
                // 현재 영상의 최신 분석 상태 다시 조회
                void polling(videoAssetId);
            }, 800);
        } catch {
            // 화면이 남아 있을 때만 후속 상태 갱신 허용
            if (alive.current) setPhase("error");
        }
    };

    // 파일 업로드 흐름
    const upload = async (file: File) => {
        // 업로드 검증과 후보 생성 완료까지 상태 자동 조회
        // 업로드 상태 초기화
        try {
            // 진행률 초기화
            progress.current = 0;
            // 새 영상의 화면 진행률 초기화
            setValue(0);
            // 이전 영상의 분석 결과 상태 비움
            setView(null);
            // 이전 서버 응답 비교 서명 초기화
            snapshot.current = "";
            // 이전 영상의 상태 조회 예약 정리
            pollEnd();
            // 업로드 단계 전환
            setPhase("uploading");
            // 진행률 갱신 시작
            timerStart();

            // 업로드 의도 생성 요청
            const createdResponse = await fetch("/api/uploads", {
                // 서버 요청 방식 연결
                method: "POST",
                // 요청 본문의 형식 안내 연결
                headers: { "content-type": "application/json" },
                // 서버에 전달할 요청 본문 연결
                body: JSON.stringify({
                    // 선택 영상의 바이트 크기 연결
                    expectedSizeBytes: file.size,
                    // 선택 영상의 미디어 형식 연결
                    declaredContentType: file.type,
                    // 업로드 이용 권한 확인 여부 연결
                    rightsConfirmed: true
                })
            });
            // 업로드 의도 응답 해석
            const created = await body(createdResponse);
            // 업로드 의도 검증
            if (
                !createdResponse.ok ||
                created.kind !== "CREATED" ||
                typeof created.uploadUrl !== "string" ||
                typeof created.uploadIntentId !== "string"
            ) {
                // 서버 응답의 실패를 오류 경로로 전달
                throw new Error("upload-grant-failed");
            }

            // 저장소 파일 전송
            await transfer(
                created.uploadUrl,
                file,
                (next) => {
                    // 전송 진행률을 타이머가 읽을 참조에 기록
                    progress.current = next;
                },
                (active) => {
                    // 화면 종료 시 취소할 현재 전송 요청 참조 저장
                    request.current = active;
                }
            );
            // 전송 완료 반영
            progress.current = 100;
            // 화면 진행률을 완료 비율로 반영
            setValue(100);
            // 완료 확인 단계 전환
            setPhase("completing");

            // 업로드 완료 등록
            const completedResponse = await fetch(
                `/api/uploads/${created.uploadIntentId}/complete`,
                { method: "POST" }
            );
            // 완료 응답 해석
            const completed = await body(completedResponse);
            // 완료 응답 검증
            if (
                !completedResponse.ok ||
                completed.kind !== "COMPLETED" ||
                typeof completed.videoAssetId !== "string"
            ) {
                // 서버 응답의 실패를 오류 경로로 전달
                throw new Error("upload-complete-failed");
            }
            // 검증 단계 전환
            setValue(5);
            // 영상 검증 단계로 화면 상태 전환
            setPhase("validating");
            // 분석 상태 조회 시작
            await polling(completed.videoAssetId);
        } catch {
            // 실패 단계 전환
            setPhase("error");
        } finally {
            // 전송 참조 초기화
            request.current = null;
            // 진행률 타이머 정리
            timerEnd();
        }
    };

    // 선택 영상 교체
    const choice = (file: File) => {
        // 처리 중 파일 교체와 지원하지 않는 형식 차단
        if (busy) return;
        // 지원하는 확장자의 영상 파일인지 확인
        if (!/\.(mp4|mov|webm)$/i.test(file.name)) {
            // 지원하지 않는 영상 형식의 재선택 안내 표시
            noticeState("MP4와 MOV와 WEBM 영상 파일을 선택해 주세요");
            // 지원하지 않는 파일의 선택 중단
            return;
        }
        // 이전 파일 선택 오류 안내 비움
        noticeState("");
        // 기존 미리보기 주소 해제
        if (preview.current) URL.revokeObjectURL(preview.current);
        // 새 미리보기 주소 생성
        const url = URL.createObjectURL(file);
        // 나중에 해제할 영상 미리보기 주소 저장
        preview.current = url;
        // 선택 파일 저장
        setSelection({ file, url });
        // 영상 선택 단계로 화면 상태 전환
        setPhase("selected");
        // 새 영상의 화면 진행률 초기화
        setValue(0);
        // 이전 영상의 분석 결과 상태 비움
        setView(null);
        // 이전 서버 응답 비교 서명 초기화
        snapshot.current = "";
        // 이전 영상의 상태 조회 예약 정리
        pollEnd();
    };

    // 현재 업로드가 진행 중인지 확인
    const busy = ["uploading", "completing", "validating", "analyzing"].includes(phase);
    // 분석이 끝난 상태인지 확인
    const finished = phase === "completed" || phase === "candidateReady";

    // 하단 버튼 동작 선택
    const action = () => {
        // 완료 상태는 새 파일 선택
        // 빠른 중복 클릭 차단
        if (busy) return;
        // 이전 분석이 끝났으면 새 영상 선택으로 전환
        if (finished) {
            // 숨겨진 파일 입력을 눌러 새 영상 선택 창 열기
            input.current?.click();
            // 파일 선택 창을 연 뒤 이전 영상의 재전송 방지
            return;
        }
        // 선택 상태는 업로드 시작
        if (selection) void upload(selection.file);
    };

    // 현재 상태에 맞는 영상 선택과 업로드 화면 반환
    return (
        <section className="upload-module" id="upload" aria-busy={busy}>
            {/* 영상 업로드 제목의 화면 묶음 표시 */}
            <div className="module-heading">
                {/* 영상 업로드의 화면 묶음 표시 */}
                <div>
                    {/* 영상 준비 안내의 안내 문구 표시 */}
                    <p className="module-kicker">영상 준비</p>
                    {/* 경기 영상 업로드의 구역 제목 표시 */}
                    <h2>경기 영상 업로드</h2>
                </div>
                {/* 업로드 단계 번호의 짧은 문구 표시 */}
                <span className="module-index" aria-hidden="true">
                    01
                </span>
            </div>
            {/* 파일을 놓으면 선택 단계만 수행 */}
            <div
                className={`file-picker${selection ? " has-file" : ""}`}
                // 파일을 끌어올 때 기본 동작과 놓기 가능 상태 제어
                onDragOver={(event) => {
                    // 현재 입력의 브라우저 기본 동작 차단
                    event.preventDefault();
                    // 업로드 중에는 끌어놓기 금지 표시와 그 외에는 복사 표시 선택
                    event.dataTransfer.dropEffect = busy ? "none" : "copy";
                }}
                // 놓인 파일을 읽어 영상 선택으로 연결
                onDrop={(event) => {
                    // 기본 브라우저 파일 열기 동작 차단
                    event.preventDefault();
                    // 첫 번째 파일 선택
                    const file = event.dataTransfer.files[0];
                    // 선택된 파일 검증
                    if (file) choice(file);
                }}
            >
                {/* 실제 파일 입력은 화면 버튼으로 제어 */}
                <input
                    // 실제 화면 요소를 참조에 연결
                    ref={input}
                    id="video-file"
                    // 보조 기술이 읽을 화면 요소 이름 지정
                    aria-label="영상 파일"
                    type="file"
                    // 파일 선택 창의 영상 형식 제한
                    accept="video/mp4,video/quicktime,video/webm"
                    // 진행 상태와 선택 조건에 따라 입력 잠금
                    disabled={busy}
                    // 입력 변경 시 선택 상태 반영
                    onChange={(event) => {
                        // 파일 입력 이벤트에서 첫 파일 추출
                        const file = event.currentTarget.files?.[0];
                        // 같은 파일 재선택 허용
                        event.currentTarget.value = "";
                        // 선택된 파일 검증
                        if (file) choice(file);
                    }}
                />
                {selection ? (
                    // 선택 영상 미리보기의 화면 묶음 표시
                    <div className="file-preview">
                        {/* 선택 영상 미리보기 */}
                        <video
                            // 보조 기술이 읽을 화면 요소 이름 지정
                            aria-label="선택 영상 미리보기"
                            // 표시할 영상이나 이미지 주소 연결
                            src={selection.url}
                            // 브라우저 기본 영상 재생 조작부 표시
                            controls
                            // 미리보기 영상의 초기 음소거 지정
                            muted
                            // 모바일에서도 화면 안에서 영상 재생 유지
                            playsInline
                            // 영상의 미리 읽기 범위 지정
                            preload="auto"
                        />
                        {/* 선택 파일 이름과 크기 표시 */}
                        <div className="file-meta">
                            {/* 영상 업로드의 짧은 문구 표시 */}
                            <span>
                                {/* 영상 업로드의 강조 문구 표시 */}
                                <strong>{selection.file.name}</strong>
                                {/* ·의 보조 문구 표시 */}
                                <small>
                                    {size(selection.file.size)} ·{" "}
                                    {selection.file.type || "영상 파일"}
                                </small>
                            </span>
                            {/* 영상 파일 선택의 입력 설명 표시 */}
                            <label className="file-button" htmlFor="video-file">
                                영상 변경
                            </label>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* 파일 선택 안내 아이콘 */}
                        <span className="file-icon" aria-hidden="true">
                            ▷
                        </span>
                        {/* 영상 파일 선택의 강조 문구 표시 */}
                        <strong>영상 파일 선택</strong>
                        {/* 끌어놓기와 버튼을 통한 영상 선택 방법 표시 */}
                        <small>파일을 드래그하거나 버튼을 클릭하세요</small>
                        {/* 지원 형식: 4의 보조 문구 표시 */}
                        <small>지원 형식: MP4, MOV, WEBM</small>
                        {/* 영상 파일 선택의 입력 설명 표시 */}
                        <label className="file-button" htmlFor="video-file">
                            영상 파일 선택
                        </label>
                    </>
                )}
            </div>
            {notice ? (
                // 영상 선택과 처리 상태 안내의 안내 문구 표시
                <p className="upload-status" role="alert">
                    {notice}
                </p>
            ) : null}
            {/* 영상 선택과 처리 상태 안내의 화면 묶음 표시 */}
            <div className="upload-status" aria-live="polite">
                {message[phase]}
            </div>
            {/* 영상 업로드 진행률의 화면 묶음 표시 */}
            <div className="progress-track">
                {/* 영상 업로드의 업로드 진행률 표시 */}
                <progress
                    className="progress-fill"
                    // 현재 입력이나 진행 상태를 화면 값에 반영
                    value={value}
                    max={100}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={value}
                />
            </div>
            {/* 선택 영상 분석 실행의 동작 버튼 표시 */}
            <button
                className="primary-action"
                type="button"
                // 클릭 시 연결된 화면 동작 실행
                onClick={action}
                // 진행 상태와 선택 조건에 따라 입력 잠금
                disabled={busy || (!selection && !finished)}
            >
                {/* ▷의 짧은 문구 표시 */}
                <span aria-hidden="true">▷</span> {finished ? "다른 영상 분석" : "분석 시작"}
            </button>
        </section>
    );
}
