export interface GhnEnv {
  GHN_TOKEN?: string;
  GHN_SHOP_ID?: string;
  GHN_API_URL?: string;
  GHN_FROM_NAME?: string;
  GHN_FROM_PHONE?: string;
  GHN_FROM_ADDRESS?: string;
  GHN_FROM_WARD_CODE?: string;
  GHN_FROM_WARD_NAME?: string;
  GHN_FROM_DISTRICT_ID?: string;
  GHN_FROM_DISTRICT_NAME?: string;
}

export interface GhnParcelItem {
  name: string;
  code: string;
  quantity: number;
  price: number;
  weight: number;
}

export interface GhnDestination {
  districtId: number;
  wardCode: string;
  street: string;
}

export interface GhnOrderInput {
  orderId: string;
  customerName: string;
  customerPhone: string;
  destination: GhnDestination;
  districtName: string;
  wardName: string;
  items: GhnParcelItem[];
  codAmount: number;
  insuranceValue: number;
  note: string;
}

export function ghnIsConfigured(env: GhnEnv): boolean {
  return Boolean(
    env.GHN_TOKEN &&
      env.GHN_SHOP_ID &&
      env.GHN_FROM_NAME &&
      env.GHN_FROM_PHONE &&
      env.GHN_FROM_ADDRESS &&
      env.GHN_FROM_WARD_CODE &&
      env.GHN_FROM_WARD_NAME &&
      env.GHN_FROM_DISTRICT_ID &&
      env.GHN_FROM_DISTRICT_NAME
  );
}

export async function listGhnProvinces(env: GhnEnv): Promise<unknown[]> {
  const data = await ghnRequest(env, "/shiip/public-api/master-data/province");
  return asArray(data, "provinces");
}

export async function listGhnDistricts(env: GhnEnv, provinceId: number): Promise<unknown[]> {
  const data = await ghnRequest(env, "/shiip/public-api/master-data/district", {
    province_id: provinceId
  });
  return asArray(data, "districts");
}

export async function listGhnWards(env: GhnEnv, districtId: number): Promise<unknown[]> {
  const data = await ghnRequest(env, "/shiip/public-api/master-data/ward", {
    district_id: districtId
  });
  return asArray(data, "wards");
}

export async function quoteGhnShipping(
  env: GhnEnv,
  destination: Pick<GhnDestination, "districtId" | "wardCode">,
  weight: number,
  insuranceValue: number
): Promise<number> {
  const originDistrictId = requiredNumber(env.GHN_FROM_DISTRICT_ID, "GHN_FROM_DISTRICT_ID");
  const data = await ghnRequest(env, "/shiip/public-api/v2/shipping-order/fee", {
    from_district_id: originDistrictId,
    to_district_id: destination.districtId,
    to_ward_code: destination.wardCode,
    service_type_id: 2,
    weight,
    length: 20,
    width: 15,
    height: 10,
    insurance_value: insuranceValue,
    coupon: null
  });
  const fee = readNumberProperty(data, "total");
  if (!Number.isSafeInteger(fee) || fee < 0) {
    throw new Error("GHN returned an invalid shipping fee.");
  }
  return fee;
}

export async function createGhnShipment(env: GhnEnv, order: GhnOrderInput): Promise<{
  orderCode: string;
  fee: number | null;
}> {
  assertGhnConfigured(env);
  const payload = {
    payment_type_id: 1,
    note: order.note,
    required_note: "KHONGCHOXEMHANG",
    from_name: env.GHN_FROM_NAME,
    from_phone: env.GHN_FROM_PHONE,
    from_address: env.GHN_FROM_ADDRESS,
    from_ward_code: env.GHN_FROM_WARD_CODE,
    from_district_id: Number(env.GHN_FROM_DISTRICT_ID),
    from_ward_name: env.GHN_FROM_WARD_NAME,
    from_district_name: env.GHN_FROM_DISTRICT_NAME,
    to_name: order.customerName,
    to_phone: order.customerPhone,
    to_address: order.destination.street,
    to_ward_code: order.destination.wardCode,
    to_district_id: order.destination.districtId,
    cod_amount: order.codAmount,
    content: order.items.map((item) => `${item.name} x${item.quantity}`).join(", ").slice(0, 200),
    weight: totalWeight(order.items),
    length: 20,
    width: 15,
    height: 10,
    insurance_value: order.insuranceValue,
    service_type_id: 2,
    client_order_code: order.orderId.slice(0, 50),
    items: order.items.map((item) => ({
      name: item.name,
      code: item.code,
      quantity: item.quantity,
      price: item.price,
      weight: item.weight
    }))
  };
  const data = await ghnRequest(env, "/shiip/public-api/v2/shipping-order/create", payload);
  const orderCode = readStringProperty(data, "order_code");
  if (!orderCode) throw new Error("GHN did not return a shipment tracking code.");
  const fee = readNumberProperty(data, "total_fee");
  return { orderCode, fee: Number.isSafeInteger(fee) ? fee : null };
}

export async function getGhnShipment(env: GhnEnv, orderCode: string): Promise<unknown> {
  return ghnRequest(env, "/shiip/public-api/v2/shipping-order/detail", { order_code: orderCode });
}

export function totalWeight(items: GhnParcelItem[]): number {
  const weight = Math.max(100, items.reduce((total, item) => total + item.weight * item.quantity, 0));
  if (!Number.isSafeInteger(weight)) throw new Error("GHN parcel weight exceeds the supported limit.");
  return weight;
}

export function assertGhnConfigured(env: GhnEnv): void {
  if (!ghnIsConfigured(env)) {
    throw new Error("GHN_TOKEN, GHN_SHOP_ID and GHN_FROM_* sender details must be configured.");
  }
}

async function ghnRequest(env: GhnEnv, path: string, body?: Record<string, unknown>): Promise<unknown> {
  if (!env.GHN_TOKEN) throw new Error("GHN_TOKEN must be configured.");
  const baseUrl = env.GHN_API_URL ?? "https://dev-online-gateway.ghn.vn";
  const headers: Record<string, string> = {
    Token: env.GHN_TOKEN,
    "Content-Type": "application/json"
  };
  if (env.GHN_SHOP_ID) headers.ShopId = env.GHN_SHOP_ID;

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(10_000)
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok || !isRecord(result) || result.code !== 200) {
    const message = isRecord(result) && typeof result.message === "string" ? result.message : response.statusText;
    throw new Error(`GHN request failed (${response.status}): ${message || "unknown provider error"}`);
  }
  return result.data;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`GHN returned invalid ${label} data.`);
  return value;
}

function readNumberProperty(value: unknown, key: string): number {
  if (!isRecord(value)) return Number.NaN;
  const property = value[key];
  if (typeof property === "number") return property;
  if (typeof property === "string" && property.trim()) return Number(property);
  return Number.NaN;
}

function readStringProperty(value: unknown, key: string): string | null {
  if (!isRecord(value) || typeof value[key] !== "string") return null;
  return value[key];
}

function requiredNumber(value: string | undefined, name: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${name} must be a positive integer.`);
  return number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
