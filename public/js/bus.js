/* 통근버스 승차 신청 (일반 직원 + 도급/단체 계정) */

const BusUI = {
  weekAnchor: null,
  weekData: null,

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

    const grid = document.getElementById("busWeekGrid");
    const today = todayStr();
    grid.innerHTML = data.days.map((day) => {
      const isToday = day.date === today;
      const dayTypeCls = day.dayType === "holiday" ? "holiday" : day.dayType === "weekend" ? "weekend" : "";
      const wd = WEEKDAY_KEYS[new Date(day.date + "T00:00:00Z").getUTCDay()];
      const holidayTag = day.dayType === "holiday" && day.holidayLabel ? ` <span class="holiday-tag">${escapeHtml(day.holidayLabel)}</span>` : "";
      return `
        <div class="day-cell ${isToday ? "today" : ""} ${dayTypeCls}">
          <div class="date-label">${day.date.slice(5)}</div>
          <div class="weekday-label">${t(wd)}${holidayTag}</div>
          ${["commute", "regularLeave", "extendedLeave"].map((tt) => this.renderTripRow(day.date, tt, day[tt])).join("")}
        </div>
      `;
    }).join("");

    grid.querySelectorAll("[data-bus-apply]").forEach((btn) => btn.addEventListener("click", (e) => this.onApplyClick(e)));
    grid.querySelectorAll("[data-bus-cancel]").forEach((btn) => btn.addEventListener("click", (e) => this.onCancelClick(e)));
    grid.querySelectorAll(".bus-vehicle-select").forEach((sel) => {
      sel.addEventListener("change", () => this.onVehicleSelectChange(sel));
      this.onVehicleSelectChange(sel); // 최초 렌더링 시 기본 선택된 차량의 정류장 목록을 채워둡니다.
    });
  },

  renderTripRow(date, tripType, info) {
    const label = t(`busTrip_${tripType}`);
    const enabledVehicles = info.vehicles.filter((v) => v.enabled);
    if (info.my && info.my.applied) {
      return `
        <div class="meal-row bus-row applied" data-date="${date}" data-trip="${tripType}">
          <div class="meal-name">${label}</div>
          <div class="deadline-note" style="display:inline;">${escapeHtml(info.my.routeName)} · ${escapeHtml(info.my.stop)}${isContractorUser() ? ` (${info.my.headcount}${t("headcountUnit")})` : ""}</div>
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
    const options = enabledVehicles.map((v) => `<option value="${v.vehicleId}">${escapeHtml(v.routeName)} (${escapeHtml(v.name)})</option>`).join("");
    return `
      <div class="meal-row bus-row" data-date="${date}" data-trip="${tripType}">
        <div class="meal-name">${label}</div>
        <select class="bus-vehicle-select" data-vehicles='${escapeHtml(JSON.stringify(enabledVehicles))}'>${options}</select>
        <select class="bus-stop-select"></select>
        ${isContractorUser() ? `<input type="number" class="bus-headcount-input" min="1" max="9999" value="1" style="width:70px;">` : ""}
        <button data-bus-apply>${t("busApplyBtn")}</button>
      </div>
    `;
  },

  onVehicleSelectChange(select) {
    const row = select.closest(".bus-row");
    const stopSelect = row.querySelector(".bus-stop-select");
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

