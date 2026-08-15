/* 통근버스 승차 신청 (일반 직원 + 도급/단체 계정) */

const TRIP_TYPES_CLIENT = ["commute", "regularLeave", "extendedLeave"];
const DEFAULT_WEEKDAYS_CLIENT = [1, 2, 3, 4, 5]; // 월~금 (기본 등록은 평일에만 자동 적용되므로)

const BusUI = {
  weekAnchor: null,
  weekData: null,
  currentTrip: "commute",

  async load(anchorDate) {
    const container = document.getElementById("busApplyView");
    container.innerHTML = `<div class="card">${t("loading")}</div>`;
    try {
      const anchor = anchorDate || this.weekAnchor || new Date().toISOString().slice(0, 10);
      const data = await API.get(`/bus/week?date=${anchor}`);
      this.weekAnchor = anchor;
      this.weekData = data;
      this.render(data);
    } catch (err) {
      container.innerHTML = `<div class="card">${escapeHtml(err.message)}</div>`;
    }
  },

  shiftWeek(days) {
    const d = new Date((this.weekAnchor || new Date().toISOString().slice(0, 10)) + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    this.load(d.toISOString().slice(0, 10));
  },

  render(data) {
    const container = document.getElementById("busApplyView");
    const weekLabel = data.week && data.week.length ? `${data.week[0]} ~ ${data.week[6]}` : "-";
    container.innerHTML = `
      <div class="card">
        <h2 style="margin-top:0;">${t("busTab")}</h2>
        <p class="deadline-note">${t("busApplyHelp")}</p>
      </div>
      <div class="tabs" id="busTripTabs">
        ${TRIP_TYPES_CLIENT.map((tt) => `<button data-trip-tab="${tt}" class="${tt === this.currentTrip ? "active" : ""}">${t(`busTrip_${tt}`)}</button>`).join("")}
      </div>
      <div class="card" id="busDefaultCard">
        <h3>${t("busDefaultRegTitle")}</h3>
        <p class="deadline-note">${t("busDefaultRegHelp")}</p>
        <div id="busDefaultRowContainer"></div>
      </div>
      <div class="card">
        <div class="week-nav">
          <button class="secondary" id="busPrevWeekBtn">${t("prevWeek")}</button>
          <div class="label">${weekLabel}</div>
          <button class="secondary" id="busNextWeekBtn">${t("nextWeek")}</button>
        </div>
        <div class="week-grid" id="busWeekGrid"></div>
      </div>
    `;
    document.getElementById("busPrevWeekBtn").addEventListener("click", () => this.shiftWeek(-7));
    document.getElementById("busNextWeekBtn").addEventListener("click", () => this.shiftWeek(7));
    document.querySelectorAll("#busTripTabs button").forEach((b) => {
      b.addEventListener("click", () => {
        this.currentTrip = b.dataset.tripTab;
        this.renderTripContent();
      });
    });

    this.renderTripContent();
  },

  // 탭(출근/정시퇴근/연장퇴근) 전환 시에는 이미 받아온 주간 데이터를 그대로 다시 그리기만 하고,
  // 서버에 다시 요청하지 않습니다.
  renderTripContent() {
    if (!this.weekData) return;
    document.querySelectorAll("#busTripTabs button").forEach((b) => b.classList.toggle("active", b.dataset.tripTab === this.currentTrip));
    this.renderDefaultRow(this.weekData);
    this.renderWeekGrid(this.weekData);
  },

  /* -------------------- 내 기본(평소) 탑승 차량 등록 (요일별 주간 그리드) -------------------- */

  renderDefaultRow(data) {
    const tripType = this.currentTrip;
    const holder = document.getElementById("busDefaultRowContainer");
    const defaultsForTrip = (data.myDefaults || []).filter((d) => d.tripType === tripType);
    const byDow = new Map(defaultsForTrip.map((d) => [d.dayOfWeek, d]));
    const vehicles = data.vehicles || [];

    holder.innerHTML = `
      <div class="week-grid">
        ${DEFAULT_WEEKDAYS_CLIENT.map((dow) => {
          const wd = WEEKDAY_KEYS[dow];
          const def = byDow.get(dow);
          if (def && def.vehicleId) {
            return `
              <div class="day-cell">
                <div class="weekday-label">${t(wd)}</div>
                <div class="meal-row bus-row applied" data-default-dow="${dow}">
                  <div class="deadline-note" style="display:inline;">${escapeHtml(def.routeName)} (${escapeHtml(def.vehicleName)}) · ${escapeHtml(def.stop)}${isContractorUser() ? ` (${def.headcount}${t("headcountUnit")})` : ""}</div>
                  <button class="secondary" data-default-remove>${t("busRemoveDefault")}</button>
                </div>
              </div>
            `;
          }
          if (!vehicles.length) {
            return `
              <div class="day-cell">
                <div class="weekday-label">${t(wd)}</div>
                <div class="meal-row bus-row disabled-row"><div class="deadline-note">${t("busNoVehicleYet")}</div></div>
              </div>
            `;
          }
          const options = vehicles.map((v) => `<option value="${v.vehicleId}">${escapeHtml(v.routeName)} (${escapeHtml(v.name)})</option>`).join("");
          return `
            <div class="day-cell">
              <div class="weekday-label">${t(wd)}</div>
              <div class="meal-row bus-row" data-default-dow="${dow}">
                <select class="bus-default-vehicle-select" data-vehicles='${escapeHtml(JSON.stringify(vehicles))}'>${options}</select>
                <select class="bus-default-stop-select"></select>
                ${isContractorUser() ? `<input type="number" class="bus-default-headcount-input" min="1" max="9999" value="1" style="width:70px;">` : ""}
                <button data-default-save>${t("busRegisterDefault")}</button>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
    this.wireDefaultCard();
  },

  wireDefaultCard() {
    const card = document.getElementById("busDefaultCard");
    card.querySelectorAll(".bus-default-vehicle-select").forEach((sel) => {
      sel.addEventListener("change", () => this.onVehicleSelectChange(sel, ".bus-default-stop-select"));
      this.onVehicleSelectChange(sel, ".bus-default-stop-select");
    });
    card.querySelectorAll("[data-default-save]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const row = e.currentTarget.closest("[data-default-dow]");
        const dayOfWeek = parseInt(row.dataset.defaultDow, 10);
        const tripType = this.currentTrip;
        const vehicleId = row.querySelector(".bus-default-vehicle-select").value;
        const stop = row.querySelector(".bus-default-stop-select").value;
        if (!stop) {
          alert(t("busSelectStop"));
          return;
        }
        const body = { tripType, dayOfWeek, vehicleId, stop };
        if (isContractorUser()) {
          const n = parseInt(row.querySelector(".bus-default-headcount-input").value, 10);
          if (!Number.isInteger(n) || n < 1 || n > 9999) {
            alert(t("headcountPlaceholder"));
            return;
          }
          body.headcount = n;
        }
        try {
          await API.post("/bus/default", body);
          showToast(t("busDefaultSaved"));
          this.load(this.weekAnchor);
        } catch (err) {
          alert(err.message);
        }
      });
    });
    card.querySelectorAll("[data-default-remove]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        if (!confirm(t("confirmCancel"))) return;
        const row = e.currentTarget.closest("[data-default-dow]");
        const dayOfWeek = parseInt(row.dataset.defaultDow, 10);
        const tripType = this.currentTrip;
        try {
          await API.post("/bus/default", { tripType, dayOfWeek, vehicleId: "" });
          showToast(t("cancelSuccess"));
          this.load(this.weekAnchor);
        } catch (err) {
          alert(err.message);
        }
      });
    });
  },

  /* -------------------- 주간 신청/취소 (기본 등록의 예외 처리 포함) -------------------- */

  renderWeekGrid(data) {
    const grid = document.getElementById("busWeekGrid");
    const today = todayStr();
    const tripType = this.currentTrip;
    grid.innerHTML = data.days.map((day) => {
      const isToday = day.date === today;
      const dayTypeCls = day.dayType === "holiday" ? "holiday" : day.dayType === "weekend" ? "weekend" : "";
      const wd = WEEKDAY_KEYS[new Date(day.date + "T00:00:00Z").getUTCDay()];
      const holidayTag = day.dayType === "holiday" && day.holidayLabel ? ` <span class="holiday-tag">${escapeHtml(day.holidayLabel)}</span>` : "";
      return `
        <div class="day-cell ${isToday ? "today" : ""} ${dayTypeCls}">
          <div class="date-label">${day.date.slice(5)}</div>
          <div class="weekday-label">${t(wd)}${holidayTag}</div>
          ${this.renderTripRow(day.date, tripType, day[tripType])}
        </div>
      `;
    }).join("");

    grid.querySelectorAll("[data-bus-apply]").forEach((btn) => btn.addEventListener("click", (e) => this.onApplyClick(e)));
    grid.querySelectorAll("[data-bus-cancel]").forEach((btn) => btn.addEventListener("click", (e) => this.onCancelClick(e)));
    grid.querySelectorAll(".bus-vehicle-select").forEach((sel) => {
      sel.addEventListener("change", () => this.onVehicleSelectChange(sel, ".bus-stop-select"));
      this.onVehicleSelectChange(sel, ".bus-stop-select"); // 최초 렌더링 시 기본 선택된 차량의 정류장 목록을 채워둡니다.
    });
  },

  renderTripRow(date, tripType, info) {
    const label = t(`busTrip_${tripType}`);
    const enabledVehicles = info.vehicles.filter((v) => v.enabled);
    const my = info.my || { riding: false };
    if (my.riding) {
      const viaTag = my.via === "default" ? ` <span class="holiday-tag">${t("busRidingViaDefault")}</span>` : "";
      return `
        <div class="meal-row bus-row applied" data-date="${date}" data-trip="${tripType}">
          <div class="meal-name">${label}${viaTag}</div>
          <div class="deadline-note" style="display:inline;">${escapeHtml(my.routeName)} · ${escapeHtml(my.stop)}${isContractorUser() ? ` (${my.headcount}${t("headcountUnit")})` : ""}</div>
          <button class="secondary" data-bus-cancel>${t("cancel")}</button>
        </div>
      `;
    }
    if (!enabledVehicles.length) {
      return `
        <div class="meal-row bus-row disabled-row" data-date="${date}" data-trip="${tripType}">
          <div class="meal-name">${label}</div>
          <div class="deadline-note">${t("busNotOperating")}</div>
        </div>
      `;
    }
    const cancelledNote = my.via === "cancelled" ? `<div class="deadline-note">${t("busDefaultCancelledNote")}</div>` : "";
    const options = enabledVehicles.map((v) => `<option value="${v.vehicleId}">${escapeHtml(v.routeName)} (${escapeHtml(v.name)})</option>`).join("");
    return `
      <div class="meal-row bus-row" data-date="${date}" data-trip="${tripType}">
        <div class="meal-name">${label}</div>
        ${cancelledNote}
        <select class="bus-vehicle-select" data-vehicles='${escapeHtml(JSON.stringify(enabledVehicles))}'>${options}</select>
        <select class="bus-stop-select"></select>
        ${isContractorUser() ? `<input type="number" class="bus-headcount-input" min="1" max="9999" value="1" style="width:70px;">` : ""}
        <button data-bus-apply>${t("busApplyBtn")}</button>
      </div>
    `;
  },

  onVehicleSelectChange(select, stopSelectSelector) {
    const row = select.closest(".bus-row");
    const stopSelect = row.querySelector(stopSelectSelector);
    const vehicles = JSON.parse(select.dataset.vehicles || "[]");
    const vehicle = vehicles.find((v) => v.vehicleId === select.value);
    stopSelect.innerHTML = (vehicle ? vehicle.stops : []).map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
  },

  async onApplyClick(e) {
    const row = e.currentTarget.closest(".bus-row");
    const date = row.dataset.date;
    const tripType = row.dataset.trip;
    const vehicleId = row.querySelector(".bus-vehicle-select").value;
    const stop = row.querySelector(".bus-stop-select").value;
    if (!stop) {
      alert(t("busSelectStop"));
      return;
    }
    const body = { date, tripType, vehicleId, stop };
    if (isContractorUser()) {
      const n = parseInt(row.querySelector(".bus-headcount-input").value, 10);
      if (!Number.isInteger(n) || n < 1 || n > 9999) {
        alert(t("headcountPlaceholder"));
        return;
      }
      body.headcount = n;
    }
    try {
      await API.post("/bus/ride", body);
      showToast(t("busApplySuccess"));
      this.load(this.weekAnchor);
    } catch (err) {
      alert(err.message);
    }
  },

  async onCancelClick(e) {
    if (!confirm(t("confirmCancel"))) return;
    const row = e.currentTarget.closest(".bus-row");
    const date = row.dataset.date;
    const tripType = row.dataset.trip;
    try {
      await API.del("/bus/ride", { date, tripType });
      showToast(t("cancelSuccess"));
      this.load(this.weekAnchor);
    } catch (err) {
      alert(err.message);
    }
  },
};
