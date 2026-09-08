"use client";

import { useEffect, useRef, useState } from "react";
import * as React from "react";
import type { MediaView } from "@replay/application";

// 업로드 단계 값
type Phase = "idle" | "selected" | "uploading" | "completing" | "validating" | "analyzing" | "candidateReady" | "completed" | "error";
type UploadPanelProps = Readonly<{ onView?: (view: MediaView | null) => void }>;
type Selection = Readonly<{ file: File; url: string }>;

// 단계별 안내 문구
const message: Record<Phase, string> = {
  idle: "영상 파일을 선택해 주세요",
  selected: "선택한 영상을 확인해 주세요",
  uploading: "영상 업로드 중",
  completing: "업로드 확인 중",
  validating: "영상 검증 중",
  analyzing: "후보 장면 분석 중",
  candidateReady: "기초 장면 탐색 완료",
  completed: "분석 완료",
  error: "업로드를 다시 시도해 주세요",
};

const size = (bytes: number): string => {
  // 바이트 단위 파일 크기 표시
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// Object Storage 파일 전송
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
  // 파일 MIME 타입 설정
  request.setRequestHeader("Content-Type", file.type);
  // 업로드 진행률 전달
  request.upload.onprogress = (event) => {
    if (event.lengthComputable && event.total > 0) {
      progress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    }
  };
  // 업로드 응답 처리
  request.onload = () => {
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

// API 응답 본문 확인
const body = async (response: Response): Promise<Record<string, unknown>> => {
  // JSON 응답 파싱
  const value: unknown = await response.json();
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("invalid-response");
  }
  return value as Record<string, unknown>;
};

// 업로드 상태와 진행률 화면
export function UploadPanel({ onView }: UploadPanelProps = {}) {
  // 사용자는 파일만 선택한다 대회와 시즌과 분석 조건은 서버 정책으로 처리한다
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
  const stop = () => {
    // 타이머 존재 확인
    if (timer.current !== null) {
      // 타이머 제거
      globalThis.clearInterval(timer.current);
      // 타이머 참조 초기화
      timer.current = null;
    }
  };

  // 진행률 갱신 시작
  const start = () => {
    // 기존 타이머 제거
    stop();
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
  const stopPoll = () => {
    // 상태 조회 예약 취소
    if (poll.current !== null) {
      globalThis.clearTimeout(poll.current);
      poll.current = null;
    }
  };

  // 컴포넌트 종료 정리
  useEffect(() => {
    // 컴포넌트 활성 상태 설정
    alive.current = true;
    return () => {
      alive.current = false;
      stop();
      stopPoll();
      request.current?.abort();
      if (preview.current) URL.revokeObjectURL(preview.current);
    };
  }, []);

  useEffect(() => {
    // 부모 화면에 분석 상태 전달
    onView?.(view);
  }, [onView, view]);

  // 분석 상태 조회
  const watch = async (videoAssetId: string): Promise<void> => {
    // 업로드 뒤에는 서버가 갱신하는 파이프라인 상태만 읽고 별도 분석 설정을 받지 않는다
    // 영상 상태 조회
    try {
      // 상태 API 호출
      const response = await fetch(`/api/uploads/${videoAssetId}`, { cache: "no-store" });
      if (!response.ok) throw new Error("status-failed");
      // 상태 본문 변환
      const next = await response.json() as MediaView;
      if (!alive.current) return;
      // 상태 변경 여부 계산
      const signature = JSON.stringify(next);
      if (snapshot.current !== signature) {
        snapshot.current = signature;
        setView(next);
      }
      // 실패 상태 표시
      if (next.videoStatus === "REJECTED" || next.analysis?.status === "FAILED") {
        setPhase("error");
        return;
      }
      // 후보 준비 완료 상태 표시
      if (next.analysis?.status === "CANDIDATES_READY") {
        setValue(100);
        setPhase("candidateReady");
        return;
      }
      // 전체 평가 완료 상태 표시
      if (next.analysis?.status === "COMPLETED") {
        setValue(100);
        setPhase("completed");
        return;
      }
      if (next.analysis) {
        setValue(Math.max(10, next.analysis.progressPercent));
        setPhase("analyzing");
      } else {
        setValue(5);
        setPhase("validating");
      }
      // 다음 상태 조회 예약
      poll.current = globalThis.setTimeout(() => { void watch(videoAssetId); }, 800);
    } catch {
      if (alive.current) setPhase("error");
    }
  };

  // 파일 업로드 흐름
  const upload = async (file: File) => {
    // 업로드 완료 후 검증과 후보 생성이 끝날 때까지 자동으로 상태를 추적한다
    // 업로드 상태 초기화
    try {
      // 진행률 초기화
      progress.current = 0;
      setValue(0);
      setView(null);
      snapshot.current = "";
      stopPoll();
      // 업로드 단계 전환
      setPhase("uploading");
      // 진행률 갱신 시작
      start();

      // 업로드 의도 생성 요청
      const createdResponse = await fetch("/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedSizeBytes: file.size, declaredContentType: file.type, rightsConfirmed: true }),
      });
      // 업로드 의도 응답 해석
      const created = await body(createdResponse);
      // 업로드 의도 검증
      if (!createdResponse.ok || created.kind !== "CREATED" || typeof created.uploadUrl !== "string" || typeof created.uploadIntentId !== "string") {
        throw new Error("upload-grant-failed");
      }

      // 저장소 파일 전송
      await transfer(created.uploadUrl, file, (next) => { progress.current = next; }, (active) => { request.current = active; });
      // 전송 완료 반영
      progress.current = 100;
      setValue(100);
      // 완료 확인 단계 전환
      setPhase("completing");

      // 업로드 완료 등록
      const completedResponse = await fetch(`/api/uploads/${created.uploadIntentId}/complete`, { method: "POST" });
      // 완료 응답 해석
      const completed = await body(completedResponse);
      // 완료 응답 검증
      if (!completedResponse.ok || completed.kind !== "COMPLETED" || typeof completed.videoAssetId !== "string") {
        throw new Error("upload-complete-failed");
      }
      // 검증 단계 전환
      setValue(5);
      setPhase("validating");
      // 분석 상태 조회 시작
      await watch(completed.videoAssetId);
    } catch {
      // 실패 단계 전환
      setPhase("error");
    } finally {
      // 전송 참조 초기화
      request.current = null;
      // 진행률 타이머 정리
      stop();
    }
  };

  // 선택 영상 교체
  const choice = (file: File) => {
    // 처리 중 파일 교체와 지원하지 않는 형식 차단
    if (busy) return;
    if (!/\.(mp4|mov|webm)$/i.test(file.name)) {
      noticeState("MP4와 MOV와 WEBM 영상 파일을 선택해 주세요");
      return;
    }
    noticeState("");
    // 기존 미리보기 주소 해제
    if (preview.current) URL.revokeObjectURL(preview.current);
    // 새 미리보기 주소 생성
    const url = URL.createObjectURL(file);
    preview.current = url;
    // 선택 파일 저장
    setSelection({ file, url });
    setPhase("selected");
    setValue(0);
    setView(null);
    snapshot.current = "";
    stopPoll();
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
    if (finished) {
      input.current?.click();
      return;
    }
    // 선택 상태는 업로드 시작
    if (selection) void upload(selection.file);
  };

  return (
    <section className="upload-module" id="upload" aria-busy={busy}>
      <div className="module-heading">
        <div><p className="module-kicker">영상 준비</p><h2>경기 영상 업로드</h2></div>
        <span className="module-index" aria-hidden="true">01</span>
      </div>
      {/* 파일을 놓으면 선택 단계만 수행 */}
      <div className={`file-picker${selection ? " has-file" : ""}`}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = busy ? "none" : "copy"; }}
        onDrop={(event) => {
          // 기본 브라우저 파일 열기 동작 차단
          event.preventDefault();
          // 첫 번째 파일 선택
          const file = event.dataTransfer.files[0];
          // 선택된 파일 검증
          if (file) choice(file);
        }}>
        {/* 실제 파일 입력은 화면 버튼으로 제어 */}
        <input ref={input} id="video-file" aria-label="영상 파일" type="file" accept="video/mp4,video/quicktime,video/webm" disabled={busy} onChange={(event) => {
          // 파일 입력 이벤트에서 첫 파일 추출
          const file = event.currentTarget.files?.[0];
          // 같은 파일 재선택 허용
          event.currentTarget.value = "";
          // 선택된 파일 검증
          if (file) choice(file);
        }} />
        {selection ? (
          <div className="file-preview">
            {/* 선택 영상 미리보기 */}
            <video aria-label="선택 영상 미리보기" src={selection.url} controls muted playsInline preload="auto" />
            {/* 선택 파일 이름과 크기 표시 */}
            <div className="file-meta">
              <span><strong>{selection.file.name}</strong><small>{size(selection.file.size)} · {selection.file.type || "영상 파일"}</small></span>
              <label className="file-button" htmlFor="video-file">영상 변경</label>
            </div>
          </div>
        ) : (
          <>
            {/* 파일 선택 안내 아이콘 */}
            <span className="file-icon" aria-hidden="true">▷</span>
            <strong>영상 파일 선택</strong>
            <small>파일을 드래그하거나 버튼을 클릭하세요</small>
            <small>지원 형식: MP4, MOV, WEBM</small>
            <label className="file-button" htmlFor="video-file">영상 파일 선택</label>
          </>
        )}
      </div>
      {notice ? <p className="upload-status" role="alert">{notice}</p> : null}
      <div className="upload-status" aria-live="polite">{message[phase]}</div>
      <div className="progress-track"><progress className="progress-fill" value={value} max={100} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} /></div>
      <button className="primary-action" type="button" onClick={action} disabled={busy || (!selection && !finished)}><span aria-hidden="true">▷</span> {finished ? "다른 영상 분석" : "분석 시작"}</button>
    </section>
  );
}
