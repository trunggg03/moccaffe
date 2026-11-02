export interface VnpayEnv {
  VNPAY_TMN_CODE?: string;
  VNPAY_HASH_SECRET?: string;
  VNPAY_GATEWAY_URL?: string;
}

export interface VnpayCallback {
  orderId: string;
  amount: number;
  responseCode: string;
  transactionStatus: string;
  transactionNo: string;
}

export function vnpayIsConfigured(env: VnpayEnv): boolean {
  return Boolean(env.VNPAY_TMN_CODE && env.VNPAY_HASH_SECRET);
}

export async function createVnpayPaymentUrl(
  env: VnpayEnv,
  orderId: string,
  amountVnd: number,
  requestUrl: string,
  ipAddress: string
): Promise<string> {
  if (!env.VNPAY_TMN_CODE || !env.VNPAY_HASH_SECRET) {
    throw new Error("VNPAY_TMN_CODE and VNPAY_HASH_SECRET must be configured.");
  }
  if (!Number.isSafeInteger(amountVnd * 100) || amountVnd < 0) {
    throw new Error("VNPay amount must be a non-negative safe integer in cents.");
  }

  const origin = new URL(requestUrl).origin;
  const now = Date.now();
  const values: Record<string, string> = {
    vnp_Version: "2.1.0",
    vnp_Command: "pay",
    vnp_TmnCode: env.VNPAY_TMN_CODE,
    vnp_Amount: String(amountVnd * 100),
    vnp_CurrCode: "VND",
    vnp_TxnRef: orderId,
    vnp_OrderInfo: `Thanh toan don hang ${orderId}`,
    vnp_OrderType: "other",
    vnp_Locale: "vn",
    vnp_ReturnUrl: `${origin}/?payment=vnpay`,
    vnp_IpAddr: ipAddress.slice(0, 45),
    vnp_CreateDate: vnpayDate(now),
    vnp_ExpireDate: vnpayDate(now + 15 * 60 * 1000)
  };
  const gateway = env.VNPAY_GATEWAY_URL ?? "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html";
  const search = encodeVnpayParameters(values);
  const signature = await hmacSha512(env.VNPAY_HASH_SECRET, search);
  return `${gateway}?${search}&vnp_SecureHash=${signature}`;
}

export async function verifyVnpayCallback(url: URL, env: VnpayEnv): Promise<VnpayCallback | null> {
  if (!env.VNPAY_HASH_SECRET || !env.VNPAY_TMN_CODE) return null;
  if (url.searchParams.getAll("vnp_SecureHash").length !== 1) return null;
  const values: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (!key.startsWith("vnp_") || key === "vnp_SecureHash" || key === "vnp_SecureHashType") {
      continue;
    }
    if (url.searchParams.getAll(key).length !== 1) return null;
    values[key] = value;
  }

  const signature = url.searchParams.get("vnp_SecureHash");
  const expected = await hmacSha512(env.VNPAY_HASH_SECRET, encodeVnpayParameters(values));
  if (!signature || !constantTimeEqual(signature.toLowerCase(), expected)) return null;

  const orderId = values.vnp_TxnRef;
  const amountInCents = Number(values.vnp_Amount);
  if (
    !orderId ||
    values.vnp_TmnCode !== env.VNPAY_TMN_CODE ||
    !Number.isSafeInteger(amountInCents) ||
    amountInCents < 0 ||
    amountInCents % 100 !== 0 ||
    !values.vnp_ResponseCode ||
    !values.vnp_TransactionStatus
  ) {
    return null;
  }

  return {
    orderId,
    amount: amountInCents / 100,
    responseCode: values.vnp_ResponseCode,
    transactionStatus: values.vnp_TransactionStatus,
    transactionNo: values.vnp_TransactionNo ?? ""
  };
}

function encodeVnpayParameters(values: Record<string, string>): string {
  return Object.keys(values)
    .sort()
    .map((key) => `${vnpayEncode(key)}=${vnpayEncode(values[key])}`)
    .join("&");
}

function vnpayEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*~]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, "+");
}

async function hmacSha512(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function vnpayDate(timestamp: number): string {
  return new Date(timestamp + 7 * 60 * 60 * 1000)
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
}

function constantTimeEqual(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}
