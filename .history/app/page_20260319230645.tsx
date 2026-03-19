"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

type Post = {
  id: number;
  content: string;
  created_at: string;
};

export default function Home() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [input, setInput] = useState("");

  useEffect(() => {
    const fetchPosts = async () => {
      const { data, error } = await supabase
        .from("posts")
        .select("*")
        .order("created_at", { ascending: false });

      if (!error && data) {
        setPosts(data as Post[]);
      }
    };

    fetchPosts();
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const content = input.trim();
    if (!content) return;

    const { data, error } = await supabase
      .from("posts")
      .insert({ content })
      .select()
      .single();

    if (!error && data) {
      setPosts((prev) => [data as Post, ...prev]);
      setInput("");
    }
  };

  return (
    <main>
      <h1>Simple SNS</h1>
      <form onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="いまどうしてる？"
        />
        <button type="submit">投稿</button>
      </form>
      <ul>
        {posts.map((post) => (
          <li key={post.id}>{post.content}</li>
        ))}
      </ul>
    </main>
  );
}
