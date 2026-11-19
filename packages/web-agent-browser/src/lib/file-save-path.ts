// The timestamp in a saved screenshot or recording file name. Local
// time, not UTC: the name should match the clock the user is looking at when
// they find the file in the Files screen. No milliseconds and no random
// suffix, so the name is reproducible in a frozen-clock test.
function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** `yyyy-mm-dd-hhmmss` from the local date getters: the date in dashes, the
 *  time as one six-digit block. */
export function localFileStamp(date = new Date()): string {
  const day = [pad(date.getFullYear(), 4), pad(date.getMonth() + 1, 2), pad(date.getDate(), 2)];
  const clock = [pad(date.getHours(), 2), pad(date.getMinutes(), 2), pad(date.getSeconds(), 2)];
  return `${day.join("-")}-${clock.join("")}`;
}