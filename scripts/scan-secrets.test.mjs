import test from "node:test";
import assert from "node:assert/strict";
import { scanText } from "./scan-secrets.mjs";

// Примеры секретов собираются в рантайме, чтобы сам тест не срабатывал в сканере.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = `eyJ${b64({ alg: "EdDSA" }).slice(3)}.${b64({ id: "db" })}.signaturesig`;

test("находит JWT-токен (например, токен Turso)", () => {
  assert.equal(scanText("a.ts", `const k = "${jwt}"`).length, 1);
});

test("находит непустой TURSO_AUTH_TOKEN, пустой допустим", () => {
  assert.equal(scanText(".env", "TURSO_AUTH_TOKEN=" + "x".repeat(50)).length, 1);
  assert.equal(scanText(".env.example", "TURSO_AUTH_TOKEN=\n").length, 0);
});

test("находит токен Vercel Blob, приватные ключи, токены GitHub и строки подключения с паролем", () => {
  assert.equal(scanText("b", "vercel_blob_rw_" + "a1B2c3D4e5").length, 1);
  assert.equal(scanText("k", "-----BEGIN " + "PRIVATE KEY-----").length, 1);
  assert.equal(scanText("t", "ghp_" + "a".repeat(36)).length, 1);
  assert.equal(scanText("d", "postgresql://postgres:" + "s3cretPass" + "@db.example.com:5432/postgres").length, 1);
  assert.equal(scanText("d", "postgresql://postgres:[YOUR-PASSWORD]@db.example.com:5432/postgres").length, 0);
});

test("обычный код не даёт ложных срабатываний", () => {
  assert.equal(scanText("a.ts", 'const url = process.env.TURSO_DATABASE_URL; // libsql://shop.turso.io').length, 0);
});
