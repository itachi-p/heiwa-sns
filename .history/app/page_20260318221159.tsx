"use client";

import { useState } from "react";

export default function Home() {
  const [posts, setPosts] = useState<string[]>([]);
  const [input, setInput] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (input.trim()) {
      setPosts([input, ...posts]);
      setInput("");
    }
  }

  return (
    <div className="max-w-md mx-auto py-10 px-4">
      <h1 className="text-2xl font-bold text-center mb-6">Simple SNS</h1>
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 mb-6"
      >
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="いまどうしてる？"
          className="p-3 text-base rounded border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <button
          type="submit"
          className="p-3 text-base rounded bg-blue-600 text-white hover:bg-blue-700 transition"
        >
          投稿
        </button>
      </form>
      <ul className="space-y-3">
        {posts.map((post, idx) => (
          <li
            key={idx}
            className="bg-gray-50 p-3 rounded border border-gray-200"
          >
            {post}
          </li>
        ))}
      </ul>
    </div>
  );
}
