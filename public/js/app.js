/* 전역 상태 */
let currentWeekAnchor = new Date().toISOString().slice(0, 10);
let currentMainTab = "my";
let deferredInstallPrompt = null;

/* ---------------------------- 공통 유틸 ---------------------------- */

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

function todayStr() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function applyI18n() {
  document.documentElement.lang = getLang();
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.getElementById("langSelect").value = getLang();
  document.getElementById("langSelectLogin").value = getLang();
}

/* ---------------------------- 로그인 / 로그아웃 ---------------------------- */

function showLoginView() {
  document.getElementById("loginView").classList.remove("hidden");
  document.getElementById("appView").classList.add("hidden");
  document.getElementById("topbar").classList.add("hidden");
}

function showAppView() {
  document.getElementById("loginView").classList.add("hidden");
  document.getElementById("appView").classList.remove("hidden");
  document.getElementById("topbar").classList.remove("hidden");
  const user = API.getUser();
  document.getElementById("userBadge").innerHTML =
    `${escapeHtml(user.name)} (${escapeHtml(user.employeeId)})` +
    (user.role === "admin" ? ` <span class="badge admin">${t("admin")}</span>` : "");
  document.getElementById("tabAdmin").classList.toggle("hidden", user.role !== "admin");
  if ("Notification" in window && "serviceWorker" in navigator && "PushManager" in window) {
    document.getElementById("notifyBtn").classList.remove("hidden");
  }
  switchMainTab("my");
  checkAnnouncement();
}

async function doLogin() {
  const employeeId = document.getElementById("inputEmployeeId").value.trim();
  const name = document.getElementById("inputName").value.trim();
  const errEl = document.getElementById("loginError");
  errEl.textContent = "";
  if (!employeeId || !name) {
    errEl.textContent = t("loginHelp");
    return;
  }
  try {
    const data = await API.request("POST", "/auth/login", { employeeId, name }, { silent: true });
    API.setToken(data.token);
    API.setUser(data.user);
    showAppView();
  } catch (err) {
    errEl.textContent = err.message;
  }
}

function doLogout() {
  API.setToken(null);
  API.setUser(null);
  showLoginView();
}

/* ---------------------------- 탭 전환 ---------------------------- */

function switchMainTab(tabName) {
  currentMainTab = tabName;
  document.querySelectorAll("#mainTabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tabName));
  document.getElementById("myView").classList.toggle("hidden", tabName !== "my");
  document.getElementById("adminView").classList.toggle("hidden", tabName !== "admin");
  if (tabName === "my") {
    loadWeek(currentWeekAnchor);
  } else if (tabName === "admin") {
    AdminUI.switchTab(AdminUI.currentTab || "status");
  }
}

/* ---------------------------- 주간 캘린더 (내 신청) ---------------------------- */

function weekLabelText(week) {
  if (!week || !week.length) return "-";
  return `${week[0]} ~ ${week[6]}`;
}

async function loadWeek(anchorDate) {
  const grid = document.getElementById("weekGrid");
  grid.innerHTML = `<div>${t("loading")}</div>`;
  try {
    const data = await API.get(`/reservations/week?date=${anchorDate}`);
    currentWeekAnchor = anchorDate;
    document.getElementById("weekLabel").textContent = weekLabelText(data.week);
    document.getElementById("deadlineNote").textContent = t("deadlineNotice", data.deadline.hour, data.deadline.minute);
    renderWeekGrid(data.days);
    checkTodayReminder(data.days);
  } catch (err) {
    grid.innerHTML = `<div>${escapeHtml(err.message)}</div>`;
  }
}

/* ---------------------------- 오늘자 미신청 안내 팝업 ---------------------------- */

function checkTodayReminder(days) {
  if (isContractorUser()) return; // 도급회사(단체) 계정은 인원수를 직접 입력하는 방식이라 안내 팝업을 띄우지 않습니다.
  const today = todayStr();
  const todayInfo = days.find((d) => d.date === today);
  if (!todayInfo) return;
  const flagKey = `meal_reminder_shown_${today}`;
  if (sessionStorage.getItem(flagKey)) return;
  const lunchPending = !todayInfo.lunch.applied && todayInfo.lunch.canApply;
  const dinnerPending = !todayInfo.dinner.applied && todayInfo.dinner.canApply;
  if (!lunchPending && !dinnerPending) return;
  sessionStorage.setItem(flagKey, "1");
  const msg = lunchPending && dinnerPending ? t("reminderBothMsg") : lunchPending ? t("reminderLunchMsg") : t("reminderDinnerMsg");
  openModal(`
    <h3>${t("reminderTitle")}</h3>
    <p>${escapeHtml(msg)}</p>
    <div class="toolbar" style="margin-top:14px;">
      ${lunchPending ? `<button data-quick-apply="lunch">${t("lunch")} ${t("applyNow")}</button>` : ""}
      ${dinnerPending ? `<button data-quick-apply="dinner">${t("dinner")} ${t("applyNow")}</button>` : ""}
      <button class="secondary" id="reminderLaterBtn">${t("remindLater")}</button>
    </div>
  `);
  const laterBtn = document.getElementById("reminderLaterBtn");
  if (laterBtn) laterBtn.addEventListener("click", closeModal);
  document.querySelectorAll("[data-quick-apply]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await API.post("/reservations", { date: today, mealType: btn.dataset.quickApply });
        showToast(t("applySuccess"));
        closeModal();
        loadWeek(currentWeekAnchor);
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

/* ---------------------------- 공지사항 배너 ---------------------------- */

async function checkAnnouncement() {
  const banner = document.getElementById("announcementBanner");
  try {
    const data = await API.get("/announcement/active");
    if (!data.announcement) {
      banner.classList.add("hidden");
      return;
    }
    const dismissKey = `meal_announcement_dismissed_${data.announcement._id}`;
    if (sessionStorage.getItem(dismissKey)) {
      banner.classList.add("hidden");
      return;
    }
    banner.innerHTML = `<div class="msg">${escapeHtml(data.announcement.message)}</div><button class="secondary" id="announcementCloseBtn">${t("close")}</button>`;
    banner.classList.remove("hidden");
    document.getElementById("announcementCloseBtn").addEventListener("click", () => {
      sessionStorage.setItem(dismissKey, "1");
      banner.classList.add("hidden");
    });
  } catch (err) {
    banner.classList.add("hidden");
  }
}

/* ---------------------------- 주간 식단표 보기 (이번 주 / 다음 주) ---------------------------- */

async function toggleMenuView() {
  const area = document.getElementById("menuViewArea");
  const btn = document.getElementById("toggleMenuBtn");
  if (!area.classList.contains("hidden")) {
    area.classList.add("hidden");
    btn.textContent = t("viewMenu");
    return;
  }
  btn.textContent = t("hideMenu");
  area.classList.remove("hidden");
  area.innerHTML = t("loading");
  const thisMonday = mondayOf(todayStr());
  const nextMonday = (() => {
    const d = new Date(thisMonday + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 7);
    return d.toISOString().slice(0, 10);
  })();
  try {
    const [thisData, nextData] = await Promise.all([
      API.get(`/menu/${thisMonday}`),
      API.get(`/menu/${nextMonday}`),
    ]);
    const block = (label, menu) => `
      <div class="card" style="margin-bottom:10px;">
        <h3>${label}</h3>
        ${menu
          ? (menu.imageData ? `<img src="${menu.imageData}" style="max-width:100%;border-radius:8px;border:1px solid var(--border);">` : "") +
            (menu.note ? `<p style="white-space:pre-wrap;">${escapeHtml(menu.note)}</p>` : "")
          : `<p class="deadline-note">${t("noMenu")}</p>`}
      </div>
    `;
    area.innerHTML = block(t("thisWeekMenu"), thisData.menu) + block(t("nextWeekMenu"), nextData.menu);
  } catch (err) {
    area.textContent = err.message;
  }
}

/* ---------------------------- PWA 설치 ---------------------------- */

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  document.getElementById("installBtn").classList.remove("hidden");
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  document.getElementById("installBtn").classList.add("hidden");
});

async function onInstallClick() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  document.getElementById("installBtn").classList.add("hidden");
}

/* ---------------------------- 휴대폰(웹 푸시) 알림 구독 ---------------------------- */

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function enableNotifications() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    alert(t("notifyFailed"));
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      alert(t("notifyFailed"));
      return;
    }
    const { publicKey } = await API.get("/push/vapid-public-key");
    if (!publicKey) {
      alert(t("notifyFailed"));
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    await API.post("/push/subscribe", { subscription: sub });
    showToast(t("notifyEnabled"));
  } catch (err) {
    console.error(err);
    alert(t("notifyFailed"));
  }
}

function isContractorUser() {
  const user = API.getUser();
  return !!user && user.employeeType === "contractor";
}

function renderWeekGrid(days) {
  const grid = document.getElementById("weekGrid");
  const today = todayStr();
  const contractor = isContractorUser();
  grid.innerHTML = days.map((day) => {
    const wd = WEEKDAY_KEYS[new Date(day.date + "T00:00:00Z").getUTCDay()];
    const isToday = day.date === today;
    return `
      <div class="day-cell ${isToday ? "today" : ""}">
        <div class="date-label">${day.date.slice(5)}</div>
        <div class="weekday-label">${t(wd)}</div>
        ${contractor ? renderHeadcountRow(day.date, "lunch", day.lunch) : renderMealButton(day.date, "lunch", day.lunch)}
        ${contractor ? renderHeadcountRow(day.date, "dinner", day.dinner) : renderMealButton(day.date, "dinner", day.dinner)}
      </div>
    `;
  }).join("");

  grid.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", onMealButtonClick);
  });
  grid.querySelectorAll("button[data-headcount-save]").forEach((btn) => {
    btn.addEventListener("click", onHeadcountSaveClick);
  });
}

// 도급회사(단체) 계정용: 토글 버튼 대신 인원수를 숫자로 입력해 신청/수정/취소(0 입력)합니다.
function renderHeadcountRow(date, mealType, info) {
  const mealLabel = t(mealType);
  const editable = info.canApply; // 신청 가능 여부와 취소(변경) 가능 여부가 동일한 규칙이라 하나로 사용합니다.
  const value = info.headcount ? info.headcount : "";
  return `
    <div class="meal-row headcount-row" data-date="${date}" data-meal="${mealType}">
      <div class="meal-name">${mealLabel}</div>
      <input type="number" min="0" max="9999" class="headcount-input" placeholder="${t("headcountPlaceholder")}" value="${value}" ${editable ? "" : "disabled"}>
      <button data-headcount-save ${editable ? "" : "disabled"}>${t("saveHeadcount")}</button>
    </div>
  `;
}

async function onHeadcountSaveClick(e) {
  const btn = e.currentTarget;
  const row = btn.closest(".headcount-row");
  const date = row.dataset.date;
  const meal = row.dataset.meal;
  const input = row.querySelector(".headcount-input");
  const raw = input.value.trim();
  const n = raw === "" ? 0 : parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0 || n > 9999) {
    alert(t("headcountPlaceholder"));
    return;
  }
  btn.disabled = true;
  try {
    if (n === 0) {
      await API.del("/reservations", { date, mealType: meal });
      showToast(t("cancelSuccess"));
    } else {
      await API.post("/reservations", { date, mealType: meal, headcount: n });
      showToast(t("headcountSaved"));
    }
    loadWeek(currentWeekAnchor);
  } catch (err) {
    alert(err.message);
    loadWeek(currentWeekAnchor);
  }
}

function renderMealButton(date, mealType, info) {
  const mealLabel = t(mealType);
  let btnLabel, action, disabled = false, cls = "";
  if (info.applied) {
    cls = "applied";
    if (info.canCancel) {
      btnLabel = `${mealLabel} ${t("applied")} (${t("cancel")})`;
      action = "cancel";
    } else {
      btnLabel = `${mealLabel} ${t("applied")}`;
      action = "cancel";
      disabled = true;
    }
  } else {
    btnLabel = `${mealLabel} ${t("apply")}`;
    action = "apply";
    if (!info.canApply) disabled = true;
  }
  return `
    <div class="meal-row">
      <button data-action="${action}" data-date="${date}" data-meal="${mealType}" class="${cls}" ${disabled ? "disabled" : ""}>${btnLabel}</button>
    </div>
  `;
}

async function onMealButtonClick(e) {
  const btn = e.currentTarget;
  const date = btn.dataset.date;
  const meal = btn.dataset.meal;
  const action = btn.dataset.action;
  if (action === "cancel") {
    if (!confirm(t("confirmCancel"))) return;
  }
  btn.disabled = true;
  try {
    if (action === "apply") {
      await API.post("/reservations", { date, mealType: meal });
      showToast(t("applySuccess"));
    } else {
      await API.del("/reservations", { date, mealType: meal });
      showToast(t("cancelSuccess"));
    }
    loadWeek(currentWeekAnchor);
  } catch (err) {
    alert(err.message);
    loadWeek(currentWeekAnchor);
  }
}

function shiftWeek(days) {
  const d = new Date(currentWeekAnchor + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  loadWeek(d.toISOString().slice(0, 10));
}

/* ---------------------------- 초기화 ---------------------------- */

function initLangSelectors() {
  ["langSelect", "langSelectLogin"].forEach((id) => {
    document.getElementById(id).addEventListener("change", (e) => {
      setLang(e.target.value);
      applyI18n();
      if (!document.getElementById("appView").classList.contains("hidden")) {
        if (currentMainTab === "my") loadWeek(currentWeekAnchor);
        else if (AdminUI.currentTab) AdminUI.switchTab(AdminUI.currentTab);
      }
    });
  });
}

function init() {
  applyI18n();
  initLangSelectors();

  document.getElementById("loginBtn").addEventListener("click", doLogin);
  document.getElementById("inputName").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
  document.getElementById("inputEmployeeId").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
  document.getElementById("logoutBtn").addEventListener("click", doLogout);
  document.getElementById("prevWeekBtn").addEventListener("click", () => shiftWeek(-7));
  document.getElementById("nextWeekBtn").addEventListener("click", () => shiftWeek(7));
  document.getElementById("toggleMenuBtn").addEventListener("click", toggleMenuView);
  document.getElementById("installBtn").addEventListener("click", onInstallClick);
  document.getElementById("notifyBtn").addEventListener("click", enableNotifications);

  document.querySelectorAll("#mainTabs button").forEach((b) => {
    b.addEventListener("click", () => switchMainTab(b.dataset.tab));
  });

  if (API.getToken() && API.getUser()) {
    showAppView();
  } else {
    showLoginView();
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  }
}

document.addEventListener("DOMContentLoaded", init);
