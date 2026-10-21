import { config } from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const currentLevel = LEVELS[config.logLevel] ?? LEVELS.info;

function ts() {
  const date = new Date();
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offsetHours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0');
  const offsetRemainder = String(Math.abs(offsetMinutes) % 60).padStart(2, '0');
  const localTimestamp = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, -1);
  return `${localTimestamp}${sign}${offsetHours}:${offsetRemainder}`;
}

function log(level, msg, extra) {
  if (LEVELS[level] < currentLevel) return;
  const line = `[${ts()}] ${level.toUpperCase().padEnd(5)} ${msg}`;
  const out = level === 'error' ? console.error : console.log;
  if (extra !== undefined) {
    out(line, extra);
  } else {
    out(line);
  }
}

export const logger = {
  debug: (msg, extra) => log('debug', msg, extra),
  info: (msg, extra) => log('info', msg, extra),
  warn: (msg, extra) => log('warn', msg, extra),
  error: (msg, extra) => log('error', msg, extra),
};
