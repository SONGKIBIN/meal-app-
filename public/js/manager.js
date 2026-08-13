/* 부서 운영자(role=manager) 화면 로직. 관리자 화면(admin.js)과 거의 동일한 UI를 재사용하되,
   서버가 담당 부서(scopeDepartments) 범위로 이미 필터링해서 내려주는 /api/manager/* 엔드포인트를 사용하고,
   직원 관리는 신규 등록/삭제 없이 담당 부서 소속 직원 정보 수정만 가능합니다. */

const ManagerUI = {
  currentTab: null,
  scopeDepartments: null, // null = 아직 조회 전, [] = 조회 완료했지만 담당 부서 없음
  employeesCache: [],
  empSearchTerm: "",
  empSort: "department",
  statusDate: null,
  dailyDate: null,
  month: null,

  init() {
    document.querySelectorAll("#managerTabs button").forEach((b) => {
      b.addEventListener("click", () => this.switchTab(b.dataset.mtab));
    });
  },

  async ensureScope() {
    if (this.scopeDepartments !== null) return this.scopeDepartments;
    try {
      const data = await API.get("/manager/meta");
      this.scopeDepartments = data.departments || [];
    } catch (err) {
      this.scopeDepartments = [];
    }
    return this.scopeDepartments;
  },

  scopeNoticeHtml() {
    const list = this.scopeDepartments || [];
    if (!list.length) return `<p class="deadline-note" style="color:#dc2626;">${t("noManagedDepartments")}</p>`;
    return `<p class="deadline-note">${t("scopeDepartmentsLabel")}: <strong>${list.map(escapeHtml).join(", ")}</strong></p>`;
  },

  switchTab(tab) {
    this.currentTab = tab;
    document.querySelectorAll("#managerTabs button").forEach((b) => b.classList.toggle("active", b.dataset.mtab === tab));
    const map = {
      status: "managerStatusView",
      daily: "managerDailyView",
      monthly: "managerMonthlyView",
      employees: "managerEmployeesView",
    };
    Object.entries(map).forEach(([name, id]) => {
      document.getElementById(id).classList.toggle("hidden", name !== tab);
    });
    if (tab === "status") this.renderStatus();
    else if (tab === "daily") this.renderDaily();
    else if (tab === "monthly") this.renderMonthly();
    else if (tab === "employees") this.renderEmployees();
  },

  /* -------------------- 신청 현황 (담당 부서 소속 직원의 신청/취소 대신 처리) -------------------- */
  async renderStatus() {
    await this.ensureScope();
    const container = document.getElementById("managerStatusView");
    const date = this.statusDate || todayStr();
    this.statusDate = date;
    container.innerHTML = `
      <div class="card">
        ${this.scopeNoticeHtml()}
        <div class="toolbar">
          <label>${t("selectDate")}</label>
          <input type="date" id="mgrStatusDateInput" value="${date}">
        </div>
        <p class="deadline-note">${t("adminOverrideNotice")}</p>
        <div class="toolbar">
          <input type="text" id="mgrOverrideEmpId" placeholder="${t("employeeId")}" style="width:120px;">
          <select id="mgrOverrideMealType">
            <option value="lunch">${t("lunch")}</option>
            <option value="dinner">${t("dinner")}</option>
          </select>
          <input type="number" id="mgrOverrideHeadcount" min="1" max="9999" placeholder="${t("headcountPlaceholder")}" style="width:110px;" title="${t("headcountHelp")}">
          <button id="mgrOverrideAddBtn">${t("apply")}</button>
        </div>
        <div id="mgrStatusLists">${t("loading")}</div>
      </div>
      <div class="card">
        <h3>${t("pendingEmployees")}</h3>
        <div id="mgrPendingLists">${t("loading")}</div>
      </div>
    `;
    document.getElementById("mgrStatusDateInput").addEventListener("change", (e) => { this.statusDate = e.target.value; this.renderStatus(); });
    document.getElementById("mgrOverrideAddBtn").addEventListener("click", () => this.overrideApply());
    await Promise.all([this.loadStatusList(), this.loadPendingList()]);
  },

  async loadStatusList() {
    const listEl = document.getElementById("mgrStatusLists");
    try {
      const data = await API.get(`/manager/reservations?date=${this.statusDate}`);
      const rowsHtml = (rows, mealType) => rows.map((r) => `
        <tr>
          <td>${escapeHtml(r.employeeId)}</td>
          <td>${escapeHtml(r.employeeName)}</td>
          <td>${escapeHtml(r.department)}</td>
          <td>${r.headcount ?? 1}</td>
          <td>${r.guestCount ? r.guestCount : "-"}</td>
          <td>${r.modifiedByAdmin ? "O" : ""}</td>
          <td><button class="danger" data-cancel-id="${escapeHtml(r.employeeId)}" data-meal="${mealType}">${t("cancel")}</button></td>
        </tr>`).join("");
      listEl.innerHTML = `
        <div class="summary-cards">
          <div class="stat"><div class="num">${data.lunchCount}</div><div class="lbl">${t("lunchCount")}</div></div>
          <div class="stat"><div class="num">${data.lunchGuestCount}</div><div class="lbl">${t("guestStaffLabel")} ${t("lunch")}</div></div>
          <div class="stat"><div class="num">${data.dinnerCount}</div><div class="lbl">${t("dinnerCount")}</div></div>
          <div class="stat"><div class="num">${data.dinnerGuestCount}</div><div class="lbl">${t("guestStaffLabel")} ${t("dinner")}</div></div>
        </div>
        <h3>${t("lunch")}</h3>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>${t("employeeId")}</th><th>${t("name")}</th><th>${t("department")}</th><th>${t("headcountLabel")}</th><th>${t("guestStaffLabel")}</th><th>Admin</th><th></th></tr></thead>
          <tbody>${rowsHtml(data.lunch, "lunch") || `<tr><td colspan="7">${t("noData")}</td></tr>`}</tbody>
        </table></div>
        <h3>${t("dinner")}</h3>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>${t("employeeId")}</th><th>${t("name")}</th><th>${t("department")}</th><th>${t("headcountLabel")}</th><th>${t("guestStaffLabel")}</th><th>Admin</th><th></th></tr></thead>
          <tbody>${rowsHtml(data.dinner, "dinner") || `<tr><td colspan="7">${t("noData")}</td></tr>`}</tbody>
        </table></div>
      `;
      listEl.querySelectorAll("[data-cancel-id]").forEach((btn) => {
        btn.addEventListener("click", () => this.overrideSet(btn.dataset.cancelId, btn.dataset.meal, "cancelled"));
      });
    } catch (err) {
      listEl.textContent = err.message;
    }
  },

  async loadPendingList() {
    const el = document.getElementById("mgrPendingLists");
    try {
      const data = await API.get(`/manager/reservations/pending?date=${this.statusDate}`);
      const rowsHtml = (rows) => rows.map((e) => `
        <tr>
          <td>${escapeHtml(e.employeeId)}</td>
          <td>${escapeHtml(e.name)}${e.employeeType === "contractor" ? ` <span class="badge admin">${t("contractorBadge")}</span>` : ""}</td>
          <td>${escapeHtml(e.department)}</td>
          <td>${e.shortfall}${e.employeeType === "contractor" && Number.isInteger(e.totalHeadcount) ? ` <span class="deadline-note" style="display:inline;">(${t("appliedOfTotal", e.appliedHeadcount, e.totalHeadcount)})</span>` : ""}</td>
        </tr>`).join("");
      el.innerHTML = `
        <div class="summary-cards">
          <div class="stat"><div class="num">${data.pendingLunchCount}</div><div class="lbl">${t("pendingLunch")}</div></div>
          <div class="stat"><div class="num">${data.pendingDinnerCount}</div><div class="lbl">${t("pendingDinner")}</div></div>
        </div>
        <h3>${t("pendingLunch")}</h3>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>${t("employeeId")}</th><th>${t("name")}</th><th>${t("department")}</th><th>${t("headcountLabel")}</th></tr></thead>
          <tbody>${rowsHtml(data.pendingLunch) || `<tr><td colspan="4">${t("noData")}</td></tr>`}</tbody>
        </table></div>
        <h3>${t("pendingDinner")}</h3>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>${t("employeeId")}</th><th>${t("name")}</th><th>${t("department")}</th><th>${t("headcountLabel")}</th></tr></thead>
          <tbody>${rowsHtml(data.pendingDinner) || `<tr><td colspan="4">${t("noData")}</td></tr>`}</tbody>
        </table></div>
      `;
    } catch (err) {
      el.textContent = err.message;
    }
  },

  async overrideApply() {
    const employeeId = document.getElementById("mgrOverrideEmpId").value.trim();
    const mealType = document.getElementById("mgrOverrideMealType").value;
    const headcountRaw = document.getElementById("mgrOverrideHeadcount").value.trim();
    if (!employeeId) return;
    const headcount = headcountRaw ? parseInt(headcountRaw, 10) : undefined;
    await this.overrideSet(employeeId, mealType, "applied", headcount);
    document.getElementById("mgrOverrideEmpId").value = "";
    document.getElementById("mgrOverrideHeadcount").value = "";
  },

  async overrideSet(employeeId, mealType, status, headcount) {
    if (status === "cancelled" && !confirm(t("confirmCancel"))) return;
    try {
      const body = { employeeId, date: this.statusDate, mealType, status };
      if (Number.isInteger(headcount)) body.headcount = headcount;
      await API.put("/manager/reservations/override", body);
      showToast(status === "applied" ? t("applySuccess") : t("cancelSuccess"));
      this.loadStatusList();
      this.loadPendingList();
    } catch (err) {
      alert(err.message);
    }
  },

  /* -------------------- 일일 집계 -------------------- */
  async renderDaily() {
    await this.ensureScope();
    const container = document.getElementById("managerDailyView");
    const date = this.dailyDate || todayStr();
    this.dailyDate = date;
    container.innerHTML = `
      <div class="card">
        ${this.scopeNoticeHtml()}
        <div class="toolbar no-print">
          <label>${t("selectDate")}</label>
          <input type="date" id="mgrDailyDateInput" value="${date}">
          <div class="spacer"></div>
          <button class="secondary" id="mgrDailyExcelBtn">${t("downloadExcel")}</button>
          <button class="secondary" id="mgrDailyPrintBtn">${t("print")}</button>
        </div>
        <h2 id="mgrDailyDateHeading">${date}</h2>
        <div id="mgrDailyContent">${t("loading")}</div>
      </div>
    `;
    document.getElementById("mgrDailyDateInput").addEventListener("change", (e) => { this.dailyDate = e.target.value; this.renderDaily(); });
    document.getElementById("mgrDailyExcelBtn").addEventListener("click", () => downloadFile(`/manager/export/daily?date=${this.dailyDate}`, `meal_${this.dailyDate}.xlsx`));
    document.getElementById("mgrDailyPrintBtn").addEventListener("click", () => window.print());
    await this.loadDaily();
  },

  async loadDaily() {
    const el = document.getElementById("mgrDailyContent");
    try {
      const data = await API.get(`/manager/summary/daily?date=${this.dailyDate}`);
      const heading = document.getElementById("mgrDailyDateHeading");
      if (heading) {
        const tag = data.dayType && data.dayType !== "weekday"
          ? ` <span class="badge" style="background:#fee2e2;color:#dc2626;">${escapeHtml(data.holidayLabel) || t("weekendLabel")}</span>`
          : "";
        heading.innerHTML = `${escapeHtml(this.dailyDate)}${tag}`;
      }
      const appliedRows = (list) => list.map((r) => `
        <tr>
          <td>${escapeHtml(r.employeeId)}</td>
          <td>${escapeHtml(r.employeeName)}</td>
          <td>${escapeHtml(r.department)}</td>
          <td>${r.headcount ?? 1}</td>
          <td>${r.guestCount ? r.guestCount : "-"}</td>
        </tr>`).join("") || `<tr><td colspan="5">${t("noData")}</td></tr>`;
      const pendingRows = (list) => list.map((e) => `
        <tr>
          <td>${escapeHtml(e.employeeId)}</td>
          <td>${escapeHtml(e.name)}${e.employeeType === "contractor" ? ` <span class="badge admin">${t("contractorBadge")}</span>` : ""}</td>
          <td>${escapeHtml(e.department)}</td>
          <td>${e.shortfall}</td>
        </tr>`).join("") || `<tr><td colspan="4">${t("noData")}</td></tr>`;
      const listTable = (rowsHtml) => `
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>${t("employeeId")}</th><th>${t("name")}</th><th>${t("department")}</th><th>${t("headcountLabel")}</th><th>${t("guestStaffLabel")}</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table></div>`;
      const pendingTable = (rowsHtml) => `
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>${t("employeeId")}</th><th>${t("name")}</th><th>${t("department")}</th><th>${t("headcountLabel")}</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table></div>`;
      el.innerHTML = `
        <div class="summary-cards">
          <div class="stat"><div class="num">${data.individualLunchCount}</div><div class="lbl">${t("individualStaffLabel")} ${t("lunch")}</div></div>
          <div class="stat"><div class="num">${data.contractorLunchCount}</div><div class="lbl">${t("contractorStaffLabel")} ${t("lunch")}</div></div>
          <div class="stat"><div class="num">${data.guestLunchCount}</div><div class="lbl">${t("guestStaffLabel")} ${t("lunch")}</div></div>
          <div class="stat highlight"><div class="num">${data.lunchCount}</div><div class="lbl">${t("lunch")} ${t("total")}</div></div>
          <div class="stat"><div class="num">${data.individualDinnerCount}</div><div class="lbl">${t("individualStaffLabel")} ${t("dinner")}</div></div>
          <div class="stat"><div class="num">${data.contractorDinnerCount}</div><div class="lbl">${t("contractorStaffLabel")} ${t("dinner")}</div></div>
          <div class="stat"><div class="num">${data.guestDinnerCount}</div><div class="lbl">${t("guestStaffLabel")} ${t("dinner")}</div></div>
          <div class="stat highlight"><div class="num">${data.dinnerCount}</div><div class="lbl">${t("dinner")} ${t("total")}</div></div>
        </div>
        <h3>${t("lunch")} ${t("applicantListLabel")} (${data.lunchCount})</h3>
        ${listTable(appliedRows(data.lunch))}
        <h3>${t("lunch")} ${t("nonApplicantListLabel")} (${data.pendingLunchCount})</h3>
        ${pendingTable(pendingRows(data.pendingLunch))}
        <h3>${t("dinner")} ${t("applicantListLabel")} (${data.dinnerCount})</h3>
        ${listTable(appliedRows(data.dinner))}
        <h3>${t("dinner")} ${t("nonApplicantListLabel")} (${data.pendingDinnerCount})</h3>
        ${pendingTable(pendingRows(data.pendingDinner))}
      `;
    } catch (err) {
      el.textContent = err.message;
    }
  },

  /* -------------------- 월간 집계 -------------------- */
  async renderMonthly() {
    await this.ensureScope();
    const container = document.getElementById("managerMonthlyView");
    const month = this.month || todayStr().slice(0, 7);
    this.month = month;
    container.innerHTML = `
      <div class="card">
        ${this.scopeNoticeHtml()}
        <div class="toolbar no-print">
          <label>${t("selectMonth")}</label>
          <input type="month" id="mgrMonthInput" value="${month}">
          <div class="spacer"></div>
          <button class="secondary" id="mgrMonthlyExcelBtn">${t("downloadExcel")}</button>
          <button class="secondary" id="mgrMonthlyPrintBtn">${t("print")}</button>
        </div>
        <h2>${month}</h2>
        <div id="mgrMonthlyContent">${t("loading")}</div>
      </div>
    `;
    document.getElementById("mgrMonthInput").addEventListener("change", (e) => { this.month = e.target.value; this.renderMonthly(); });
    document.getElementById("mgrMonthlyExcelBtn").addEventListener("click", () => downloadFile(`/manager/export/monthly?month=${this.month}`, `meal_${this.month}.xlsx`));
    document.getElementById("mgrMonthlyPrintBtn").addEventListener("click", () => window.print());
    await this.loadMonthly();
  },

  async loadMonthly() {
    const el = document.getElementById("mgrMonthlyContent");
    try {
      const data = await API.get(`/manager/summary/monthly?month=${this.month}`);
      el.innerHTML = `
        <div class="summary-cards">
          <div class="stat"><div class="num">${data.individualTotalLunch}</div><div class="lbl">${t("individualStaffLabel")} ${t("lunch")}</div></div>
          <div class="stat"><div class="num">${data.contractorTotalLunch}</div><div class="lbl">${t("contractorStaffLabel")} ${t("lunch")}</div></div>
          <div class="stat"><div class="num">${data.guestTotalLunch}</div><div class="lbl">${t("guestStaffLabel")} ${t("lunch")}</div></div>
          <div class="stat highlight"><div class="num">${data.totalLunch}</div><div class="lbl">${t("lunch")} ${t("total")}</div></div>
          <div class="stat"><div class="num">${data.individualTotalDinner}</div><div class="lbl">${t("individualStaffLabel")} ${t("dinner")}</div></div>
          <div class="stat"><div class="num">${data.contractorTotalDinner}</div><div class="lbl">${t("contractorStaffLabel")} ${t("dinner")}</div></div>
          <div class="stat"><div class="num">${data.guestTotalDinner}</div><div class="lbl">${t("guestStaffLabel")} ${t("dinner")}</div></div>
          <div class="stat highlight"><div class="num">${data.totalDinner}</div><div class="lbl">${t("dinner")} ${t("total")}</div></div>
        </div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>${t("date")}</th><th>${t("lunchCount")}</th><th>${t("dinnerCount")}</th></tr></thead>
          <tbody>${data.days.map((d) => {
            const isOff = d.dayType && d.dayType !== "weekday";
            const style = isOff ? ' style="color:#dc2626;font-weight:700;"' : "";
            const tag = d.dayType === "holiday" && d.holidayLabel ? ` (${escapeHtml(d.holidayLabel)})` : "";
            return `<tr${style}><td>${d.date}${tag}</td><td>${d.lunchCount}</td><td>${d.dinnerCount}</td></tr>`;
          }).join("")}</tbody>
        </table></div>
      `;
    } catch (err) {
      el.textContent = err.message;
    }
  },

  /* -------------------- 직원(담당 부서) 관리 - 수정만 가능, 추가/삭제 불가 -------------------- */
  async renderEmployees() {
    await this.ensureScope();
    const container = document.getElementById("managerEmployeesView");
    container.innerHTML = `
      <div class="card">
        ${this.scopeNoticeHtml()}
        <p class="deadline-note">${t("managerEmployeesNotice")}</p>
        <div class="toolbar">
          <label>${t("empSearch")}</label>
          <input type="text" id="mgrEmpSearchInput" placeholder="${t("empSearchPlaceholder")}" value="${escapeHtml(this.empSearchTerm)}" style="min-width:220px;">
          <label>${t("sortBy")}</label>
          <select id="mgrEmpSortSelect">
            <option value="department" ${this.empSort === "department" ? "selected" : ""}>${t("sortByDept")}</option>
            <option value="name" ${this.empSort === "name" ? "selected" : ""}>${t("sortByName")}</option>
            <option value="employeeId" ${this.empSort === "employeeId" ? "selected" : ""}>${t("sortByEmpId")}</option>
            <option value="status" ${this.empSort === "status" ? "selected" : ""}>${t("sortByStatus")}</option>
          </select>
        </div>
        <div class="table-wrap"><table class="data-table" id="mgrEmpTable">
          <thead><tr><th>${t("employeeId")}</th><th>${t("name")}</th><th>${t("department")}</th><th>${t("employeeType")}</th><th>${t("active")}</th><th></th></tr></thead>
          <tbody><tr><td colspan="6">${t("loading")}</td></tr></tbody>
        </table></div>
      </div>
    `;
    document.getElementById("mgrEmpSearchInput").addEventListener("input", (e) => {
      this.empSearchTerm = e.target.value;
      this.renderEmployeeRows();
    });
    document.getElementById("mgrEmpSortSelect").addEventListener("change", (e) => {
      this.empSort = e.target.value;
      this.renderEmployeeRows();
    });
    await this.loadEmployees();
  },

  async loadEmployees() {
    const tbody = document.querySelector("#mgrEmpTable tbody");
    try {
      const data = await API.get("/manager/employees");
      this.employeesCache = data.employees;
      this.renderEmployeeRows();
    } catch (err) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="6">${escapeHtml(err.message)}</td></tr>`;
    }
  },

  sortEmployees(list) {
    const sorted = [...list];
    const cmp = (a, b) => String(a || "").localeCompare(String(b || ""), "ko");
    switch (this.empSort) {
      case "name":
        sorted.sort((a, b) => cmp(a.name, b.name));
        break;
      case "employeeId":
        sorted.sort((a, b) => String(a.employeeId).localeCompare(String(b.employeeId), undefined, { numeric: true }));
        break;
      case "status":
        sorted.sort((a, b) => (b.active === a.active ? cmp(a.department, b.department) || cmp(a.name, b.name) : b.active - a.active));
        break;
      case "department":
      default:
        sorted.sort((a, b) => cmp(a.department, b.department) || cmp(a.name, b.name));
        break;
    }
    return sorted;
  },

  renderEmployeeRows() {
    const tbody = document.querySelector("#mgrEmpTable tbody");
    if (!tbody) return;
    const term = (this.empSearchTerm || "").trim().toLowerCase();
    let list = term
      ? this.employeesCache.filter((e) =>
          [e.employeeId, e.name, e.department].some((v) => String(v || "").toLowerCase().includes(term))
        )
      : this.employeesCache;
    list = this.sortEmployees(list);
    tbody.innerHTML = list.map((e) => `
        <tr>
          <td>${escapeHtml(e.employeeId)}</td>
          <td>${escapeHtml(e.name)}</td>
          <td>${escapeHtml(e.department)}</td>
          <td>${e.employeeType === "contractor" ? `<span class="badge admin">${t("contractorBadge")}</span>${Number.isInteger(e.totalHeadcount) ? ` TO ${e.totalHeadcount}` : ""}` : t("individualType")}</td>
          <td>${e.active ? t("active") : t("inactive")}</td>
          <td><button class="secondary" data-edit="${e._id}">${t("edit")}</button></td>
        </tr>
      `).join("") || `<tr><td colspan="6">${t("noData")}</td></tr>`;
    tbody.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => this.openEmployeeModal(b.dataset.edit)));
  },

  openEmployeeModal(id) {
    const emp = this.employeesCache.find((e) => e._id === id);
    if (!emp) return;
    openModal(`
      <h3>${t("edit")}</h3>
      <div class="field"><label>${t("employeeId")}</label><input value="${escapeHtml(emp.employeeId)}" disabled></div>
      <div class="field"><label>${t("name")}</label><input id="mgrMName" value="${escapeHtml(emp.name)}"></div>
      <div class="field"><label>${t("department")}</label><input value="${escapeHtml(emp.department)}" disabled></div>
      <div class="field"><label>${t("employeeType")}</label>
        <select id="mgrMEmployeeType">
          <option value="individual" ${emp.employeeType !== "contractor" ? "selected" : ""}>${t("individualType")}</option>
          <option value="contractor" ${emp.employeeType === "contractor" ? "selected" : ""}>${t("contractorType")}</option>
        </select>
      </div>
      <div class="field" id="mgrMTotalHeadcountField" style="${emp.employeeType === "contractor" ? "" : "display:none;"}">
        <label>${t("totalHeadcount")}</label>
        <input id="mgrMTotalHeadcount" type="number" min="0" placeholder="${t("totalHeadcountPlaceholder")}" value="${Number.isInteger(emp.totalHeadcount) ? emp.totalHeadcount : ""}">
        <div class="login-help">${t("totalHeadcountHelp")}</div>
      </div>
      <div class="field"><label>${t("active")}</label>
        <select id="mgrMActive">
          <option value="1" ${emp.active ? "selected" : ""}>${t("active")}</option>
          <option value="0" ${!emp.active ? "selected" : ""}>${t("inactive")}</option>
        </select>
      </div>
      <div class="toolbar" style="margin-top:14px;">
        <button id="mgrMSaveBtn">${t("save")}</button>
        <button class="secondary" id="mgrMCloseBtn">${t("close")}</button>
      </div>
    `);
    document.getElementById("mgrMCloseBtn").addEventListener("click", closeModal);
    document.getElementById("mgrMEmployeeType").addEventListener("change", (e) => {
      document.getElementById("mgrMTotalHeadcountField").style.display = e.target.value === "contractor" ? "" : "none";
    });
    document.getElementById("mgrMSaveBtn").addEventListener("click", async () => {
      const name = document.getElementById("mgrMName").value.trim();
      const employeeType = document.getElementById("mgrMEmployeeType").value;
      const totalHeadcount = document.getElementById("mgrMTotalHeadcount").value.trim();
      const active = document.getElementById("mgrMActive").value === "1";
      try {
        await API.put(`/manager/employees/${emp._id}`, { name, employeeType, totalHeadcount, active });
        closeModal();
        showToast(t("save"));
        this.loadEmployees();
      } catch (err) {
        alert(err.message);
      }
    });
  },
};

document.addEventListener("DOMContentLoaded", () => ManagerUI.init());
