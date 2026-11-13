import test from "node:test";
import assert from "node:assert/strict";
import { inspectEnv } from "./env-check.mjs";

test("пустое окружение допустимо", () => {
  const r = inspectEnv({});
  assert.deepEqual(r.errors, []);
  assert.equal(r.configured, false);
});

test("корректная настройка Turso без ошибок и предупреждений", () => {
  const r = inspectEnv({ TURSO_DATABASE_URL: "libsql://shop-user.turso.io", TURSO_AUTH_TOKEN: "t", BLOB_READ_WRITE_TOKEN: "b" });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.configured, true);
});

test("облачная база без токена — ошибка, локальная — нет", () => {
  assert.match(inspectEnv({ TURSO_DATABASE_URL: "libsql://shop-user.turso.io" }).errors.join(), /TURSO_AUTH_TOKEN/);
  assert.deepEqual(inspectEnv({ TURSO_DATABASE_URL: "file:local.db" }).errors, []);
  assert.deepEqual(inspectEnv({ TURSO_DATABASE_URL: "http://127.0.0.1:8080" }).errors, []);
});

test("неверный адрес и небезопасный протокол", () => {
  assert.ok(inspectEnv({ TURSO_DATABASE_URL: "not a url" }).errors.length > 0);
  assert.ok(inspectEnv({ TURSO_DATABASE_URL: "ftp://x.example.com", TURSO_AUTH_TOKEN: "t" }).errors.length > 0);
  assert.ok(inspectEnv({ TURSO_DATABASE_URL: "http://db.example.com", TURSO_AUTH_TOKEN: "t" }).errors.length > 0);
});

test("файловая база на Vercel — ошибка", () => {
  assert.match(inspectEnv({ VERCEL: "1", TURSO_DATABASE_URL: "file:local.db" }).errors.join(), /Vercel/);
});

test("секрет под именем NEXT_PUBLIC_* — ошибка", () => {
  assert.match(inspectEnv({ NEXT_PUBLIC_TURSO_AUTH_TOKEN: "x" }).errors.join(), /NEXT_PUBLIC_TURSO_AUTH_TOKEN/);
  assert.match(inspectEnv({ NEXT_PUBLIC_BLOB_TOKEN: "x" }).errors.join(), /NEXT_PUBLIC_BLOB_TOKEN/);
  assert.deepEqual(inspectEnv({ NEXT_PUBLIC_SITE_URL: "https://shop.example.com" }).errors, []);
});

test("без токена Blob — предупреждение; демо-пароль на Vercel — предупреждение", () => {
  assert.match(inspectEnv({ TURSO_DATABASE_URL: "file:local.db" }).warnings.join(), /BLOB_READ_WRITE_TOKEN/);
  assert.match(inspectEnv({ VERCEL: "1", DEMO_PASSWORD: "x" }).warnings.join(), /DEMO_PASSWORD/);
});
