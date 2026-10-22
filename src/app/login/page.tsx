import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { isLoggedIn } from "@/lib/auth";
import { LoginForm } from "./login-form";

export async function generateMetadata() {
  const { m } = await getI18n();
  return { title: m.login.submit };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await isLoggedIn()) redirect("/");
  const { m } = await getI18n();
  const next = (await searchParams).next ?? "/";
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <div className="card px-6 py-7">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" className="mb-4 size-12" />
        <h1 className="text-[24px] font-bold tracking-[-0.02em]">{m.login.title}</h1>
        <p className="mb-6 mt-1 text-[14.5px] text-muted">{m.login.subtitle}</p>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
