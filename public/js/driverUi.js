/* 통근버스 기사 모드 화면 로직 */

const DRIVER_TRIP_TYPES = ["commute", "regularLeave", "extendedLeave"];

const DriverUI = {
  currentTab: null,
  date: null,
  weekAnchor: null,
  month: null,
  todayTrip: "commute",
  todayData: null,
  weekTrip: "commute",
  weekData: null,

  init() {
    document.querySelectorAll("#driverTabs button").forEach((b) => {
      b.addEventListener("click", () => this.switchTab(b.dataset.dtab));
    });
  },

  switchTab(tab) {
    this.currentTab = tab || this.currentTab || "today";
    document.querySelectorAll("#driverTabs button").forEach((b) => b.classList.toggle("active", b.dataset.dtab === this.currentTab));
    const map = { today: "driverMainView", week: "driverWeekView", monthly: "driverMonthlyView" };
    Object.entries(map).forEach(([name, id]) => document.getElementById(id).classList.toggle("hidden", name !== this.currentTab));
    if (this.currentTab === "today") this.load(this.date);
    else if (this.currentTab === "week") this.loadWeek(this.weekAnchor);
    else if (this.currentTab === "monthly") this.loadMonthly(this.month);
  },

  // app.js의 switchMainTab에서 호출되는 진입점입니다.
  load(date) {
    return this.loadToday(date);
  },

  tripLabel(tt) {
    return t(`busTrip_${tt}`);
  },

  /* -------------------- 당일운행 (본인 차량 운행일지 기록 + 전체 차량 현황) -------------------- */
  async loadToday(date) {
    const container = document.getElementById("driverMainView");
    container.innerHTML = `<div class="card">${t("loading")}</div>`;
    try {
      this.date = date || this.date || todayStr();
      const data = await API.get(`/bus-driver/today?date=${this.date}`);
      this.todayData = data;
      this.renderToday(data);
    } catch (err) {
      container.innerHTML = `<div class="card">${escapeHtml(err.message)}</div>`;
    }
  },

  renderToday(data) {
    const container = document.getElementById("driverMainView");
    container.innerHTML = `
      <div class="card">
        <h2 style="margin-top:0;">${t("driverPanel")}</h2>
        <div class="toolbar">
          <label>${t("selectDate")}</label>
          <input type="date" id="drvDate" value="${data.date}">
        </div>
      </div>
      <div class="tabs" id="drvTodayTripTabs">
        ${DRIVER_TRIP_TYPES.map((tt) => `<button data-today-trip-tab="${tt}" class="${tt === this.todayTrip ? "active" : ""}">${t(`busTrip_${tt}`)}</button>`).join("")}
      </div>
      <div id="drvMyVehicleCard"></div>
      <div class="card">
        <h3>${t("driverAllVehicles")}</h3>
        <p class="deadline-note">${t("driverAllVehiclesHelp")}</p>
        <table class="data-table" id="drvAllVehiclesTable"></table>
      </div>
    `;
    document.getElementById("drvDate").addEventListener("change", (e) => this.loadToday(e.target.value));
    document.querySelectorAll("#drvTodayTripTabs button").forEach((b) => {
      b.addEventListener("click", () => {
        this.todayTrip = b.dataset.todayTripTab;
        this.renderTodayContent();
      });
    });
    this.renderTodayContent();
  },

  // 탭(출근/정시퇴근/연장퇴근) 전환 시에는 이미 받아온 데이터를 그대로 다시 그리기만 합니다.
  renderTodayContent() {
    if (!this.todayData) return;
    document.querySelectorAll("#drvTodayTripTabs button").forEach((b) => b.classList.toggle("active", b.dataset.todayTripTab === this.todayTrip));
    const tripType = this.todayTrip;
    const myVehicle = this.todayData.myVehicle;

    const myCardHolder = document.getElementById("drvMyVehicleCard");
    if (myVehicle) {
      const tp = myVehicle.trips.find((t2) => t2.tripType === tripType);
      myCardHolder.innerHTML = `
        <div class="card">
          <h3>${t("driverMyVehicle")}: ${escapeHtml(myVehicle.routeName)} ${escapeHtml(myVehicle.name)}</h3>
          ${this.renderMyTripCard(myVehicle.vehicleId, tp)}
        </div>
      `;
      const form = document.getElementById(`drvLogForm_${tp.tripType}`);
      if (form) form.addEventListener("submit", (e) => this.onSubmitLog(e, myVehicle.vehicleId, tp.tripType));
    } else {
      myCardHolder.innerHTML = `<div class="card"><p>${t("driverNoVehicle")}</p></div>`;
    }

    const table = document.getElementById("drvAllVehiclesTable");
    table.innerHTML = `
      <thead><tr><th>${t("busVehicleLabel")}</th><th>${t("busOperationStatusLabel")}</th><th>${t("driverAppliedHeadcount")}</th><th>${t("busRidersLabel")}</th></tr></thead>
      <tbody>
        ${this.todayData.vehicles.map((v) => {
          const tp = v.trips.find((t2) => t2.tripType === tripType);
          return `
            <tr class="${v.isMine ? "today" : ""}">
              <td>${escapeHtml(v.routeName)} ${escapeHtml(v.name)}${v.isMine ? ` (${t("driverMyVehicle")})` : ""}</td>
              <td>${tp.enabled ? t("busOperating") : t("busNotOperating")}</td>
              <td>${tp.enabled ? `${tp.appliedHeadcount}${t("headcountUnit")}` : "-"}</td>
              <td>${tp.enabled ? (tp.riders.map((r) => escapeHtml(`${r.department ? r.department + " " : ""}${r.employeeName}`)).join(", ") || t("noData")) : "-"}</td>
            </tr>
          `;
        }).join("") || `<tr><td colspan="4">${t("noData")}</td></tr>`}
      </tbody>
    `;
  },

  renderMyTripCard(vehicleId, tp) {
    if (!tp.enabled) {
      return `
        <div class="meal-row bus-row disabled-row">
          <div class="meal-name">${this.tripLabel(tp.tripType)}</div>
          <div class="deadline-note">${t("busNotOperating")}</div>
        </div>
      `;
    }
    const riderNames = tp.riders.map((r) => escapeHtml(`${r.department ? r.department + " " : ""}${r.employeeName}${r.headcount > 1 ? `(${r.headcount})` : ""}`)).join(", ");
    return `
      <form class="meal-row bus-row" id="drvLogForm_${tp.tripType}" style="flex-wrap:wrap;">
        <div class="meal-name">${this.tripLabel(tp.tripType)} (${t("driverAppliedHeadcount")}: ${tp.appliedHeadcount}${t("headcountUnit")})</div>
        <div class="deadline-note" style="flex-basis:100%;">${t("busRidersLabel")}: ${riderNames || t("noData")}</div>
        <select name="operated">
          <option value="unset" ${tp.operated === null ? "selected" : ""}>${t("driverNotRecorded")}</option>
          <option value="true" ${tp.operated === true ? "selected" : ""}>${t("driverOperated")}</option>
          <option value="false" ${tp.operated === false ? "selected" : ""}>${t("driverNotOperated")}</option>
        </select>
        <input type="number" name="actualHeadcount" min="0" max="9999" placeholder="${t("driverActualHeadcount")}" value="${tp.actualHeadcount !== null && tp.actualHeadcount !== undefined ? tp.actualHeadcount : ""}" style="width:100px;">
        <input type="text" name="note" placeholder="${t("driverNotePlaceholder")}" value="${escapeHtml(tp.note || "")}" style="flex:1;min-width:120px;">
        <button type="submit">${t("save")}</button>
      </form>
    `;
  },

  async onSubmitLog(e, vehicleId, tripType) {
    e.preventDefault();
    const form = e.currentTarget;
    const operatedRaw = form.operated.value;
    const operated = operatedRaw === "unset" ? null : operatedRaw === "true";
    const actualHeadcountRaw = form.actualHeadcount.value.trim();
    const actualHeadcount = actualHeadcountRaw === "" ? null : parseInt(actualHeadcountRaw, 10);
    const note = form.note.value.trim();
    try {
      await API.post("/bus-driver/log", { date: this.date, tripType, vehicleId, operated, actualHeadcount, note });
      showToast(t("save"));
      this.loadToday(this.date);
    } catch (err) {
      alert(err.message);
    }
  },

  /* -------------------- 주간 운행명령 (읽기 전용) -------------------- */
  async loadWeek(anchorDate) {
    const container = document.getElementById("driverWeekView");
    container.innerHTML = `<div class="card">${t("loading")}</div>`;
    try {
      const anchor = anchorDate || this.weekAnchor || todayStr();
      const data = await API.get(`/bus-driver/week-operation?date=${anchor}`);
      this.weekAnchor = anchor;
      this.weekData = data;
      this.renderWeek(data);
    } catch (err) {
      container.innerHTML = `<div class="card">${escapeHtml(err.message)}</div>`;
    }
  },

  shiftWeek(days) {
    const d = new Date((this.weekAnchor || todayStr()) + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    this.loadWeek(d.toISOString().slice(0, 10));
  },

  renderWeek(data) {
    const container = document.getElementById("driverWeekView");
    const weekLabel = data.week && data.week.length ? `${data.week[0]} ~ ${data.week[6]}` : "-";
    container.innerHTML = `
      <div class="card">
        <h2 style="margin-top:0;">${t("driverWeekOperationTab")}</h2>
        <div class="week-nav">
          <button class="secondary" id="drvPrevWeekBtn">${t("prevWeek")}</button>
          <div class="label">${weekLabel}</div>
          <button class="secondary" id="drvNextWeekBtn">${t("nextWeek")}</button>
        </div>
      </div>
      <div class="tabs" id="drvWeekTripTabs">
        ${DRIVER_TRIP_TYPES.map((tt) => `<button data-week-trip-tab="${tt}" class="${tt === this.weekTrip ? "active" : ""}">${t(`busTrip_${tt}`)}</button>`).join("")}
      </div>
      <div class="card" id="drvWeekTripContent"></div>
    `;
    document.getElementById("drvPrevWeekBtn").addEventListener("click", () => this.shiftWeek(-7));
    document.getElementById("drvNextWeekBtn").addEventListener("click", () => this.shiftWeek(7));
    document.querySelectorAll("#drvWeekTripTabs button").forEach((b) => {
      b.addEventListener("click", () => {
        this.weekTrip = b.dataset.weekTripTab;
        this.renderWeekContent();
      });
    });
    this.renderWeekContent();
  },

  renderWeekContent() {
    if (!this.weekData) return;
    document.querySelectorAll("#drvWeekTripTabs button").forEach((b) => b.classList.toggle("active", b.dataset.weekTripTab === this.weekTrip));
    const tripType = this.weekTrip;
    const data = this.weekData;
    const content = document.getElementById("drvWeekTripContent");
    const vehicleNames = data.days[0] ? data.days[0].vehicles.map((v) => `${v.routeName} ${v.name}`) : [];
    const riderLine = (r) => `${escapeHtml(r.employeeId)} ${escapeHtml(r.department || "")} ${escapeHtml(r.employeeName)}${r.headcount > 1 ? `(${r.headcount})` : ""}`.trim();
    content.innerHTML = `
      <p class="deadline-note">${t("driverWeekRidersHelp")}</p>
      <table class="data-table">
        <thead><tr><th>${t("date")}</th>${vehicleNames.map((n) => `<th>${escapeHtml(n)}</th>`).join("")}</tr></thead>
        <tbody>
          ${data.days.map((day) => `
            <tr>
              <td>${day.date}</td>
              ${day.vehicles.map((v) => {
                const tp = v.trips.find((t2) => t2.tripType === tripType);
                if (!tp || !tp.enabled) return `<td>${t("busNotOperating")}</td>`;
                const riders = (tp.riders || []).map(riderLine).join("<br>");
                return `
                  <td>
                    <div>${t("busOperating")} (${tp.appliedHeadcount}${t("headcountUnit")})</div>
                    <div class="deadline-note">${riders || t("noData")}</div>
                  </td>
                `;
              }).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  },

  /* -------------------- 월별 집계 (읽기 전용) -------------------- */
  async loadMonthly(month) {
    const container = document.getElementById("driverMonthlyView");
    container.innerHTML = `<div class="card">${t("loading")}</div>`;
    try {
      const m = month || this.month || todayStr().slice(0, 7);
      const data = await API.get(`/bus-driver/summary/monthly?month=${m}`);
      this.month = m;
      this.renderMonthly(data);
    } catch (err) {
      container.innerHTML = `<div class="card">${escapeHtml(err.message)}</div>`;
    }
  },

  renderMonthly(data) {
    const container = document.getElementById("driverMonthlyView");
    container.innerHTML = `
      <div class="card">
        <h2 style="margin-top:0;">${t("monthlySummary")}</h2>
        <div class="toolbar">
          <label>${t("selectMonth")}</label>
          <input type="month" id="drvMonthInput" value="${data.month}">
        </div>
      </div>
      ${data.vehicles.map((v) => `
        <div class="card">
          <h3>${escapeHtml(v.routeName)} ${escapeHtml(v.name)}</h3>
          <p>${t("busTrip_commute")} ${t("total")}: ${v.totals.commute} / ${t("busTrip_regularLeave")} ${t("total")}: ${v.totals.regularLeave} / ${t("busTrip_extendedLeave")} ${t("total")}: ${v.totals.extendedLeave}</p>
          <table class="data-table">
            <thead><tr><th>${t("date")}</th><th>${t("busTrip_commute")}</th><th>${t("busTrip_regularLeave")}</th><th>${t("busTrip_extendedLeave")}</th></tr></thead>
            <tbody>
              ${v.daily.map((d) => `<tr><td>${d.date}</td><td>${d.commute}</td><td>${d.regularLeave}</td><td>${d.extendedLeave}</td></tr>`).join("")}
            </tbody>
          </table>
        </div>
      `).join("")}
    `;
    document.getElementById("drvMonthInput").addEventListener("change", (e) => this.loadMonthly(e.target.value));
  },
};

document.addEventListener("DOMContentLoaded", () => DriverUI.init());
