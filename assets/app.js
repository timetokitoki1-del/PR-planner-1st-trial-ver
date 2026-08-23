(function () {
  const letters = ["A", "B", "C", "D"];
  const config = window.PR_APP_CONFIG || { edition: "full" };
  const noteUrl = config.noteUrl || "https://note.com/s_shindan";
  const isTrial = config.edition === "trial";
  const mockCount = config.mockCount || (isTrial ? 10 : 50);
  const mockMinutes = config.mockMinutes || (isTrial ? 16 : 80);
  const bank = window.PR_QUIZ_BANK;
  const allQuestions = bank.questions.filter((q) => {
    if (isTrial) return q.chapter === 1;
    return true;
  });
  const chapters = bank.chapters.filter((c) => {
    if (isTrial) return c.no === 1;
    return true;
  });

  const state = {
    mode: "home",
    currentSet: [],
    currentIndex: 0,
    answers: {},
    startedAt: null,
    timerId: null,
    timeLimitSec: 0,
    remainingSec: 0,
    quizKind: "practice",
    lastResult: null,
  };

  const els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function init() {
    [
      "editionLabel",
      "questionCount",
      "chapterCount",
      "mockInfo",
      "wrongCount",
      "bookmarkCount",
      "chapterGrid",
      "homeScreen",
      "quizScreen",
      "resultScreen",
      "reviewScreen",
      "bookmarkScreen",
      "quizTitle",
      "quizSub",
      "timer",
      "timerWrap",
      "progressBar",
      "questionIndex",
      "questionDifficulty",
      "questionText",
      "options",
      "explanation",
      "choiceReasons",
      "nextBtn",
      "finishBtn",
      "bookmarkBtn",
      "resultTitle",
      "scoreRate",
      "scoreDetail",
      "scoreJudge",
      "resultMeta",
      "reviewAdvice",
      "reviewList",
      "wrongReviewList",
      "bookmarkReviewList",
    ].forEach((id) => (els[id] = $(id)));

    els.editionLabel.textContent =
      isTrial ? "第1章トライアル版" : "14章＋模試版";
    els.questionCount.textContent = allQuestions.length;
    els.chapterCount.textContent = chapters.length;
    els.mockInfo.textContent = `${mockCount}問 / ${mockMinutes}分`;
    updateWrongCount();
    updateBookmarkCount();
    document.querySelectorAll(".note-link").forEach((link) => {
      link.href = noteUrl;
    });
    renderChapters();
    bindActions();
    showScreen("home");
  }

  function bindActions() {
    document.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => handleTab(btn.dataset.tab));
    });

    on("startMockBtn", "click", startMock);
    on("retryWrongBtn", "click", startWrongRetry);
    on("finishBtn", "click", () => finishQuiz(true));
    on("nextBtn", "click", nextQuestion);
    on("homeBtn", "click", () => {
      clearTimer();
      showScreen("home");
    });
    on("bookmarkBtn", "click", toggleCurrentBookmark);
    on("resultHomeBtn", "click", () => showScreen("home"));
    on("resultWrongBtn", "click", startWrongRetry);
    on("retryBookmarkBtn", "click", startBookmarkRetry);
  }

  function on(id, eventName, handler) {
    const el = $(id);
    if (el) el.addEventListener(eventName, handler);
  }

  function handleTab(tab) {
    document.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.setAttribute("aria-selected", btn.dataset.tab === tab ? "true" : "false");
    });
    if (tab === "chapters") showScreen("home");
    if (tab === "mock") startMock();
    if (tab === "wrong") showWrongReview();
    if (tab === "bookmark") showBookmarkReview();
  }

  function renderChapters() {
    els.chapterGrid.innerHTML = "";
    chapters.forEach((chapter) => {
      const count = allQuestions.filter((q) => q.chapter === chapter.no).length;
      const button = document.createElement("button");
      button.className = "chapter-card";
      button.type = "button";
      button.innerHTML = `
        <span class="chapter-no">第${chapter.no}章</span>
        <strong>${chapter.title}</strong>
        <span>${chapter.theme}</span>
        <span>${count}問収録</span>
      `;
      button.addEventListener("click", () => startChapter(chapter.no));
      els.chapterGrid.appendChild(button);
    });
  }

  function showScreen(name) {
    ["homeScreen", "quizScreen", "resultScreen", "reviewScreen", "bookmarkScreen"].forEach((id) => {
      if (els[id]) els[id].classList.toggle("active", id === `${name}Screen`);
    });
    state.mode = name;
    if (name !== "quiz") clearTimer();
    updateWrongCount();
    updateBookmarkCount();
  }

  function startChapter(chapterNo) {
    const set = shuffle(allQuestions.filter((q) => q.chapter === chapterNo));
    const chapter = bank.chapters.find((c) => c.no === chapterNo);
    startQuiz(set, `第${chapterNo}章 ${chapter.title}`, `${set.length}問 / 章別演習`, 0);
  }

  function startMock() {
    if (isTrial) {
      const count = Math.min(mockCount, allQuestions.length);
      const set = shuffle(allQuestions).slice(0, count);
      startQuiz(
        set,
        "トライアル模試",
        `${count}問 / ${mockMinutes}分 / 70%以上で合格。フル版では50問の本番形式模試に挑戦できます。`,
        mockMinutes * 60,
        "mock"
      );
      return;
    }
    const count = Math.min(mockCount, allQuestions.length);
    const set = pickBalancedMock(allQuestions, count);
    startQuiz(set, "本番形式 模擬試験", `${count}問 / ${mockMinutes}分 / 70%以上で合格`, mockMinutes * 60, "mock");
  }

  function startWrongRetry() {
    const ids = getWrongIds();
    const set = shuffle(allQuestions.filter((q) => ids.includes(q.id)));
    if (!set.length) {
      showWrongReview();
      return;
    }
    startQuiz(set, "間違った問題を解く", `${set.length}問 / 弱点復習`, 0);
  }

  function startBookmarkRetry() {
    const ids = getBookmarkIds();
    const set = allQuestions.filter((q) => ids.includes(q.id));
    if (!set.length) {
      showBookmarkReview();
      return;
    }
    startQuiz(set, "ブックマーク問題を演習", `${set.length}問 / あとで見直す問題`, 0);
  }

  function startQuiz(set, title, sub, timeLimitSec, quizKind = "practice") {
    state.currentSet = set;
    state.currentIndex = 0;
    state.answers = {};
    state.startedAt = Date.now();
    state.timeLimitSec = timeLimitSec;
    state.remainingSec = timeLimitSec;
    state.quizKind = quizKind;
    els.quizTitle.textContent = title;
    els.quizSub.textContent = sub;
    els.timerWrap.style.display = timeLimitSec ? "block" : "none";
    showScreen("quiz");
    renderQuestion();
    if (timeLimitSec) startTimer();
  }

  function renderQuestion() {
    const q = state.currentSet[state.currentIndex];
    const answered = state.answers[q.id];
    const chapter = bank.chapters.find((c) => c.no === q.chapter);
    els.questionIndex.textContent = `${state.currentIndex + 1} / ${state.currentSet.length}`;
    els.questionDifficulty.textContent = `${chapter ? `第${chapter.no}章` : ""} ${difficultyLabel(q.difficulty)}`;
    els.questionText.textContent = q.prompt;
    els.progressBar.style.width = `${((state.currentIndex + 1) / state.currentSet.length) * 100}%`;
    els.options.innerHTML = "";
    renderBookmarkButton(q);

    q.options.forEach((option, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "option";
      if (answered !== undefined) {
        if (index === q.answer) btn.classList.add("correct");
        if (index === answered && index !== q.answer) btn.classList.add("wrong");
      }
      btn.innerHTML = `<span class="option-letter">${letters[index]}</span><span>${option.text}</span>`;
      btn.disabled = answered !== undefined;
      btn.addEventListener("click", () => answerQuestion(index));
      els.options.appendChild(btn);
    });

    renderExplanation(q, answered);
    els.nextBtn.style.display = answered !== undefined ? "inline-flex" : "none";
    els.nextBtn.textContent =
      state.currentIndex === state.currentSet.length - 1 ? "結果を見る" : "次の問題へ";
  }

  function renderExplanation(q, answered) {
    const visible = answered !== undefined;
    els.explanation.classList.toggle("active", visible);
    els.choiceReasons.innerHTML = "";
    if (!visible) return;
    q.options.forEach((option, index) => {
      const div = document.createElement("div");
      div.className = "reason";
      const prefix = index === q.answer ? "正解" : "不正解";
      div.innerHTML = `<strong>${letters[index]}：${prefix}</strong><br>${option.reason}`;
      els.choiceReasons.appendChild(div);
    });
  }

  function renderBookmarkButton(q) {
    if (!els.bookmarkBtn) return;
    const saved = getBookmarkIds().includes(q.id);
    els.bookmarkBtn.textContent = saved ? "ブックマーク済み" : "ブックマークに保存";
    els.bookmarkBtn.classList.toggle("bookmarked", saved);
    els.bookmarkBtn.setAttribute("aria-pressed", saved ? "true" : "false");
  }

  function answerQuestion(index) {
    const q = state.currentSet[state.currentIndex];
    state.answers[q.id] = index;
    updateWrongStorage(q, index);
    renderQuestion();
  }

  function nextQuestion() {
    if (state.currentIndex >= state.currentSet.length - 1) {
      finishQuiz(false);
      return;
    }
    state.currentIndex += 1;
    renderQuestion();
  }

  function finishQuiz(earlyExit) {
    clearTimer();
    const answeredQuestions = state.currentSet.filter((q) => state.answers[q.id] !== undefined);
    const denominator = earlyExit ? answeredQuestions.length : state.currentSet.length;
    const correct = answeredQuestions.filter((q) => state.answers[q.id] === q.answer).length;
    const rate = denominator ? Math.round((correct / denominator) * 100) : 0;
    const passed = rate >= 70 && denominator > 0;
    const elapsed = Math.round((Date.now() - state.startedAt) / 1000);
    state.lastResult = {
      correct,
      denominator,
      total: state.currentSet.length,
      rate,
      passed,
      elapsed,
      earlyExit,
      quizKind: state.quizKind,
      questions: state.currentSet,
      answers: { ...state.answers },
    };
    renderResult();
    showScreen("result");
  }

  function renderResult() {
    const r = state.lastResult;
    els.resultTitle.textContent = r.earlyExit ? "途中終了時点の判定" : "演習結果";
    els.scoreRate.textContent = `${r.rate}%`;
    els.scoreDetail.textContent = `${r.correct} / ${r.denominator} 問正解`;
    els.scoreJudge.textContent = r.passed ? "合格ライン到達" : "合格ライン未達";
    els.resultMeta.textContent = `対象: ${r.denominator}問 / 全${r.total}問、経過時間: ${formatTime(r.elapsed)}。合格基準は70%以上です。`;
    renderReviewAdvice(r);
    els.reviewList.innerHTML = "";
    r.questions.forEach((q, idx) => {
      const selected = r.answers[q.id];
      const div = document.createElement("div");
      div.className = "review-item";
      const mark = selected === q.answer ? "ok" : "ng";
      const selectedText = selected === undefined ? "未回答" : `${letters[selected]} ${q.options[selected].text}`;
      div.innerHTML = `
        <div><span class="mark ${mark}">${selected === q.answer ? "正解" : "要復習"}</span> Q${idx + 1}. ${q.prompt}</div>
        <div class="footer-note">あなたの回答: ${selectedText}<br>正解: ${letters[q.answer]} ${q.options[q.answer].text}</div>
      `;
      els.reviewList.appendChild(div);
    });
  }

  function renderReviewAdvice(result) {
    if (!els.reviewAdvice) return;
    els.reviewAdvice.classList.remove("active");
    els.reviewAdvice.innerHTML = "";
    if (result.quizKind !== "mock") return;

    const summaries = chapters
      .map((chapter) => {
        const attempted = result.questions.filter(
          (q) => q.chapter === chapter.no && result.answers[q.id] !== undefined
        );
        const correct = attempted.filter((q) => result.answers[q.id] === q.answer).length;
        const answered = attempted.length;
        return {
          chapter,
          answered,
          correct,
          wrong: answered - correct,
          rate: answered ? Math.round((correct / answered) * 100) : 0,
        };
      })
      .filter((item) => item.answered > 0);

    const weakChapters = summaries
      .filter((item) => item.rate < 80 || item.wrong > 0)
      .sort((a, b) => a.rate - b.rate || b.wrong - a.wrong || b.answered - a.answered)
      .slice(0, 3);

    const lead = result.passed
      ? "合格ラインには届いています。さらに安定させるなら、落とした章を短く復習しましょう。"
      : "合格ラインまであと一歩です。まずは失点が出た章から戻ると、伸びが出やすいです。";

    const body = weakChapters.length
      ? weakChapters
          .map(
            (item) => `
              <div class="advice-item">
                <strong>第${item.chapter.no}章 ${item.chapter.title}</strong>
                <span>${item.correct}/${item.answered}問正解・正答率${item.rate}%</span>
                <p>${reviewHint(item.chapter.no)}</p>
              </div>
            `
          )
          .join("")
      : `
        <div class="advice-item">
          <strong>大きな弱点章は目立ちません</strong>
          <span>回答済み問題は高水準で安定しています</span>
          <p>次はブックマークした問題と、迷った選択肢の理由を確認すると得点が固まりやすくなります。</p>
        </div>
      `;

    els.reviewAdvice.innerHTML = `
      <div>
        <span class="advice-label">模試後の復習提案</span>
        <h3>次に復習すると伸びやすい章</h3>
        <p>${lead}</p>
      </div>
      <div class="advice-list">${body}</div>
      <a class="btn primary" href="${noteUrl}" target="_blank" rel="noopener">Noteで復習する</a>
    `;
    els.reviewAdvice.classList.add("active");
  }

  function reviewHint(chapterNo) {
    return {
      1: "PRの定義、広告との違い、ステークホルダーの範囲をもう一度整理しましょう。",
      2: "経営と広報の接続、社会環境、企業価値との関係を確認しましょう。",
      3: "PDCA、アウトプットとアウトカム、効果測定の違いを重点的に復習しましょう。",
      4: "送り手・受け手・媒体・ノイズと、効果理論のひっかけを確認しましょう。",
      5: "ニュース価値、リリース、記者対応、広告との違いを復習しましょう。",
      6: "STP、4P/4C、購買行動モデル、プッシュとプルを整理しましょう。",
      7: "MPR、IMC、PESO、製品ライフサイクルとの関係を押さえ直しましょう。",
      8: "ブランド・エクイティ、アイデンティティとイメージ、ブランド体系を確認しましょう。",
      9: "CSR、ISO26000、トリプルボトムライン、ESG/SDGsの違いを復習しましょう。",
      10: "トップダウンとボトムアップ、社内媒体、従業員理解の論点を見直しましょう。",
      11: "IRの目的、開示制度、公平性、企業価値指標を整理しましょう。",
      12: "異文化理解、海外メディア対応、現地文脈への合わせ方を確認しましょう。",
      13: "リスク・クライシス・イシュー、初動対応、記者会見、再発防止を復習しましょう。",
      14: "行政広報、情報公開、市民参加、地域PR、公共団体広報を見直しましょう。",
    }[chapterNo] || "この章の基本語句とひっかけ選択肢を確認しましょう。";
  }

  function showWrongReview() {
    const ids = getWrongIds();
    const wrongs = allQuestions.filter((q) => ids.includes(q.id));
    els.wrongReviewList.innerHTML = "";
    if (!wrongs.length) {
      els.wrongReviewList.innerHTML = `<div class="empty">まだ間違った問題はありません。章別演習か模試を解くと、ここに自動で保存されます。</div>`;
    } else {
      wrongs.forEach((q) => {
        const chapter = bank.chapters.find((c) => c.no === q.chapter);
        const div = document.createElement("div");
        div.className = "review-item";
        div.innerHTML = `
          <strong>第${chapter.no}章 ${chapter.title}</strong>
          <div>${q.prompt}</div>
          <div class="footer-note">正解: ${letters[q.answer]} ${q.options[q.answer].text}</div>
        `;
        els.wrongReviewList.appendChild(div);
      });
    }
    showScreen("review");
  }

  function showBookmarkReview() {
    const ids = getBookmarkIds();
    const bookmarks = allQuestions.filter((q) => ids.includes(q.id));
    if (!els.bookmarkReviewList) return;
    els.bookmarkReviewList.innerHTML = "";
    if (!bookmarks.length) {
      els.bookmarkReviewList.innerHTML = `<div class="empty">まだブックマークはありません。解説を読んで「あとでもう一度見たい」と思った問題を保存しておけます。</div>`;
    } else {
      bookmarks.forEach((q) => {
        const chapter = bank.chapters.find((c) => c.no === q.chapter);
        const div = document.createElement("div");
        div.className = "review-item";
        div.innerHTML = `
          <strong>第${chapter.no}章 ${chapter.title}</strong>
          <div>${q.prompt}</div>
          <div class="footer-note">正解: ${letters[q.answer]} ${q.options[q.answer].text}</div>
        `;
        els.bookmarkReviewList.appendChild(div);
      });
    }
    showScreen("bookmark");
  }

  function toggleCurrentBookmark() {
    const q = state.currentSet[state.currentIndex];
    if (!q) return;
    const ids = new Set(getBookmarkIds());
    if (ids.has(q.id)) ids.delete(q.id);
    else ids.add(q.id);
    localStorage.setItem(bookmarkKey(), JSON.stringify([...ids]));
    updateBookmarkCount();
    renderBookmarkButton(q);
  }

  function updateWrongStorage(q, selected) {
    const ids = new Set(getWrongIds());
    if (selected === q.answer) ids.delete(q.id);
    else ids.add(q.id);
    localStorage.setItem(storageKey(), JSON.stringify([...ids]));
    updateWrongCount();
  }

  function getWrongIds() {
    try {
      return JSON.parse(localStorage.getItem(storageKey()) || "[]");
    } catch {
      return [];
    }
  }

  function getBookmarkIds() {
    try {
      return JSON.parse(localStorage.getItem(bookmarkKey()) || "[]");
    } catch {
      return [];
    }
  }

  function storageKey() {
    return `pr-planner-wrong-${config.edition}`;
  }

  function bookmarkKey() {
    return `pr-planner-bookmark-${config.edition}`;
  }

  function updateWrongCount() {
    if (els.wrongCount) els.wrongCount.textContent = getWrongIds().length;
  }

  function updateBookmarkCount() {
    if (els.bookmarkCount) els.bookmarkCount.textContent = getBookmarkIds().length;
  }

  function startTimer() {
    clearTimer();
    renderTimer();
    state.timerId = setInterval(() => {
      state.remainingSec -= 1;
      renderTimer();
      if (state.remainingSec <= 0) finishQuiz(false);
    }, 1000);
  }

  function renderTimer() {
    els.timer.textContent = formatTime(state.remainingSec);
  }

  function clearTimer() {
    if (state.timerId) clearInterval(state.timerId);
    state.timerId = null;
  }

  function pickBalancedMock(questions, count) {
    const byChapter = chapters.map((chapter) => shuffle(questions.filter((q) => q.chapter === chapter.no)));
    const picked = [];
    let cursor = 0;
    while (picked.length < count && byChapter.some((items) => items.length)) {
      const bucket = byChapter[cursor % byChapter.length];
      if (bucket && bucket.length) picked.push(bucket.shift());
      cursor += 1;
    }
    return shuffle(picked).slice(0, count);
  }

  function shuffle(items) {
    return [...items].sort(() => Math.random() - 0.5);
  }

  function difficultyLabel(value) {
    return { basic: "基本", standard: "標準", trap: "ひっかけ" }[value] || "標準";
  }

  function formatTime(sec) {
    const safe = Math.max(0, sec || 0);
    const m = Math.floor(safe / 60);
    const s = safe % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  document.addEventListener("DOMContentLoaded", init);
})();
