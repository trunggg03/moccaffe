import { z } from "zod";

export const orderRequestSchema = z
  .object({
    customerName: z.string().trim().min(2).max(80),
    customerPhone: z
      .string()
      .trim()
      .min(8)
      .max(20)
      .regex(/^[0-9+().\-\s]+$/),
    fulfillmentType: z.enum(["pickup", "delivery"]),
    deliveryStreet: z.string().trim().max(180).optional().default(""),
    deliveryWardCode: z.string().trim().max(32).optional().default(""),
    deliveryDistrictId: z.number().int().positive().optional(),
    deliveryWardName: z.string().trim().max(100).optional().default(""),
    deliveryDistrictName: z.string().trim().max(100).optional().default(""),
    customerNote: z.string().trim().max(500).optional().default(""),
    paymentMethod: z.enum(["cash", "bank_transfer", "vnpay"]).default("cash"),
    items: z
      .array(
        z.object({
          productId: z.string().min(1).max(80),
          quantity: z.number().int().min(1).max(99)
        })
      )
      .min(1)
      .max(30)
  })
  .superRefine((order, context) => {
    if (
      order.fulfillmentType === "delivery" &&
      (order.deliveryStreet.length < 5 ||
        Boolean(order.deliveryWardCode) !== Boolean(order.deliveryDistrictId) ||
        Boolean(order.deliveryWardCode) !== Boolean(order.deliveryWardName) ||
        Boolean(order.deliveryWardCode) !== Boolean(order.deliveryDistrictName))
    ) {
      context.addIssue({
        code: "custom",
        path: ["deliveryStreet"],
        message: "Vui lòng nhập địa chỉ giao hàng và chọn đủ quận, phường."
      });
    }

    const productIds = order.items.map((item) => item.productId);
    if (new Set(productIds).size !== productIds.length) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "Mỗi sản phẩm chỉ được xuất hiện một lần trong giỏ hàng."
      });
    }
  });

export const shippingQuoteSchema = z.object({
  deliveryDistrictId: z.number().int().positive(),
  deliveryWardCode: z.string().trim().min(1).max(32),
  items: z
    .array(z.object({ productId: z.string().min(1).max(80), quantity: z.number().int().min(1).max(99) }))
    .min(1)
    .max(30)
});

export type OrderRequest = z.infer<typeof orderRequestSchema>;
