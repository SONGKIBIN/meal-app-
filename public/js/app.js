/* 전역 상태 */
let currentWeekAnchor = new Date().toISOString().slice(0, 10);
let currentMainTab = "my";
let deferredInstallPrompt = null;
let currentContractorTotalHeadcount = null; // 도급(단체) 계정의 등록된 총원(TO), 화면 표시용

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

const LAST_LOGIN_KEY = "meal_last_login";

// 마지막으로 로그인에 성공한 사번/이름을 저장해두면, 다음에 접속했을 때 입력칸에 자동으로 채워집니다.
function saveLastLogin(employeeId, name) {
  try {
    localStorage.setItem(LAST_LOGIN_KEY, JSON.stringify({ employeeId, name }));
  } catch (err) {
    // 저장 공간을 사용할 수 없는 환경이면 조용히 무시합니다 (자동 저장은 편의 기능이라 필수는 아님).
  }
}

function loadLastLogin() {
  try {
    const raw = localStorage.getItem(LAST_LOGIN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function prefillLoginForm() {
  const saved = loadLastLogin();
  if (!saved) return;
  const idInput = document.getElementById("inputEmployeeId");
  const nameInput = document.getElementById("inputName");
  if (idInput && !idInput.value) idInput.value = saved.employeeId || "";
  if (nameInput && !nameInput.value) nameInput.value = saved.name || "";
}

function showLoginView() {
  document.getElementById("loginView").classList.remove("hidden");
  document.getElementById("appView").classList.add("hidden");
  document.getElementById("topbar").classList.add("hidden");
  prefillLoginForm();
}

function showAppView() {
  document.getElementById("loginView").classList.add("hidden");
  document.getElementById("appView").classList.remove("hidden");
  document.getElementById("topbar").classList.remove("hidden");
  const user = API.getUser();
  const isContractor = user.employeeType === "contractor";
  // 도급(단체) 계정은 "도급" 표시 대신 부서명 + 이름으로 보여줍니다 (예: 협력업체 OO건설).
  const displayName = isContractor && user.department
    ? `${escapeHtml(user.department)} ${escapeHtml(user.name)}`
    : escapeHtml(user.name);
  document.getElementById("userBadge").innerHTML =
    `${displayName} (${escapeHtml(user.employeeId)})` +
    (user.role === "admin" ? ` <span class="badge admin">${t("admin")}</span>` : "");
  const isAdmin = user.role === "admin";
  // 마스터 관리자 계정(시스템 최초 설치 시 자동 생성된 계정)만 "내 식사 신청" 메뉴를 숨기고 관리자 화면만 보여줍니다.
  // 다른 직원에게 나중에 관리자 권한을 부여한 경우에는 예전처럼 관리자 화면과 식사 신청 화면을 모두 사용할 수 있습니다.
  const isMasterAdmin = !!user.isMasterAdmin;
  document.getElementById("tabAdmin").classList.toggle("hidden", !isAdmin);
  document.getElementById("tabMy").classList.toggle("hidden", isMasterAdmin);
  if (!isMasterAdmin && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window) {
    document.getElementById("notifyBtn").classList.remove("hidden");
  }
  updateInstallButtonVisibility();
  switchMainTab(isMasterAdmin ? "admin" : "my");
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
    saveLastLogin(employeeId, name);
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
    document.getElementById("deadlineNote").textContent = t(
      "deadlineNotice",
      data.deadline.lunch.hour,
      data.deadline.lunch.minute,
      data.deadline.dinner.hour,
      data.deadline.dinner.minute
    );
    currentContractorTotalHeadcount = data.contractor && Number.isInteger(data.contractor.totalHeadcount) ? data.contractor.totalHeadcount : null;
    renderWeekGrid(data.days);
    renderContractorToCard(data.contractor);
    checkTodayReminder(data.days);
  } catch (err) {
    grid.innerHTML = `<div>${escapeHtml(err.message)}</div>`;
  }
}

// 도급(단체) 계정 전용: 등록된 총원(TO)과, 대기 중인 총원 수정 요청이 있으면 함께 보여줍니다.
function renderContractorToCard(contractor) {
  const card = document.getElementById("contractorToCard");
  if (!card) return;
  if (!isContractorUser() || !contractor) {
    card.classList.add("hidden");
    card.innerHTML = "";
    return;
  }
  card.classList.remove("hidden");
  const user = API.getUser();
  const total = Number.isInteger(contractor.totalHeadcount) ? contractor.totalHeadcount : null;
  const pendingNotice = Number.isInteger(contractor.requestedHeadcount)
    ? `<p class="deadline-note">${escapeHtml(t("requestHeadcountPendingNotice", contractor.requestedHeadcount))}</p>`
    : "";
  const cardTitle = user.department ? `${escapeHtml(user.department)} ${escapeHtml(user.name)}` : escapeHtml(user.name);
  card.innerHTML = `
    <h3 style="margin:0 0 8px;">${cardTitle}</h3>
    <div class="summary-cards">
      <div class="stat"><div class="num">${total !== null ? total : "-"}</div><div class="lbl">${t("totalHeadcount")}</div></div>
    </div>
    ${pendingNotice}
    <div class="toolbar">
      <button class="secondary" id="requestHeadcountBtn">${t("requestHeadcountChange")}</button>
    </div>
  `;
  document.getElementById("requestHeadcountBtn").addEventListener("click", () => openHeadcountRequestModal(contractor));
}

function openHeadcountRequestModal(contractor) {
  const total = Number.isInteger(contractor.totalHeadcount) ? contractor.totalHeadcount : "";
  openModal(`
    <h3>${t("requestHeadcountModalTitle")}</h3>
    <div class="field"><label>${t("requestHeadcountCurrent")}</label><input value="${total !== "" ? total : "-"}" disabled></div>
    <div class="field"><label>${t("requestHeadcountNew")}</label><input id="reqHeadcountInput" type="number" min="0" max="9999" value="${total}"></div>
    <div class="field"><label>${t("requestHeadcountNote")}</label><textarea id="reqHeadcountNote" rows="3" style="width:100%;" placeholder="${t("requestHeadcountNotePlaceholder")}"></textarea></div>
    <div class="toolbar" style="margin-top:14px;">
      <button id="reqHeadcountSubmitBtn">${t("requestHeadcountSubmit")}</button>
      <button class="secondary" id="reqHeadcountCloseBtn">${t("close")}</button>
    </div>
  `);
  document.getElementById("reqHeadcountCloseBtn").addEventListener("click", closeModal);
  document.getElementById("reqHeadcountSubmitBtn").addEventListener("click", async () => {
    const n = parseInt(document.getElementById("reqHeadcountInput").value, 10);
    if (!Number.isInteger(n) || n < 0 || n > 9999) {
      alert(t("totalHeadcountPlaceholder"));
      return;
    }
    const note = document.getElementById("reqHeadcountNote").value.trim();
    try {
      await API.post("/reservations/headcount-request", { requestedHeadcount: n, note });
      closeModal();
      showToast(t("requestHeadcountSent"));
      loadWeek(currentWeekAnchor);
    } catch (err) {
      alert(err.message);
    }
  });
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

/* ---------------------------- 접속 링크 공유 / QR코드 ---------------------------- */

// 로그인한 화면 상단의 "접속 링크 공유" 버튼을 누르면, 이 사이트 주소를 복사하거나
// QR코드를 스캔해서 다른 직원에게 전달할 수 있는 모달을 보여줍니다.
function openShareLinkModal() {
  const url = window.location.origin + "/";
  const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(url)}`;
  openModal(`
    <h3>${t("shareLinkTitle")}</h3>
    <p class="deadline-note">${t("shareLinkHelp")}</p>
    <div class="field">
      <input id="shareLinkInput" value="${escapeHtml(url)}" readonly style="width:100%;">
    </div>
    <div class="toolbar">
      <button id="copyLinkBtn">${t("copyLink")}</button>
      <button class="secondary" id="shareLinkCloseBtn">${t("close")}</button>
    </div>
    <div style="text-align:center;margin-top:16px;">
      <img src="${qrImgUrl}" alt="QR" width="220" height="220"
        style="border-radius:8px;border:1px solid var(--border);"
        onerror="this.style.display='none'; document.getElementById('qrFallbackMsg').style.display='block';">
      <p id="qrFallbackMsg" class="deadline-note" style="display:none;">${t("qrLoadFailed")}</p>
    </div>
  `);
  document.getElementById("shareLinkCloseBtn").addEventListener("click", closeModal);
  document.getElementById("copyLinkBtn").addEventListener("click", async () => {
    const input = document.getElementById("shareLinkInput");
    try {
      await navigator.clipboard.writeText(url);
    } catch (err) {
      input.removeAttribute("readonly");
      input.select();
      document.execCommand("copy");
      input.setAttribute("readonly", "readonly");
    }
    showToast(t("linkCopied"));
  });
}

/* ---------------------------- PWA 설치 ---------------------------- */

// 아이폰/아이패드의 Safari는 beforeinstallprompt 이벤트를 지원하지 않아 자동 설치 팝업을 띄울 수 없습니다.
// 대신 기기를 감지해서 "공유 버튼 → 홈 화면에 추가" 방법을 안내하는 모달을 보여줍니다.
function isIOSDevice() {
  const ua = navigator.userAgent || "";
  // iPadOS 13+는 데스크톱 Safari로 위장하므로 터치 지원 + Mac 플랫폼 조합으로 함께 판별합니다.
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandaloneMode() {
  return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
}

// 로그인 후 화면에 진입할 때마다 기기/설치 상태에 맞춰 "앱 설치" 버튼 표시 여부를 갱신합니다.
function updateInstallButtonVisibility() {
  const btn = document.getElementById("installBtn");
  if (isStandaloneMode()) {
    btn.classList.add("hidden");
    return;
  }
  if (isIOSDevice()) {
    btn.classList.remove("hidden");
  } else if (deferredInstallPrompt) {
    btn.classList.remove("hidden");
  }
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (!isStandaloneMode()) document.getElementById("installBtn").classList.remove("hidden");
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  document.getElementById("installBtn").classList.add("hidden");
});

async function onInstallClick() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    document.getElementById("installBtn").classList.add("hidden");
    return;
  }
  if (isIOSDevice()) {
    openIosInstallGuide();
  }
}

function openIosInstallGuide() {
  openModal(`
    <h3>${t("iosInstallTitle")}</h3>
    <div class="ios-install-steps">
      <p><span class="badge admin">1</span> ${t("iosInstallStep1")}</p>
      <p><span class="badge admin">2</span> ${t("iosInstallStep2")}</p>
      <p><span class="badge admin">3</span> ${t("iosInstallStep3")}</p>
    </div>
    <div class="toolbar" style="margin-top:14px;">
      <button class="secondary" id="iosInstallCloseBtn">${t("close")}</button>
    </div>
  `);
  document.getElementById("iosInstallCloseBtn").addEventListener("click", closeModal);
}

/* ---------------------------- 업데이트 확인 (PWA로 설치한 경우 옛 버전이 캐시에 남아있을 수 있어 수동 갱신 제공) ---------------------------- */

async function checkForUpdate() {
  if (!confirm(t("updateConfirm"))) return;
  const btn = document.getElementById("checkUpdateBtn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = t("updateChecking");
  }
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (window.caches && caches.keys) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (err) {
    console.error(err);
  } finally {
    // 캐시/서비스워커를 정리한 뒤 새로고침하면 서버의 최신 파일을 새로 받아옵니다.
    location.reload();
  }
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
    const dayTypeCls = day.dayType === "holiday" ? "holiday" : day.dayType === "weekend" ? "weekend" : "";
    const holidayTag = day.dayType === "holiday" && day.holidayLabel ? ` <span class="holiday-tag">${escapeHtml(day.holidayLabel)}</span>` : "";
    return `
      <div class="day-cell ${isToday ? "today" : ""} ${dayTypeCls}">
        <div class="date-label">${day.date.slice(5)}</div>
        <div class="weekday-label">${t(wd)}${holidayTag}</div>
        ${contractor ? renderHeadcountRow(day.date, "lunch", day.lunch) : renderMealButton(day.date, "lunch", day.lunch) + renderGuestRow(day.date, "lunch", day.lunch)}
        ${contractor ? renderHeadcountRow(day.date, "dinner", day.dinner) : renderMealButton(day.date, "dinner", day.dinner) + renderGuestRow(day.date, "dinner", day.dinner)}
      </div>
    `;
  }).join("");

  grid.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", onMealButtonClick);
  });
  grid.querySelectorAll("button[data-headcount-save]").forEach((btn) => {
    btn.addEventListener("click", onHeadcountSaveClick);
  });
  grid.querySelectorAll("button[data-guest-save]").forEach((btn) => {
    btn.addEventListener("click", onGuestSaveClick);
  });
}

// 개인 직원용: 이미 신청한 끼니에 한해 함께 식사할 손님/내방객 인원을 추가로 등록할 수 있습니다.
function renderGuestRow(date, mealType, info) {
  if (!info.applied) return "";
  const editable = info.canCancel; // 신청 취소와 동일한 마감 규칙을 적용합니다.
  const value = info.guestCount || 0;
  return `
    <div class="meal-row guest-row" data-date="${date}" data-meal="${mealType}">
      <div class="meal-name">${t("guestCountLabel")}</div>
      <input type="number" min="0" max="99" class="guest-input" placeholder="0" value="${value}" ${editable ? "" : "disabled"}>
      <button data-guest-save class="secondary" ${editable ? "" : "disabled"}>${t("save")}</button>
    </div>
  `;
}

async function onGuestSaveClick(e) {
  const btn = e.currentTarget;
  const row = btn.closest(".guest-row");
  const date = row.dataset.date;
  const meal = row.dataset.meal;
  const input = row.querySelector(".guest-input");
  const raw = input.value.trim();
  const n = raw === "" ? 0 : parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0 || n > 99) {
    alert(t("guestCountPlaceholder"));
    return;
  }
  btn.disabled = true;
  try {
    await API.put("/reservations/guest-count", { date, mealType: meal, guestCount: n });
    showToast(t("guestCountSaved"));
    loadWeek(currentWeekAnchor);
  } catch (err) {
    alert(err.message);
    loadWeek(currentWeekAnchor);
  }
}

// 도급회사(단체) 계정용: 토글 버튼 대신 인원수를 숫자로 입력해 신청/수정/취소(0 입력)합니다.
// totalHeadcount(TO)가 등록되어 있으면 신청 인원과 미신청 인원을 함께 보여줍니다.
function renderHeadcountRow(date, mealType, info) {
  const mealLabel = t(mealType);
  const editable = info.canApply; // 신청 가능 여부와 취소(변경) 가능 여부가 동일한 규칙이라 하나로 사용합니다.
  const value = info.headcount ? info.headcount : "";
  const breakdown = currentContractorTotalHeadcount !== null
    ? `<div class="deadline-note" style="width:100%;margin:2px 0 0;">${t("appliedOfTotal", info.headcount, currentContractorTotalHeadcount)} · ${t("notAppliedCount")} ${info.notApplied ?? Math.max(currentContractorTotalHeadcount - info.headcount, 0)}</div>`
    : "";
  return `
    <div class="meal-row headcount-row" data-date="${date}" data-meal="${mealType}">
      <div class="meal-name">${mealLabel}</div>
      <input type="number" min="0" max="9999" class="headcount-input" placeholder="${t("headcountPlaceholder")}" value="${value}" ${editable ? "" : "disabled"}>
      <button data-headcount-save ${editable ? "" : "disabled"}>${t("saveHeadcount")}</button>
      ${breakdown}
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
  document.getElementById("checkUpdateBtn").addEventListener("click", checkForUpdate);
  document.getElementById("shareLinkBtn").addEventListener("click", openShareLinkModal);

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
