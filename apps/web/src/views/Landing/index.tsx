// 화면 구성에 필요한 기능과 공유 자료 형식 읽음
import * as React from "react";
import { Footer } from "../../components/Footer";
import { CaseSlider } from "../../components/CaseSlider";
import { FloatingTools } from "../../components/FloatingTools";
import { PreFooter } from "../../components/PreFooter";
import { Header } from "../../components/Header";
import { HeroMotion } from "../../components/HeroMotion";
import { Reveal } from "../../components/Reveal";
import { SolutionDeck } from "../../components/SolutionDeck";
import { images, path } from "../../assets/image";

// 분석 기능 카드 데이터
const services = [
    { title: "판정 후보 탐지", text: "파울과 핸드볼과 차징과 득점 취소 장면을 후보로 모읍니다." },
    { title: "IFAB와 K리그 요강 대조", text: "경기 날짜와 대회에 맞는 규정 판본을 적용합니다." },
    { title: "근거 프레임과 클립", text: "장면 전후의 실제 영상을 결과와 함께 보여줍니다." },
    { title: "낮은 확신도 표시", text: "판단이 어려운 장면을 숨기지 않고 확인 대상으로 남깁니다." },
    { title: "VAR 검토 범위", text: "검토 범주와 문턱과 절차를 분리해 설명합니다." },
    { title: "영상 한계 기록", text: "각도와 속도와 누락 장면을 근거의 한계로 표시합니다." },
] as const;

// 검토 범위 카드 데이터
const cases = [
    {
        // 카드 제목 연결
        title: "파울",
        // 카드 설명 연결
        text: "접촉과 강도와 정상 속도 장면을 확인합니다.",
        // 카드 색상 구분 연결
        tone: "blue",
        // 카드 이미지 주소 연결
        image: images.review.foul
    },
    {
        // 카드 제목 연결
        title: "핸드볼",
        // 카드 설명 연결
        text: "공의 접촉과 팔의 위치와 의도 판단을 분리합니다.",
        // 카드 색상 구분 연결
        tone: "red",
        // 카드 이미지 주소 연결
        image: images.review.handball
    },
    {
        // 카드 제목 연결
        title: "차징과 터치",
        // 카드 설명 연결
        text: "경합 과정과 마지막 터치를 시간순으로 보여줍니다.",
        // 카드 색상 구분 연결
        tone: "green",
        // 카드 이미지 주소 연결
        image: images.review.charging
    },
    {
        // 카드 제목 연결
        title: "득점 취소",
        // 카드 설명 연결
        text: "득점 직전 반칙과 VAR 검토 가능성을 대조합니다.",
        // 카드 색상 구분 연결
        tone: "violet",
        // 카드 이미지 주소 연결
        image: images.review.goal
    }
] as const;

// 결과 읽기 순서 데이터
const help = [
    { number: "01", title: "영상 사실", text: "무엇이 실제로 보이는지 먼저 확인" },
    { number: "02", title: "규정 조건", text: "해당 장면에 적용되는 조항 확인" },
    { number: "03", title: "확신도와 한계", text: "판단 가능한 범위와 불확실성 표시" },
    { number: "04", title: "판정 결과 읽기", text: "관측 판정과 규정 적용 결과를 비교" },
] as const;

// 랜딩 화면 구성
// 랜딩 화면 표시
export function LandingView() {
    // 랜딩 전체 화면 반환
    return (
        <div className="site-shell">
            {/* 공통 헤더 표시 */}
            <Header mode="landing" />

            {/* 서비스 소개의 본문 영역 표시 */}
            <main>
                {/* 첫 화면 영웅 영역 */}
                <HeroMotion id="top" aria-labelledby="hero-title">
                    {/* 첫 화면 배경 이미지의 이미지 표시 */}
                    <img
                        className="hero-art"
                        data-testid="hero-art"
                        // 표시할 영상이나 이미지 주소 연결
                        src={path(images.hero)}
                        // 이미지를 볼 수 없을 때 사용할 설명 연결
                        alt=""
                        // 장식 요소를 보조 기술의 읽기 대상에서 제외
                        aria-hidden="true"
                        // 이미지 해독으로 화면 갱신이 막히지 않도록 지정
                        decoding="async"
                        // 첫 화면 핵심 이미지의 읽기 우선순위 지정
                        fetchPriority="high"
                    />
                    {/* 화면 진입 효과 표시 */}
                    <Reveal className="hero-copy">
                        {/* 서비스 소개 부제의 안내 문구 표시 */}
                        <p className="hero-kicker">K리그 경기 영상 판정 보조</p>
                        {/* 경기 판정의의 페이지 제목 표시 */}
                        <h1 id="hero-title">
                            경기 판정의
                            <br /> <span>새로운 근거를 열다</span>
                        </h1>
                        {/* 서비스 소개의 안내 문구 표시 */}
                        <p>
                            하이라이트 영상 속 판정 장면을 찾고
                            <br />
                            영상 근거와 IFAB와 K리그 규정을 함께 확인합니다.
                        </p>
                        {/* 영상 분석 시작의 이동 링크 표시 */}
                        <a className="hero-cta" href="/analyze">
                            영상 분석 시작하기 <span aria-hidden="true">→</span>
                        </a>
                    </Reveal>
                    {/* 솔루션 구역 이동의 이동 링크 표시 */}
                    <a className="hero-scroll" href="#solutions" aria-label="주요 솔루션으로 이동">
                        ⌄
                    </a>
                </HeroMotion>

                {/* 주요 솔루션 영역 */}
                <section
                    className="section solutions"
                    id="solutions"
                    // 화면 영역을 설명할 제목 요소 연결
                    aria-labelledby="solutions-title"
                >
                    {/* 화면 진입 효과 표시 */}
                    <Reveal className="section-heading center">
                        {/* 주요 솔루션의 구역 제목 표시 */}
                        <h2 id="solutions-title">주요 솔루션</h2>
                        {/* 영상에서 판정 근거를 확인하는 솔루션 소개 표시 */}
                        <p>영상 한 편으로 판정에 필요한 근거를 단계별로 확인합니다.</p>
                    </Reveal>
                    {/* 화면 진입 효과 표시 */}
                    <Reveal delay={200}>
                        {/* 솔루션 탭 표시 */}
                        <SolutionDeck />
                    </Reveal>
                </section>

                {/* 주요 분석 기능 영역 */}
                <section
                    className="section services"
                    id="services"
                    // 화면 영역을 설명할 제목 요소 연결
                    aria-labelledby="services-title"
                >
                    {/* 화면 진입 효과 표시 */}
                    <Reveal className="section-heading">
                        {/* 주요 분석 기능의 구역 제목 표시 */}
                        <h2 id="services-title">주요 분석 기능</h2>
                        {/* 여러 분석 기능의 연결 흐름 소개 표시 */}
                        <p>판정 확인에 필요한 기능을 하나의 흐름으로 연결합니다.</p>
                    </Reveal>
                    {/* 분석 기능 카드 목록의 화면 묶음 표시 */}
                    <div className="service-grid">
                        {services.map((service, index) => (
                            // 화면 진입 효과 표시
                            <Reveal
                                as="article"
                                className="service-item"
                                delay={200 + index * 70}
                                // 반복 화면 요소의 고유 항목 구분
                                key={service.title}
                            >
                                {/* 분석 기능 순서 번호의 짧은 문구 표시 */}
                                <span className="service-icon" aria-hidden="true">
                                    {String(index + 1).padStart(2, "0")}
                                </span>
                                {/* 서비스 소개의 화면 묶음 표시 */}
                                <div>
                                    {/* 서비스 소개의 항목 제목 표시 */}
                                    <h3>{service.title}</h3>
                                    {/* 서비스 소개의 안내 문구 표시 */}
                                    <p>{service.text}</p>
                                </div>
                                {/* →의 짧은 문구 표시 */}
                                <span className="arrow" aria-hidden="true">
                                    →
                                </span>
                            </Reveal>
                        ))}
                    </div>
                    {/* 영상 분석 시작의 이동 링크 표시 */}
                    <a className="text-cta" href="/analyze">
                        영상 분석 시작하기 <span aria-hidden="true">→</span>
                    </a>
                </section>

                {/* 검토 범위 영역 */}
                <section className="section cases" id="cases" aria-labelledby="cases-title">
                    {/* 화면 진입 효과 표시 */}
                    <Reveal className="section-heading">
                        {/* 주요 검토 범위의 구역 제목 표시 */}
                        <h2 id="cases-title">주요 검토 범위</h2>
                        {/* 서비스 소개의 안내 문구 표시 */}
                        <p>확정 판정이 아니라 영상과 규정에 기반한 보조 의견을 제공합니다.</p>
                    </Reveal>
                    {/* 화면 진입 효과 표시 */}
                    <Reveal delay={200}>
                        {/* 검토 범위 슬라이더 표시 */}
                        <CaseSlider
                            items={cases.map((item) => ({ ...item, image: path(item.image) }))}
                        />
                    </Reveal>
                </section>

                {/* 결과 읽기 순서 영역 */}
                <section className="section help" id="rules" aria-labelledby="help-title">
                    {/* 화면 진입 효과 표시 */}
                    <Reveal className="section-heading">
                        {/* 판정 근거를 한눈에 보기의 구역 제목 표시 */}
                        <h2 id="help-title">판정 근거를 한눈에 보기</h2>
                        {/* 서비스 소개의 안내 문구 표시 */}
                        <p>결과를 읽는 순서를 고정해 장면과 규정의 차이를 놓치지 않습니다.</p>
                    </Reveal>
                    {/* 결과 읽기 순서의 화면 묶음 표시 */}
                    <div className="help-grid">
                        {help.map((item, index) => (
                            // 화면 진입 효과 표시
                            <Reveal as="article" delay={200 + index * 70} key={item.number}>
                                {/* 서비스 소개의 강조 문구 표시 */}
                                <strong>{item.number}</strong>
                                {/* 서비스 소개의 항목 제목 표시 */}
                                <h3>{item.title}</h3>
                                {/* 서비스 소개의 안내 문구 표시 */}
                                <p>{item.text}</p>
                                {/* →의 짧은 문구 표시 */}
                                <span aria-hidden="true">→</span>
                            </Reveal>
                        ))}
                    </div>
                </section>

                {/* 분석 시작 안내 표시 */}
                <PreFooter />
            </main>

            {/* 공통 푸터 표시 */}
            <Footer />
            {/* 빠른 이동 도구 표시 */}
            <FloatingTools />
        </div>
    );
}
