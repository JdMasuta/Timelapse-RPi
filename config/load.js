// config/load.js
// Loads the single settings.json file (created from settings.default.json on first run),
// merges it over the shipped defaults, and flattens scalar settings into process.env via
// the schema so existing process.env consumers keep working. Real .env values (loaded by
// dotenv) take precedence, since we only set environment variables that are still unset.

const fs = require("fs");
const path = require("path");
require("dotenv").config();

const schema = require("./schema");

const DEFAULT_PATH = path.join(__dirname, "settings.default.json");
const CURRENT_PATH = path.join(__dirname, "settings.json");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Re-read settings.default.json + settings.json and merge group-by-group. */
function readMerged() {
  const defaults = readJson(DEFAULT_PATH);

  let current = {};
  try {
    current = readJson(CURRENT_PATH);
  } catch (e) {
    current = {};
  }

  const merged = {};
  for (const group of Object.keys(defaults)) {
    merged[group] =
      defaults[group] && typeof defaults[group] === "object"
        ? { ...defaults[group], ...(current[group] || {}) }
        : current[group] ?? defaults[group];
  }
  return merged;
}

/** Flatten scalar (schema-listed) settings into process.env, without clobbering .env. */
function flattenToEnv(merged) {
  for (const field of schema) {
    const value = merged[field.group] && merged[field.group][field.key];
    if (value !== undefined && process.env[field.env] === undefined) {
      process.env[field.env] = String(value);
    }
  }
}

/** Persist the merged settings object back to settings.json (pretty-printed, lossless). */
function writeCurrent(merged) {
  fs.writeFileSync(CURRENT_PATH, JSON.stringify(merged, null, 2) + "\n");
}

function load() {
  if (!fs.existsSync(CURRENT_PATH)) {
    fs.copyFileSync(DEFAULT_PATH, CURRENT_PATH);
  }
  const merged = readMerged();
  flattenToEnv(merged);

  // VideoConfig reads CAPTURES_DIR; keep it aligned with the captures output dir.
  if (process.env.CAPTURES_DIR === undefined && process.env.OUTPUT_DIR) {
    process.env.CAPTURES_DIR = process.env.OUTPUT_DIR;
  }
  return merged;
}

module.exports = {
  settings: load(),
  defaults: readJson(DEFAULT_PATH),
  schema,
  DEFAULT_PATH,
  CURRENT_PATH,
  readMerged,
  flattenToEnv,
  writeCurrent,
};
