"use client";

// 화면 구성에 필요한 기능과 공유 자료 형식 읽음
import * as React from "react";
import { useState } from "react";

// 솔루션 탭별 이름과 설명 묶음 생성
const slides = [
    {
        // 화면에 표시할 항목 이름 연결
        label: "영상 사실",
        // 화면에 표시할 영문 항목 이름 연결
        labelEn: "VIDEO FACTS",
        // 카드 제목 연결
        title: "영상 근거 중심의 판정 보조",
        // 카드 설명 연결
        text: "정상 속도와 리플레이와 다른 각도를 구분하고 확인 가능한 장면만 다음 단계로 전달합니다.",
    },
    {
        // 화면에 표시할 항목 이름 연결
        label: "규정 대조",
        // 화면에 표시할 영문 항목 이름 연결
        labelEn: "RULE CHECK",
        // 카드 제목 연결
        title: "적용 규정과 판본 확인",
        // 카드 설명 연결
        text: "경기 날짜와 대회에 맞는 판본을 선택하고 적용 조항과 확인되지 않은 조건을 함께 남깁니다.",
    },
    {
        // 화면에 표시할 항목 이름 연결
        label: "증거 결과",
        // 화면에 표시할 영문 항목 이름 연결
        labelEn: "EVIDENCE",
        // 카드 제목 연결
        title: "실제 프레임과 증거 클립",
        // 카드 설명 연결
        text: "판정 장면 전후의 프레임과 짧은 영상을 같은 사건으로 묶어 결과에서 바로 확인합니다.",
    },
] as const;

// 솔루션 패널 구성
export function SolutionDeck() {
    // 활성 패널 상태
    const [active, setActive] = useState(0);
    // 현재 솔루션 조회
    const slide = slides[active] ?? slides[0];

    // 솔루션 영역 반환
    return (
        <div className="solution-showcase" data-active={active}>
            {/* 솔루션 선택 탭 목록의 화면 묶음 표시 */}
            <div className="solution-rail" role="tablist" aria-label="주요 솔루션">
                {slides.map((item, index) => (
                    // 솔루션 소개의 동작 버튼 표시
                    <button
                        className={index === active ? "is-active" : ""}
                        // 반복 화면 요소의 고유 항목 구분
                        key={item.label}
                        type="button"
                        // 보조 기술에 화면 요소의 의미 전달
                        role="tab"
                        // 현재 선택된 솔루션 탭 상태 전달
                        aria-selected={index === active}
                        // 탭과 연결된 내용 영역 식별자 지정
                        aria-controls="solution-panel"
                        // 키보드 초점을 받을 수 있는 순서 지정
                        tabIndex={index === active ? 0 : -1}
                        // 포인터가 올라오면 해당 솔루션 활성화
                        onMouseEnter={() => setActive(index)}
                        // 키보드 초점을 받은 솔루션 활성화
                        onFocus={() => setActive(index)}
                        // 키 입력을 화면 이동 동작에 연결
                        onKeyDown={(event) => {
                            // 방향키 외 입력은 기본 동작 유지
                            if (
                                !["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(
                                    event.key
                                )
                            ) {
                                // 현재 입력에 대한 후속 동작 종료
                                return;
                            }
                            // 탭 이동 기본 동작 차단
                            event.preventDefault();
                            // 방향에 맞는 다음 패널 계산
                            const next =
                                event.key === "ArrowRight" || event.key === "ArrowDown"
                                    ? (index + 1) % slides.length
                                    : (index + slides.length - 1) % slides.length;
                            // 다음 패널 활성화
                            setActive(next);
                            // 다음 탭으로 포커스 이동
                            document
                                .querySelector<HTMLButtonElement>(
                                    `[aria-controls="solution-panel"][data-index="${next}"]`
                                )
                                ?.focus();
                        }}
                        id={`solution-tab-${index}`}
                        data-index={index}
                    >
                        {/* 솔루션 소개의 짧은 문구 표시 */}
                        <span>{item.label}</span>
                    </button>
                ))}
            </div>
            <article
                className="showcase-feature is-active"
                id="solution-panel"
                // 보조 기술에 화면 요소의 의미 전달
                role="tabpanel"
                // 화면 영역을 설명할 제목 요소 연결
                aria-labelledby={`solution-tab-${active}`}
            >
                {/* 솔루션 소개 장식의 화면 묶음 표시 */}
                <div className="showcase-visual">
                    {/* 배경 격자 장식의 화면 묶음 표시 */}
                    <div className="visual-grid" />
                    {/* 축구공 장식의 화면 묶음 표시 */}
                    <div className="visual-ball">●</div>
                    {/* 공 이동선 장식의 화면 묶음 표시 */}
                    <div className="visual-line line-one" />
                    {/* 공 이동선 장식의 화면 묶음 표시 */}
                    <div className="visual-line line-two" />
                </div>
                {/* 선택 솔루션 설명의 화면 묶음 표시 */}
                <div className="showcase-copy solution-copy" key={slide.label}>
                    {/* 솔루션 소개의 안내 문구 표시 */}
                    <p className="label">{slide.labelEn}</p>
                    {/* 솔루션 소개의 항목 제목 표시 */}
                    <h3>{slide.title}</h3>
                    {/* 솔루션 소개의 안내 문구 표시 */}
                    <p>{slide.text}</p>
                </div>
            </article>
        </div>
    );
}
