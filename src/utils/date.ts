export const toISOStringWithTimezone = (date = new Date()) => {
  const pad = (n: number): string => String(Math.abs(n)).padStart(2, '0');

  // Get timezone offset in minutes
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const offsetHours = Math.floor(Math.abs(offset) / 60);
  const offsetMinutes = Math.abs(offset) % 60;
  const timezoneOffset = `${sign}${pad(offsetHours)}:${pad(offsetMinutes)}`;

  // Extract date parts in local time
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1); // Months are zero-based
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0');

  // Format date with timezone offset
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}${timezoneOffset}`;
};
