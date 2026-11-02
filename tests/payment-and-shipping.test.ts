import { afterEach, describe, expect, it, vi } from "vitest";
import { quoteGhnShipping, totalWeight } from "../src/ghn";
import { createVnpayPaymentUrl, verifyVnpayCallback } from "../src/vnpay";

describe("VNPay signing", () => {
  const env = {
    VNPAY_TMN_CODE: "DEMOV210",
    VNPAY_HASH_SECRET: "test-secret"
  };

  it("creates a signed payment URL and verifies signed callback values", async () => {
    const paymentUrl = await createVnpayPaymentUrl(
      env,
      "order-123",
      79000,
      "https://cafe.example/api/orders",
      "203.0.113.10"
    );
    const payment = new URL(paymentUrl);

    expect(payment.origin).toBe("https://sandbox.vnpayment.vn");
    expect(payment.searchParams.get("vnp_Amount")).toBe("7900000");
    expect(payment.searchParams.get("vnp_TxnRef")).toBe("order-123");
    expect(payment.searchParams.get("vnp_ReturnUrl")).toBe("https://cafe.example/?payment=vnpay");

    const callbackValues = Object.fromEntries(payment.searchParams.entries());
    delete callbackValues.vnp_SecureHash;
    callbackValues.vnp_TransactionNo = "123456";
    callbackValues.vnp_ResponseCode = "00";
    callbackValues.vnp_TransactionStatus = "00";
    const callback = new URLSearchParams(callbackValues);
    callback.set("vnp_SecureHash", await sign(callbackValues, env.VNPAY_HASH_SECRET));

    const verified = await verifyVnpayCallback(
      new URL(`https://cafe.example/api/payments/vnpay/return?${callback}`),
      env
    );
    expect(verified).toMatchObject({
      orderId: "order-123",
      amount: 79000,
      responseCode: "00",
      transactionStatus: "00",
      transactionNo: "123456"
    });

    callback.set("vnp_Amount", "1");
    expect(
      await verifyVnpayCallback(
        new URL(`https://cafe.example/api/payments/vnpay/return?${callback}`),
        env
      )
    ).toBeNull();
  });
});

describe("GHN parcel and quote", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("calculates parcel weight from item quantities", () => {
    expect(
      totalWeight([
        { name: "Coffee", code: "coffee", quantity: 2, price: 32000, weight: 350 },
        { name: "Cake", code: "cake", quantity: 1, price: 52000, weight: 180 }
      ])
    ).toBe(880);
    expect(totalWeight([])).toBe(100);
  });

  it("uses GHN credentials and destination to quote delivery", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 200, data: { total: 23000 } }), {
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const fee = await quoteGhnShipping(
      {
        GHN_TOKEN: "test-token",
        GHN_SHOP_ID: "12345",
        GHN_API_URL: "https://dev-online-gateway.ghn.vn",
        GHN_FROM_DISTRICT_ID: "1452"
      },
      { districtId: 1452, wardCode: "21012" },
      880,
      116000
    );

    expect(fee).toBe(23000);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://dev-online-gateway.ghn.vn/shiip/public-api/v2/shipping-order/fee",
      expect.objectContaining({
        headers: expect.objectContaining({ Token: "test-token", ShopId: "12345" })
      })
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      from_district_id: 1452,
      to_district_id: 1452,
      to_ward_code: "21012",
      weight: 880,
      insurance_value: 116000
    });
  });
});

async function sign(values: Record<string, string>, secret: string): Promise<string> {
  const body = Object.keys(values)
    .sort()
    .map((key) => `${encode(key)}=${encode(values[key])}`)
    .join("&");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function encode(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*~]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, "+");
}
