"use client";

import React, { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

type Post = {
  id: number;
  content: string;
  created_at?: string;
  user_id?: string;
};

const DUMMY_USER_ID = "11111111-1111-1111-1111-111111111111";

export default function Home() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [input, setInput] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchPosts = async () => {
    const { data, error } = await supabase
      .from("posts")
      .select("*");

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    if (data) {
      setPosts(data as Post[]);
    }
    setErrorMessage(null);
  };

  useEffect(() => {
    const run = async () => {
      try {
        await fetchPosts();
      } catch (err) {
        console.error("fetchPosts error:", err);
        setErrorMessage("投稿一覧の取得に失敗しました。");
      }
    };

    void run();
  }, []);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const content = input.trim();
    if (!content) return;

    const { data, error } = await supabase
      .from("posts")
      .insert({ content, user_id: DUMMY_USER_ID })
      .select()
      .single();

    if (error) {
      console.error("insert error:", error);
      setErrorMessage(error.message);
      return;
    }

    if (data) {
      setInput("");
      await fetchPosts();
    }
  };

  const handleLike = async (postId: number) => {
    const { error } = await supabase.from("likes").upsert(
      { user_id: DUMMY_USER_ID, post_id: postId },
      { onConflict: "user_id,post_id" }
    );

    if (error) {
      console.error("like error:", error);
      setErrorMessage(error.message);
    } else {
      setErrorMessage(null);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-xl p-6">
        <h1 className="mb-4 text-2xl font-semibold">Simple SNS</h1>

        {errorMessage ? (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {errorMessage}
          </div>
        ) : null}

        <form
          onSubmit={handleSubmit}
          className="mb-6 flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="いまどうしてる？"
            className="rounded-md border border-gray-300 bg-white px-3 py-2 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
          />
          <button
            type="submit"
            className="rounded-md bg-blue-600 px-3 py-2 font-medium text-white hover:bg-blue-700"
          >
            投稿
          </button>
        </form>

        <ul className="space-y-3">
          {posts.map((post) => (
            <li
              key={post.id}
              className="break-words rounded-lg border border-gray-200 bg-white p-4"
            >
              <div className="text-sm text-gray-500">
                {post.created_at ? new Date(post.created_at).toLocaleString() : ""}
              </div>
              <div className="mt-1 whitespace-pre-wrap">{post.content}</div>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => void handleLike(post.id)}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1 text-sm font-medium text-gray-900 hover:bg-gray-50"
                >
                  いいね
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
