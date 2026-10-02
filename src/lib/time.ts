export function formatNepalDateTime(value: Date) {
  return new Intl.DateTimeFormat("en-NP", {
    timeZone: "Asia/Kathmandu",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

export function getNepalOperatingDateKey(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kathmandu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

export function parseOperatingDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Invalid operating date.");
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("Invalid operating date.");
  }

  return date;
}

export function nepalOperatingDayBounds(value: string) {
  const date = parseOperatingDate(value);
  const nepalOffsetMinutes = 5 * 60 + 45;
  const start = new Date(date.getTime() - nepalOffsetMinutes * 60_000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  return { start, end, operatingDate: date };
}
