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
    <div style={{ maxWidth: 400, margin: "0 auto", padding: "2rem" }}>
      <h1 style={{ textAlign: "center" }}>Simple SNS</h1>
      <form 
        onSubmit={handleSubmit}
        style={{
          display: "flex", 
          flexDirection: "column", 
          gap: "1rem",
          marginBottom: "2rem"
        }}
      >
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="What's on your mind?"
          style={{
            padding: "0.75rem",
            fontSize: "1rem",
            borderRadius: "6px",
            border: "1px solid #ccc"
          }}
        />
        <button 
          type="submit" 
          style={{
            padding: "0.75rem",
            fontSize: "1rem",
            borderRadius: "6px",
            border: "none",
            background: "#276ef1",
            color: "#fff",
            cursor: "pointer"
          }}
        >
          Post
        </button>
      </form>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {posts.map((post, idx) => (
          <li 
            key={idx} 
            style={{
              background: "#f9f9f9",
              padding: "0.75rem",
              borderRadius: "6px",
              marginBottom: "0.5rem",
              border: "1px solid #eee"
            }}
          >
            {post}
          </li>
        ))}
      </ul>
    </div>
  );
}
