"use client";

import { useEffect, useState } from "react";
import AdminNav from "@/components/admin/AdminNav";

type CustomerMessage = {
  id: string;
  name: string;
  phone: string;
  email: string;
  subject: string;
  message: string;
  reply: string;
  status: "new" | "seen" | "answered" | "closed";
  createdAt: string;
  updatedAt: string;
};

export default function AdminMessagesPage() {
  const [messages, setMessages] = useState<CustomerMessage[]>([]);
  const [messageText, setMessageText] = useState("");

  async function loadMessages() {
    const res = await fetch("/api/customer-messages", { cache: "no-store" });
    const data = await res.json();

    if (res.ok && data?.success && Array.isArray(data.messages)) {
      setMessages(data.messages);
    }
  }

  useEffect(() => {
    loadMessages();
  }, []);

  async function updateMessage(item: CustomerMessage, patch: Partial<CustomerMessage>) {
    const res = await fetch("/api/customer-messages", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: item.id,
        reply: patch.reply ?? item.reply,
        status: patch.status ?? item.status,
      }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.success) {
      setMessageText(data?.message || "Failed to update message.");
      return;
    }

    setMessageText("Message updated.");
    await loadMessages();
  }

  async function deleteMessage(item: CustomerMessage) {
    if (!confirm(`Delete message from ${item.name}?`)) return;

    const res = await fetch(`/api/customer-messages?id=${item.id}`, {
      method: "DELETE",
    });

    if (res.ok) {
      await loadMessages();
    }
  }

  return (
    <main className="min-h-screen bg-[#fcf8f6] px-4 py-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <AdminNav />

        <section className="rounded-[28px] border border-[#ead9d1] bg-white p-6 shadow-sm md:p-8">
          <h1 className="text-3xl font-semibold text-[#2e221d]">
            Customer Messages
          </h1>
          <p className="mt-2 text-sm text-neutral-600">
            Review customer queries and save admin replies.
          </p>

          {messageText ? (
            <div className="mt-5 rounded-2xl border border-[#ead9d1] bg-[#fffaf7] p-4 text-sm text-[#2e221d]">
              {messageText}
            </div>
          ) : null}
        </section>

        <section className="grid gap-4">
          {messages.map((item) => (
            <MessageCard
              key={item.id}
              item={item}
              onUpdate={updateMessage}
              onDelete={deleteMessage}
            />
          ))}

          {messages.length === 0 ? (
            <div className="rounded-[28px] border border-[#ead9d1] bg-white p-6 text-sm text-neutral-600">
              No customer messages yet.
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function MessageCard({
  item,
  onUpdate,
  onDelete,
}: {
  item: CustomerMessage;
  onUpdate: (item: CustomerMessage, patch: Partial<CustomerMessage>) => void;
  onDelete: (item: CustomerMessage) => void;
}) {
  const [reply, setReply] = useState(item.reply || "");
  const [status, setStatus] = useState<CustomerMessage["status"]>(item.status);

  return (
    <article className="rounded-[28px] border border-[#ead9d1] bg-white p-5 shadow-sm">
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[#fffaf7] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#7a5244]">
              {status}
            </span>
            <span className="text-xs text-neutral-500">
              {new Date(item.createdAt).toLocaleString()}
            </span>
          </div>

          <h2 className="mt-3 text-xl font-semibold text-[#2e221d]">
            {item.subject || "Customer Query"}
          </h2>

          <div className="mt-3 grid gap-1 text-sm text-neutral-600">
            <p><b>Name:</b> {item.name}</p>
            <p><b>Phone:</b> {item.phone}</p>
            {item.email ? <p><b>Email:</b> {item.email}</p> : null}
          </div>

          <p className="mt-4 rounded-2xl bg-[#fffaf7] p-4 text-sm leading-7 text-[#2e221d]">
            {item.message}
          </p>
        </div>

        <div className="grid gap-3">
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-[#2e221d]">Admin Reply</span>
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={5}
              className="rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none"
              placeholder="Write reply or contact note"
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-semibold text-[#2e221d]">Status</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as CustomerMessage["status"])}
              className="rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none"
            >
              <option value="new">New</option>
              <option value="seen">Seen</option>
              <option value="answered">Answered</option>
              <option value="closed">Closed</option>
            </select>
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onUpdate(item, { reply, status })}
              className="rounded-full bg-[#2e221d] px-5 py-2.5 text-sm font-semibold text-white"
            >
              Save Reply
            </button>

            <button
              type="button"
              onClick={() => onDelete(item)}
              className="rounded-full border border-red-200 px-5 py-2.5 text-sm font-semibold text-red-600"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}