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
    <div>
      <h1>Simple SNS</h1>
      <form onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="What's on your mind?"
        />
        <button type="submit">Post</button>
      </form>
      <ul>
        {posts.map((post, idx) => (
          <li key={idx}>{post}</li>
        ))}
      </ul>
    </div>
  );
}
