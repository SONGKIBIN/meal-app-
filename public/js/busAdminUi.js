/* 통근 차량 관리(busAdmin 권한) 화면 로직 */

const BUS_ADMIN_TRIP_TYPES = ["commute", "regularLeave", "extendedLeave"];

const BusAdminUI = {
  currentTab: null,
  statusDate: null,
  statusTrip: "commute",
  statusData: null,
  dailyDate: null,
  month: null,
  operationDate: null,
  routesCache: [],

  init() {
    document.querySelectorAll("#busAdminTabs button").forEach((b) => {
      b.addEventListener("click", () => this.switchTab(b.dataset.batab));
    });
  },

  switchTab(tab) {
    this.currentTab = tab;
    document.querySelectorAll("#busAdminTabs button").forEach((b) => b.classList.toggle("active", b.dataset.batab === tab));
    const map = {
      status: "busAdminStatusView",
      daily: "busAdminDailyView",
      monthly: "busAdminMonthlyView",
      vehicles: "busAdminVehiclesView",
      operation: "busAdminOperationView",
    };
    Object.entries(map).forEach(([name, id]) => document.getElementById(id).classList.toggle("hidden", name !== tab));
    if (tab === "status") this.renderStatus();
    else if (tab === "daily") this.renderDaily();
    else if (tab === "monthly") this.renderMonthly();
    else if (tab === "vehicles") this.renderVehicles();
    else if (tab === "operation") this.renderOperation();
  },

  tripLabel(tt) {
    return t(`busTrip_${tt}`);
  },

  /* -------------------- 신청 현황 (관리자 취소 가능) -------------------- */
  async renderStatus() {
    const container = document.getElementById("busAdminStatusView");
    const date = this.statusDate || todayStr();
    this.statusDate = date;
    container.innerHTML = `<div class="card">${t("loading")}</div>`;
    try {
      const data = await API.get(`/bus-admin/summary/daily?date=${date}`);
      this.statusData = data;
      container.innerHTML = `
        <div class="card">
          <div class="toolbar">
            <label>${t("selectDate")}</label>
            <input type="date" id="baStatusDate" value="${date}">
          </div>
        </div>
        <div class="tabs" id="baStatusTripTabs">
          ${BUS_ADMIN_TRIP_TYPES.map((tt) => `<button data-status-trip-tab="${tt}" class="${tt === this.statusTrip ? "active" : ""}">${t(`busTrip_${tt}`)}</button>`).join("")}
        </div>
        <div class="card" id="baStatusTripContent"></div>
      `;
      document.getElementById("baStatusDate").addEventListener("change", (e) => {
        this.statusDate = e.target.value;
        this.renderStatus();
      });
      document.querySelectorAll("#baStatusTripTabs button").forEach((b) => {
        b.addEventListener("click", () => {
          this.statusTrip = b.dataset.statusTripTab;
          this.renderStatusContent();
        });
      });
      this.renderStatusContent();
    } catch (err) {
      container.innerHTML = `<div class="card">${escapeHtml(err.message)}</div>`;
    }
  },

  // 탭(출근/정시퇴근/연장퇴근) 전환 시에는 이미 받아온 데이터를 그대로 다시 그리기만 합니다.
  renderStatusContent() {
    if (!this.statusData) return;
    document.querySelectorAll("#baStatusTripTabs button").forEach((b) => b.classList.toggle("active", b.dataset.statusTripTab === this.statusTrip));
    const date = this.statusDate;
    const tripType = this.statusTrip;
    const content = document.getElementById("baStatusTripContent");
    content.innerHTML = this.statusData.vehicles.map((v) => {
      const tp = v.trips.find((t2) => t2.tripType === tripType);
      if (!tp) return "";
      return `
        <h3>${escapeHtml(v.routeName)} - ${escapeHtml(v.name)} (${tp.count}${t("headcountUnit")})</h3>
        <table class="data-table">
          <thead><tr><th>${t("department")}</th><th>${t("name")}</th><th>${t("employeeId")}</th><th>${t("busStopLabel")}</th><th>${t("busSourceLabel")}</th><th></th></tr></thead>
          <tbody>
            ${tp.riders.map((r) => `
              <tr>
                <td>${escapeHtml(r.department)}</td>
                <td>${escapeHtml(r.employeeName)}</td>
                <td>${escapeHtml(r.employeeId)}</td>
                <td>${escapeHtml(r.stop)}${r.headcount > 1 ? ` (${r.headcount}${t("headcountUnit")})` : ""}</td>
                <td>${r.source === "default" ? t("busSourceDefault") : t("busSourceExplicit")}</td>
                <td><button class="secondary" data-ba-cancel-ride
                  ${r.rideId ? `data-ride-id="${r.rideId}"` : ""}
                  data-employee-id="${escapeHtml(r.employeeId)}"
                  data-date="${date}"
                  data-trip="${tp.tripType}"
                  data-vehicle="${v.vehicleId}"
                >${t("cancel")}</button></td>
              </tr>
            `).join("") || `<tr><td colspan="6">${t("noData")}</td></tr>`}
          </tbody>
        </table>
      `;
    }).join("") || `<p>${t("noData")}</p>`;

    content.querySelectorAll("[data-ba-cancel-ride]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm(t("confirmCancel"))) return;
        try {
          const body = btn.dataset.rideId
            ? { rideId: btn.dataset.rideId }
            : {
                employeeId: btn.dataset.employeeId,
                date: btn.dataset.date,
                tripType: btn.dataset.trip,
                vehicleId: btn.dataset.vehicle,
              };
          await API.del("/bus-admin/ride", body);
          showToast(t("cancelSuccess"));
          this.renderStatus();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  },

  /* -------------------- 일일 집계 (엑셀/인쇄) -------------------- */
  async renderDaily() {
    const container = document.getElementById("busAdminDailyView");
    const date = this.dailyDate || todayStr();
    this.dailyDate = date;
    container.innerHTML = `<div class="card">${t("loading")}</div>`;
    try {
      const data = await API.get(`/bus-admin/summary/daily?date=${date}`);
      container.innerHTML = `
        <div class="card">
          <div class="toolbar">
            <label>${t("selectDate")}</label>
            <input type="date" id="baDailyDate" value="${date}">
            <button id="baDailyExcelBtn">${t("downloadExcel")}</button>
            <button class="secondary" id="baDailyPrintBtn">${t("print")}</button>
          </div>
          <table class="data-table">
            <thead><tr><th>${t("busVehicleLabel")}</th><th>${t("busRouteLabel")}</th><th>${t("busTrip_commute")}</th><th>${t("busTrip_regularLeave")}</th><th>${t("busTrip_extendedLeave")}</th></tr></thead>
            <tbody>
              ${data.vehicles.map((v) => `
                <tr>
                  <td>${escapeHtml(v.name)}</td>
                  <td>${escapeHtml(v.routeName)}</td>
                  ${v.trips.map((tp) => `<td>${tp.count}</td>`).join("")}
                </tr>
              `).join("") || `<tr><td colspan="5">${t("noData")}</td></tr>`}
            </tbody>
          </table>
        </div>
      `;
      document.getElementById("baDailyDate").addEventListener("change", (e) => {
        this.dailyDate = e.target.value;
        this.renderDaily();
      });
      document.getElementById("baDailyExcelBtn").addEventListener("click", () => downloadFile(`/bus-admin/export/daily?date=${date}`, `bus_${date}.xlsx`));
      document.getElementById("baDailyPrintBtn").addEventListener("click", () => window.print());
    } catch (err) {
      container.innerHTML = `<div class="card">${escapeHtml(err.message)}</div>`;
    }
  },

  /* -------------------- 월간 집계 -------------------- */
  async renderMonthly() {
    const container = document.getElementById("busAdminMonthlyView");
    const month = this.month || todayStr().slice(0, 7);
    this.month = month;
    container.innerHTML = `<div class="card">${t("loading")}</div>`;
    try {
      const data = await API.get(`/bus-admin/summary/monthly?month=${month}`);
      container.innerHTML = `
        <div class="card">
          <div class="toolbar">
            <label>${t("selectMonth")}</label>
            <input type="month" id="baMonthInput" value="${month}">
            <button id="baMonthlyExcelBtn">${t("downloadExcel")}</button>
          </div>
          <p>${t("busTrip_commute")} ${t("total")}: ${data.totals.commute} / ${t("busTrip_regularLeave")} ${t("total")}: ${data.totals.regularLeave} / ${t("busTrip_extendedLeave")} ${t("total")}: ${data.totals.extendedLeave}</p>
          <table class="data-table">
            <thead><tr><th>${t("date")}</th><th>${t("busTrip_commute")}</th><th>${t("busTrip_regularLeave")}</th><th>${t("busTrip_extendedLeave")}</th></tr></thead>
            <tbody>
              ${data.days.map((d) => `<tr><td>${d.date}</td><td>${d.commute}</td><td>${d.regularLeave}</td><td>${d.extendedLeave}</td></tr>`).join("")}
            </tbody>
          </table>
        </div>
      `;
      document.getElementById("baMonthInput").addEventListener("change", (e) => {
        this.month = e.target.value;
        this.renderMonthly();
      });
      document.getElementById("baMonthlyExcelBtn").addEventListener("click", () => downloadFile(`/bus-admin/export/monthly?month=${month}`, `bus_${month}.xlsx`));
    } catch (err) {
      container.innerHTML = `<div class="card">${escapeHtml(err.message)}</div>`;
    }
  },

  /* -------------------- 차량/코스 관리 -------------------- */
  async renderVehicles() {
    const container = document.getElementById("busAdminVehiclesView");
    container.innerHTML = `<div class="card">${t("loading")}</div>`;
    try {
      const [{ routes }, { vehicles }] = await Promise.all([API.get("/bus-admin/routes"), API.get("/bus-admin/vehicles")]);
      this.routesCache = routes;
      container.innerHTML = `
        <div class="card">
          <h3>${t("busRoutesTitle")}</h3>
          <table class="data-table">
            <thead><tr><th>${t("busRouteLabel")}</th><th>${t("busStopsLabel")}</th><th>${t("active")}</th><th></th></tr></thead>
            <tbody>
              ${routes.map((r) => `
                <tr>
                  <td>${escapeHtml(r.name)}</td>
                  <td>${(r.stops || []).map(escapeHtml).join(" → ")}</td>
                  <td>${r.active ? t("active") : t("inactive")}</td>
                  <td><button class="secondary" data-edit-route="${r._id}">${t("edit")}</button></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
          <button id="baAddRouteBtn">${t("busAddRoute")}</button>
        </div>
        <div class="card">
          <h3>${t("busVehiclesTitle")}</h3>
          <table class="data-table">
            <thead><tr><th>${t("busVehicleLabel")}</th><th>${t("busRouteLabel")}</th><th>${t("busDriverLabel")}</th><th>${t("active")}</th><th></th></tr></thead>
            <tbody>
              ${vehicles.map((v) => `
                <tr>
                  <td>${escapeHtml(v.name)}</td>
                  <td>${escapeHtml(v.routeName)}</td>
                  <td>${escapeHtml(v.driverEmployeeId || "-")}</td>
                  <td>${v.active ? t("active") : t("inactive")}</td>
                  <td><button class="secondary" data-edit-vehicle="${v._id}">${t("edit")}</button></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
          <button id="baAddVehicleBtn">${t("busAddVehicle")}</button>
        </div>
      `;
      document.getElementById("baAddRouteBtn").addEventListener("click", () => this.openRouteModal(null));
      document.getElementById("baAddVehicleBtn").addEventListener("click", () => this.openVehicleModal(null, vehicles, routes));
      container.querySelectorAll("[data-edit-route]").forEach((btn) => {
        btn.addEventListener("click", () => this.openRouteModal(routes.find((r) => r._id === btn.dataset.editRoute)));
      });
      container.querySelectorAll("[data-edit-vehicle]").forEach((btn) => {
        btn.addEventListener("click", () => this.openVehicleModal(vehicles.find((v) => v._id === btn.dataset.editVehicle), vehicles, routes));
      });
    } catch (err) {
      container.innerHTML = `<div class="card">${escapeHtml(err.message)}</div>`;
    }
  },

  openRouteModal(route) {
    const isNew = !route;
    openModal(`
      <h3>${isNew ? t("busAddRoute") : t("edit")}</h3>
      <div class="field"><label>${t("busRouteLabel")}</label><input id="routeNameInput" value="${route ? escapeHtml(route.name) : ""}"></div>
      <div class="field"><label>${t("busStopsLabel")}</label><input id="routeStopsInput" placeholder="${t("busStopsPlaceholder")}" value="${route ? escapeHtml((route.stops || []).join(", ")) : ""}"></div>
      ${route ? `<div class="field"><label>${t("active")}</label><select id="routeActiveInput"><option value="true" ${route.active ? "selected" : ""}>${t("active")}</option><option value="false" ${!route.active ? "selected" : ""}>${t("inactive")}</option></select></div>` : ""}
      <div class="toolbar" style="margin-top:14px;">
        <button id="routeSaveBtn">${t("save")}</button>
        <button class="secondary" id="routeCloseBtn">${t("close")}</button>
      </div>
    `);
    document.getElementById("routeCloseBtn").addEventListener("click", closeModal);
    document.getElementById("routeSaveBtn").addEventListener("click", async () => {
      const name = document.getElementById("routeNameInput").value.trim();
      const stops = document.getElementById("routeStopsInput").value.split(",").map((s) => s.trim()).filter(Boolean);
      if (!name || !stops.length) {
        alert(t("busRouteRequired"));
        return;
      }
      const body = { name, stops };
      if (route) body.active = document.getElementById("routeActiveInput").value === "true";
      try {
        if (route) await API.put(`/bus-admin/routes/${route._id}`, body);
        else await API.post("/bus-admin/routes", body);
        closeModal();
        showToast(t("save"));
        this.renderVehicles();
      } catch (err) {
        alert(err.message);
      }
    });
  },

  openVehicleModal(vehicle, vehicles, routes) {
    const isNew = !vehicle;
    openModal(`
      <h3>${isNew ? t("busAddVehicle") : t("edit")}</h3>
      <div class="field"><label>${t("busVehicleLabel")}</label><input id="vehicleNameInput" value="${vehicle ? escapeHtml(vehicle.name) : ""}"></div>
      <div class="field"><label>${t("busRouteLabel")}</label>
        <select id="vehicleRouteInput">${routes.map((r) => `<option value="${r._id}" ${vehicle && vehicle.routeId === r._id ? "selected" : ""}>${escapeHtml(r.name)}</option>`).join("")}</select>
      </div>
      <div class="field"><label>${t("busCapacityLabel")}</label><input id="vehicleCapacityInput" type="number" min="0" value="${vehicle && vehicle.capacity !== null ? vehicle.capacity : ""}"></div>
      ${vehicle ? `<div class="field"><label>${t("active")}</label><select id="vehicleActiveInput"><option value="true" ${vehicle.active ? "selected" : ""}>${t("active")}</option><option value="false" ${!vehicle.active ? "selected" : ""}>${t("inactive")}</option></select></div>` : ""}
      <div class="toolbar" style="margin-top:14px;">
        <button id="vehicleSaveBtn">${t("save")}</button>
        <button class="secondary" id="vehicleCloseBtn">${t("close")}</button>
      </div>
    `);
    document.getElementById("vehicleCloseBtn").addEventListener("click", closeModal);
    document.getElementById("vehicleSaveBtn").addEventListener("click", async () => {
      const name = document.getElementById("vehicleNameInput").value.trim();
      const routeId = document.getElementById("vehicleRouteInput").value;
      const capacity = document.getElementById("vehicleCapacityInput").value;
      if (!name || !routeId) {
        alert(t("busVehicleRequired"));
        return;
      }
      const body = { name, routeId, capacity: capacity === "" ? null : parseInt(capacity, 10) };
      if (vehicle) body.active = document.getElementById("vehicleActiveInput").value === "true";
      try {
        if (vehicle) await API.put(`/bus-admin/vehicles/${vehicle._id}`, body);
        else await API.post("/bus-admin/vehicles", body);
        closeModal();
        showToast(t("save"));
        this.renderVehicles();
      } catch (err) {
        alert(err.message);
      }
    });
  },

  /* -------------------- 운행일 지정 -------------------- */
  async renderOperation() {
    const container = document.getElementById("busAdminOperationView");
    const date = this.operationDate || todayStr();
    this.operationDate = date;
    container.innerHTML = `<div class="card">${t("loading")}</div>`;
    try {
      const data = await API.get(`/bus-admin/operation?date=${date}`);
      container.innerHTML = `
        <div class="card">
          <div class="toolbar">
            <label>${t("selectDate")}</label>
            <input type="date" id="baOpDate" value="${date}">
          </div>
          <p class="deadline-note">${t("busOperationHelp")}</p>
          <table class="data-table">
            <thead><tr><th>${t("busVehicleLabel")}</th><th>${t("busTrip_commute")}</th><th>${t("busTrip_regularLeave")}</th><th>${t("busTrip_extendedLeave")}</th></tr></thead>
            <tbody>
              ${data.vehicles.map((v) => `
                <tr>
                  <td>${escapeHtml(v.routeName)} ${escapeHtml(v.name)}</td>
                  ${v.trips.map((tp) => `
                    <td>
                      <label><input type="checkbox" data-op-toggle data-vehicle="${v.vehicleId}" data-trip="${tp.tripType}" ${tp.enabled ? "checked" : ""}> ${tp.enabled ? t("busOperating") : t("busNotOperating")}</label>
                      ${tp.overridden ? `<span class="deadline-note" style="display:block;">${t("busOverridden")}</span>` : ""}
                    </td>
                  `).join("")}
                </tr>
              `).join("") || `<tr><td colspan="4">${t("noData")}</td></tr>`}
            </tbody>
          </table>
        </div>
      `;
      document.getElementById("baOpDate").addEventListener("change", (e) => {
        this.operationDate = e.target.value;
        this.renderOperation();
      });
      container.querySelectorAll("[data-op-toggle]").forEach((cb) => {
        cb.addEventListener("change", async () => {
          try {
            await API.post("/bus-admin/operation", {
              date,
              tripType: cb.dataset.trip,
              vehicleId: cb.dataset.vehicle,
              enabled: cb.checked,
            });
            showToast(t("save"));
            this.renderOperation();
          } catch (err) {
            alert(err.message);
            this.renderOperation();
          }
        });
      });
    } catch (err) {
      container.innerHTML = `<div class="card">${escapeHtml(err.message)}</div>`;
    }
  },
};

document.addEventListener("DOMContentLoaded", () => BusAdminUI.init());
