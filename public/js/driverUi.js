/* 통근버스 기사 모드 화면 로직 */

const DriverUI = {
  date: null,

  async load(date) {
    const container = document.getElementById("driverMainView");
    container.innerHTML = `<div class="card">${t("loading")}</div>`;
    try {
      this.date = date || this.date || todayStr();
      const data = await API.get(`/bus-driver/today?date=${this.date}`);
      this.render(data);
    } catch (err) {
      container.innerHTML = `<div class="card">${escapeHtml(err.message)}</div>`;
    }
  },

  tripLabel(tt) {
    return t(`busTrip_${tt}`);
  },

  render(data) {
    const container = document.getElementById("driverMainView");
    const myVehicle = data.myVehicle;
    container.innerHTML = `
      <div class="card">
        <h2 style="margin-top:0;">${t("driverPanel")}</h2>
        <div class="toolbar">
          <label>${t("selectDate")}</label>
          <input type="date" id="drvDate" value="${data.date}">
        </div>
      </div>
      ${myVehicle ? `
        <div class="card">
          <h3>${t("driverMyVehicle")}: ${escapeHtml(myVehicle.routeName)} ${escapeHtml(myVehicle.name)}</h3>
          ${myVehicle.trips.map((tp) => this.renderMyTripCard(myVehicle.vehicleId, tp)).join("")}
        </div>
      ` : `<div class="card"><p>${t("driverNoVehicle")}</p></div>`}
      <div class="card">
        <h3>${t("driverAllVehicles")}</h3>
        <table class="data-table">
          <thead><tr><th>${t("busVehicleLabel")}</th><th>${t("busTrip_commute")}</th><th>${t("busTrip_regularLeave")}</th><th>${t("busTrip_extendedLeave")}</th></tr></thead>
          <tbody>
            ${data.vehicles.map((v) => `
              <tr class="${v.isMine ? "today" : ""}">
                <td>${escapeHtml(v.routeName)} ${escapeHtml(v.name)}</td>
                ${v.trips.map((tp) => `<td>${tp.enabled ? `${t("busOperating")} · ${tp.appliedHeadcount}${t("headcountUnit")}` : t("busNotOperating")}</td>`).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
    document.getElementById("drvDate").addEventListener("change", (e) => this.load(e.target.value));
    if (myVehicle) {
      myVehicle.trips.forEach((tp) => {
        const form = document.getElementById(`drvLogForm_${tp.tripType}`);
        if (form) form.addEventListener("submit", (e) => this.onSubmitLog(e, myVehicle.vehicleId, tp.tripType));
      });
    }
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
    return `
      <form class="meal-row bus-row" id="drvLogForm_${tp.tripType}" style="flex-wrap:wrap;">
        <div class="meal-name">${this.tripLabel(tp.tripType)} (${t("driverAppliedHeadcount")}: ${tp.appliedHeadcount}${t("headcountUnit")})</div>
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
      this.load(this.date);
    } catch (err) {
      alert(err.message);
    }
  },
};
