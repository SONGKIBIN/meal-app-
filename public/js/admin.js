/* 관리자 화면 로직 */

function openModal(innerHtml) {
  closeModal();
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.id = "modalBackdrop";
  backdrop.innerHTML = `<div class="modal">${innerHtml}</div>`;
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeModal(); });
  document.body.appendChild(backdrop);
}
function closeModal() {
  const el = document.getElementById("modalBackdrop");
  if (el) el.remove();
}

async function downloadFile(path, filename) {
  try {
    const res = await API.get(path);
    let blob;
    if (res instanceof Response) {
      blob = await res.blob();
    } else if (res instanceof Blob) {
      blob = res;
    } else {
      // 백업 다운로드처럼 서버 응답이 JSON 형식이라 api.js에서 이미 객체로 변환된 경우,
      // 다시 텍스트로 만들어 파일로 저장합니다.
      blob = new Blob([JSON.stringify(res, null, 2)], { type: "application/json" });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(err.message);
  }
}

// 이번 주/다음 주 월요일 날짜(YYYY-MM-DD)를 구합니다.
function mondayOf(dateStr) {
  const wd = new Date(dateStr + "T00:00:00Z").getUTCDay(); // 0=일 ... 6=토
  const offset = wd === 0 ? -6 : 1 - wd;
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

const AdminUI = {
  currentTab: null,
  employeesCache: [],
  empSearchTerm: "",
  empSort: "department",
  empStatusFilter: "active",
  statusDate: null,
  dailyDate: null,
  month: null,
  menuWeekStart: null,
  satisfactionSubTab: "daily",
  satisfactionDate: null,
  satisfactionMonth: null,

  init() {
    document.querySelectorAll("#adminTabs button").forEach((b) => {
      b.addEventListener("click", () => this.switchTab(b.dataset.atab));
    });
    // "개발자 모드" 탭은 마스터 관리자(사번 admin) 계정에게만 보입니다. 다른 관리자는 이 탭 자체가
    // 화면에 나타나지 않고, 혹시 URL을 조작해 접근을 시도해도 서버(requireMasterAdmin)에서 차단됩니다.
    const user = API.getUser();
    if (user && user.isMasterAdmin) {
      document.getElementById("atabDeveloper").classList.remove("hidden");
    }
  },

  switchTab(tab) {
    this.currentTab = tab;
    document.querySelectorAll("#adminTabs button").forEach((b) => b.classList.toggle("active", b.dataset.atab === tab));
    const map = {
      status: "adminStatusView",
      daily: "adminDailyView",
      monthly: "adminMonthlyView",
      employees: "adminEmployeesView",
      menu: "adminMenuView",
      satisfaction: "adminSatisfactionView",
      settings: "adminSettingsView",
      developer: "adminDeveloperView",
    };
    Object.entries(map).forEach(([name, id]) => {
      document.getElementById(id).classList.toggle("hidden", name !== tab);
    });
    if (tab === "status") this.renderStatus();
    else if (tab === "daily") this.renderDaily();
    else if (tab === "monthly") this.renderMonthly();
    else if (tab === "employees") this.renderEmployees();
    else if (tab === "menu") this.renderMenu();
    else if (tab === "satisfaction") this.renderSatisfaction();
    else if (tab === "settings") this.renderSettings();
    else if (tab === "developer") this.renderDeveloper();
  },

  /* -------------------- 신청 현황 (당일 신청/취소 강제 변경 가능) -------------------- */
  async renderStatus() {
    const container = document.getElementById("adminStatusView");
    const date = this.statusDate || todayStr();
    this.statusDate = date;
    container.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <label>${t("selectDate")}</label>
          <input type="date" id="statusDateInput" value="${date}">
        </div>
        <p class="deadline-note">${t("adminOverrideNotice")}</p>
        <div class="toolbar">
          <input type="text" id="overrideEmpId" placeholder="${t("employeeId")}" style="width:120px;">
          <select id="overrideMealType">
            <option value="lunch">${t("lunch")}</option>
            <option value="dinner">${t("dinner")}</option>
          </select>
          <input type="number" id="overrideHeadcount" min="1" max="9999" placeholder="${t("headcountPlaceholder")}" style="width:110px;" title="${t("headcountHelp")}">
          <button id="overrideAddBtn">${t("apply")}</button>
        </div>
        <div id="statusLists">${t("loading")}</div>
      </div>
      <div class="card">
        <h3>${t("pendingEmployees")}</h3>
        <div id="pendingLists">${t("loading")}</div>
      </div>
    `;
    document.getElementById("statusDateInput").addEventListener("change", (e) => { this.statusDate = e.target.value; this.renderStatus(); });
    document.getElementById("overrideAddBtn").addEventListener("click", () => this.overrideApply());
    await Promise.all([this.loadStatusList(), this.loadPendingList()]);
  },

  async loadStatusList() {
    const listEl = document.getElementById("statusLists");
    try {
      const data = await API.get(`/admin/reservations?date=${this.statusDate}`);
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

  // 아직 신청하지 않은 재직 직원 목록 (중식/석식 각각) - 급식 준비 인원 파악용
  async loadPendingList() {
    const el = document.getElementById("pendingLists");
    try {
      const data = await API.get(`/admin/reservations/pending?date=${this.statusDate}`);
      const rowsHtml = (rows, mealType) => rows.map((e) => `
        <tr>
          <td>${escapeHtml(e.employeeId)}</td>
          <td>${escapeHtml(e.name)}${e.employeeType === "contractor" ? ` <span class="badge admin">${t("contractorBadge")}</span>` : ""}</td>
          <td>${escapeHtml(e.department)}</td>
          <td>${e.shortfall}${e.employeeType === "contractor" && Number.isInteger(e.totalHeadcount) ? ` <span class="deadline-note" style="display:inline;">(${t("appliedOfTotal", e.appliedHeadcount, e.totalHeadcount)})</span>` : ""}</td>
          <td><button data-apply-id="${escapeHtml(e.employeeId)}" data-meal="${mealType}" data-target="${e.employeeType === "contractor" && Number.isInteger(e.totalHeadcount) ? e.totalHeadcount : e.shortfall}" data-contractor="${e.employeeType === "contractor" ? "1" : "0"}">${t("apply")}</button></td>
        </tr>`).join("");
      el.innerHTML = `
        <div class="summary-cards">
          <div class="stat"><div class="num">${data.pendingLunchCount}</div><div class="lbl">${t("pendingLunch")}</div></div>
          <div class="stat"><div class="num">${data.pendingDinnerCount}</div><div class="lbl">${t("pendingDinner")}</div></div>
        </div>
        <h3>${t("pendingLunch")}</h3>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>${t("employeeId")}</th><th>${t("name")}</th><th>${t("department")}</th><th>${t("headcountLabel")}</th><th></th></tr></thead>
          <tbody>${rowsHtml(data.pendingLunch, "lunch") || `<tr><td colspan="5">${t("noData")}</td></tr>`}</tbody>
        </table></div>
        <h3>${t("pendingDinner")}</h3>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>${t("employeeId")}</th><th>${t("name")}</th><th>${t("department")}</th><th>${t("headcountLabel")}</th><th></th></tr></thead>
          <tbody>${rowsHtml(data.pendingDinner, "dinner") || `<tr><td colspan="5">${t("noData")}</td></tr>`}</tbody>
        </table></div>
      `;
      el.querySelectorAll("[data-apply-id]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const employeeId = btn.dataset.applyId;
          const mealType = btn.dataset.meal;
          const isContractor = btn.dataset.contractor === "1";
          let headcount;
          if (isContractor) {
            const raw = prompt(t("contractorApplyPrompt"), btn.dataset.target);
            if (raw === null) return;
            const n = parseInt(raw.trim(), 10);
            if (!Number.isInteger(n) || n < 0) {
              alert(t("headcountPlaceholder"));
              return;
            }
            headcount = n;
          }
          this.overrideSet(employeeId, mealType, "applied", headcount);
        });
      });
    } catch (err) {
      el.textContent = err.message;
    }
  },

  async overrideApply() {
    const employeeId = document.getElementById("overrideEmpId").value.trim();
    const mealType = document.getElementById("overrideMealType").value;
    const headcountRaw = document.getElementById("overrideHeadcount").value.trim();
    if (!employeeId) return;
    const headcount = headcountRaw ? parseInt(headcountRaw, 10) : undefined;
    await this.overrideSet(employeeId, mealType, "applied", headcount);
    document.getElementById("overrideEmpId").value = "";
    document.getElementById("overrideHeadcount").value = "";
  },

  async overrideSet(employeeId, mealType, status, headcount) {
    if (status === "cancelled" && !confirm(t("confirmCancel"))) return;
    try {
      const body = { employeeId, date: this.statusDate, mealType, status };
      if (Number.isInteger(headcount)) body.headcount = headcount;
      await API.put("/admin/reservations/override", body);
      showToast(status === "applied" ? t("applySuccess") : t("cancelSuccess"));
      this.loadStatusList();
      this.loadPendingList();
    } catch (err) {
      alert(err.message);
    }
  },

  /* -------------------- 일일 집계 -------------------- */
  async renderDaily() {
    const container = document.getElementById("adminDailyView");
    const date = this.dailyDate || todayStr();
    this.dailyDate = date;
    container.innerHTML = `
      <div class="card">
        <div class="toolbar no-print">
          <label>${t("selectDate")}</label>
          <input type="date" id="dailyDateInput" value="${date}">
          <div class="spacer"></div>
          <button class="secondary" id="dailyExcelBtn">${t("downloadExcel")}</button>
          <button class="secondary" id="dailyPrintBtn">${t("print")}</button>
        </div>
        <h2 id="dailyDateHeading">${date}</h2>
        <div id="dailyContent">${t("loading")}</div>
      </div>
    `;
    document.getElementById("dailyDateInput").addEventListener("change", (e) => { this.dailyDate = e.target.value; this.renderDaily(); });
    document.getElementById("dailyExcelBtn").addEventListener("click", () => downloadFile(`/admin/export/daily?date=${this.dailyDate}`, `meal_${this.dailyDate}.xlsx`));
    document.getElementById("dailyPrintBtn").addEventListener("click", () => window.print());
    await this.loadDaily();
  },

  async loadDaily() {
    const el = document.getElementById("dailyContent");
    try {
      const data = await API.get(`/admin/summary/daily?date=${this.dailyDate}`);
      const heading = document.getElementById("dailyDateHeading");
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
    const container = document.getElementById("adminMonthlyView");
    const month = this.month || todayStr().slice(0, 7);
    this.month = month;
    container.innerHTML = `
      <div class="card">
        <div class="toolbar no-print">
          <label>${t("selectMonth")}</label>
          <input type="month" id="monthInput" value="${month}">
          <div class="spacer"></div>
          <button class="secondary" id="monthlyExcelBtn">${t("downloadExcel")}</button>
          <button class="secondary" id="monthlyPrintBtn">${t("print")}</button>
        </div>
        <h2>${month}</h2>
        <div id="monthlyContent">${t("loading")}</div>
      </div>
    `;
    document.getElementById("monthInput").addEventListener("change", (e) => { this.month = e.target.value; this.renderMonthly(); });
    document.getElementById("monthlyExcelBtn").addEventListener("click", () => downloadFile(`/admin/export/monthly?month=${this.month}`, `meal_${this.month}.xlsx`));
    document.getElementById("monthlyPrintBtn").addEventListener("click", () => window.print());
    await this.loadMonthly();
  },

  async loadMonthly() {
    const el = document.getElementById("monthlyContent");
    try {
      const data = await API.get(`/admin/summary/monthly?month=${this.month}`);
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

  /* -------------------- 직원 관리 -------------------- */
  async renderEmployees() {
    const container = document.getElementById("adminEmployeesView");
    container.innerHTML = `
      <div class="card">
        <h2>${t("employeeCountSummary")}</h2>
        <div class="summary-cards" id="empCountSummary"></div>
      </div>
      <div class="card hidden" id="empPendingRequestsCard"></div>
      <div class="card">
        <div class="toolbar no-print">
          <button id="addEmpBtn">${t("addEmployee")}</button>
          <div class="spacer"></div>
          <button class="secondary" id="empExcelBtn">${t("downloadExcel")}</button>
          <button class="secondary" id="empPrintBtn">${t("print")}</button>
          <button class="secondary" id="downloadTemplateBtn">${t("downloadTemplate")}</button>
        </div>
        <div class="toolbar">
          <input type="file" id="importFileInput" accept=".xlsx,.xls">
          <button id="importUploadBtn">${t("uploadFile")}</button>
        </div>
        <div id="importResult" class="deadline-note"></div>
        <div class="toolbar">
          <label>${t("empSearch")}</label>
          <input type="text" id="empSearchInput" placeholder="${t("empSearchPlaceholder")}" value="${escapeHtml(this.empSearchTerm)}" style="min-width:220px;">
          <label>${t("sortBy")}</label>
          <select id="empSortSelect">
            <option value="department" ${this.empSort === "department" ? "selected" : ""}>${t("sortByDept")}</option>
            <option value="name" ${this.empSort === "name" ? "selected" : ""}>${t("sortByName")}</option>
            <option value="employeeId" ${this.empSort === "employeeId" ? "selected" : ""}>${t("sortByEmpId")}</option>
            <option value="status" ${this.empSort === "status" ? "selected" : ""}>${t("sortByStatus")}</option>
            <option value="role" ${this.empSort === "role" ? "selected" : ""}>${t("sortByRole")}</option>
          </select>
        </div>
        <div class="tabs" id="empStatusFilterTabs">
          <button class="${this.empStatusFilter === "all" ? "active" : ""}" data-status-filter="all">${t("statusAll")}</button>
          <button class="${this.empStatusFilter === "active" ? "active" : ""}" data-status-filter="active">${t("statusActiveFilter")}</button>
          <button class="${this.empStatusFilter === "inactive" ? "active" : ""}" data-status-filter="inactive">${t("statusInactiveFilter")}</button>
        </div>
        <div class="table-wrap"><table class="data-table" id="empTable" style="table-layout:fixed;">
          <colgroup>
            <col style="width:10%"><col style="width:9%"><col style="width:17%">
            <col style="width:10%"><col style="width:10%"><col style="width:10%"><col style="width:34%">
          </colgroup>
          <thead><tr><th>${t("employeeId")}</th><th>${t("name")}</th><th>${t("department")}</th><th>${t("employeeType")}</th><th>${t("role")}</th><th>${t("active")}</th><th></th></tr></thead>
          <tbody><tr><td colspan="7">${t("loading")}</td></tr></tbody>
        </table></div>
      </div>
    `;
    document.getElementById("addEmpBtn").addEventListener("click", () => this.openEmployeeModal());
    document.getElementById("empExcelBtn").addEventListener("click", () =>
      downloadFile(`/admin/employees/export?status=${this.empStatusFilter}`, `employee_list_${todayStr()}.xlsx`)
    );
    document.getElementById("empPrintBtn").addEventListener("click", () => window.print());
    document.getElementById("downloadTemplateBtn").addEventListener("click", () => downloadFile("/admin/employees/import-template", "employee_template.xlsx"));
    document.getElementById("importUploadBtn").addEventListener("click", () => this.uploadImport());
    document.getElementById("empSearchInput").addEventListener("input", (e) => {
      this.empSearchTerm = e.target.value;
      this.renderEmployeeRows();
    });
    document.getElementById("empSortSelect").addEventListener("change", (e) => {
      this.empSort = e.target.value;
      this.renderEmployeeRows();
    });
    document.querySelectorAll("#empStatusFilterTabs [data-status-filter]").forEach((b) => {
      b.addEventListener("click", () => {
        this.empStatusFilter = b.dataset.statusFilter;
        this.renderEmployeeRows();
        document.querySelectorAll("#empStatusFilterTabs [data-status-filter]").forEach((btn) =>
          btn.classList.toggle("active", btn.dataset.statusFilter === this.empStatusFilter)
        );
      });
    });
    await this.loadEmployees();
  },

  async loadEmployees() {
    const tbody = document.querySelector("#empTable tbody");
    try {
      const data = await API.get("/admin/employees");
      this.employeesCache = data.employees;
      this.renderEmployeeSummary();
      this.renderPendingHeadcountRequests();
      this.renderEmployeeRows();
    } catch (err) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="7">${escapeHtml(err.message)}</td></tr>`;
    }
  },

  // 개인 인원 / 도급사 총원(TO 합계) / 합계를 계산해 요약 카드로 표시합니다 (재직 중인 직원 기준).
  // 마스터 관리자 계정(시스템 최초 설치 시 자동 생성된 계정)만 인원 집계에서 제외합니다.
  // 다른 직원에게 부여된 관리자 권한(role=admin)은 일반 직원과 동일하게 인원에 포함됩니다.
  computeEmployeeSummary() {
    const activeList = this.employeesCache.filter((e) => e.active && !e.isMasterAdmin);
    const individualCount = activeList.filter((e) => e.employeeType !== "contractor").length;
    const contractorTotalCount = activeList
      .filter((e) => e.employeeType === "contractor")
      .reduce((sum, e) => sum + (Number.isInteger(e.totalHeadcount) ? e.totalHeadcount : 0), 0);
    return { individualCount, contractorTotalCount, total: individualCount + contractorTotalCount };
  },

  renderEmployeeSummary() {
    const el = document.getElementById("empCountSummary");
    if (!el) return;
    const s = this.computeEmployeeSummary();
    el.innerHTML = `
      <div class="stat"><div class="num">${s.individualCount}</div><div class="lbl">${t("individualCount")}</div></div>
      <div class="stat"><div class="num">${s.contractorTotalCount}</div><div class="lbl">${t("contractorTotalCount")}</div></div>
      <div class="stat"><div class="num">${s.total}</div><div class="lbl">${t("total")}</div></div>
    `;
  },

  // 도급(단체) 계정이 보낸 총원(TO) 수정 요청이 있으면 승인/거절할 수 있는 카드를 표시합니다.
  renderPendingHeadcountRequests() {
    const card = document.getElementById("empPendingRequestsCard");
    if (!card) return;
    const pending = this.employeesCache.filter((e) => Number.isInteger(e.requestedHeadcount));
    if (!pending.length) {
      card.classList.add("hidden");
      card.innerHTML = "";
      return;
    }
    card.classList.remove("hidden");
    card.innerHTML = `
      <h2>${t("pendingHeadcountRequests")}</h2>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>${t("employeeId")}</th><th>${t("name")}</th><th>${t("totalHeadcount")}</th><th>${t("requestHeadcountNew")}</th><th>${t("requestHeadcountNote")}</th><th></th></tr></thead>
        <tbody>${pending.map((e) => `
          <tr>
            <td>${escapeHtml(e.employeeId)}</td>
            <td>${escapeHtml(e.name)}</td>
            <td>${Number.isInteger(e.totalHeadcount) ? e.totalHeadcount : "-"}</td>
            <td><strong>${e.requestedHeadcount}</strong></td>
            <td>${escapeHtml(e.requestedHeadcountNote || "")}</td>
            <td>
              <button data-approve="${e._id}">${t("approve")}</button>
              <button class="danger" data-reject="${e._id}">${t("reject")}</button>
            </td>
          </tr>
        `).join("")}</tbody>
      </table></div>
    `;
    card.querySelectorAll("[data-approve]").forEach((b) => b.addEventListener("click", () => this.approveHeadcountRequest(b.dataset.approve)));
    card.querySelectorAll("[data-reject]").forEach((b) => b.addEventListener("click", () => this.rejectHeadcountRequest(b.dataset.reject)));
  },

  async approveHeadcountRequest(id) {
    try {
      await API.post(`/admin/employees/${id}/approve-headcount-request`, {});
      showToast(t("approveSuccess"));
      this.loadEmployees();
    } catch (err) {
      alert(err.message);
    }
  },

  async rejectHeadcountRequest(id) {
    if (!confirm(t("reject") + "?")) return;
    try {
      await API.post(`/admin/employees/${id}/reject-headcount-request`, {});
      showToast(t("rejectSuccess"));
      this.loadEmployees();
    } catch (err) {
      alert(err.message);
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
      case "role": {
        // 관리자 → 부서 운영자 → 일반직원 순으로 그룹을 묶어서 보여주고, 그룹 내에서는 부서→이름 순으로 정렬합니다.
        const roleRank = (e) => (e.role === "admin" ? 0 : e.role === "manager" ? 1 : 2);
        sorted.sort((a, b) => roleRank(a) - roleRank(b) || cmp(a.department, b.department) || cmp(a.name, b.name));
        break;
      }
      case "department":
      default:
        sorted.sort((a, b) => cmp(a.department, b.department) || cmp(a.name, b.name));
        break;
    }
    return sorted;
  },

  // 검색어 + 재직/퇴직 필터 + 선택한 정렬 기준을 적용해 화면에 표시합니다.
  renderEmployeeRows() {
    const tbody = document.querySelector("#empTable tbody");
    if (!tbody) return;
    const term = (this.empSearchTerm || "").trim().toLowerCase();
    let list = term
      ? this.employeesCache.filter((e) =>
          [e.employeeId, e.name, e.department].some((v) => String(v || "").toLowerCase().includes(term))
        )
      : this.employeesCache;
    if (this.empStatusFilter === "active") list = list.filter((e) => e.active);
    else if (this.empStatusFilter === "inactive") list = list.filter((e) => !e.active);
    list = this.sortEmployees(list);
    tbody.innerHTML = list.map((e) => {
      const pendingBadge = Number.isInteger(e.requestedHeadcount)
        ? ` <span class="badge admin" title="${escapeHtml(t("requestHeadcountChange"))}">→${e.requestedHeadcount}</span>`
        : "";
      const actions = e.active
        ? `<div class="row-actions">
             <button class="secondary" data-edit="${e._id}">${t("edit")}</button>
             <button class="danger" data-del="${e._id}">${t("delete")}</button>
           </div>`
        : `<div class="row-actions">
             <button class="secondary" data-edit="${e._id}">${t("edit")}</button>
             <button class="secondary" data-restore="${e._id}">${t("restoreEmployee")}</button>
             <button class="danger" data-permdel="${e._id}" title="${escapeHtml(t("permanentDeleteHelp"))}">${t("permanentDelete")}</button>
           </div>`;
      return `
        <tr>
          <td>${escapeHtml(e.employeeId)}</td>
          <td>${escapeHtml(e.name)}</td>
          <td>${escapeHtml(e.department)}</td>
          <td>${e.employeeType === "contractor" ? `<span class="badge admin">${t("contractorBadge")}</span>${Number.isInteger(e.totalHeadcount) ? ` TO ${e.totalHeadcount}` : ""}${pendingBadge}` : t("individualType")}</td>
          <td>${e.role === "admin" ? t("admin") : e.role === "manager" ? `${t("manager")}${e.managedDepartments && e.managedDepartments.length ? ` <span class="deadline-note" style="display:inline;">(${escapeHtml(e.managedDepartments.join(", "))})</span>` : ""}` : t("user")}</td>
          <td>${e.active ? t("active") : t("inactive")}</td>
          <td>${actions}</td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="7">${t("noData")}</td></tr>`;
    tbody.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => this.openEmployeeModal(b.dataset.edit)));
    tbody.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => this.deleteEmployee(b.dataset.del)));
    tbody.querySelectorAll("[data-restore]").forEach((b) => b.addEventListener("click", () => this.restoreEmployee(b.dataset.restore)));
    tbody.querySelectorAll("[data-permdel]").forEach((b) => b.addEventListener("click", () => this.permanentDeleteEmployee(b.dataset.permdel)));
  },

  async restoreEmployee(id) {
    if (!confirm(t("confirmRestore"))) return;
    try {
      await API.put(`/admin/employees/${id}`, { active: true });
      showToast(t("restoreEmployee"));
      this.loadEmployees();
    } catch (err) {
      alert(err.message);
    }
  },

  async permanentDeleteEmployee(id) {
    if (!confirm(t("confirmPermanentDelete"))) return;
    try {
      await API.del(`/admin/employees/${id}/permanent`);
      showToast(t("permanentDelete"));
      this.loadEmployees();
    } catch (err) {
      alert(err.message);
    }
  },

  async openEmployeeModal(id) {
    const emp = id ? this.employeesCache.find((e) => e._id === id) : null;
    // 담당 부서 입력 시 오타로 인해 실제 부서명과 어긋나 운영자가 아무 인원도 못 보는 상황을 막기 위해,
    // 기존에 등록된 부서명 목록을 datalist로 함께 보여줍니다.
    if (!this.departmentsCache) {
      try {
        const data = await API.get("/admin/departments");
        this.departmentsCache = data.departments || [];
      } catch (err) {
        this.departmentsCache = [];
      }
    }
    const deptOptionsHtml = this.departmentsCache.map((d) => `<option value="${escapeHtml(d)}">`).join("");
    const currentManaged = emp && emp.managedDepartments ? emp.managedDepartments : [];
    // 담당 부서는 체크박스로 여러 개를 자유롭게 선택할 수 있습니다 (예전에는 쉼표로 구분한 글자 입력칸이었는데,
    // 자동완성 목록에서 하나를 고르면 입력해둔 다른 부서명까지 통째로 지워지는 문제가 있어 체크박스 방식으로 바꿨습니다).
    const deptCheckboxesHtml = this.departmentsCache.length
      ? this.departmentsCache.map((d) => `
          <label class="dept-check-item">
            <input type="checkbox" class="mManagedDeptCheck" value="${escapeHtml(d)}" ${currentManaged.includes(d) ? "checked" : ""}>
            ${escapeHtml(d)}
          </label>
        `).join("")
      : `<span class="login-help">${t("noManagedDepartments")}</span>`;
    openModal(`
      <h3>${emp ? t("edit") : t("addEmployee")}</h3>
      <datalist id="mDeptListOptions">${deptOptionsHtml}</datalist>
      <div class="field"><label>${t("employeeId")}</label><input id="mEmpId" value="${emp ? escapeHtml(emp.employeeId) : ""}" ${emp ? "disabled" : ""}></div>
      <div class="field"><label>${t("name")}</label><input id="mName" value="${emp ? escapeHtml(emp.name) : ""}"></div>
      <div class="field"><label>${t("department")}</label><input id="mDept" list="mDeptListOptions" value="${emp ? escapeHtml(emp.department) : ""}"></div>
      <div class="field"><label>${t("role")}</label>
        <select id="mRole">
          <option value="user" ${!emp || emp.role === "user" ? "selected" : ""}>${t("user")}</option>
          <option value="manager" ${emp && emp.role === "manager" ? "selected" : ""}>${t("manager")}</option>
          <option value="admin" ${emp && emp.role === "admin" ? "selected" : ""}>${t("admin")}</option>
        </select>
      </div>
      <div class="field" id="mManagedDeptField" style="${emp && emp.role === "manager" ? "" : "display:none;"}">
        <label>${t("managedDepartments")}</label>
        <div class="login-help">${t("managedDepartmentsHelp")}</div>
        <div class="dept-check-list" id="mManagedDeptChecks">${deptCheckboxesHtml}</div>
        <div class="toolbar" style="margin-top:6px;">
          <input id="mManagedDeptExtra" list="mDeptListOptions" placeholder="${t("managedDepartmentsPlaceholder")}" style="flex:1;">
          <button type="button" class="secondary" id="mManagedDeptAddBtn">${t("add")}</button>
        </div>
      </div>
      <div class="field"><label>${t("employeeType")}</label>
        <select id="mEmployeeType">
          <option value="individual" ${!emp || emp.employeeType !== "contractor" ? "selected" : ""}>${t("individualType")}</option>
          <option value="contractor" ${emp && emp.employeeType === "contractor" ? "selected" : ""}>${t("contractorType")}</option>
        </select>
      </div>
      <div class="field" id="mTotalHeadcountField" style="${emp && emp.employeeType === "contractor" ? "" : "display:none;"}">
        <label>${t("totalHeadcount")}</label>
        <input id="mTotalHeadcount" type="number" min="0" placeholder="${t("totalHeadcountPlaceholder")}" value="${emp && Number.isInteger(emp.totalHeadcount) ? emp.totalHeadcount : ""}">
        <div class="login-help">${t("totalHeadcountHelp")}</div>
      </div>
      <div class="toolbar" style="margin-top:14px;">
        <button id="mSaveBtn">${t("save")}</button>
        <button class="secondary" id="mCloseBtn">${t("close")}</button>
      </div>
    `);
    document.getElementById("mCloseBtn").addEventListener("click", closeModal);
    document.getElementById("mEmployeeType").addEventListener("change", (e) => {
      document.getElementById("mTotalHeadcountField").style.display = e.target.value === "contractor" ? "" : "none";
    });
    document.getElementById("mRole").addEventListener("change", (e) => {
      document.getElementById("mManagedDeptField").style.display = e.target.value === "manager" ? "" : "none";
    });
    // 체크박스 목록에 아직 없는 부서명(신규 부서 등)은 입력 후 "추가" 버튼으로 새 체크박스를 만들어줍니다.
    const addManagedDeptCheckbox = (value) => {
      const name = value.trim();
      if (!name) return;
      const list = document.getElementById("mManagedDeptChecks");
      const already = [...list.querySelectorAll(".mManagedDeptCheck")].some((cb) => cb.value === name);
      if (already) return;
      const label = document.createElement("label");
      label.className = "dept-check-item";
      label.innerHTML = `<input type="checkbox" class="mManagedDeptCheck" value="${escapeHtml(name)}" checked> ${escapeHtml(name)}`;
      list.appendChild(label);
    };
    document.getElementById("mManagedDeptAddBtn").addEventListener("click", () => {
      const input = document.getElementById("mManagedDeptExtra");
      addManagedDeptCheckbox(input.value);
      input.value = "";
      input.focus();
    });
    document.getElementById("mManagedDeptExtra").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        document.getElementById("mManagedDeptAddBtn").click();
      }
    });
    document.getElementById("mSaveBtn").addEventListener("click", async () => {
      const employeeId = document.getElementById("mEmpId").value.trim();
      const name = document.getElementById("mName").value.trim();
      const department = document.getElementById("mDept").value.trim();
      const role = document.getElementById("mRole").value;
      const managedDepartments = [...document.querySelectorAll(".mManagedDeptCheck:checked")].map((cb) => cb.value);
      const employeeType = document.getElementById("mEmployeeType").value;
      const totalHeadcount = document.getElementById("mTotalHeadcount").value.trim();
      try {
        if (emp) await API.put(`/admin/employees/${emp._id}`, { name, department, role, managedDepartments, employeeType, totalHeadcount });
        else await API.post("/admin/employees", { employeeId, name, department, role, managedDepartments, employeeType, totalHeadcount });
        closeModal();
        showToast(t("save"));
        this.loadEmployees();
      } catch (err) {
        alert(err.message);
      }
    });
  },

  async deleteEmployee(id) {
    if (!confirm(t("confirmDelete"))) return;
    try {
      await API.del(`/admin/employees/${id}`);
      this.loadEmployees();
    } catch (err) {
      alert(err.message);
    }
  },

  async uploadImport() {
    const fileInput = document.getElementById("importFileInput");
    if (!fileInput.files.length) {
      alert(t("uploadFile"));
      return;
    }
    const fd = new FormData();
    fd.append("file", fileInput.files[0]);
    const resultEl = document.getElementById("importResult");
    resultEl.textContent = t("loading");
    try {
      const data = await API.request("POST", "/admin/employees/import", fd, { isFormData: true });
      resultEl.innerHTML = `${t("save")}: +${data.created} / ${t("edit")}: ${data.updated}` +
        (data.errors && data.errors.length ? "<br>" + data.errors.map(escapeHtml).join("<br>") : "");
      fileInput.value = "";
      this.loadEmployees();
    } catch (err) {
      resultEl.textContent = err.message;
    }
  },

  /* -------------------- 식단표 관리 -------------------- */
  async renderMenu() {
    const container = document.getElementById("adminMenuView");
    const thisMonday = mondayOf(todayStr());
    const nextMonday = (() => {
      const d = new Date(thisMonday + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + 7);
      return d.toISOString().slice(0, 10);
    })();
    this.menuWeekStart = this.menuWeekStart || thisMonday;
    container.innerHTML = `
      <div class="card">
        <h2>${t("menuManage")}</h2>
        <div class="toolbar">
          <button class="secondary" id="menuThisWeekBtn">${t("thisWeekMenu")}</button>
          <button class="secondary" id="menuNextWeekBtn">${t("nextWeekMenu")}</button>
          <label>${t("weekOf")}</label>
          <input type="date" id="menuWeekInput" value="${this.menuWeekStart}">
        </div>
        <div id="menuCurrentPreview">${t("loading")}</div>
        <div class="field"><label>${t("uploadMenuImage")}</label><input type="file" id="menuImageInput" accept="image/*"></div>
        <div class="field"><label>${t("menuNote")}</label><textarea id="menuNoteInput" rows="4" style="width:100%;"></textarea></div>
        <div class="toolbar">
          <button id="menuSaveBtn">${t("save")}</button>
          <button class="danger" id="menuDeleteBtn">${t("delete")}</button>
        </div>
      </div>
    `;
    document.getElementById("menuThisWeekBtn").addEventListener("click", () => { this.menuWeekStart = thisMonday; this.renderMenu(); });
    document.getElementById("menuNextWeekBtn").addEventListener("click", () => { this.menuWeekStart = nextMonday; this.renderMenu(); });
    document.getElementById("menuWeekInput").addEventListener("change", (e) => { this.menuWeekStart = mondayOf(e.target.value); this.renderMenu(); });
    document.getElementById("menuSaveBtn").addEventListener("click", () => this.saveMenu());
    document.getElementById("menuDeleteBtn").addEventListener("click", () => this.deleteMenu());
    await this.loadMenuPreview();
  },

  async loadMenuPreview() {
    const el = document.getElementById("menuCurrentPreview");
    try {
      const data = await API.get(`/menu/${this.menuWeekStart}`);
      const noteInput = document.getElementById("menuNoteInput");
      if (data.menu) {
        noteInput.value = data.menu.note || "";
        el.innerHTML = data.menu.imageData
          ? `<img src="${data.menu.imageData}" style="max-width:100%;border-radius:8px;border:1px solid var(--border);margin-bottom:10px;">`
          : "";
      } else {
        noteInput.value = "";
        el.innerHTML = `<p class="deadline-note">${t("noMenu")}</p>`;
      }
    } catch (err) {
      el.textContent = err.message;
    }
  },

  async saveMenu() {
    const fd = new FormData();
    fd.append("weekStart", this.menuWeekStart);
    fd.append("note", document.getElementById("menuNoteInput").value);
    const fileInput = document.getElementById("menuImageInput");
    if (fileInput.files.length) fd.append("image", fileInput.files[0]);
    try {
      await API.request("POST", "/menu", fd, { isFormData: true });
      showToast(t("save"));
      this.loadMenuPreview();
    } catch (err) {
      alert(err.message);
    }
  },

  async deleteMenu() {
    if (!confirm(t("confirmDelete"))) return;
    try {
      await API.del(`/menu/${this.menuWeekStart}`);
      showToast(t("delete"));
      this.loadMenuPreview();
    } catch (err) {
      alert(err.message);
    }
  },

  /* -------------------- 설정 (마감시간 / 공지사항 / 백업) -------------------- */
  async renderSettings() {
    const container = document.getElementById("adminSettingsView");
    container.innerHTML = `
      <div class="card">
        <h2>${t("deadlineSettings")}</h2>
        <p class="deadline-note">${t("deadlineSettingsHelp")}</p>
        <div class="toolbar">
          <label style="min-width:60px;">${t("lunch")}</label>
          <input type="number" id="lunchDeadlineHourInput" min="0" max="23" style="width:70px;">
          <label>${t("deadlineHourLabel")}</label>
          <input type="number" id="lunchDeadlineMinuteInput" min="0" max="59" style="width:70px;">
          <label>${t("deadlineMinuteLabel")}</label>
        </div>
        <div class="toolbar">
          <label style="min-width:60px;">${t("dinner")}</label>
          <input type="number" id="dinnerDeadlineHourInput" min="0" max="23" style="width:70px;">
          <label>${t("deadlineHourLabel")}</label>
          <input type="number" id="dinnerDeadlineMinuteInput" min="0" max="59" style="width:70px;">
          <label>${t("deadlineMinuteLabel")}</label>
        </div>
        <div class="toolbar">
          <button id="saveDeadlineBtn">${t("saveSettings")}</button>
        </div>
      </div>
      <div class="card">
        <h2>${t("holidayManage")}</h2>
        <p class="deadline-note">${t("holidayManageHelp")}</p>
        <div class="toolbar">
          <label>${t("holidayDate")}</label>
          <input type="date" id="holidayDateInput">
          <input type="text" id="holidayLabelInput" placeholder="${t("holidayLabelPlaceholder")}" style="max-width:200px;">
          <button id="addHolidayBtn">${t("addHoliday")}</button>
        </div>
        <div id="holidayList">${t("loading")}</div>
      </div>
      <div class="card">
        <h2>${t("announcementManage")}</h2>
        <textarea id="announcementInput" rows="3" style="width:100%;" placeholder="${t("announcementPlaceholder")}"></textarea>
        <div class="toolbar" style="margin-top:8px;">
          <button id="postAnnouncementBtn">${t("postAnnouncement")}</button>
        </div>
        <div id="announcementList">${t("loading")}</div>
      </div>
      <div class="card">
        <h2>${t("backupData")}</h2>
        <p class="deadline-note">${t("backupDesc")}</p>
        <button class="secondary" id="backupBtn">${t("backupData")}</button>
      </div>
    `;
    document.getElementById("saveDeadlineBtn").addEventListener("click", () => this.saveDeadline());
    document.getElementById("addHolidayBtn").addEventListener("click", () => this.addHoliday());
    document.getElementById("postAnnouncementBtn").addEventListener("click", () => this.postAnnouncement());
    document.getElementById("backupBtn").addEventListener("click", () => downloadFile("/admin/backup", `meal_app_backup_${todayStr()}.json`));
    await Promise.all([this.loadDeadline(), this.loadHolidays(), this.loadAnnouncements()]);
  },

  async loadHolidays() {
    const el = document.getElementById("holidayList");
    try {
      const data = await API.get("/admin/holidays");
      el.innerHTML = data.holidays.length
        ? `<div class="table-wrap"><table class="data-table">
            <thead><tr><th>${t("holidayDate")}</th><th>${t("holidayLabelInput")}</th><th></th></tr></thead>
            <tbody>${data.holidays.map((h) => `
              <tr>
                <td>${escapeHtml(h.date)}</td>
                <td>${escapeHtml(h.label || "-")}</td>
                <td><button class="danger" data-del-holiday="${h._id}">${t("deleteHoliday")}</button></td>
              </tr>
            `).join("")}</tbody>
          </table></div>`
        : `<p class="deadline-note">${t("holidayListEmpty")}</p>`;
      el.querySelectorAll("[data-del-holiday]").forEach((b) => b.addEventListener("click", () => this.deleteHoliday(b.dataset.delHoliday)));
    } catch (err) {
      el.textContent = err.message;
    }
  },

  async addHoliday() {
    const date = document.getElementById("holidayDateInput").value;
    const label = document.getElementById("holidayLabelInput").value.trim();
    if (!date) return;
    try {
      await API.post("/admin/holidays", { date, label });
      document.getElementById("holidayDateInput").value = "";
      document.getElementById("holidayLabelInput").value = "";
      showToast(t("holidayAdded"));
      this.loadHolidays();
    } catch (err) {
      alert(err.message);
    }
  },

  async deleteHoliday(id) {
    if (!confirm(t("confirmDeleteHoliday"))) return;
    try {
      await API.del(`/admin/holidays/${id}`);
      showToast(t("holidayDeleted"));
      this.loadHolidays();
    } catch (err) {
      alert(err.message);
    }
  },

  async loadDeadline() {
    try {
      const data = await API.get("/admin/settings");
      document.getElementById("lunchDeadlineHourInput").value = data.settings.lunchDeadlineHour;
      document.getElementById("lunchDeadlineMinuteInput").value = data.settings.lunchDeadlineMinute;
      document.getElementById("dinnerDeadlineHourInput").value = data.settings.dinnerDeadlineHour;
      document.getElementById("dinnerDeadlineMinuteInput").value = data.settings.dinnerDeadlineMinute;
    } catch (err) {
      alert(err.message);
    }
  },

  async saveDeadline() {
    const lunchDeadlineHour = document.getElementById("lunchDeadlineHourInput").value;
    const lunchDeadlineMinute = document.getElementById("lunchDeadlineMinuteInput").value;
    const dinnerDeadlineHour = document.getElementById("dinnerDeadlineHourInput").value;
    const dinnerDeadlineMinute = document.getElementById("dinnerDeadlineMinuteInput").value;
    try {
      await API.put("/admin/settings", { lunchDeadlineHour, lunchDeadlineMinute, dinnerDeadlineHour, dinnerDeadlineMinute });
      showToast(t("settingsSaved"));
    } catch (err) {
      alert(err.message);
    }
  },

  async loadAnnouncements() {
    const el = document.getElementById("announcementList");
    try {
      const data = await API.get("/admin/announcements");
      el.innerHTML = data.announcements.length
        ? `<div class="table-wrap"><table class="data-table">
            <thead><tr><th>${t("date")}</th><th>${t("announcementContent")}</th><th>${t("active")}</th><th></th></tr></thead>
            <tbody>${data.announcements.map((a) => `
              <tr>
                <td>${new Date(a.createdAt).toLocaleString()}</td>
                <td style="text-align:left;">${escapeHtml(a.message)}</td>
                <td>${a.active ? "O" : ""}</td>
                <td>
                  ${a.active ? `<button class="danger" data-end="${a._id}">${t("endAnnouncement")}</button>` : ""}
                  <button class="danger" data-del-announce="${a._id}">${t("deleteAnnouncement")}</button>
                </td>
              </tr>
            `).join("")}</tbody>
          </table></div>`
        : `<p class="deadline-note">${t("noAnnouncement")}</p>`;
      el.querySelectorAll("[data-end]").forEach((b) => b.addEventListener("click", () => this.endAnnouncement(b.dataset.end)));
      el.querySelectorAll("[data-del-announce]").forEach((b) => b.addEventListener("click", () => this.deleteAnnouncement(b.dataset.delAnnounce)));
    } catch (err) {
      el.textContent = err.message;
    }
  },

  async postAnnouncement() {
    const message = document.getElementById("announcementInput").value.trim();
    if (!message) return;
    try {
      await API.post("/admin/announcements", { message });
      document.getElementById("announcementInput").value = "";
      showToast(t("postAnnouncement"));
      this.loadAnnouncements();
    } catch (err) {
      alert(err.message);
    }
  },

  async endAnnouncement(id) {
    if (!confirm(t("confirmEndAnnouncement"))) return;
    try {
      await API.put(`/admin/announcements/${id}/deactivate`, {});
      this.loadAnnouncements();
    } catch (err) {
      alert(err.message);
    }
  },

  async deleteAnnouncement(id) {
    if (!confirm(t("confirmDeleteAnnouncement"))) return;
    try {
      await API.del(`/admin/announcements/${id}`);
      showToast(t("announcementDeleted"));
      this.loadAnnouncements();
    } catch (err) {
      alert(err.message);
    }
  },

  /* -------------------- 만족도 조사 (관리자 전용) -------------------- */

  starText(stars) {
    return "★".repeat(stars) + "☆".repeat(5 - stars);
  },

  deptRatingRowsHtml(byDepartment) {
    const fmtStars = (m) => `1★${m.star1} 2★${m.star2} 3★${m.star3} 4★${m.star4} 5★${m.star5}`;
    return byDepartment.map((d) => `
      <tr>
        <td>${escapeHtml(d.department)}</td>
        <td>${d.lunch.count}</td>
        <td>${d.lunch.avgScore ?? "-"}</td>
        <td style="font-size:0.82rem;">${fmtStars(d.lunch)}</td>
        <td>${d.dinner.count}</td>
        <td>${d.dinner.avgScore ?? "-"}</td>
        <td style="font-size:0.82rem;">${fmtStars(d.dinner)}</td>
      </tr>`).join("");
  },

  deptRatingTableHtml(byDepartment) {
    return `
      <div class="table-wrap"><table class="data-table">
        <thead><tr>
          <th>${t("department")}</th>
          <th>${t("lunch")} ${t("satisfactionRespondents")}</th>
          <th>${t("lunch")} ${t("satisfactionAvgScore")}</th>
          <th>${t("lunch")} ${t("satisfactionStarDist")}</th>
          <th>${t("dinner")} ${t("satisfactionRespondents")}</th>
          <th>${t("dinner")} ${t("satisfactionAvgScore")}</th>
          <th>${t("dinner")} ${t("satisfactionStarDist")}</th>
        </tr></thead>
        <tbody>${this.deptRatingRowsHtml(byDepartment) || `<tr><td colspan="7">${t("noData")}</td></tr>`}</tbody>
      </table></div>`;
  },

  async renderSatisfaction() {
    const container = document.getElementById("adminSatisfactionView");
    container.innerHTML = `
      <div class="card">
        <div class="tabs no-print" id="satisfactionSubTabs">
          <button class="${this.satisfactionSubTab === "daily" ? "active" : ""}" data-ssub="daily">${t("satisfactionDailyTab")}</button>
          <button class="${this.satisfactionSubTab === "monthly" ? "active" : ""}" data-ssub="monthly">${t("satisfactionMonthlyTab")}</button>
        </div>
        <div id="satisfactionContent">${t("loading")}</div>
      </div>
    `;
    document.querySelectorAll("#satisfactionSubTabs [data-ssub]").forEach((b) => {
      b.addEventListener("click", () => {
        this.satisfactionSubTab = b.dataset.ssub;
        this.renderSatisfaction();
      });
    });
    if (this.satisfactionSubTab === "monthly") this.renderSatisfactionMonthly();
    else this.renderSatisfactionDaily();
  },

  async renderSatisfactionDaily() {
    const el = document.getElementById("satisfactionContent");
    const date = this.satisfactionDate || todayStr();
    this.satisfactionDate = date;
    el.innerHTML = `
      <div class="toolbar no-print">
        <label>${t("selectDate")}</label>
        <input type="date" id="satDateInput" value="${date}">
        <div class="spacer"></div>
        <button class="secondary" id="satExcelBtn">${t("downloadExcel")}</button>
        <button class="secondary" id="satPrintBtn">${t("print")}</button>
      </div>
      <h2>${escapeHtml(date)}</h2>
      <div id="satDailyBody">${t("loading")}</div>
    `;
    document.getElementById("satDateInput").addEventListener("change", (e) => { this.satisfactionDate = e.target.value; this.renderSatisfactionDaily(); });
    document.getElementById("satExcelBtn").addEventListener("click", () => downloadFile(`/admin/ratings/export/daily?date=${this.satisfactionDate}`, `satisfaction_${this.satisfactionDate}.xlsx`));
    document.getElementById("satPrintBtn").addEventListener("click", () => window.print());
    await this.loadSatisfactionDaily();
  },

  async loadSatisfactionDaily() {
    const body = document.getElementById("satDailyBody");
    try {
      const data = await API.get(`/admin/ratings?date=${this.satisfactionDate}`);
      const detailRows = data.ratings.map((r) => `
        <tr>
          <td>${r.mealType === "lunch" ? t("lunch") : t("dinner")}</td>
          <td>${escapeHtml(r.employeeId)}</td>
          <td>${escapeHtml(r.employeeName)}</td>
          <td>${escapeHtml(r.department)}</td>
          <td title="${r.stars}">${this.starText(r.stars)}</td>
          <td>${r.score}</td>
          <td style="text-align:left;">${escapeHtml(r.reason)}</td>
        </tr>`).join("");
      body.innerHTML = `
        <div class="summary-cards">
          <div class="stat"><div class="num">${data.lunchOverall.count}</div><div class="lbl">${t("lunch")} ${t("satisfactionRespondents")}</div></div>
          <div class="stat highlight"><div class="num">${data.lunchOverall.avgScore ?? "-"}</div><div class="lbl">${t("lunch")} ${t("satisfactionAvgScore")}</div></div>
          <div class="stat"><div class="num">${data.dinnerOverall.count}</div><div class="lbl">${t("dinner")} ${t("satisfactionRespondents")}</div></div>
          <div class="stat highlight"><div class="num">${data.dinnerOverall.avgScore ?? "-"}</div><div class="lbl">${t("dinner")} ${t("satisfactionAvgScore")}</div></div>
        </div>
        <h3>${t("satisfactionByDept")}</h3>
        ${this.deptRatingTableHtml(data.byDepartment)}
        <h3>${t("satisfactionDetailList")}</h3>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th></th><th>${t("employeeId")}</th><th>${t("name")}</th><th>${t("department")}</th><th>${t("satisfactionStars")}</th><th>${t("satisfactionScore")}</th><th>${t("satisfactionReason")}</th></tr></thead>
          <tbody>${detailRows || `<tr><td colspan="7">${t("noData")}</td></tr>`}</tbody>
        </table></div>
      `;
    } catch (err) {
      body.textContent = err.message;
    }
  },

  async renderSatisfactionMonthly() {
    const el = document.getElementById("satisfactionContent");
    const month = this.satisfactionMonth || todayStr().slice(0, 7);
    this.satisfactionMonth = month;
    el.innerHTML = `
      <div class="toolbar no-print">
        <label>${t("selectMonth")}</label>
        <input type="month" id="satMonthInput" value="${month}">
        <div class="spacer"></div>
        <button class="secondary" id="satMonthlyExcelBtn">${t("downloadExcel")}</button>
        <button class="secondary" id="satMonthlyPrintBtn">${t("print")}</button>
      </div>
      <h2>${escapeHtml(month)}</h2>
      <div id="satMonthlyBody">${t("loading")}</div>
    `;
    document.getElementById("satMonthInput").addEventListener("change", (e) => { this.satisfactionMonth = e.target.value; this.renderSatisfactionMonthly(); });
    document.getElementById("satMonthlyExcelBtn").addEventListener("click", () => downloadFile(`/admin/ratings/export/monthly?month=${this.satisfactionMonth}`, `satisfaction_${this.satisfactionMonth}.xlsx`));
    document.getElementById("satMonthlyPrintBtn").addEventListener("click", () => window.print());
    await this.loadSatisfactionMonthly();
  },

  async loadSatisfactionMonthly() {
    const body = document.getElementById("satMonthlyBody");
    try {
      const data = await API.get(`/admin/ratings/summary/monthly?month=${this.satisfactionMonth}`);
      body.innerHTML = `
        <div class="summary-cards">
          <div class="stat"><div class="num">${data.lunchOverall.count}</div><div class="lbl">${t("lunch")} ${t("satisfactionRespondents")}</div></div>
          <div class="stat highlight"><div class="num">${data.lunchOverall.avgScore ?? "-"}</div><div class="lbl">${t("lunch")} ${t("satisfactionAvgScore")}</div></div>
          <div class="stat"><div class="num">${data.dinnerOverall.count}</div><div class="lbl">${t("dinner")} ${t("satisfactionRespondents")}</div></div>
          <div class="stat highlight"><div class="num">${data.dinnerOverall.avgScore ?? "-"}</div><div class="lbl">${t("dinner")} ${t("satisfactionAvgScore")}</div></div>
        </div>
        <h3>${t("satisfactionByDept")}</h3>
        ${this.deptRatingTableHtml(data.byDepartment)}
      `;
    } catch (err) {
      body.textContent = err.message;
    }
  },

  /* -------------------- 개발자 모드 (마스터 관리자 전용) --------------------
     통근버스 기능 공개 여부(비공개 개발자 모드 ON/OFF), 마스터 비밀번호 변경,
     통근 차량 관리 관리자/기사 권한 부여를 다룹니다. 이 탭은 isMasterAdmin이 아니면 애초에 보이지 않고,
     서버(requireMasterAdmin)에서도 다시 한번 확인하므로 일반 관리자는 절대 접근할 수 없습니다. */
  devEmployeesCache: [],
  devSearchTerm: "",

  async renderDeveloper() {
    const container = document.getElementById("adminDeveloperView");
    container.innerHTML = `<div class="card">${t("loading")}</div>`;
    try {
      const [busSystem, vehicles] = await Promise.all([API.get("/master/bus-system"), API.get("/bus-admin/vehicles").catch(() => ({ vehicles: [] }))]);
      container.innerHTML = `
        <div class="card">
          <h2>${t("devBusSystemTitle")}</h2>
          <p class="deadline-note">${t("devBusSystemHelp")}</p>
          <p><b>${t("devBusSystemStatus")}:</b> ${busSystem.enabled ? t("devBusSystemOn") : t("devBusSystemOff")}</p>
          <div class="field"><label>${t("devBusSystemNote")}</label><input id="devBusNoteInput" value="${escapeHtml(busSystem.note || "")}" placeholder="${t("devBusSystemNotePlaceholder")}"></div>
          <div class="field"><label>${t("masterPassword")}</label><input type="password" id="devBusPasswordInput"></div>
          <div id="devBusMsg" class="deadline-note" style="color:var(--danger); min-height:1.2em;"></div>
          <div class="toolbar">
            <button id="devBusEnableBtn" class="${busSystem.enabled ? "" : "secondary"}">${t("devBusSystemEnable")}</button>
            <button id="devBusDisableBtn" class="${busSystem.enabled ? "secondary" : ""}">${t("devBusSystemDisable")}</button>
          </div>
        </div>
        <div class="card">
          <h2>${t("devChangePasswordTitle")}</h2>
          <div class="field"><label>${t("devCurrentPassword")}</label><input type="password" id="devCurrentPasswordInput"></div>
          <div class="field"><label>${t("devNewPassword")}</label><input type="password" id="devNewPasswordInput"></div>
          <div class="toolbar"><button id="devChangePasswordBtn">${t("save")}</button></div>
        </div>
        <div class="card">
          <h2>${t("devPermissionsTitle")}</h2>
          <p class="deadline-note">${t("devPermissionsHelp")}</p>
          <div class="toolbar">
            <input type="text" id="devEmpSearchInput" placeholder="${t("empSearchPlaceholder")}" value="${escapeHtml(this.devSearchTerm)}">
          </div>
          <div id="devEmpList">${t("loading")}</div>
        </div>
      `;
      document.getElementById("devBusEnableBtn").addEventListener("click", () => this.saveBusSystem(true));
      document.getElementById("devBusDisableBtn").addEventListener("click", () => this.saveBusSystem(false));
      document.getElementById("devChangePasswordBtn").addEventListener("click", () => this.changeMasterPassword());
      this.devVehiclesCache = vehicles.vehicles || [];
      document.getElementById("devEmpSearchInput").addEventListener("input", (e) => {
        this.devSearchTerm = e.target.value;
        this.loadDevEmployees(this.devVehiclesCache);
      });
      await this.loadDevEmployees(this.devVehiclesCache);
    } catch (err) {
      container.innerHTML = `<div class="card">${escapeHtml(err.message)}</div>`;
    }
  },

  async saveBusSystem(enabled) {
    const note = document.getElementById("devBusNoteInput").value;
    const password = document.getElementById("devBusPasswordInput").value;
    const msgEl = document.getElementById("devBusMsg");
    if (msgEl) msgEl.textContent = "";
    if (!password) {
      if (msgEl) msgEl.textContent = t("devPasswordRequired");
      document.getElementById("devBusPasswordInput").focus();
      return;
    }
    try {
      // 여기서의 401(비밀번호 불일치)은 로그인 세션 만료가 아니라 입력값 오류이므로,
      // silent:true로 호출해 강제 로그아웃 없이 오류 메시지만 화면에 표시합니다.
      await API.post("/master/bus-system", { enabled, note, password }, { silent: true });
      showToast(t("save"));
      this.renderDeveloper();
    } catch (err) {
      if (msgEl) msgEl.textContent = err.message;
      else alert(err.message);
    }
  },

  async changeMasterPassword() {
    const currentPassword = document.getElementById("devCurrentPasswordInput").value;
    const newPassword = document.getElementById("devNewPasswordInput").value;
    try {
      // 마찬가지로 현재 비밀번호 불일치(401)는 세션 만료가 아니므로 강제 로그아웃하지 않습니다.
      await API.post("/master/change-password", { currentPassword, newPassword }, { silent: true });
      showToast(t("devPasswordChanged"));
      document.getElementById("devCurrentPasswordInput").value = "";
      document.getElementById("devNewPasswordInput").value = "";
    } catch (err) {
      alert(err.message);
    }
  },

  async loadDevEmployees(vehicles) {
    const el = document.getElementById("devEmpList");
    el.innerHTML = t("loading");
    try {
      const q = this.devSearchTerm ? `?q=${encodeURIComponent(this.devSearchTerm)}` : "";
      const data = await API.get(`/master/employees${q}`);
      this.devEmployeesCache = data.employees;
      const vehicleOptions = (vid) => `<option value="">-</option>` + vehicles.map((v) => `<option value="${v._id}" ${vid === String(v._id) ? "selected" : ""}>${escapeHtml(v.routeName)} ${escapeHtml(v.name)}</option>`).join("");
      el.innerHTML = `
        ${!vehicles.length ? `<p class="deadline-note">${t("devNoVehiclesYet")}</p>` : ""}
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>${t("employeeId")}</th><th>${t("name")}</th><th>${t("department")}</th><th>${t("devBusAdminCol")}</th><th>${t("devBusDriverCol")}</th><th>${t("devDriverVehicleCol")}</th><th></th></tr></thead>
          <tbody>
            ${data.employees.map((e) => `
              <tr data-emp-row="${e.employeeId}">
                <td>${escapeHtml(e.employeeId)}</td>
                <td>${escapeHtml(e.name)}</td>
                <td>${escapeHtml(e.department)}</td>
                <td><input type="checkbox" class="dev-busadmin-cb" ${e.busAdmin ? "checked" : ""}></td>
                <td><input type="checkbox" class="dev-busdriver-cb" ${e.busDriver ? "checked" : ""}></td>
                <td><select class="dev-vehicle-select" ${!vehicles.length ? "disabled" : ""}>${vehicleOptions(e.driverVehicleId)}</select></td>
                <td><button class="secondary" data-dev-save="${e.employeeId}">${t("save")}</button></td>
              </tr>
            `).join("") || `<tr><td colspan="7">${t("noData")}</td></tr>`}
          </tbody>
        </table></div>
      `;
      el.querySelectorAll("[data-dev-save]").forEach((btn) => {
        btn.addEventListener("click", () => this.saveDevPermissions(btn.dataset.devSave));
      });
      // 배정 차량을 고르면 "기사" 체크박스도 함께 켜줍니다 (차량 선택 없이 저장되면 서버에서 배정이
      // 자동으로 해제되므로, 체크박스를 따로 켜는 걸 잊어도 선택이 사라지지 않도록 방지합니다).
      el.querySelectorAll(".dev-vehicle-select").forEach((sel) => {
        sel.addEventListener("change", () => {
          const row = sel.closest("tr");
          if (sel.value) row.querySelector(".dev-busdriver-cb").checked = true;
        });
      });
    } catch (err) {
      el.textContent = err.message;
    }
  },

  async saveDevPermissions(employeeId) {
    const row = document.querySelector(`[data-emp-row="${employeeId}"]`);
    const busAdmin = row.querySelector(".dev-busadmin-cb").checked;
    const driverVehicleId = row.querySelector(".dev-vehicle-select").value;
    // 차량이 선택되어 있으면 "기사" 체크박스를 깜빡 잊고 켜지 않았어도 기사 권한으로 저장합니다.
    // (체크박스가 꺼진 채로 저장되면 서버가 배정 차량을 자동으로 비우기 때문입니다.)
    const busDriver = row.querySelector(".dev-busdriver-cb").checked || !!driverVehicleId;
    try {
      await API.put(`/master/employees/${employeeId}/bus-permissions`, { busAdmin, busDriver, driverVehicleId });
      showToast(t("save"));
      this.loadDevEmployees(this.devVehiclesCache);
    } catch (err) {
      alert(err.message);
    }
  },
};

document.addEventListener("DOMContentLoaded", () => AdminUI.init());
