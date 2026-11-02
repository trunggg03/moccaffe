import { describe, expect, it } from "vitest";
import { orderRequestSchema } from "../src/validation";

const validOrder = {
  customerName: "Nguyễn An",
  customerPhone: "090 123 4567",
  fulfillmentType: "delivery",
  deliveryStreet: "12 Nguyễn Huệ",
  deliveryWardCode: "21012",
  deliveryDistrictId: 1452,
  deliveryWardName: "Phường Bến Nghé",
  deliveryDistrictName: "Quận 1",
  customerNote: "Ít đá",
  paymentMethod: "vnpay",
  items: [{ productId: "ca-phe-sua-da", quantity: 2 }]
};

describe("orderRequestSchema", () => {
  it("accepts valid delivery and pickup orders", () => {
    expect(orderRequestSchema.safeParse(validOrder).success).toBe(true);
    expect(
      orderRequestSchema.safeParse({
        ...validOrder,
        fulfillmentType: "pickup",
        deliveryStreet: "",
        deliveryWardCode: "",
        deliveryDistrictId: undefined,
        deliveryWardName: "",
        deliveryDistrictName: ""
      }).success
    ).toBe(true);
  });

  it("requires an address for delivery", () => {
    const result = orderRequestSchema.safeParse({
      ...validOrder,
      deliveryStreet: "",
      deliveryWardCode: ""
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === "deliveryStreet")).toBe(true);
    }
  });

  it("accepts manual delivery without GHN address codes and bank transfer payment", () => {
    expect(
      orderRequestSchema.safeParse({
        ...validOrder,
        deliveryStreet: "12 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh",
        deliveryWardCode: "",
        deliveryDistrictId: undefined,
        deliveryWardName: "",
        deliveryDistrictName: "",
        paymentMethod: "bank_transfer"
      }).success
    ).toBe(true);
  });

  it("rejects duplicate products, invalid quantities, and malformed phone numbers", () => {
    expect(
      orderRequestSchema.safeParse({
        ...validOrder,
        items: [
          { productId: "ca-phe-sua-da", quantity: 1 },
          { productId: "ca-phe-sua-da", quantity: 2 }
        ]
      }).success
    ).toBe(false);
    expect(
      orderRequestSchema.safeParse({
        ...validOrder,
        items: [{ productId: "ca-phe-sua-da", quantity: 100 }]
      }).success
    ).toBe(false);
    expect(
      orderRequestSchema.safeParse({ ...validOrder, customerPhone: "call-me" }).success
    ).toBe(false);
  });
});
