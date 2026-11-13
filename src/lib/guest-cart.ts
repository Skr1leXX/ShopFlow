"use client";

import { useSyncExternalStore } from "react";

// Гостевая корзина живёт в localStorage браузера и хранит только id варианта и количество.
// Цены, названия и остатки всегда берутся с сервера; при входе корзина объединяется с серверной.
const KEY = "shopflow:guest-cart";
const EVENT = "shopflow:guest-cart";
export type GuestItem = { variantId: string; quantity: number };

const readRaw = () => {
  try { return localStorage.getItem(KEY) ?? "[]"; } catch { return "[]"; }
};
export const parseGuest = (raw: string): GuestItem[] => {
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data)
      ? data.filter((i) => typeof i?.variantId === "string" && Number.isInteger(i?.quantity) && i.quantity > 0).slice(0, 50)
      : [];
  } catch { return []; }
};
export const readGuestCart = () => parseGuest(readRaw());

export function writeGuestCart(items: GuestItem[]) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* хранилище недоступно: корзина не сохранится */ }
  window.dispatchEvent(new Event(EVENT));
}

export function addGuestItem(variantId: string, quantity: number, max: number) {
  const items = readGuestCart();
  const found = items.find((i) => i.variantId === variantId);
  const total = Math.min(max, 99, (found?.quantity ?? 0) + quantity);
  writeGuestCart(found ? items.map((i) => (i === found ? { ...i, quantity: total } : i)) : [...items, { variantId, quantity: total }]);
  return total;
}

export const setGuestQuantity = (variantId: string, quantity: number) =>
  writeGuestCart(readGuestCart().map((i) => (i.variantId === variantId ? { ...i, quantity } : i)));
export const removeGuestItem = (variantId: string) => writeGuestCart(readGuestCart().filter((i) => i.variantId !== variantId));

const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb); // другая вкладка
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener("storage", cb); };
};

/** Строка JSON как снимок: примитив сравнивается по значению, лишних перерисовок нет. */
export const useGuestCartRaw = () => useSyncExternalStore(subscribe, readRaw, () => "[]");
