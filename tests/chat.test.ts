import { describe, expect, it, vi } from "vitest";
import app from "../src/index";
import { chatSystemPrompt } from "../src/chat-policy";
import { createProductChunks } from "../src/data/menu";

describe("chatbot RAG", () => {
  it("embeds the question, searches Vectorize, then answers with retrieved context", async () => {
    const aiRun = vi.fn(async (
      model: string,
      input: { text?: string[]; messages?: { role: string; content: string }[] }
    ) => {
      if (model === "@cf/google/embeddinggemma-300m") {
        return { data: [[0.1, 0.2, 0.3]] };
      }
      expect(input.messages).toBeDefined();
      return {
        choices: [{ message: { content: "Cà phê sữa đá có giá 32.000 đồng." } }]
      };
    });
    const query = vi.fn().mockResolvedValue({
      count: 2,
      matches: [
        {
          id: "faq-payment",
          metadata: { source: "faq", text: "Website hỗ trợ thanh toán khi nhận món." }
        },
        {
          id: "old-menu",
          metadata: { source: "menu", text: "Giá cũ không còn hiệu lực." }
        }
      ]
    });
    const all = vi.fn().mockResolvedValue({
      results: [
        {
          id: "ca-phe-sua-da",
          name: "Cà phê sữa đá",
          description: "Cà phê rang xay đậm vị.",
          category_label: "Cà phê",
          price_vnd: 32000
        },
        {
          id: "banh-chuoi",
          name: "Bánh chuối nướng",
          description: "Bánh chuối thơm bơ.",
          category_label: "Bánh ngọt",
          price_vnd: 35000
        }
      ]
    });
    const env = {
      AI: { run: aiRun },
      MENU_VECTORIZE: { query },
      DB: { prepare: vi.fn(() => ({ all })) }
    } as never;

    const response = await app.request(
      "/api/chat",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Cà phê sữa đá bao nhiêu tiền?",
          history: [{ role: "user", content: "Mình muốn gọi cà phê." }]
        })
      },
      env
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      response: "Cà phê sữa đá có giá 32.000 đồng."
    });
    expect(aiRun).toHaveBeenNthCalledWith(1, "@cf/google/embeddinggemma-300m", {
      text: ["Cà phê sữa đá bao nhiêu tiền?"]
    });
    expect(query).toHaveBeenCalledWith([0.1, 0.2, 0.3], {
      topK: 5,
      returnMetadata: "all"
    });
    expect(aiRun).toHaveBeenNthCalledWith(
      2,
      "@cf/google/gemma-4-26b-a4b-it",
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "system",
            content: expect.stringContaining("đề xuất tối đa 3 món")
          }),
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("Cà phê sữa đá (Cà phê): Cà phê rang xay đậm vị. Giá hiện tại: 32.000 đồng.")
          }),
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("Website hỗ trợ thanh toán khi nhận món.")
          })
        ])
      })
    );
    const completionMessages = aiRun.mock.calls[1][1].messages;
    expect(completionMessages?.at(-1)?.content).not.toContain("Giá cũ không còn hiệu lực.");
  });

  it("encodes the mandatory truthfulness, privacy, and transaction rules", () => {
    expect(chatSystemPrompt).toContain("không phải nguồn xác minh nghiệp vụ");
    expect(chatSystemPrompt).toContain("không khẳng định còn hàng");
    expect(chatSystemPrompt).toContain("Không tiết lộ dữ liệu cá nhân");
    expect(chatSystemPrompt).toContain("Không xác nhận giao dịch");
    expect(chatSystemPrompt).toContain("không có công cụ tra cứu đơn hàng");
    expect(chatSystemPrompt).toContain("dị ứng hoặc ảnh hưởng sức khỏe");
    expect(chatSystemPrompt).toContain("Không bịa ưu đãi");
  });

  it("builds menu chunks from the current D1 product data", () => {
    expect(
      createProductChunks([
        {
          id: "latte-nong",
          name: "Latte",
          description: "Espresso cùng sữa tươi.",
          category_label: "Cà phê",
          price_vnd: 45000
        }
      ])
    ).toEqual([
      {
        id: "product-latte-nong",
        source: "menu",
        text: "Latte (Cà phê): Espresso cùng sữa tươi. Giá hiện tại: 45.000 đồng."
      }
    ]);
  });

  it("indexes current menu data only for an authenticated admin", async () => {
    const products = [
      {
        id: "latte-nong",
        name: "Latte",
        description: "Espresso cùng sữa tươi.",
        category_label: "Cà phê",
        price_vnd: 45000
      }
    ];
    const all = vi.fn().mockResolvedValue({ results: products });
    const prepare = vi.fn(() => ({ all }));
    const aiRun = vi.fn(async (_model: string, input: { text: string[] }) => ({
      data: input.text.map(() => [0.1, 0.2, 0.3])
    }));
    const upsert = vi.fn().mockResolvedValue({ count: 5 });
    const env = {
      ADMIN_TOKEN: "test-admin-token",
      DB: { prepare },
      AI: { run: aiRun },
      MENU_VECTORIZE: { upsert }
    } as never;

    const response = await app.request(
      "/api/chat/seed",
      {
        method: "POST",
        headers: { Authorization: "Bearer test-admin-token" }
      },
      env
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ seeded: 5 });
    expect(upsert).toHaveBeenCalledOnce();
    expect(upsert.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "product-latte-nong",
          values: [0.1, 0.2, 0.3],
          metadata: expect.objectContaining({
            text: "Latte (Cà phê): Espresso cùng sữa tươi. Giá hiện tại: 45.000 đồng."
          })
        })
      ])
    );
  });

  it("retires the previous experimental chat endpoint", async () => {
    const response = await app.request(
      "/api/chat/legacy",
      { method: "POST" },
      {} as never
    );

    expect(response.status).toBe(410);
  });
});
