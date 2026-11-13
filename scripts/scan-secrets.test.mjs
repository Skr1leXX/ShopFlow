import test from "node:test";
import assert from "node:assert/strict";
import { scanText } from "./scan-secrets.mjs";

// Примеры секретов собираются в рантайме, чтобы сам тест не срабатывал в сканере.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (role) => `eyJ${b64({ alg: "HS256" }).slice(3)}.${b64({ role })}.signaturesig`;

test("находит service_role JWT, но не anon", () => {
  assert.equal(scanText("a.ts", `const k = "${jwt("service_role")}"`).length, 1);
  assert.equal(scanText("a.ts", `const k = "${jwt("anon")}"`).length, 0);
});

test("находит непустой SUPABASE_SERVICE_ROLE_KEY, пустой допустим", () => {
  assert.equal(scanText(".env", "SUPABASE_SERVICE_ROLE_KEY=" + "x".repeat(40)).length, 1);
  assert.equal(scanText(".env.example", "SUPABASE_SERVICE_ROLE_KEY=\n").length, 0);
});

test("находит приватные ключи, токены и строки подключения с паролем", () => {
  assert.equal(scanText("k", "-----BEGIN " + "PRIVATE KEY-----").length, 1);
  assert.equal(scanText("t", "ghp_" + "a".repeat(36)).length, 1);
  assert.equal(scanText("d", "postgresql://postgres:" + "s3cretPass" + "@db.example.supabase.co:5432/postgres").length, 1);
  assert.equal(scanText("d", "postgresql://postgres:[YOUR-PASSWORD]@db.example.supabase.co:5432/postgres").length, 0);
});
