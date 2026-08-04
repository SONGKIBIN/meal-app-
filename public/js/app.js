/* 전역 상태 */
let currentWeekAnchor = new Date().toISOString().slice(0, 10);
let currentMainTab = "my";

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
  switchMainTab("my");
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
  } catch (err) {
    grid.innerHTML = `<div>${escapeHtml(err.message)}</div>`;
  }
}

function renderWeekGrid(days) {
  const grid = document.getElementById("weekGrid");
  const today = todayStr();
  grid.innerHTML = days.map((day) => {
    const wd = WEEKDAY_KEYS[new Date(day.date + "T00:00:00Z").getUTCDay()];
    const isToday = day.date === today;
    return `
      <div class="day-cell ${isToday ? "today" : ""}">
        <div class="date-label">${day.date.slice(5)}</div>
        <div class="weekday-label">${t(wd)}</div>
        ${renderMealButton(day.date, "lunch", day.lunch)}
        ${renderMealButton(day.date, "dinner", day.dinner)}
      </div>
    `;
  }).join("");

  grid.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", onMealButtonClick);
  });
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
