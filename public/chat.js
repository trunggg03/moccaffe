const chatToggle = document.querySelector("#chat-toggle");
const chatPanel = document.querySelector("#chat-panel");
const chatClose = document.querySelector("#chat-close");
const chatMessages = document.querySelector("#chat-messages");
const chatStatus = document.querySelector("#chat-status");
const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
const chatSubmit = chatForm.querySelector('button[type="submit"]');

const history = [];

function addChatMessage(role, content) {
  const message = document.createElement("p");
  message.className = `chat-message${role === "user" ? " chat-message--user" : ""}`;
  message.textContent = content;
  chatMessages.append(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function setChatOpen(open) {
  chatPanel.hidden = !open;
  chatToggle.setAttribute("aria-expanded", String(open));
  if (open) chatInput.focus();
}

addChatMessage(
  "assistant",
  "Xin chào! Mình có thể giúp bạn tìm hiểu thực đơn, giá món, giao hàng và thanh toán."
);

chatToggle.addEventListener("click", () => setChatOpen(chatPanel.hidden));
chatClose.addEventListener("click", () => setChatOpen(false));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !chatPanel.hidden) setChatOpen(false);
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;

  const previousHistory = history.slice(-6);
  history.push({ role: "user", content: message });
  addChatMessage("user", message);
  chatInput.value = "";
  chatInput.disabled = true;
  chatSubmit.disabled = true;
  chatStatus.textContent = "Mộc đang tìm thông tin…";

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history: previousHistory })
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error ?? "Chưa gửi được tin nhắn. Vui lòng thử lại.");
    }

    addChatMessage("assistant", result.response);
    history.push({ role: "assistant", content: result.response });
    chatStatus.textContent = "";
  } catch (error) {
    chatStatus.textContent =
      error instanceof Error ? error.message : "Chưa gửi được tin nhắn. Vui lòng thử lại.";
  } finally {
    chatInput.disabled = false;
    chatSubmit.disabled = false;
    chatInput.focus();
  }
});
