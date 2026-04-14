import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  let rewritePath: string | undefined;
  if (pathname.startsWith("/@") && pathname.length > 2) {
    const rest = pathname.slice(2);
    if (rest && !rest.includes("/")) {
      rewritePath = `/p/${rest}`;
    }
  }
  return await updateSession(request, rewritePath);
}

export const config = {
  matcher: [
    /*
     * 静的ファイル・画像・favicon を除くすべてのパスでセッションを更新
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
