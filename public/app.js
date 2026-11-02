const currency = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0
});
const CART_KEY = "moc-cafe-cart-v1";

const productGrid = document.querySelector("#product-grid");
const categoryList = document.querySelector("#category-list");
const menuStatus = document.querySelector("#menu-status");
const menuCount = document.querySelector("#menu-count");
const cartDialog = document.querySelector("#cart-dialog");
const checkoutDialog = document.querySelector("#checkout-dialog");
const cartItems = document.querySelector("#cart-items");
const cartCount = document.querySelector("#cart-count");
const cartTotal = document.querySelector("#cart-total");
const cartSubtotal = document.querySelector("#cart-subtotal");
const checkoutTotal = document.querySelector("#checkout-total");
const checkoutForm = document.querySelector("#checkout-form");
const checkoutError = document.querySelector("#checkout-error");
const addressGroup = document.querySelector("#address-group");
const deliveryStreet = document.querySelector("#delivery-street");
const manualAddressSelects = document.querySelector("#ghn-address-selects");
const deliveryStreetLabel = document.querySelector("#delivery-street-label");
const provinceSelect = document.querySelector("#delivery-province");
const districtSelect = document.querySelector("#delivery-district");
const wardSelect = document.querySelector("#delivery-ward");
const shippingQuote = document.querySelector("#shipping-quote");
const placeOrderButton = document.querySelector("#place-order");
const toastElement = document.querySelector("#toast");

let products = [];
let deliveryFee = 0;
let ghnEnabled = false;
let vnpayEnabled = false;
let manualDeliveryFee = 15000;
let bankTransferDetails = null;
let quoteRequest = 0;
let activeCategory = "all";
let toastTimer;
let cart = readCart();

function readCart() {
  try {
    const stored = JSON.parse(localStorage.getItem(CART_KEY) ?? "{}");
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      return Object.fromEntries(
        Object.entries(stored).filter(
          ([id, quantity]) =>
            typeof id === "string" &&
            Number.isInteger(quantity) &&
            quantity > 0 &&
            quantity <= 99
        )
      );
    }
  } catch {
    showToast("Không thể đọc giỏ hàng đã lưu trên thiết bị này.");
  }
  return {};
}

function saveCart() {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  } catch {
    showToast("Giỏ hàng chưa thể lưu trên thiết bị này.");
  }
  renderCart();
  if (
    checkoutDialog.open &&
    document.querySelector('input[name="fulfillmentType"]:checked')?.value === "delivery"
  ) {
    void refreshShippingQuote();
  }
}

function showToast(message) {
  toastElement.textContent = message;
  toastElement.classList.add("toast--visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastElement.classList.remove("toast--visible"), 3000);
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderCategories() {
  const categories = [...new Map(products.map((product) => [product.category, product.categoryLabel]))];
  const options = [["all", "Tất cả"], ...categories];
  categoryList.replaceChildren();
  for (const [id, name] of options) {
    const button = makeElement("button", "category-chip", name);
    button.type = "button";
    button.dataset.category = id;
    button.setAttribute("aria-pressed", String(activeCategory === id));
    categoryList.append(button);
  }
}

function renderProducts() {
  const visibleProducts =
    activeCategory === "all"
      ? products
      : products.filter((product) => product.category === activeCategory);
  productGrid.replaceChildren();
  menuCount.textContent = `${visibleProducts.length} món`;
  for (const product of visibleProducts) {
    const card = makeElement("article", "product-card");
    const artwork = makeElement("div", `product-art product-art--${product.category}`);
    if (product.imageUrl) {
      const image = makeElement("img", "product-art__image");
      image.src = product.imageUrl;
      image.alt = `Ảnh tham khảo: ${product.name}`;
      image.loading = "lazy";
      artwork.append(image);
    }

    const information = makeElement("div", "product-info");
    information.append(makeElement("p", "product-category", product.categoryLabel));
    information.append(makeElement("h3", "product-name", product.name));
    information.append(makeElement("p", "product-description", product.description));
    const buyRow = makeElement("div", "product-buy");
    buyRow.append(makeElement("span", "product-price", currency.format(product.price)));
    const addButton = makeElement("button", "add-button", "+");
    addButton.type = "button";
    addButton.setAttribute("aria-label", `Thêm ${product.name} vào giỏ hàng`);
    addButton.addEventListener("click", () => {
      cart[product.id] = Math.min((cart[product.id] ?? 0) + 1, 99);
      saveCart();
      showToast(`Đã thêm ${product.name} vào giỏ.`);
    });
    buyRow.append(addButton);
    information.append(buyRow);
    card.append(artwork, information);
    productGrid.append(card);
  }
}

function renderCart() {
  const productById = new Map(products.map((product) => [product.id, product]));
  const entries = Object.entries(cart).filter(([id]) => productById.has(id));
  const quantity = entries.reduce((sum, [, count]) => sum + count, 0);
  const subtotal = entries.reduce(
    (sum, [id, count]) => sum + productById.get(id).price * count,
    0
  );

  document.querySelector("#open-cart").setAttribute(
    "aria-label",
    `Giỏ hàng, ${quantity} món, tổng ${currency.format(subtotal)}`
  );
  cartCount.textContent = String(quantity);
  cartTotal.textContent = currency.format(subtotal);
  cartSubtotal.textContent = currency.format(subtotal);
  const deliverySelected =
    document.querySelector('input[name="fulfillmentType"]:checked')?.value === "delivery";
  checkoutTotal.textContent = currency.format(
    subtotal + (deliverySelected && deliveryFee !== null ? deliveryFee : 0)
  );
  document.querySelector("#checkout-button").disabled = quantity === 0;
  updatePlaceOrderAvailability();
  cartItems.replaceChildren();

  if (entries.length === 0) {
    cartItems.append(makeElement("p", "cart-empty", "Giỏ hàng còn trống. Chọn một món bạn thích nhé."));
    return;
  }

  for (const [id, count] of entries) {
    const product = productById.get(id);
    const line = makeElement("div", "cart-line");
    const details = makeElement("div");
    details.append(makeElement("h3", "cart-line__name", product.name));
    details.append(makeElement("p", "cart-line__price", currency.format(product.price * count)));
    const controls = makeElement("div", "quantity-control");
    const decrement = makeElement("button", "", "−");
    decrement.type = "button";
    decrement.setAttribute("aria-label", `Giảm số lượng ${product.name}`);
    decrement.addEventListener("click", () => {
      if (cart[id] <= 1) delete cart[id];
      else cart[id] -= 1;
      saveCart();
    });
    const countLabel = makeElement("span", "", String(count));
    const increment = makeElement("button", "", "+");
    increment.type = "button";
    increment.setAttribute("aria-label", `Tăng số lượng ${product.name}`);
    increment.addEventListener("click", () => {
      if (cart[id] < 99) cart[id] += 1;
      saveCart();
    });
    controls.append(decrement, countLabel, increment);
    line.append(details, controls);
    cartItems.append(line);
  }
}

function updateFulfillment() {
  const isDelivery =
    document.querySelector('input[name="fulfillmentType"]:checked')?.value === "delivery";
  addressGroup.hidden = !isDelivery;
  manualAddressSelects.hidden = !ghnEnabled;
  deliveryStreetLabel.textContent = ghnEnabled ? "Số nhà, tên đường" : "Địa chỉ giao tận nhà";
  deliveryStreet.placeholder = ghnEnabled
    ? "Số nhà, tên đường"
    : "Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành";
  deliveryStreet.required = isDelivery;
  provinceSelect.required = isDelivery && ghnEnabled;
  districtSelect.required = isDelivery && ghnEnabled;
  wardSelect.required = isDelivery && ghnEnabled;
  if (isDelivery && ghnEnabled) {
    deliveryFee = null;
    void loadProvinces();
  } else if (isDelivery) {
    deliveryFee = manualDeliveryFee;
    shippingQuote.textContent = `Phí giao tận nhà: ${currency.format(manualDeliveryFee)}.`;
  } else {
    deliveryFee = 0;
    shippingQuote.textContent = "";
  }
  updatePlaceOrderAvailability();
  renderCart();
}

function updatePlaceOrderAvailability() {
  const deliverySelected =
    document.querySelector('input[name="fulfillmentType"]:checked')?.value === "delivery";
  const hasItems = Object.values(cart).some((quantity) => quantity > 0);
  const addressReady = !deliverySelected || deliveryStreet.value.trim().length >= 5;
  const quoteReady = !deliverySelected || (deliveryFee !== null && Number.isSafeInteger(deliveryFee));
  const ghnAddressReady =
    !deliverySelected || !ghnEnabled || Boolean(districtSelect.value && wardSelect.value);
  placeOrderButton.disabled = !hasItems || !addressReady || !quoteReady || !ghnAddressReady;
}

function setSelectOptions(select, placeholder, entries, valueKey, labelKey) {
  select.replaceChildren(new Option(placeholder, ""));
  for (const entry of entries) {
    const value = String(entry[valueKey] ?? "");
    const label = String(entry[labelKey] ?? "");
    if (value && label) select.add(new Option(label, value));
  }
}

async function fetchGhnOptions(path, select, placeholder, valueKey, labelKey) {
  select.disabled = true;
  select.replaceChildren(new Option("Đang tải…", ""));
  const response = await fetch(path);
  const result = await response.json();
  if (!response.ok || !Array.isArray(result)) {
    throw new Error(result.error ?? "Chưa tải được danh sách địa chỉ GHN.");
  }
  setSelectOptions(select, placeholder, result, valueKey, labelKey);
  select.disabled = false;
}

async function loadProvinces() {
  if (!ghnEnabled || provinceSelect.options.length > 1) return;
  try {
    await fetchGhnOptions(
      "/api/ghn/provinces",
      provinceSelect,
      "Chọn tỉnh / thành",
      "ProvinceID",
      "ProvinceName"
    );
  } catch (error) {
    shippingQuote.textContent =
      error instanceof Error ? error.message : "Chưa tải được danh sách tỉnh / thành.";
  }
}

async function refreshShippingQuote() {
  const requestId = ++quoteRequest;
  deliveryFee = null;
  updatePlaceOrderAvailability();
  renderCart();
  const items = Object.entries(cart).map(([productId, quantity]) => ({ productId, quantity }));
  if (!ghnEnabled || !districtSelect.value || !wardSelect.value || items.length === 0) {
    shippingQuote.textContent = "Chọn địa chỉ và món để tính phí vận chuyển.";
    return;
  }
  shippingQuote.textContent = "Đang tính phí giao hàng…";
  try {
    const response = await fetch("/api/shipping/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deliveryDistrictId: Number(districtSelect.value),
        deliveryWardCode: wardSelect.value,
        items
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Chưa thể tính phí giao hàng.");
    if (requestId !== quoteRequest) return;
    deliveryFee = result.fee;
    shippingQuote.textContent = `Phí giao hàng: ${currency.format(deliveryFee)}`;
  } catch (error) {
    if (requestId !== quoteRequest) return;
    deliveryFee = null;
    shippingQuote.textContent =
      error instanceof Error ? error.message : "Chưa thể tính phí giao hàng.";
  }
  updatePlaceOrderAvailability();
  renderCart();
}

async function loadMenu() {
  try {
    const [menuResponse, configResponse] = await Promise.all([
      fetch("/api/products"),
      fetch("/api/config")
    ]);
    if (!menuResponse.ok) throw new Error(`Menu request failed with status ${menuResponse.status}.`);
    if (!configResponse.ok) throw new Error(`Config request failed with status ${configResponse.status}.`);
    const [menu, config] = await Promise.all([menuResponse.json(), configResponse.json()]);
    products = menu;
    if (!Array.isArray(products)) throw new Error("Menu response was not a list.");
    ghnEnabled = config.ghnEnabled === true;
    vnpayEnabled = config.vnpayEnabled === true;
    manualDeliveryFee = Number.isSafeInteger(config.manualDeliveryFee)
      ? config.manualDeliveryFee
      : 15000;
    document.querySelector("#vnpay-choice").hidden = !vnpayEnabled;
    document.querySelector("#delivery-choice-title").textContent =
      ghnEnabled ? "Giao tận nhà qua GHN" : "Giao tận nhà";
    document.querySelector("#delivery-choice-help").textContent = ghnEnabled
      ? "Phí giao hàng tính theo địa chỉ"
      : `Phí giao hàng ${currency.format(manualDeliveryFee)}`;
    bankTransferDetails = config.bankTransfer ?? null;
    document.querySelector("#bank-transfer-help").textContent = bankTransferDetails
      ? `${bankTransferDetails.bankName} · ${bankTransferDetails.accountHolder}`
      : "Thông tin tài khoản sẽ được quán xác nhận sau khi nhận đơn";
    menuStatus.textContent = products.length ? "" : "Thực đơn đang được cập nhật.";
    renderCategories();
    renderProducts();
    renderCart();
  } catch {
    menuStatus.textContent = "Chưa tải được thực đơn. Vui lòng kiểm tra kết nối và thử tải lại trang.";
    showToast("Không thể kết nối đến thực đơn lúc này.");
  }
}

categoryList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-category]");
  if (!button) return;
  activeCategory = button.dataset.category;
  renderCategories();
  renderProducts();
});

provinceSelect.addEventListener("change", async () => {
  districtSelect.disabled = true;
  wardSelect.disabled = true;
  wardSelect.replaceChildren(new Option("Chọn phường / xã", ""));
  if (!provinceSelect.value) return void refreshShippingQuote();
  try {
    await fetchGhnOptions(
      `/api/ghn/districts?provinceId=${encodeURIComponent(provinceSelect.value)}`,
      districtSelect,
      "Chọn quận / huyện",
      "DistrictID",
      "DistrictName"
    );
  } catch (error) {
    shippingQuote.textContent = error instanceof Error ? error.message : "Chưa tải được quận / huyện.";
  }
  refreshShippingQuote();
});

districtSelect.addEventListener("change", async () => {
  wardSelect.disabled = true;
  if (!districtSelect.value) {
    wardSelect.replaceChildren(new Option("Chọn phường / xã", ""));
    return void refreshShippingQuote();
  }
  try {
    await fetchGhnOptions(
      `/api/ghn/wards?districtId=${encodeURIComponent(districtSelect.value)}`,
      wardSelect,
      "Chọn phường / xã",
      "WardCode",
      "WardName"
    );
  } catch (error) {
    shippingQuote.textContent = error instanceof Error ? error.message : "Chưa tải được phường / xã.";
  }
  refreshShippingQuote();
});
wardSelect.addEventListener("change", refreshShippingQuote);
deliveryStreet.addEventListener("input", updatePlaceOrderAvailability);

document.querySelector("#open-cart").addEventListener("click", () => cartDialog.showModal());
document.querySelector("#checkout-button").addEventListener("click", () => {
  cartDialog.close();
  checkoutError.hidden = true;
  checkoutForm.hidden = false;
  document.querySelector("#order-success").hidden = true;
  updateFulfillment();
  checkoutDialog.showModal();
  if (document.querySelector('input[name="fulfillmentType"]:checked')?.value === "delivery") {
    refreshShippingQuote();
  }
});
document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => document.querySelector(`#${button.dataset.close}`).close());
});
document.querySelectorAll('input[name="fulfillmentType"]').forEach((input) => {
  input.addEventListener("change", updateFulfillment);
});
document.querySelectorAll('input[name="paymentMethod"]').forEach((input) => {
  input.addEventListener("change", () => {
    const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked')?.value;
    document.querySelector("#payment-summary").textContent =
      paymentMethod === "vnpay"
        ? "Thanh toán an toàn qua VNPay"
        : paymentMethod === "bank_transfer"
          ? "Chuyển khoản ngân hàng"
          : "Thanh toán khi nhận món";
  });
});

checkoutForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  checkoutError.hidden = true;
  placeOrderButton.disabled = true;
  placeOrderButton.firstElementChild.textContent = "Đang gửi đơn…";

  const formData = new FormData(checkoutForm);
  const fulfillmentType = formData.get("fulfillmentType");
  const order = {
    customerName: formData.get("customerName"),
    customerPhone: formData.get("customerPhone"),
    fulfillmentType,
    deliveryStreet: formData.get("deliveryStreet"),
    deliveryWardCode: ghnEnabled ? formData.get("deliveryWard") : "",
    deliveryDistrictId: ghnEnabled ? Number(formData.get("deliveryDistrict")) || undefined : undefined,
    deliveryWardName: ghnEnabled ? wardSelect.selectedOptions[0]?.textContent ?? "" : "",
    deliveryDistrictName: ghnEnabled ? districtSelect.selectedOptions[0]?.textContent ?? "" : "",
    customerNote: formData.get("customerNote"),
    paymentMethod: formData.get("paymentMethod"),
    items: Object.entries(cart).map(([productId, quantity]) => ({ productId, quantity }))
  };

  try {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(order)
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error ?? "Chưa thể đặt món. Vui lòng kiểm tra thông tin.");
    }
    if (result.paymentUrl) {
      sessionStorage.setItem("moc-pending-payment", result.id);
      window.location.assign(result.paymentUrl);
      return;
    }
    cart = {};
    saveCart();
    document.querySelector("#success-order-id").textContent = result.id.slice(0, 8).toUpperCase();
    document.querySelector("#success-total").textContent = `Tổng thanh toán: ${currency.format(result.total)}`;
    renderBankTransferInstructions(result.bankTransfer);
    checkoutForm.hidden = true;
    document.querySelector("#order-success").hidden = false;
  } catch (error) {
    checkoutError.textContent =
      error instanceof Error ? error.message : "Chưa thể đặt món. Vui lòng thử lại.";
    checkoutError.hidden = false;
  } finally {
    updatePlaceOrderAvailability();
    placeOrderButton.firstElementChild.textContent = "Đặt món ngay";
  }
});

function renderBankTransferInstructions(instructions) {
  const container = document.querySelector("#bank-transfer-instructions");
  container.replaceChildren();
  const isBankTransfer =
    document.querySelector('input[name="paymentMethod"]:checked')?.value === "bank_transfer";
  if (!isBankTransfer) {
    container.hidden = true;
    return;
  }

  container.hidden = false;
  container.append(makeElement("h4", "", "Thông tin chuyển khoản"));
  if (!instructions) {
    container.append(
      makeElement(
        "p",
        "",
        "Quán sẽ liên hệ để xác nhận thông tin tài khoản ngân hàng và hướng dẫn thanh toán."
      )
    );
    return;
  }

  for (const [label, value] of [
    ["Ngân hàng", instructions.bankName],
    ["Chủ tài khoản", instructions.accountHolder],
    ["Số tài khoản", instructions.accountNumber],
    ["Số tiền", currency.format(instructions.amount)],
    ["Nội dung chuyển khoản", instructions.transferContent]
  ]) {
    const row = makeElement("p");
    row.append(document.createTextNode(`${label}: `));
    row.append(makeElement("strong", "", value));
    container.append(row);
  }
  container.append(
    makeElement(
      "p",
      "",
      "Đơn được xác nhận sau khi quán nhận và đối soát khoản tiền chuyển."
    )
  );
  if (instructions.qrUrl) {
    const qr = makeElement("img", "bank-transfer-qr");
    qr.src = instructions.qrUrl;
    qr.alt = "Mã QR chuyển khoản ngân hàng";
    container.append(qr);
  }
}

loadMenu();

async function handleVnpayReturn() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("payment") !== "vnpay") return;
  try {
    const response = await fetch(`/api/payments/vnpay/return?${params.toString()}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Không xác minh được kết quả thanh toán.");
    if (result.success) {
      cart = {};
      saveCart();
      showToast("Thanh toán VNPay thành công. Mộc đã nhận đơn của bạn!");
    } else {
      showToast("Thanh toán chưa hoàn tất. Đơn hàng chưa được xác nhận.");
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Không xác minh được kết quả thanh toán.");
  } finally {
    sessionStorage.removeItem("moc-pending-payment");
    window.history.replaceState({}, "", window.location.pathname);
  }
}

void handleVnpayReturn();
