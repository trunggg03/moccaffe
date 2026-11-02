import { Hono } from "hono";
import { z } from "zod";
import {
  createGhnShipment,
  getGhnShipment,
  ghnIsConfigured,
  listGhnDistricts,
  listGhnProvinces,
  listGhnWards,
  quoteGhnShipping,
  totalWeight,
  type GhnEnv,
  type GhnParcelItem
} from "./ghn";
import { orderRequestSchema, shippingQuoteSchema } from "./validation";
import {
  createVnpayPaymentUrl,
  verifyVnpayCallback,
  vnpayIsConfigured,
  type VnpayEnv
} from "./vnpay";
import { chatSystemPrompt } from "./chat-policy";
import { createProductChunks, menuChunks } from "./data/menu";

interface Env extends GhnEnv, VnpayEnv {
  DB: D1Database;
  AI: Ai;
  MENU_VECTORIZE: Vectorize;
  PRODUCT_IMAGES: R2Bucket;
  ADMIN_TOKEN?: string;
  DELIVERY_FEE_VND?: string;
  BANK_NAME?: string;
  BANK_BIN?: string;
  BANK_ACCOUNT_NUMBER?: string;
  BANK_ACCOUNT_HOLDER?: string;
  AI_TOKEN?: string;
  ACCOUNT_ID?: string;
}

interface ProductRow {
  id: string;
  name: string;
  description: string;
  category: string;
  category_label: string;
  price_vnd: number;
  image_key: string | null;
  weight_g: number;
}

interface OrderItemRow {
  product_id: string;
  product_name: string;
  unit_price_vnd: number;
  quantity: number;
  line_total_vnd: number;
  weight_g: number;
}

const productPhotoFallbacks: Record<string, string> = {
  "ca-phe-sua-da": "ca-phe-sua-da",
  "bac-xiu": "americano-da",
  "cold-brew-cam": "latte-nong",
  "latte-nong": "socola-nong",
  "tra-dao-cam-sa": "tra-chanh-mat-ong",
  "matcha-latte": "matcha-latte",
  "croissant-bo": "croissant-bo",
  tiramisu: "tiramisu",
  espresso: "espresso",
  "americano-da": "tra-chanh-mat-ong",
  cappuccino: "socola-nong",
  "mocha-nong": "mocha-nong",
  "tra-vai-hoa-hong": "tra-vai-hoa-hong",
  "tra-chanh-mat-ong": "tra-chanh-mat-ong",
  "socola-nong": "mocha-nong",
  "banh-chuoi": "banh-chuoi",
  "cheesecake-dau": "cheesecake-dau",
  "cookie-socola": "cookie-socola"
};

const adminStatusSchema = z.object({
  status: z.enum(["new", "preparing", "ready", "completed", "cancelled"])
});

const app = new Hono<{ Bindings: Env }>();

const chatHistorySchema = z.array(
  z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(500)
  })
).max(8);

app.post("/api/chat", async (context) => {
  const body: unknown = await context.req.json().catch(() => null);
  const parsed = z.object({
    message: z.string().trim().min(1).max(500),
    history: chatHistorySchema.optional().default([])
  }).safeParse(body);
  if (!parsed.success) {
    return context.json({ error: "Thông điệp không hợp lệ." }, 400);
  }

  try {
    const { results: products = [] } = await context.env.DB.prepare(
      `SELECT id, name, description, category_label, price_vnd
       FROM products
       WHERE is_available = 1
       ORDER BY category_label, name`
    ).all<{
      id: string;
      name: string;
      description: string;
      category_label: string;
      price_vnd: number;
    }>();
    const currentMenu = createProductChunks(products).map((chunk) => chunk.text);

    const embedding = await context.env.AI.run("@cf/google/embeddinggemma-300m", {
      text: [parsed.data.message]
    });
    const queryVector = embedding.data[0];
    if (!queryVector?.length) throw new Error("Embedding model returned no vector.");

    const search = await context.env.MENU_VECTORIZE.query(queryVector, {
      topK: 5,
      returnMetadata: "all"
    });
    const retrievedReferences = search.matches.flatMap((match) => {
      const metadata = match.metadata;
      return isRecord(metadata) &&
        metadata.source === "faq" &&
        typeof metadata.text === "string"
        ? [metadata.text]
        : [];
    });
    const referenceText = retrievedReferences.length
      ? retrievedReferences.map((text, index) => `[${index + 1}] ${text}`).join("\n")
      : "Không tìm thấy đoạn RAG liên quan.";

    const completion = await context.env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
      messages: [
        {
          role: "system",
          content: chatSystemPrompt
        },
        ...parsed.data.history.slice(-6),
        {
          role: "user",
          content: `MENU HIỆN TẠI (tên, mô tả và giá lấy trực tiếp từ D1; không chứa xác nhận tồn kho):\n${currentMenu.join("\n") || "Menu hiện chưa có sản phẩm."}\n\nRAG FAQ LIÊN QUAN:\n${referenceText}\n\nCÂU HỎI HIỆN TẠI:\n${parsed.data.message}`
        }
      ]
    });
    const response = completion.choices[0]?.message.content?.trim() ?? "";
    if (!response) throw new Error("Chat model returned an empty response.");

    return context.json({ response });
  } catch (error) {
    console.error("Chatbot request failed.", error);
    return context.json(
      { error: "Trợ lý đang tạm thời không khả dụng. Vui lòng thử lại sau." },
      503
    );
  }
});

app.post("/api/chat/seed", async (context) => {
  if (!context.env.ADMIN_TOKEN || !hasAdminAccess(context.req.header("Authorization"), context.env)) {
    return context.json({ error: "Không có quyền truy cập." }, 401);
  }

  try {
    const { results = [] } = await context.env.DB.prepare(
      `SELECT id, name, description, category_label, price_vnd
       FROM products
       WHERE is_available = 1`
    ).all<{
      id: string;
      name: string;
      description: string;
      category_label: string;
      price_vnd: number;
    }>();
    const chunks = [...menuChunks, ...createProductChunks(results)];
    const embedding = await context.env.AI.run("@cf/google/embeddinggemma-300m", {
      text: chunks.map((chunk) => chunk.text)
    });
    if (embedding.data.length !== chunks.length) {
      throw new Error("Embedding model returned an incomplete batch.");
    }

    await context.env.MENU_VECTORIZE.upsert(
      chunks.map((chunk, index) => ({
        id: chunk.id,
        values: embedding.data[index],
        metadata: { source: chunk.source, text: chunk.text }
      }))
    );
    return context.json({ seeded: chunks.length });
  } catch (error) {
    console.error("Chat knowledge indexing failed.", error);
    return context.json(
      { error: "Chưa thể cập nhật dữ liệu chatbot. Vui lòng kiểm tra cấu hình AI và Vectorize." },
      503
    );
  }
});

app.get("/api/health", (context) => context.json({ status: "ok" }));

app.get("/api/config", (context) =>
  context.json({
    ghnEnabled: ghnIsConfigured(context.env),
    vnpayEnabled: vnpayIsConfigured(context.env),
    manualDeliveryFee: getManualDeliveryFee(context.env),
    bankTransfer: getBankTransferDetails(context.env)
  })
);

app.get("/api/ghn/provinces", async (context) => {
  if (!ghnIsConfigured(context.env)) {
    return context.json({ error: "Dịch vụ giao hàng GHN chưa được cấu hình." }, 503);
  }
  return context.json(await listGhnProvinces(context.env));
});

app.get("/api/ghn/districts", async (context) => {
  if (!ghnIsConfigured(context.env)) {
    return context.json({ error: "Dịch vụ giao hàng GHN chưa được cấu hình." }, 503);
  }
  const provinceId = Number(context.req.query("provinceId"));
  if (!Number.isSafeInteger(provinceId) || provinceId < 1) {
    return context.json({ error: "Mã tỉnh/thành không hợp lệ." }, 400);
  }
  return context.json(await listGhnDistricts(context.env, provinceId));
});

app.get("/api/ghn/wards", async (context) => {
  if (!ghnIsConfigured(context.env)) {
    return context.json({ error: "Dịch vụ giao hàng GHN chưa được cấu hình." }, 503);
  }
  const districtId = Number(context.req.query("districtId"));
  if (!Number.isSafeInteger(districtId) || districtId < 1) {
    return context.json({ error: "Mã quận/huyện không hợp lệ." }, 400);
  }
  return context.json(await listGhnWards(context.env, districtId));
});

app.get("/api/categories", async (context) => {
  const { results = [] } = await context.env.DB.prepare(
    `SELECT DISTINCT category, category_label
     FROM products
     WHERE is_available = 1
     ORDER BY category_label`
  ).all<{ category: string; category_label: string }>();

  return context.json(results.map((category) => ({ id: category.category, name: category.category_label })));
});

app.get("/api/products", async (context) => {
  const category = context.req.query("category");
  const query = category
    ? `SELECT id, name, description, category, category_label, price_vnd, image_key, weight_g
       FROM products
       WHERE is_available = 1 AND category = ?
       ORDER BY name`
    : `SELECT id, name, description, category, category_label, price_vnd, image_key, weight_g
       FROM products
       WHERE is_available = 1
       ORDER BY category, name`;
  const statement = context.env.DB.prepare(query);
  const { results = [] } = category
    ? await statement.bind(category).all<ProductRow>()
    : await statement.all<ProductRow>();

  return context.json(
    results.map((product) => ({
      id: product.id,
      name: product.name,
      description: product.description,
      category: product.category,
      categoryLabel: product.category_label,
      price: product.price_vnd,
      imageUrl: product.image_key
        ? `/api/images/${encodeURIComponent(product.id)}`
        : `/images/${productPhotoFallbacks[product.id] ?? "ca-phe-sua-da"}.jpg`
    }))
  );
});

app.get("/api/images/:productId", async (context) => {
  const product = await context.env.DB.prepare(
    "SELECT image_key FROM products WHERE id = ? AND is_available = 1"
  )
    .bind(context.req.param("productId"))
    .first<{ image_key: string | null }>();

  if (!product?.image_key) {
    return context.json({ error: "Không tìm thấy ảnh sản phẩm." }, 404);
  }

  const image = await context.env.PRODUCT_IMAGES.get(product.image_key);
  if (!image) {
    return context.json({ error: "Ảnh sản phẩm hiện không khả dụng." }, 404);
  }

  return context.body(image.body, 200, {
    "Content-Type": image.httpMetadata?.contentType ?? "application/octet-stream",
    "Cache-Control": "public, max-age=3600",
    ETag: image.httpEtag
  });
});

app.post("/api/shipping/quote", async (context) => {
  if (!ghnIsConfigured(context.env)) {
    return context.json({ error: "Dịch vụ giao hàng GHN chưa được cấu hình." }, 503);
  }
  const body: unknown = await context.req.json().catch(() => null);
  const parsed = shippingQuoteSchema.safeParse(body);
  if (!parsed.success) return context.json({ error: "Thông tin nhận hàng chưa hợp lệ." }, 400);

  const products = await findProducts(context.env.DB, parsed.data.items.map((item) => item.productId));
  if (products.size !== parsed.data.items.length) {
    return context.json({ error: "Một hoặc nhiều món đã hết hàng." }, 409);
  }
  const parcelItems = makeParcelItems(parsed.data.items, products);
  const weight = totalWeight(parcelItems);
  const insuranceValue = parcelItems.reduce((total, item) => total + item.price * item.quantity, 0);
  const fee = await quoteGhnShipping(
    context.env,
    { districtId: parsed.data.deliveryDistrictId, wardCode: parsed.data.deliveryWardCode },
    weight,
    insuranceValue
  );
  return context.json({ fee, weight });
});

app.post("/api/orders", async (context) => {
  const rawBody: unknown = await context.req.json().catch(() => null);
  const parsedOrder = orderRequestSchema.safeParse(rawBody);
  if (!parsedOrder.success) {
    return context.json(
      {
        error: "Thông tin đặt món chưa hợp lệ.",
        details: parsedOrder.error.issues.map(({ path, message }) => ({
          field: path.join("."),
          message
        }))
      },
      400
    );
  }

  const order = parsedOrder.data;
  if (order.paymentMethod === "vnpay" && !vnpayIsConfigured(context.env)) {
    return context.json({ error: "Thanh toán VNPay chưa được cấu hình." }, 503);
  }
  const products = await findProducts(context.env.DB, order.items.map((item) => item.productId));
  if (products.size !== order.items.length) {
    return context.json(
      { error: "Một hoặc nhiều món đã hết hàng. Vui lòng tải lại thực đơn." },
      409
    );
  }

  const lines = order.items.map((item) => {
    const product = products.get(item.productId);
    if (!product) throw new Error("Validated order product was not found.");
    return {
      product,
      quantity: item.quantity,
      lineTotal: product.price_vnd * item.quantity
    };
  });
  const subtotal = lines.reduce((total, line) => total + line.lineTotal, 0);
  if (
    lines.some((line) => !Number.isSafeInteger(line.lineTotal)) ||
    !Number.isSafeInteger(subtotal)
  ) {
    return context.json({ error: "Tổng đơn hàng vượt quá giới hạn cho phép." }, 400);
  }

  let deliveryFee = 0;
  let deliveryAddress: string | null = null;
  if (order.fulfillmentType === "delivery") {
    if (ghnIsConfigured(context.env)) {
      if (!order.deliveryDistrictId || !order.deliveryWardCode) {
        return context.json({ error: "Vui lòng chọn tỉnh, quận và phường giao hàng." }, 400);
      }
      const parcelItems = makeParcelItems(order.items, products);
      deliveryFee = await quoteGhnShipping(
        context.env,
        { districtId: order.deliveryDistrictId, wardCode: order.deliveryWardCode },
        totalWeight(parcelItems),
        subtotal
      );
      deliveryAddress = [
        order.deliveryStreet,
        order.deliveryWardName,
        order.deliveryDistrictName
      ].join(", ");
    } else {
      deliveryFee = getManualDeliveryFee(context.env);
      deliveryAddress = order.deliveryStreet;
    }
  }
  const total = subtotal + deliveryFee;
  if (!Number.isSafeInteger(total)) {
    return context.json({ error: "Tổng đơn hàng vượt quá giới hạn cho phép." }, 400);
  }
  if (order.paymentMethod === "vnpay" && !Number.isSafeInteger(total * 100)) {
    return context.json({ error: "Số tiền vượt quá giới hạn của cổng VNPay." }, 400);
  }
  const orderId = crypto.randomUUID();
  const paymentUrl =
    order.paymentMethod === "vnpay"
      ? await createVnpayPaymentUrl(
          context.env,
          orderId,
          total,
          context.req.url,
          context.req.header("CF-Connecting-IP") ?? "127.0.0.1"
        )
      : null;
  const statements = [
    context.env.DB.prepare(
      `INSERT INTO orders (
         id, customer_name, customer_phone, fulfillment_type, delivery_address,
         customer_note, subtotal_vnd, delivery_fee_vnd, total_vnd,
         delivery_street, delivery_ward_code, delivery_district_id,
         delivery_ward_name, delivery_district_name, payment_method
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      orderId,
      order.customerName,
      order.customerPhone,
      order.fulfillmentType,
      deliveryAddress,
      order.customerNote,
      subtotal,
      deliveryFee,
      total,
      order.fulfillmentType === "delivery" ? order.deliveryStreet : null,
      order.fulfillmentType === "delivery" ? order.deliveryWardCode : null,
      order.fulfillmentType === "delivery" ? order.deliveryDistrictId ?? null : null,
      order.fulfillmentType === "delivery" ? order.deliveryWardName : null,
      order.fulfillmentType === "delivery" ? order.deliveryDistrictName : null,
      order.paymentMethod
    ),
    ...lines.map(({ product, quantity, lineTotal }) =>
      context.env.DB.prepare(
        `INSERT INTO order_items (
           order_id, product_id, product_name, unit_price_vnd, quantity, line_total_vnd, weight_g
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        orderId,
        product.id,
        product.name,
        product.price_vnd,
        quantity,
        lineTotal,
        product.weight_g
      )
    )
  ];
  const results = await context.env.DB.batch(statements);
  if (results.some((result) => !result.success)) {
    throw new Error("Unable to persist the complete order.");
  }

  return context.json(
    {
      id: orderId,
      status: "new",
      paymentMethod: order.paymentMethod,
      subtotal,
      deliveryFee,
      total,
      paymentUrl,
      bankTransfer:
        order.paymentMethod === "bank_transfer"
          ? makeBankTransferInstructions(context.env, orderId, total)
          : null
    },
    201
  );
});

app.get("/api/payments/vnpay/ipn", async (context) => {
  const callback = await verifyVnpayCallback(new URL(context.req.url), context.env);
  if (!callback) return vnpayIpnResponse("97", "Invalid signature");
  const order = await context.env.DB.prepare(
    "SELECT total_vnd, payment_method, payment_status, status FROM orders WHERE id = ?"
  )
    .bind(callback.orderId)
    .first<{
      total_vnd: number;
      payment_method: string;
      payment_status: string;
      status: string;
    }>();
  if (!order) return vnpayIpnResponse("01", "Order not found");
  if (
    order.payment_method !== "vnpay" ||
    callback.amount !== order.total_vnd ||
    order.status === "cancelled"
  ) {
    return vnpayIpnResponse("04", "Invalid order amount or state");
  }
  if (order.payment_status === "paid") return vnpayIpnResponse("00", "Confirm Success");

  const paid = callback.responseCode === "00" && callback.transactionStatus === "00";
  await context.env.DB.prepare(
    `UPDATE orders
     SET payment_status = ?, payment_transaction_no = ?,
         paid_at = CASE WHEN ? = 'paid' THEN COALESCE(paid_at, ?) ELSE paid_at END
     WHERE id = ? AND payment_method = 'vnpay' AND payment_status != 'paid'`
  )
    .bind(
      paid ? "paid" : "failed",
      callback.transactionNo || null,
      paid ? "paid" : "failed",
      new Date().toISOString(),
      callback.orderId
    )
    .run();
  return vnpayIpnResponse("00", "Confirm Success");
});

app.get("/api/payments/vnpay/return", async (context) => {
  const callback = await verifyVnpayCallback(new URL(context.req.url), context.env);
  if (!callback) return context.json({ error: "Chữ ký kết quả thanh toán không hợp lệ." }, 400);
  const order = await context.env.DB.prepare(
    "SELECT total_vnd, payment_method, status FROM orders WHERE id = ?"
  )
    .bind(callback.orderId)
    .first<{ total_vnd: number; payment_method: string; status: string }>();
  if (!order || order.payment_method !== "vnpay" || order.total_vnd !== callback.amount) {
    return context.json({ error: "Không tìm thấy giao dịch hợp lệ." }, 404);
  }

  const success =
    callback.responseCode === "00" &&
    callback.transactionStatus === "00" &&
    order.status !== "cancelled";
  if (success) {
    await context.env.DB.prepare(
      `UPDATE orders
       SET payment_status = 'paid', payment_transaction_no = ?,
           paid_at = COALESCE(paid_at, ?)
       WHERE id = ? AND payment_method = 'vnpay' AND status != 'cancelled'`
    )
      .bind(callback.transactionNo || null, new Date().toISOString(), callback.orderId)
      .run();
  } else {
    await context.env.DB.prepare(
      `UPDATE orders SET payment_status = 'failed'
       WHERE id = ? AND payment_method = 'vnpay' AND payment_status = 'unpaid'`
    )
      .bind(callback.orderId)
      .run();
  }
  return context.json({ orderId: callback.orderId, success });
});

app.post("/api/admin/session", (context) => {
  if (!isAdmin(context.req.header("Authorization"), context.env)) {
    return context.json({ error: "Mã quản trị không chính xác." }, 401);
  }
  return context.json({ authenticated: true });
});

app.get("/api/admin/orders", async (context) => {
  if (!hasAdminAccess(context.req.header("Authorization"), context.env)) {
    return context.json({ error: "Không có quyền truy cập." }, 401);
  }
  const status = context.req.query("status");
  const where = status && ["new", "preparing", "ready", "completed", "cancelled"].includes(status)
    ? "WHERE status = ?"
    : "";
  const statement = context.env.DB.prepare(
    `SELECT id, customer_name, customer_phone, fulfillment_type, delivery_address,
            delivery_district_id, delivery_ward_code,
            customer_note, subtotal_vnd, delivery_fee_vnd, total_vnd, status, created_at,
            payment_method, payment_status, payment_transaction_no, paid_at,
            ghn_order_code, ghn_status, ghn_fee_vnd
     FROM orders ${where}
     ORDER BY created_at DESC LIMIT 100`
  );
  const { results = [] } = where
    ? await statement.bind(status).all<Record<string, unknown>>()
    : await statement.all<Record<string, unknown>>();

  const itemsByOrder = await getItemsForOrders(context.env.DB, results.map((row) => String(row.id)));
  return context.json(results.map((row) => ({ ...row, items: itemsByOrder.get(String(row.id)) ?? [] })));
});

app.get("/api/admin/orders/:orderId", async (context) => {
  if (!hasAdminAccess(context.req.header("Authorization"), context.env)) {
    return context.json({ error: "Không có quyền truy cập." }, 401);
  }
  const order = await context.env.DB.prepare(
    "SELECT * FROM orders WHERE id = ?"
  )
    .bind(context.req.param("orderId"))
    .first<Record<string, unknown>>();
  if (!order) return context.json({ error: "Không tìm thấy đơn hàng." }, 404);
  const items = await getItemsForOrders(context.env.DB, [String(order.id)]);
  return context.json({ ...order, items: items.get(String(order.id)) ?? [] });
});

app.patch("/api/admin/orders/:orderId/status", async (context) => {
  if (!hasAdminAccess(context.req.header("Authorization"), context.env)) {
    return context.json({ error: "Không có quyền truy cập." }, 401);
  }
  const body: unknown = await context.req.json().catch(() => null);
  const parsed = adminStatusSchema.safeParse(body);
  if (!parsed.success) return context.json({ error: "Trạng thái đơn hàng không hợp lệ." }, 400);
  const currentOrder = await context.env.DB.prepare(
    "SELECT ghn_order_code FROM orders WHERE id = ?"
  )
    .bind(context.req.param("orderId"))
    .first<{ ghn_order_code: string | null }>();
  if (!currentOrder) return context.json({ error: "Không tìm thấy đơn hàng." }, 404);
  if (parsed.data.status === "cancelled" && currentOrder.ghn_order_code) {
    return context.json(
      { error: "Hãy hủy vận đơn trực tiếp với GHN trước khi hủy đơn hàng." },
      409
    );
  }
  const result = await context.env.DB.prepare("UPDATE orders SET status = ? WHERE id = ?")
    .bind(parsed.data.status, context.req.param("orderId"))
    .run();
  if (!result.success) throw new Error("Unable to update order status.");
  if (result.meta.changes !== 1) return context.json({ error: "Không tìm thấy đơn hàng." }, 404);
  return context.json({ status: parsed.data.status });
});

app.post("/api/admin/orders/:orderId/mark-paid", async (context) => {
  if (!hasAdminAccess(context.req.header("Authorization"), context.env)) {
    return context.json({ error: "Không có quyền truy cập." }, 401);
  }
  const result = await context.env.DB.prepare(
    `UPDATE orders SET payment_status = 'paid', paid_at = COALESCE(paid_at, ?)
     WHERE id = ? AND payment_method IN ('cash', 'bank_transfer') AND payment_status = 'unpaid'
       AND status != 'cancelled'`
  )
    .bind(new Date().toISOString(), context.req.param("orderId"))
    .run();
  if (!result.success) throw new Error("Unable to update manual payment status.");
  if (result.meta.changes !== 1) {
    return context.json({ error: "Đơn không tồn tại hoặc đã được ghi nhận thanh toán." }, 409);
  }
  return context.json({ paymentStatus: "paid" });
});

app.post("/api/admin/orders/:orderId/shipment", async (context) => {
  if (!hasAdminAccess(context.req.header("Authorization"), context.env)) {
    return context.json({ error: "Không có quyền truy cập." }, 401);
  }
  if (!ghnIsConfigured(context.env)) {
    return context.json({ error: "Chưa cấu hình dịch vụ GHN." }, 503);
  }
  const orderId = context.req.param("orderId");
  const order = await context.env.DB.prepare("SELECT * FROM orders WHERE id = ?")
    .bind(orderId)
    .first<AdminOrderRow>();
  if (!order) return context.json({ error: "Không tìm thấy đơn hàng." }, 404);
  if (order.fulfillment_type !== "delivery" || order.status === "cancelled") {
    return context.json({ error: "Đơn này không thể tạo vận đơn." }, 409);
  }
  if (!order.delivery_district_id || !order.delivery_ward_code || !order.delivery_street) {
    return context.json(
      { error: "Đơn này dùng địa chỉ giao thủ công, không đủ mã địa chỉ để tạo vận đơn GHN." },
      409
    );
  }
  if (order.payment_method === "vnpay" && order.payment_status !== "paid") {
    return context.json({ error: "Chỉ tạo vận đơn sau khi VNPay xác nhận thanh toán." }, 409);
  }
  const reservation = await context.env.DB.prepare(
    `UPDATE orders SET ghn_status = 'creating'
     WHERE id = ? AND ghn_order_code IS NULL AND (ghn_status IS NULL OR ghn_status != 'creating')`
  )
    .bind(orderId)
    .run();
  if (!reservation.success) throw new Error("Unable to reserve shipment creation.");
  if (reservation.meta.changes !== 1) {
    return context.json({ error: "Vận đơn đã được tạo hoặc đang xử lý." }, 409);
  }

  const items = await getItemsForOrders(context.env.DB, [orderId]);
  const orderItems = items.get(orderId) ?? [];
  let shipment: { orderCode: string; fee: number | null };
  try {
    shipment = await createGhnShipment(context.env, {
      orderId,
      customerName: order.customer_name,
      customerPhone: order.customer_phone,
      destination: {
        street: order.delivery_street ?? "",
        districtId: order.delivery_district_id ?? 0,
        wardCode: order.delivery_ward_code ?? ""
      },
      districtName: order.delivery_district_name ?? "",
      wardName: order.delivery_ward_name ?? "",
      items: orderItems.map((item) => ({
        name: item.product_name,
        code: item.product_id,
        quantity: item.quantity,
        price: item.unit_price_vnd,
        weight: item.weight_g
      })),
      codAmount: order.payment_status === "paid" ? 0 : order.total_vnd,
      insuranceValue: order.subtotal_vnd,
      note: order.customer_note
    });
  } catch (error) {
    await context.env.DB.prepare(
      "UPDATE orders SET ghn_status = NULL WHERE id = ? AND ghn_status = 'creating'"
    )
      .bind(orderId)
      .run();
    throw error;
  }
  const update = await context.env.DB.prepare(
    `UPDATE orders SET ghn_order_code = ?, ghn_status = 'ready_to_pick',
                       ghn_fee_vnd = ?, shipping_created_at = ?
     WHERE id = ? AND ghn_status = 'creating'`
  )
    .bind(shipment.orderCode, shipment.fee, new Date().toISOString(), orderId)
    .run();
  if (!update.success || update.meta.changes !== 1) {
    console.error("GHN shipment was created but could not be linked to the order.", {
      orderId,
      ghnOrderCode: shipment.orderCode
    });
    throw new Error("GHN đã tạo vận đơn nhưng chưa lưu được mã. Liên hệ hỗ trợ trước khi thử lại.");
  }
  return context.json({ orderCode: shipment.orderCode, fee: shipment.fee }, 201);
});

app.post("/api/admin/orders/:orderId/shipment/refresh", async (context) => {
  if (!hasAdminAccess(context.req.header("Authorization"), context.env)) {
    return context.json({ error: "Không có quyền truy cập." }, 401);
  }
  if (!ghnIsConfigured(context.env)) {
    return context.json({ error: "Chưa cấu hình dịch vụ GHN." }, 503);
  }
  const order = await context.env.DB.prepare("SELECT ghn_order_code FROM orders WHERE id = ?")
    .bind(context.req.param("orderId"))
    .first<{ ghn_order_code: string | null }>();
  if (!order) return context.json({ error: "Không tìm thấy đơn hàng." }, 404);
  if (!order.ghn_order_code) return context.json({ error: "Đơn chưa có mã vận đơn." }, 409);
  const details = await getGhnShipment(context.env, order.ghn_order_code);
  const status = readGhnStatus(details);
  if (status) {
    await context.env.DB.prepare("UPDATE orders SET ghn_status = ? WHERE id = ?")
      .bind(status, context.req.param("orderId"))
      .run();
  }
  return context.json({ orderCode: order.ghn_order_code, status, details });
});

app.post("/api/admin/products/:productId/image", async (context) => {
  if (!context.env.ADMIN_TOKEN) {
    return context.json({ error: "Chưa cấu hình quyền tải ảnh sản phẩm." }, 503);
  }
  const authorized =
    hasAdminAccess(context.req.header("Authorization"), context.env) ||
    constantTimeEqual(
      context.req.header("X-Admin-Token") ?? "",
      context.env.ADMIN_TOKEN
    );
  if (!authorized) {
    return context.json({ error: "Bạn không có quyền thực hiện thao tác này." }, 401);
  }

  const productId = context.req.param("productId");
  const product = await context.env.DB.prepare("SELECT id FROM products WHERE id = ?")
    .bind(productId)
    .first<{ id: string }>();
  if (!product) return context.json({ error: "Không tìm thấy sản phẩm." }, 404);

  const formData = await context.req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return context.json({ error: "Vui lòng đính kèm tệp ảnh trong trường file." }, 400);
  }
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp"
  };
  const extension = extensions[file.type];
  if (!extension) return context.json({ error: "Chỉ hỗ trợ ảnh JPEG, PNG hoặc WebP." }, 415);
  if (file.size === 0 || file.size > 5 * 1024 * 1024) {
    return context.json({ error: "Ảnh phải có dung lượng từ 1 byte đến 5 MB." }, 413);
  }

  const imageKey = `products/${productId}/${crypto.randomUUID()}.${extension}`;
  await context.env.PRODUCT_IMAGES.put(imageKey, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type }
  });
  try {
    const updateResult = await context.env.DB.prepare(
      "UPDATE products SET image_key = ? WHERE id = ?"
    )
      .bind(imageKey, productId)
      .run();
    if (!updateResult.success || updateResult.meta.changes !== 1) {
      throw new Error("Unable to associate the uploaded image with its product.");
    }
  } catch (error) {
    try {
      await context.env.PRODUCT_IMAGES.delete(imageKey);
    } catch (cleanupError) {
      console.error("Failed to remove an unlinked product image from R2.", cleanupError);
    }
    throw error;
  }

  return context.json({ imageUrl: `/api/images/${encodeURIComponent(productId)}` });
});

app.notFound((context) => context.json({ error: "Không tìm thấy API." }, 404));
app.onError((error, context) => {
  console.error("Request failed.", error);
  return context.json({ error: "Đã có lỗi xảy ra. Vui lòng thử lại sau." }, 500);
});

interface AdminOrderRow {
  id: string;
  customer_name: string;
  customer_phone: string;
  fulfillment_type: string;
  delivery_street: string | null;
  delivery_ward_code: string | null;
  delivery_district_id: number | null;
  delivery_ward_name: string | null;
  delivery_district_name: string | null;
  customer_note: string;
  subtotal_vnd: number;
  total_vnd: number;
  status: string;
  payment_method: string;
  payment_status: string;
}

async function findProducts(db: D1Database, ids: string[]): Promise<Map<string, ProductRow>> {
  const placeholders = ids.map(() => "?").join(", ");
  const { results = [] } = await db
    .prepare(
      `SELECT id, name, description, category, category_label, price_vnd, image_key, weight_g
       FROM products WHERE is_available = 1 AND id IN (${placeholders})`
    )
    .bind(...ids)
    .all<ProductRow>();
  return new Map(results.map((product) => [product.id, product]));
}

function makeParcelItems(
  requestedItems: { productId: string; quantity: number }[],
  products: Map<string, ProductRow>
): GhnParcelItem[] {
  return requestedItems.map((item) => {
    const product = products.get(item.productId);
    if (!product) throw new Error("Requested product was not found.");
    return {
      name: product.name,
      code: product.id,
      quantity: item.quantity,
      price: product.price_vnd,
      weight: product.weight_g
    };
  });
}

async function getItemsForOrders(
  db: D1Database,
  ids: string[]
): Promise<Map<string, OrderItemRow[]>> {
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => "?").join(", ");
  const { results = [] } = await db
    .prepare(
      `SELECT order_id, product_id, product_name, unit_price_vnd, quantity,
              line_total_vnd, weight_g
       FROM order_items WHERE order_id IN (${placeholders}) ORDER BY id`
    )
    .bind(...ids)
    .all<OrderItemRow & { order_id: string }>();
  const grouped = new Map<string, OrderItemRow[]>();
  for (const { order_id: orderId, ...item } of results) {
    const items = grouped.get(orderId) ?? [];
    items.push(item);
    grouped.set(orderId, items);
  }
  return grouped;
}

function isAdmin(authorization: string | undefined, env: Env): boolean {
  if (!env.ADMIN_TOKEN || !authorization?.startsWith("Bearer ")) return false;
  return constantTimeEqual(authorization.slice(7), env.ADMIN_TOKEN);
}

function hasAdminAccess(authorization: string | undefined, env: Env): boolean {
  return isAdmin(authorization, env);
}

function vnpayIpnResponse(code: string, message: string): Response {
  return Response.json({ RspCode: code, Message: message });
}

function readGhnStatus(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const data = isRecord(value.data) ? value.data : value;
  return typeof data.status === "string" ? data.status : null;
}

function getManualDeliveryFee(env: Env): number {
  const fee = Number(env.DELIVERY_FEE_VND ?? "15000");
  if (!Number.isSafeInteger(fee) || fee < 0 || fee > 10_000_000) {
    throw new Error("DELIVERY_FEE_VND must be a whole number between 0 and 10000000.");
  }
  return fee;
}

interface BankTransferDetails {
  bankName: string;
  bankBin: string;
  accountNumber: string;
  accountHolder: string;
}

function getBankTransferDetails(env: Env): BankTransferDetails | null {
  const { BANK_NAME, BANK_BIN, BANK_ACCOUNT_NUMBER, BANK_ACCOUNT_HOLDER } = env;
  if (!BANK_NAME || !BANK_BIN || !BANK_ACCOUNT_NUMBER || !BANK_ACCOUNT_HOLDER) return null;
  return {
    bankName: BANK_NAME,
    bankBin: BANK_BIN,
    accountNumber: BANK_ACCOUNT_NUMBER,
    accountHolder: BANK_ACCOUNT_HOLDER
  };
}

function makeBankTransferInstructions(
  env: Env,
  orderId: string,
  amount: number
): (BankTransferDetails & { amount: number; transferContent: string; qrUrl: string }) | null {
  const details = getBankTransferDetails(env);
  if (!details) return null;
  const transferContent = `MOC ${orderId.slice(0, 8).toUpperCase()}`;
  const query = new URLSearchParams({
    amount: String(amount),
    addInfo: transferContent,
    accountName: details.accountHolder
  });
  return {
    ...details,
    amount,
    transferContent,
    qrUrl: `https://img.vietqr.io/image/${encodeURIComponent(details.bankBin)}-${encodeURIComponent(details.accountNumber)}-compact2.png?${query}`
  };
}

async function getEmbedding(text: string, env: Env): Promise<number[] | null> {
  if (!env.AI_TOKEN) return null;
  try {
    const response = await fetch("https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/ai/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.AI_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "text-embedding-3",
        input: text
      })
    });
    if (!response.ok) return null;
    const data: { data: { embedding: number[] }[] } = await response.json();
    if (data.data && data.data.length > 0 && Array.isArray(data.data[0].embedding)) {
      return data.data[0].embedding;
    }
    return null;
  } catch (e) {
    console.error("Embedding error:", e);
    return null;
  }
}

async function storeProductEmbeddings(env: Env): Promise<void> {
  const { results = [] } = await env.DB.prepare(
    "SELECT id, name, description, category, category_label, price_vnd FROM products WHERE is_available = 1"
  ).all();

  for (const product of results) {
    const text = `${product.name} ${product.description} ${product.category_label} ${product.price_vnd} VND`;
    const embedding = await getEmbedding(text, env);
    if (embedding) {
      await env.DB.prepare(
        "UPDATE products SET embedding = ? WHERE id = ?"
      ).bind(JSON.stringify(embedding), product.id).run();
    }
  }
}

// Legacy implementation kept out of the public chat endpoints.
app.post("/api/chat/legacy", async (context) => {
  if (context.req.path === "/api/chat/legacy") {
    return context.json({ error: "Endpoint này đã được thay thế." }, 410);
  }

  const body: unknown = await context.req.json().catch(() => null);
  const parsed = z.object({
    message: z.string().trim().min(1).max(500)
  }).safeParse(body);
  if (!parsed.success) {
    return context.json({ error: "Thông điệp không hợp lệ." }, 400);
  }

  const message = parsed.data.message;

  // Tìm các đoạn liên quan trong Vectorize
  const queryVector = await getEmbedding(message, context.env);
  if (!queryVector) return context.json({ error: "Chatbot chưa được cấu hình." }, 503);
  const vectorizeResults = await context.env.MENU_VECTORIZE.query(queryVector, {
    topK: 5,
    returnMetadata: "all"
  });

  // Chuẩn bị context cho LLM
  const relevantTexts: string[] = vectorizeResults.matches
    .map((m: any) => m.metadata?.text || "")
    .filter(Boolean);

  const contextText = relevantTexts.join("\n---\n");

  // Gọi gemma-4-26b-a4b-it để trả lời
  const prompt = `Bạn là trợ lý ảo của Quán Cà Phê Mộc Cafe, một quán cà phê tại Việt Nam. Hãy trả lời câu hỏi của khách hàng bằng tiếng Việt, thân thiện và ngắn gọn. Dựa trên thông tin dưới đây:

Thông tin:
${contextText}

Câu hỏi: ${message}

Trả lời ngắn gọn, bạn bè, sử dụng tiếng Việt. Nếu không tìm thấy thông tin, hãy giới thiệu về menu và cách đặt hàng.`;

  try {
    const aiResponse = await fetch(`https://api.cloudflare.com/client/v4/accounts/${context.env.ACCOUNT_ID}/ai/run/@cf/google/gemma-4-26b-a4b-it`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${context.env.AI_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt: prompt
      })
    });

    if (aiResponse.ok) {
      const result: unknown = await aiResponse.json();
      const response =
        isRecord(result) && typeof result.response === "string" ? result.response.trim() : "";
      return context.json({
        response: response || "Xin lỗi, tôi đang xử lý câu hỏi của bạn.",
        suggestions: [],
        source: "gemma"
      });
    }
  } catch (error) {
    console.error("AI error:", error);
  }

  // Fallback: trả lời đơn giản
  return context.json({
    response: taoTraLoiFallback(message, relevantTexts),
    suggestions: [],
    source: "fallback"
  });
});

function taoTraLoiFallback(message: string, relevantTexts: string[]): string {
  const combinedText = relevantTexts.join(" ").toLowerCase();

  if (combinedText.includes("giao") || combinedText.includes("vận chuyển") || combinedText.includes("delivery")) {
    return "Chúng tôi hỗ trợ giao hàng trong nội thành với phụ phí 15.000đ. Bạn có thể chọn quận và phường khi đặt hàng nhé!";
  }
  if (combinedText.includes("trà")) {
    return "Chúng tôi có bán trà đào, trà vải, trà chanh... Giá từ 38.000đ đến 48.000đ. Bạn muốn đặt loại nào nhỉ?";
  }
  if (combinedText.includes("cà phê") || combinedText.includes("coffee") || combinedText.includes("espresso") || combinedText.includes("latte")) {
    return "Chúng tôi có cà phê sữa đá 35.000đ, espresso 32.000đ, latte 42.000đ, mocha 48.000đ... Bạn muốn thử gì không?";
  }
  if (combinedText.includes("bánh") || combinedText.includes("bread") || combinedText.includes("croissant")) {
    return "Các món bánh kèm café rất ngon! Croissant phô mai 42.000đ, bánh chuối 40.000đ, cheesecake 55.000đ...";
  }

  return "Chào bạn! 👋 Tôi có thể giúp gì cho bạn? Bạn có thể hỏi về menu, giá sản phẩm, giờ mở cửa (08:00-21:00), hoặc cách thanh toán nhé!";
}

app.post("/api/chat/legacy-seed", async (context) => {
  if (context.req.path === "/api/chat/legacy-seed") {
    return context.json({ error: "Endpoint này đã được thay thế." }, 410);
  }

  if (!context.env.ADMIN_TOKEN || !hasAdminAccess(context.req.header("Authorization"), context.env)) {
    return context.json({ error: "Không có quyền truy cập." }, 401);
  }

  const menuData = [
    { id: "menu-coffee", text: "CÀ PHÊ: Cà phê sữa đá 35,000đ - Espresso 32,000đ - Cà phê đen 28,000đ - Latte 42,000đ - Cappuccino 45,000đ - Mocha nóng 48,000đ - Cold brew cam 52,000đ - Matcha latte 55,000đ" },
    { id: "menu-tea", text: "TRÀ: Trà đào cam sả 46,000đ - Trà vải hoa hồng 48,000đ - Trà chanh mat ôn 42,000đ - Trà đá hoa quả 45,000đ - Trà xanh minh 38,000đ" },
    { id: "menu-breakfast", text: "BÁNH MẶT: Croissant phô mai 42,000đ - Croissant bò 45,000đ - Bánh quy socola 38,000đ - Bánh chuối 40,000đ - Cheesecake dâu 55,000đ - Tiramisu 58,000đ" },
    { id: "faq-hours", text: "GIỜ MỞ CỬA: Thứ 2 - Thứ 7 08:00 - 21:00, Chủ nhật 09:00 - 20:00. Vui lòng đặt trước khi 20:30 để nhận đơn giao trong ngày." },
    { id: "faq-delivery", text: "VIỆN CHUYỂN HÀNH: Miễn phí giao trong bán kính 3km, phí 15,000đ giao ngoài khu vực. Hỗ trợ GHN giao hàng nhanh trong 1-2 ngày." },
    { id: "faq-payment", text: "CÁCH THANH TOÁN: Tiền mặt khi nhận, Chuyển khoản ngân hàng, Thanh toán VNPay qua QR code hoặc link." },
    { id: "faq-ordering", text: "ĐẶT HÀNG: Gọi tới số 0909.123.456 hoặc website. Quý khách cung cấp họ tên, số điện thoại, địa chỉ chi tiết." },
    { id: "policy-refund", text: "CHÍNH SÁCH TRẢ HÀNG: Khách hàng có thể trả lại đồ trong vòng 30 phút kể từ khi nhận hàng, đồ phải nguyên vẹn, gói nguyên gia." }
  ];

  const vectors = await Promise.all(menuData.map(async (item) => {
    const values = await getEmbedding(item.text, context.env);
    if (!values) throw new Error(`Could not embed chat content ${item.id}.`);
    return {
      id: item.id,
      values,
      metadata: { source: item.id, text: item.text }
    };
  }));

  await context.env.MENU_VECTORIZE.upsert(vectors);

  return context.json({ seeded: vectors.length, items: menuData.map(i => i.id) });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function constantTimeEqual(candidate: string, expected: string): boolean {
  const candidateBytes = new TextEncoder().encode(candidate);
  const expectedBytes = new TextEncoder().encode(expected);
  let difference = candidateBytes.length ^ expectedBytes.length;
  const length = Math.max(candidateBytes.length, expectedBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (candidateBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  }
  return difference === 0;
}

export default app;