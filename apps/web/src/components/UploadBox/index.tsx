"use client";

import { useEffect, useRef, useState } from "react";
import * as React from "react";
import type { MediaView } from "@replay/application";

// 업로드 단계 값
type Phase = "idle" | "selected" | "uploading" | "completing" | "validating" | "analyzing" | "candidateReady" | "completed" | "error";
type UploadBoxProps = Readonly<{ onView?: (view: MediaView | null) => void }>;
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
  const request = new XMLHttpRequest();
  attach(request);
  request.open("PUT", url);
  request.setRequestHeader("Content-Type", file.type);
  request.upload.onprogress = (event) => {
    if (event.lengthComputable && event.total > 0) {
      progress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    }
  };
  request.onload = () => {
    if (request.status >= 200 && request.status < 300) resolve();
    else reject(new Error("upload-failed"));
  };
  request.onerror = () => reject(new Error("upload-failed"));
  request.onabort = () => reject(new Error("upload-aborted"));
  request.send(file);
});

// API 응답 본문 확인
const responseBody = async (response: Response): Promise<Record<string, unknown>> => {
  const value: unknown = await response.json();
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("invalid-response");
  }
  return value as Record<string, unknown>;
};

// 업로드 상태와 진행률 화면
export function UploadBox({ onView }: UploadBoxProps = {}) {
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
  const [competition, setCompetition] = useState("K리그1");
  const [season, setSeason] = useState("2026");

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
    if (poll.current !== null) {
      globalThis.clearTimeout(poll.current);
      poll.current = null;
    }
  };

  // 컴포넌트 종료 정리
  useEffect(() => {
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
    onView?.(view);
  }, [onView, view]);

  // 분석 상태 조회
  const watch = async (videoAssetId: string): Promise<void> => {
    try {
      const response = await fetch(`/api/uploads/${videoAssetId}`, { cache: "no-store" });
      if (!response.ok) throw new Error("status-failed");
      const next = await response.json() as MediaView;
      if (!alive.current) return;
      const signature = JSON.stringify(next);
      if (snapshot.current !== signature) {
        snapshot.current = signature;
        setView(next);
      }
      if (next.videoStatus === "REJECTED" || next.analysis?.status === "FAILED") {
        setPhase("error");
        return;
      }
      if (next.analysis?.status === "CANDIDATES_READY") {
        setValue(100);
        setPhase("candidateReady");
        return;
      }
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
      poll.current = globalThis.setTimeout(() => { void watch(videoAssetId); }, 800);
    } catch {
      if (alive.current) setPhase("error");
    }
  };

  // 파일 업로드 흐름
  const upload = async (file: File) => {
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

      // 업로드 의도 요청
      const createdResponse = await fetch("/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedSizeBytes: file.size, declaredContentType: file.type, rightsConfirmed: true, competition, season }),
      });
      // 업로드 의도 응답 해석
      const created = await responseBody(createdResponse);
      // 업로드 의도 검증
      if (!createdResponse.ok || created.kind !== "CREATED" || typeof created.uploadUrl !== "string" || typeof created.uploadIntentId !== "string") {
        throw new Error("upload-grant-failed");
      }

      // Object Storage 직접 업로드
      await transfer(created.uploadUrl, file, (next) => { progress.current = next; }, (active) => { request.current = active; });
      // 전송 완료 반영
      progress.current = 100;
      setValue(100);
      // 완료 확인 단계 전환
      setPhase("completing");

      // 업로드 완료 요청
      const completedResponse = await fetch(`/api/uploads/${created.uploadIntentId}/complete`, { method: "POST" });
      // 완료 응답 해석
      const completed = await responseBody(completedResponse);
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
    if (preview.current) URL.revokeObjectURL(preview.current);
    const url = URL.createObjectURL(file);
    preview.current = url;
    setSelection({ file, url });
    setPhase("selected");
    setValue(0);
    setView(null);
    snapshot.current = "";
    stopPoll();
  };

  const busy = ["uploading", "completing", "validating", "analyzing"].includes(phase);
  const finished = phase === "completed" || phase === "candidateReady";
  const action = () => {
    if (finished) {
      input.current?.click();
      return;
    }
    if (selection) void upload(selection.file);
  };

  return (
    <section className="upload-module" id="upload" aria-busy={busy}>
      <div className="module-heading">
        <div><p className="module-kicker">영상 준비</p><h2>경기 영상 업로드</h2></div>
        <span className="module-index" aria-hidden="true">01</span>
      </div>
      <div className="select-row">
        <label>대회<select aria-label="대회" value={competition} onChange={(event) => setCompetition(event.target.value)}><option value="K리그1">K리그1</option><option value="K리그2">K리그2</option></select></label>
        <label>시즌<select aria-label="시즌" value={season} onChange={(event) => setSeason(event.target.value)}><option value="2026">2026</option></select></label>
      </div>
      <div className={`file-picker${selection ? " has-file" : ""}`}>
        <input ref={input} id="video-file" aria-label="영상 파일" type="file" accept="video/mp4,video/quicktime,video/webm" disabled={busy} onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) choice(file);
        }} />
        {selection ? (
          <div className="file-preview">
            <video aria-label="선택 영상 미리보기" src={selection.url} controls muted playsInline preload="auto" />
            <div className="file-meta">
              <span><strong>{selection.file.name}</strong><small>{size(selection.file.size)} · {selection.file.type || "영상 파일"}</small></span>
              <label className="file-button" htmlFor="video-file">영상 변경</label>
            </div>
          </div>
        ) : (
          <>
            <span className="file-icon" aria-hidden="true">▷</span>
            <strong>영상 파일 선택</strong>
            <small>파일을 드래그하거나 버튼을 클릭하세요</small>
            <small>지원 형식: MP4, MOV, WEBM</small>
            <label className="file-button" htmlFor="video-file">영상 파일 선택</label>
          </>
        )}
      </div>
      <label className="confidence-toggle"><input type="checkbox" defaultChecked /> <span>낮은 확신도 장면도 표시</span></label>
      <div className="upload-status" aria-live="polite">{message[phase]}</div>
      <div className="progress-track"><progress className="progress-fill" value={value} max={100} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} /></div>
      <button className="primary-action" type="button" onClick={action} disabled={busy || (!selection && !finished)}><span aria-hidden="true">▷</span> {finished ? "다른 영상 분석" : "분석 시작"}</button>
    </section>
  );
}
