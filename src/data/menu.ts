export interface ProductKnowledge {
  id: string;
  name: string;
  description: string;
  category_label: string;
  price_vnd: number;
}

export interface KnowledgeChunk {
  id: string;
  text: string;
  source: "menu" | "faq";
}

export const menuChunks: KnowledgeChunk[] = [
  {
    id: "faq-delivery",
    source: "faq",
    text: "GIAO HÀNG: Khách có thể chọn giao hàng hoặc đến lấy tại quán. Nếu GHN được cấu hình, phí giao hàng được tính theo địa chỉ và hiển thị khi đặt món. Nếu GHN chưa được cấu hình, phí giao hàng thủ công được áp dụng."
  },
  {
    id: "faq-payment",
    source: "faq",
    text: "THANH TOÁN: Website hỗ trợ thanh toán khi nhận món và chuyển khoản ngân hàng. VNPay sẽ xuất hiện khi quán đã cấu hình cổng thanh toán. Thông tin chuyển khoản (nếu được cấu hình) và hướng dẫn thanh toán hiển thị sau khi đặt hàng."
  },
  {
    id: "faq-ordering",
    source: "faq",
    text: "ĐẶT MÓN: Khách chọn món trên website, thêm vào giỏ hàng, chọn đến lấy hoặc giao hàng, rồi cung cấp tên và số điện thoại. Với đơn giao hàng, cần cung cấp địa chỉ nhận hàng."
  },
  {
    id: "faq-vnpay",
    source: "faq",
    text: "VNPAY: Khi chọn VNPay, khách sẽ được chuyển tới cổng thanh toán. Đơn hàng chỉ được xác nhận thanh toán sau khi hệ thống xác minh giao dịch thành công."
  }
];

export function createProductChunks(products: ProductKnowledge[]): KnowledgeChunk[] {
  return products.map((product) => ({
    id: `product-${product.id}`,
    source: "menu",
    text: `${product.name} (${product.category_label}): ${product.description} Giá hiện tại: ${product.price_vnd.toLocaleString("vi-VN")} đồng.`
  }));
}
