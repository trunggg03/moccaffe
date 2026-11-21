const TOKEN_KEY = "moc-admin-token";
const currency = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0
});
const loginCard = document.querySelector("#login-card");
const loginForm = document.querySelector("#login-form");
const dashboard = document.querySelector("#dashboard");
const ordersList = document.querySelector("#orders-list");
const orderDetail = document.querySelector("#order-detail");
const dashboardError = document.querySelector("#dashboard-error");
const toast = document.querySelector("#admin-toast");

let adminToken = sessionStorage.getItem(TOKEN_KEY) ?? "";
let orders = [];
let selectedOrderId = "";
let toastTimeout;
let ghnEnabled = false;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function api(path, options = {}) {
  return fetch(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${adminToken}`,
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...options.headers
    }
  });
}

function notify(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.remove("visible"), 2800);
}

function setAuthenticated(authenticated) {
  loginCard.hidden = authenticated;
  dashboard.hidden = !authenticated;
  document.querySelector("#logout").hidden = !authenticated;
}

async function loadOrders() {
  dashboardError.hidden = true;
  const refreshButton = document.querySelector("#refresh-orders");
  refreshButton.disabled = true;
  try {
    const [response, configResponse] = await Promise.all([
      api("/api/admin/orders"),
      fetch("/api/config")
    ]);
    const [result, config] = await Promise.all([response.json(), configResponse.json()]);
    if (response.status === 401) {
      logout();
      throw new Error("Phiên quản trị không còn hợp lệ. Vui lòng đăng nhập lại.");
    }
    if (!response.ok || !Array.isArray(result)) {
      throw new Error(result.error ?? "Không tải được danh sách đơn hàng.");
    }
    if (!configResponse.ok) throw new Error(config.error ?? "Không tải được cấu hình cửa hàng.");
    ghnEnabled = config.ghnEnabled === true;
    orders = result;
    updateMetrics();
    document.querySelector("#orders-updated").textContent =
      `Cập nhật ${new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`;
    renderOrders();
  } finally {
    refreshButton.disabled = false;
  }
}

function updateMetrics() {
  document.querySelector("#metric-total").textContent = String(orders.length);
  document.querySelector("#metric-new").textContent = String(
    orders.filter((order) => order.status === "new").length
  );
  document.querySelector("#metric-unpaid").textContent = String(
    orders.filter((order) => order.payment_status === "unpaid").length
  );
  const paidTotal = orders.reduce(
    (total, order) => total + (order.payment_status === "paid" ? order.total_vnd : 0),
    0
  );
  document.querySelector("#metric-paid").textContent = currency.format(paidTotal);
}

function normalizeSearch(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLocaleLowerCase("vi-VN");
}

function getVisibleOrders() {
  const query = normalizeSearch(document.querySelector("#order-search").value.trim());
  const status = document.querySelector("#status-filter").value;
  return orders.filter((order) => {
    if (status && order.status !== status) return false;
    return !query || normalizeSearch(
      [
        order.id,
        order.customer_name,
        order.customer_phone,
        order.delivery_address ?? "",
        order.ghn_order_code ?? ""
      ].join(" ")
    ).includes(query);
  });
}

function renderOrders() {
  ordersList.replaceChildren();
  const visibleOrders = getVisibleOrders();
  document.querySelector("#result-count").textContent =
    visibleOrders.length === orders.length
      ? `${orders.length} đơn`
      : `${visibleOrders.length} / ${orders.length} đơn`;
  if (!visibleOrders.length) {
    const hasOrders = orders.length > 0;
    const empty = element(
      "div",
      "orders-empty",
      hasOrders ? "Không tìm thấy đơn phù hợp với từ khóa." : "Chưa có đơn hàng nào."
    );
    if (hasOrders) {
      const clearSearch = element("button", "empty-action", "Xóa nội dung tìm kiếm");
      clearSearch.type = "button";
      clearSearch.addEventListener("click", () => {
        document.querySelector("#order-search").value = "";
        renderOrders();
      });
      empty.append(clearSearch);
    }
    ordersList.append(empty);
    orderDetail.replaceChildren();
    orderDetail.append(
      element(
        "div",
        "detail-empty",
        orders.length
          ? "Không có đơn phù hợp với bộ lọc hiện tại."
          : "Chưa có đơn hàng để hiển thị."
      )
    );
    return;
  }
  if (!visibleOrders.some((order) => order.id === selectedOrderId)) {
    selectedOrderId = visibleOrders[0].id;
  }
  for (const order of visibleOrders) {
    const card = element("button", `order-card${order.status === "new" ? " order-card--new" : ""}`);
    card.type = "button";
    card.setAttribute("aria-current", String(order.id === selectedOrderId));
    const top = element("div", "order-card__top");
    top.append(element("span", "order-card__id", `#${String(order.id).slice(0, 8).toUpperCase()}`));
    top.append(makeBadge(order.status, order.status === "cancelled" ? "badge--danger" : ""));
    const name = element("p", "order-card__name", order.customer_name);
    const bottom = element("div", "order-card__bottom");
    bottom.append(element("span", "", `${order.items.length} món · ${formatDate(order.created_at)}`));
    bottom.append(element("strong", "", currency.format(order.total_vnd)));
    const meta = element("div", "order-card__meta");
    meta.append(
      makeBadge(
        order.payment_status === "paid"
          ? "Đã thanh toán"
          : order.payment_status === "failed"
            ? "Thanh toán lỗi"
            : "Chưa thanh toán",
        order.payment_status === "paid" ? "" : "badge--warning"
      )
    );
    if (order.fulfillment_type === "delivery") {
      meta.append(
        makeBadge(
          order.ghn_order_code
            ? "Đã có vận đơn"
            : order.delivery_district_id && order.delivery_ward_code
              ? "Chờ tạo vận đơn"
              : "Giao thủ công"
        )
      );
    }
    card.append(top, name, bottom, meta);
    card.addEventListener("click", () => {
      selectedOrderId = order.id;
      renderOrders();
      renderOrderDetail(order);
    });
    ordersList.append(card);
  }
  const selected = visibleOrders.find((order) => order.id === selectedOrderId) ?? visibleOrders[0];
  selectedOrderId = selected.id;
  renderOrderDetail(selected);
  ordersList.querySelectorAll(".order-card").forEach((card, index) => {
    card.setAttribute("aria-current", String(visibleOrders[index].id === selectedOrderId));
  });
}

function renderOrderDetail(order) {
  orderDetail.replaceChildren();
  const heading = element("div", "detail-heading");
  const headingInfo = element("div");
  headingInfo.append(element("h2", "", `Đơn #${String(order.id).slice(0, 8).toUpperCase()}`));
  headingInfo.append(element("span", "detail-date", formatDate(order.created_at)));
  const badges = element("div", "order-badges");
  badges.append(makeBadge(order.status));
  badges.append(
    makeBadge(
      order.payment_status === "paid"
        ? "Đã thanh toán"
        : order.payment_status === "failed"
          ? "Thanh toán lỗi"
          : "Chưa thanh toán",
      order.payment_status === "paid" ? "" : "badge--warning"
    )
  );
  if (order.ghn_order_code) badges.append(makeBadge(`GHN · ${order.ghn_status ?? "đã tạo"}`));
  heading.append(headingInfo, badges);
  orderDetail.append(heading);

  const customer = element("section", "detail-section");
  customer.append(element("h3", "", "Khách hàng"));
  customer.append(element("p", "", `${order.customer_name} · ${order.customer_phone}`));
  customer.append(
    element(
      "p",
      "",
      order.fulfillment_type === "delivery"
        ? order.delivery_address || "Chưa có địa chỉ giao hàng"
        : "Khách đến lấy tại quán"
    )
  );
  if (order.customer_note) customer.append(element("p", "", `Ghi chú: ${order.customer_note}`));
  orderDetail.append(customer);

  const contents = element("section", "detail-section");
  contents.append(element("h3", "", "Món đã đặt"));
  for (const item of order.items) {
    const row = element("div", "item-row");
    const name = element("div");
    name.append(document.createTextNode(`${item.product_name} × ${item.quantity}`));
    name.append(element("small", "", currency.format(item.unit_price_vnd)));
    row.append(name, element("strong", "", currency.format(item.line_total_vnd)));
    contents.append(row);
  }
  const subtotal = element("div", "item-row");
  subtotal.append(element("span", "", "Tạm tính"), element("span", "", currency.format(order.subtotal_vnd)));
  contents.append(subtotal);
  const shipping = element("div", "item-row");
  shipping.append(
    element("span", "", "Giao hàng"),
    element("span", "", currency.format(order.delivery_fee_vnd))
  );
  contents.append(shipping);
  const total = element("div", "total-row");
  total.append(element("span", "", "Tổng cộng"), element("strong", "", currency.format(order.total_vnd)));
  contents.append(total);
  orderDetail.append(contents);

  const payment = element("section", "detail-section");
  payment.append(element("h3", "", "Thanh toán"));
  payment.append(
    element(
      "p",
      "",
      `${paymentMethodLabel(order.payment_method)} · ${paymentStatusLabel(order.payment_status)}`
    )
  );
  if (order.payment_transaction_no) {
    payment.append(element("p", "", `Mã giao dịch: ${order.payment_transaction_no}`));
  }
  orderDetail.append(payment);

  if (order.fulfillment_type === "delivery") {
    const shippingDetails = element("section", "detail-section");
    const canCreateGhnShipment =
      ghnEnabled && Boolean(order.delivery_district_id && order.delivery_ward_code);
    shippingDetails.append(element("h3", "", canCreateGhnShipment ? "Vận chuyển GHN" : "Giao hàng"));
    shippingDetails.append(
      element(
        "p",
        "",
        order.ghn_order_code
          ? `Mã vận đơn: ${order.ghn_order_code}`
          : canCreateGhnShipment
            ? "Chưa tạo vận đơn GHN"
            : "Giao thủ công, không có vận đơn GHN"
      )
    );
    if (order.ghn_status) shippingDetails.append(element("p", "", `Trạng thái: ${order.ghn_status}`));
    if (order.ghn_fee_vnd !== null) {
      shippingDetails.append(element("p", "", `Phí GHN: ${currency.format(order.ghn_fee_vnd)}`));
    }
    orderDetail.append(shippingDetails);
  }

  const actions = element("div", "detail-actions");
  const statusSelect = document.createElement("select");
  statusSelect.setAttribute("aria-label", "Trạng thái đơn hàng");
  for (const [value, label] of [
    ["new", "Mới"],
    ["preparing", "Đang chuẩn bị"],
    ["ready", "Sẵn sàng"],
    ["completed", "Hoàn tất"],
    ["cancelled", "Đã hủy"]
  ]) {
    const option = new Option(label, value);
    option.selected = value === order.status;
    statusSelect.add(option);
  }
  statusSelect.addEventListener("change", () => {
    updateStatus(order.id, statusSelect.value).catch(showDashboardError);
  });
  actions.append(statusSelect);

  if (["cash", "bank_transfer"].includes(order.payment_method) && order.payment_status === "unpaid") {
    actions.append(
      actionButton(
        order.payment_method === "bank_transfer" ? "Xác nhận đã nhận chuyển khoản" : "Đánh dấu đã thu tiền",
        () => markPaymentPaid(order.id)
      )
    );
  }
  if (
    order.fulfillment_type === "delivery" &&
    !order.ghn_order_code &&
    order.status !== "cancelled" &&
    ghnEnabled &&
    order.delivery_district_id &&
    order.delivery_ward_code
  ) {
    actions.append(
      actionButton(
        order.payment_method === "vnpay" && order.payment_status !== "paid"
          ? "Chờ VNPay xác nhận"
          : "Tạo vận đơn GHN",
        () => createShipment(order.id),
        "action-primary",
        order.payment_method === "vnpay" && order.payment_status !== "paid"
      )
    );
  }
  if (order.ghn_order_code) {
    actions.append(actionButton("Cập nhật vận chuyển", () => refreshShipment(order.id)));
  }
  orderDetail.append(actions);
}

function makeBadge(text, extraClass = "") {
  const labels = {
    new: "Mới",
    preparing: "Đang chuẩn bị",
    ready: "Sẵn sàng",
    completed: "Hoàn tất",
    cancelled: "Đã hủy",
    unpaid: "Chưa thanh toán",
    paid: "Đã thanh toán",
    failed: "Thanh toán lỗi"
  };
  return element("span", `badge ${extraClass}`.trim(), labels[text] ?? text);
}

function paymentMethodLabel(method) {
  return (
    {
      cash: "Thanh toán khi nhận",
      bank_transfer: "Chuyển khoản ngân hàng",
      vnpay: "VNPay"
    }[method] ?? method
  );
}

function paymentStatusLabel(status) {
  return (
    {
      unpaid: "Chưa thanh toán",
      paid: "Đã thanh toán",
      failed: "Thanh toán lỗi",
      refunded: "Đã hoàn tiền"
    }[status] ?? status
  );
}

function actionButton(text, callback, className = "", disabled = false) {
  const button = element("button", className, text);
  button.type = "button";
  button.disabled = disabled;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await callback();
    } catch (error) {
      dashboardError.textContent = error instanceof Error ? error.message : "Thao tác thất bại.";
      dashboardError.hidden = false;
    } finally {
      button.disabled = disabled;
    }
  });
  return button;
}

async function updateStatus(orderId, status) {
  const response = await api(`/api/admin/orders/${encodeURIComponent(orderId)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Không cập nhật được trạng thái.");
  notify("Đã cập nhật trạng thái đơn hàng.");
  await loadOrders();
}

async function markPaymentPaid(orderId) {
  const response = await api(`/api/admin/orders/${encodeURIComponent(orderId)}/mark-paid`, {
    method: "POST"
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Không ghi nhận được thanh toán.");
  notify("Đã ghi nhận thanh toán.");
  await loadOrders();
}

async function createShipment(orderId) {
  const response = await api(`/api/admin/orders/${encodeURIComponent(orderId)}/shipment`, {
    method: "POST"
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Không tạo được vận đơn GHN.");
  notify(`Đã tạo vận đơn GHN ${result.orderCode}.`);
  await loadOrders();
}

async function refreshShipment(orderId) {
  const response = await api(`/api/admin/orders/${encodeURIComponent(orderId)}/shipment/refresh`, {
    method: "POST"
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Không cập nhật được trạng thái GHN.");
  notify(`GHN: ${result.status ?? "Đã đồng bộ trạng thái"}.`);
  await loadOrders();
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("vi-VN");
}

function logout() {
  adminToken = "";
  sessionStorage.removeItem(TOKEN_KEY);
  setAuthenticated(false);
}

function showDashboardError(error) {
  dashboardError.textContent = error instanceof Error ? error.message : "Thao tác thất bại.";
  dashboardError.hidden = false;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("#admin-token");
  const error = document.querySelector("#login-error");
  const button = loginForm.querySelector("button");
  button.disabled = true;
  error.hidden = true;
  adminToken = input.value;
  try {
    const response = await api("/api/admin/session", { method: "POST" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Không đăng nhập được.");
    sessionStorage.setItem(TOKEN_KEY, adminToken);
    setAuthenticated(true);
    await loadOrders();
  } catch (reason) {
    logout();
    error.textContent = reason instanceof Error ? reason.message : "Không đăng nhập được.";
    error.hidden = false;
  } finally {
    button.disabled = false;
    input.value = "";
  }
});

document.querySelector("#logout").addEventListener("click", logout);
document.querySelector("#refresh-orders").addEventListener("click", () => {
  loadOrders().catch((error) => {
    dashboardError.textContent = error.message;
    dashboardError.hidden = false;
  });
});
document.querySelector("#status-filter").addEventListener("change", () => {
  selectedOrderId = "";
  loadOrders().catch((error) => {
    dashboardError.textContent = error.message;
    dashboardError.hidden = false;
  });
  document.querySelector("#order-search").addEventListener("input", renderOrders);

  window.setInterval(() => {
    if (adminToken && !document.hidden && !dashboard.hidden) {
      loadOrders().catch(showDashboardError);
    }
  }, 30_000);
});

if (adminToken) {
  setAuthenticated(true);
  loadOrders().catch((error) => {
    if (adminToken) showDashboardError(error);
    else {
      const loginError = document.querySelector("#login-error");
      loginError.textContent = error.message;
      loginError.hidden = false;
    }
  });
} else {
  setAuthenticated(false);
}
