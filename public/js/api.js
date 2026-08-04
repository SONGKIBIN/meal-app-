const API = {
  base: "/api",
  getToken() {
    return localStorage.getItem("meal_token");
  },
  setToken(token) {
    if (token) localStorage.setItem("meal_token", token);
    else localStorage.removeItem("meal_token");
  },
  getUser() {
    try {
      return JSON.parse(localStorage.getItem("meal_user") || "null");
    } catch {
      return null;
    }
  },
  setUser(user) {
    if (user) localStorage.setItem("meal_user", JSON.stringify(user));
    else localStorage.removeItem("meal_user");
  },
  async request(method, path, body, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    const token = this.getToken();
    if (token) headers["Authorization"] = "Bearer " + token;
    let fetchBody = undefined;
    if (body !== undefined && !opts.isFormData) {
      headers["Content-Type"] = "application/json";
      fetchBody = JSON.stringify(body);
    } else if (opts.isFormData) {
      fetchBody = body;
    }
    const res = await fetch(this.base + path, { method, headers, body: fetchBody });
    if (res.status === 401) {
      this.setToken(null);
      this.setUser(null);
      if (!opts.silent) window.location.reload();
      throw new Error("Unauthorized");
    }
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      if (!res.ok) throw new Error("요청 처리 중 오류가 발생했습니다.");
      return res; // caller handles (e.g., file download)
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "요청 처리 중 오류가 발생했습니다.");
    return data;
  },
  get(path) {
    return this.request("GET", path);
  },
  post(path, body) {
    return this.request("POST", path, body);
  },
  put(path, body) {
    return this.request("PUT", path, body);
  },
  del(path, body) {
    return this.request("DELETE", path, body);
  },
};
