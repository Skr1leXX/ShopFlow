const rub = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 });
export const formatPrice = (n: number) => rub.format(n);

export const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));

export const ORDER_STATUS: Record<string, string> = {
  pending: "Новый",
  paid: "Подтверждён",
  processing: "Собирается",
  shipped: "Отправлен",
  delivered: "Доставлен",
  cancelled: "Отменён",
};
export const STOCK_REASON: Record<string, string> = {
  receipt: "Приход", writeoff: "Списание", adjustment: "Корректировка", sale: "Продажа", return: "Возврат (отмена)",
};
export const DELIVERY: Record<string, string> = { courier: "Курьер", pickup: "Самовывоз", post: "Почта" };
export const PAYMENT: Record<string, string> = { card: "Картой онлайн", cash: "При получении", invoice: "По счёту" };
