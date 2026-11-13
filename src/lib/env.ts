/** Без адреса базы приложение показывает инструкцию по настройке (/setup), а не падает. */
export const isDbConfigured = Boolean(process.env.TURSO_DATABASE_URL);
