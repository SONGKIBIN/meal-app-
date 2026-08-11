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

  init() {
    document.querySelectorAll("#adminTabs button").forEach((b) => {
      b.addEventListener("click", () => this.switchTab(b.dataset.atab));
    });
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
      settings: "adminSettingsView",
    };
    Object.entries(map).forEach(([name, id]) => {
      document.getElementById(id).classList.toggle("hidden", name !== tab);
    });
    if (tab === "status") this.renderStatus();
    else if (tab === "daily") this.renderDaily();
    else if (tab === "monthly") this.renderMonthly();
    else if (tab === "employees") this.renderEmployees();
    else if (tab === "menu") this.renderMenu();
    else if (tab === "settings") this.renderSettings();
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
          <td>${r.modifiedByAdmin ? "O" : ""}</td>
          <td><button class="danger" data-cancel-id="${escapeHtml(r.employeeId)}" data-meal="${mealType}">${t("cancel")}</button></td>
        </tr>`).join("");
      listEl.innerHTML = `
        <div class="summary-cards">
          <div class="stat"><div class="num">${data.lunchCount}</div><div class="lbl">${t("lunchCount")}</div></div>
          <div class="stat"><div class="num">${data.dinnerCount}</div><div class="lbl">${t("dinnerCount")}</div></div>
        </div>
        <h3>${t("lunch")}</h3>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>${t("employeeId")}</th><th>${t("name")}</th><th>${t("department")}</th><th>${t("headcountLabel")}</th><th>Admin</th><th></th></tr></thead>
          <tbody>${rowsHtml(data.lunch, "lunch") || `<tr><td colspan="6">${t("noData")}</td></tr>`}</tbody>
        </table></div>
        <h3>${t("dinner")}</h3>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>${t("employeeId")}</th><th>${t("name")}</th><th>${t("department")}</th><th>${t("headcountLabel")}</th><th>Admin</th><th></th></tr></thead>
          <tbody>${rowsHtml(data.dinner, "dinner") || `<tr><td colspan="6">${t("noData")}</td></tr>`}</tbody>
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
        <h2>${date}</h2>
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
      const rows = [
        ...data.lunch.map((r) => ({ ...r, mealLabel: t("lunch") })),
        ...data.dinner.map((r) => ({ ...r, mealLabel: t("dinner") })),
      ];
      el.innerHTML = `
        <div class="summary-cards">
          <div class="stat"><div class="num">${data.lunchCount}</div><div class="lbl">${t("lunchCount")}</div></div>
          <div class="stat"><div class="num">${data.dinnerCount}</div><div class="lbl">${t("dinnerCount")}</div></div>
          <div class="stat"><div class="num">${data.pendingLunchCount}</div><div class="lbl">${t("pendingLunch")}</div></div>
          <div class="stat"><div class="num">${data.pendingDinnerCount}</div><div class="lbl">${t("pendingDinner")}</div></div>
        </div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>${t("mealType")}</th><th>${t("employeeId")}</th><th>${t("name")}</th><th>${t("department")}</th><th>${t("headcountLabel")}</th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td>${r.mealLabel}</td><td>${escapeHtml(r.employeeId)}</td><td>${escapeHtml(r.employeeName)}</td><td>${escapeHtml(r.department)}</td><td>${r.headcount ?? 1}</td></tr>`).join("") || `<tr><td colspan="5">${t("noData")}</td></tr>`}</tbody>
        </table></div>
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
          <div class="stat"><div class="num">${data.totalLunch}</div><div class="lbl">${t("lunchCount")} ${t("total")}</div></div>
          <div class="stat"><div class="num">${data.totalDinner}</div><div class="lbl">${t("dinnerCount")} ${t("total")}</div></div>
        </div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>${t("date")}</th><th>${t("lunchCount")}</th><th>${t("dinnerCount")}</th></tr></thead>
          <tbody>${data.days.map((d) => `<tr><td>${d.date}</td><td>${d.lunchCount}</td><td>${d.dinnerCount}</td></tr>`).join("")}</tbody>
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
        <div class="toolbar">
          <button id="addEmpBtn">${t("addEmployee")}</button>
          <div class="spacer"></div>
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
        <div class="table-wrap"><table class="data-table" id="empTable">
          <thead><tr><th>${t("employeeId")}</th><th>${t("name")}</th><th>${t("department")}</th><th>${t("employeeType")}</th><th>${t("role")}</th><th>${t("active")}</th><th></th></tr></thead>
          <tbody><tr><td colspan="7">${t("loading")}</td></tr></tbody>
        </table></div>
      </div>
    `;
    document.getElementById("addEmpBtn").addEventListener("click", () => this.openEmployeeModal());
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
  computeEmployeeSummary() {
    const activeList = this.employeesCache.filter((e) => e.active);
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
        // 관리자 그룹을 먼저, 그다음 일반직원 그룹으로 묶어서 보여주고, 그룹 내에서는 부서→이름 순으로 정렬합니다.
        const roleRank = (e) => (e.role === "admin" ? 0 : 1);
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
        ? `<button class="secondary" data-edit="${e._id}">${t("edit")}</button>
           <button class="danger" data-del="${e._id}">${t("delete")}</button>`
        : `<button class="secondary" data-edit="${e._id}">${t("edit")}</button>
           <button class="secondary" data-restore="${e._id}">${t("restoreEmployee")}</button>
           <button class="danger" data-permdel="${e._id}" title="${escapeHtml(t("permanentDeleteHelp"))}">${t("permanentDelete")}</button>`;
      return `
        <tr>
          <td>${escapeHtml(e.employeeId)}</td>
          <td>${escapeHtml(e.name)}</td>
          <td>${escapeHtml(e.department)}</td>
          <td>${e.employeeType === "contractor" ? `<span class="badge admin">${t("contractorBadge")}</span>${Number.isInteger(e.totalHeadcount) ? ` TO ${e.totalHeadcount}` : ""}${pendingBadge}` : t("individualType")}</td>
          <td>${e.role === "admin" ? t("admin") : t("user")}</td>
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

  openEmployeeModal(id) {
    const emp = id ? this.employeesCache.find((e) => e._id === id) : null;
    openModal(`
      <h3>${emp ? t("edit") : t("addEmployee")}</h3>
      <div class="field"><label>${t("employeeId")}</label><input id="mEmpId" value="${emp ? escapeHtml(emp.employeeId) : ""}" ${emp ? "disabled" : ""}></div>
      <div class="field"><label>${t("name")}</label><input id="mName" value="${emp ? escapeHtml(emp.name) : ""}"></div>
      <div class="field"><label>${t("department")}</label><input id="mDept" value="${emp ? escapeHtml(emp.department) : ""}"></div>
      <div class="field"><label>${t("role")}</label>
        <select id="mRole">
          <option value="user" ${!emp || emp.role === "user" ? "selected" : ""}>${t("user")}</option>
          <option value="admin" ${emp && emp.role === "admin" ? "selected" : ""}>${t("admin")}</option>
        </select>
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
    document.getElementById("mSaveBtn").addEventListener("click", async () => {
      const employeeId = document.getElementById("mEmpId").value.trim();
      const name = document.getElementById("mName").value.trim();
      const department = document.getElementById("mDept").value.trim();
      const role = document.getElementById("mRole").value;
      const employeeType = document.getElementById("mEmployeeType").value;
      const totalHeadcount = document.getElementById("mTotalHeadcount").value.trim();
      try {
        if (emp) await API.put(`/admin/employees/${emp._id}`, { name, department, role, employeeType, totalHeadcount });
        else await API.post("/admin/employees", { employeeId, name, department, role, employeeType, totalHeadcount });
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
    document.getElementById("postAnnouncementBtn").addEventListener("click", () => this.postAnnouncement());
    document.getElementById("backupBtn").addEventListener("click", () => downloadFile("/admin/backup", `meal_app_backup_${todayStr()}.json`));
    await Promise.all([this.loadDeadline(), this.loadAnnouncements()]);
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
};

document.addEventListener("DOMContentLoaded", () => AdminUI.init());
