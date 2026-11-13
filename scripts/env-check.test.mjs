import test from "node:test";
import assert from "node:assert/strict";
import { inspectEnv } from "./env-check.mjs";

const jwt = (role) => `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.sig`;

test("пустое окружение допустимо", () => {
  const r = inspectEnv({});
  assert.deepEqual(r.errors, []);
  assert.equal(r.configured, false);
});

test("нужны обе переменные Supabase", () => {
  assert.equal(inspectEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://a.supabase.co" }).errors.length, 1);
});

test("корректная настройка без ошибок", () => {
  const r = inspectEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://a.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("anon"), NEXT_PUBLIC_SITE_URL: "https://shop.example.com" });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.configured, true);
});

test("service_role в публичной переменной — ошибка", () => {
  const r = inspectEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://a.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("service_role") });
  assert.match(r.errors.join(), /СЕКРЕТНЫЙ/);
  assert.ok(inspectEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://a.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_abc" }).errors.length > 0);
});

test("секрет под именем NEXT_PUBLIC_* — ошибка", () => {
  const r = inspectEnv({ NEXT_PUBLIC_SERVICE_ROLE_KEY: "x" });
  assert.match(r.errors.join(), /NEXT_PUBLIC_SERVICE_ROLE_KEY/);
});

test("http для не-localhost и неверный URL", () => {
  assert.ok(inspectEnv({ NEXT_PUBLIC_SUPABASE_URL: "http://a.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("anon") }).errors.length > 0);
  assert.ok(inspectEnv({ NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("anon") }).errors.length === 0);
  assert.ok(inspectEnv({ NEXT_PUBLIC_SUPABASE_URL: "not a url", NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("anon") }).errors.length > 0);
});

test("service role на Vercel — предупреждение", () => {
  const r = inspectEnv({ VERCEL: "1", SUPABASE_SERVICE_ROLE_KEY: "x" });
  assert.match(r.warnings.join(), /Vercel/);
});
