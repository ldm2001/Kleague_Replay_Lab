"use client";

import { useEffect, useRef, useState } from "react";
import * as React from "react";

type Phase = "idle" | "uploading" | "completing" | "queued" | "error";

const message: Record<Phase, string> = {
  idle: "영상 파일을 선택해 주세요",
  uploading: "영상 업로드 중",
  completing: "업로드 확인 중",
  queued: "검증 대기",
  error: "업로드를 다시 시도해 주세요",
};

const put = (
  url: string,
  file: File,
  progress: (value: number) => void,
  attach: (request: XMLHttpRequest) => void,
): Promise<void> =>
  new Promise((resolve, reject) => {
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

const read = async (response: Response): Promise<Record<string, unknown>> => {
  const value: unknown = await response.json();
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("invalid-response");
  }
  return value as Record<string, unknown>;
};

export function UploadBox() {
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<XMLHttpRequest | null>(null);
  const progress = useRef(0);
  const timer = useRef<ReturnType<typeof globalThis.setInterval> | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [value, setValue] = useState(0);

  const stop = () => {
    if (timer.current !== null) {
      globalThis.clearInterval(timer.current);
      timer.current = null;
    }
  };

  const start = () => {
    stop();
    timer.current = globalThis.setInterval(() => {
      setValue((current) => {
        const next = progress.current;
        return current === next ? current : next;
      });
    }, 120);
  };

  useEffect(() => () => {
    stop();
    request.current?.abort();
  }, []);

  const upload = async (file: File) => {
    try {
      progress.current = 0;
      setValue(0);
      setPhase("uploading");
      start();

      const createdResponse = await fetch("/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedSizeBytes: file.size,
          declaredContentType: file.type,
          rightsConfirmed: true,
        }),
      });
      const created = await read(createdResponse);
      if (!createdResponse.ok || created.kind !== "CREATED" || typeof created.uploadUrl !== "string" || typeof created.uploadIntentId !== "string") {
        throw new Error("upload-grant-failed");
      }

      await put(
        created.uploadUrl,
        file,
        (next) => {
          progress.current = next;
        },
        (active) => {
          request.current = active;
        },
      );
      progress.current = 100;
      setValue(100);
      setPhase("completing");

      const completedResponse = await fetch(`/api/uploads/${created.uploadIntentId}/complete`, { method: "POST" });
      const completed = await read(completedResponse);
      if (!completedResponse.ok || completed.kind !== "COMPLETED") {
        throw new Error("upload-complete-failed");
      }
      setPhase("queued");
    } catch {
      setPhase("error");
    } finally {
      request.current = null;
      stop();
    }
  };

  return (
    <section className="upload-box" aria-busy={phase === "uploading" || phase === "completing"}>
      <div className="upload-copy">
        <p className="eyebrow">K리그 판정 보조</p>
        <h1>하이라이트에서 확인할 장면 찾기</h1>
        <p>영상 전체를 검수하고 근거 프레임과 규정 대조 결과를 준비합니다.</p>
      </div>
      <label className="file-picker" htmlFor="video-file">
        <span>영상 파일 선택</span>
        <input
          ref={input}
          id="video-file"
          aria-label="영상 파일"
          type="file"
          accept="video/mp4,video/quicktime,video/webm"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void upload(file);
          }}
        />
      </label>
      <div className="upload-status" aria-live="polite">{message[phase]}</div>
      <div
        className="progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
      >
        <span className="progress-fill" style={{ transform: `scaleX(${value / 100})` }} />
      </div>
    </section>
  );
}
