import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(
  request: NextRequest,
  rewritePath?: string
) {
  const rewriteUrl =
    rewritePath != null && rewritePath !== request.nextUrl.pathname
      ? (() => {
          const u = request.nextUrl.clone();
          u.pathname = rewritePath;
          return u;
        })()
      : null;

  let supabaseResponse = rewriteUrl
    ? NextResponse.rewrite(rewriteUrl)
    : NextResponse.next({
        request,
      });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = rewriteUrl
            ? NextResponse.rewrite(rewriteUrl)
            : NextResponse.next({
                request,
              });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  await supabase.auth.getUser();

  return supabaseResponse;
}
