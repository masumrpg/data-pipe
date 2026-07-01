import type { MappingRule, TransformKey } from '../shared/types';

/**
 * Registry of available transforms.
 * Add new transforms here.
 */
const TRANSFORMS: Record<TransformKey, (val: unknown) => unknown> = {
  toInt:       (v) => {
    const n = parseInt(String(v), 10);
    return isNaN(n) ? null : n;
  },
  toFloat:     (v) => {
    const n = parseFloat(String(v));
    return isNaN(n) ? null : n;
  },
  toString:    (v) => (v == null ? '' : String(v)),
  toISODate:   (v) => {
    if (v == null) return null;
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? null : d.toISOString();
  },
  toLower:     (v) => (typeof v === 'string' ? v.toLowerCase() : v),
  toUpper:     (v) => (typeof v === 'string' ? v.toUpperCase() : v),
  trim:        (v) => (typeof v === 'string' ? v.trim() : v),
  nullIfEmpty: (v) => (v === '' || v == null ? null : v),
};

/**
 * Resolve a dot-path value from a nested object.
 * Supports bracket-like syntax for array matching: "tajweed.ayahs[nomorAyat].text"
 */
function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current == null) return undefined;

    // Handle array index reference like "ayahs[nomorAyat]"
    const bracketMatch = part.match(/^(\w+)\[(\w+)\]$/);
    if (bracketMatch) {
      const [, arrayKey, indexKey] = bracketMatch;
      const arr = (current as Record<string, unknown>)[arrayKey!];
      if (Array.isArray(arr)) {
        // indexKey is a field name referencing the current context's value
        // This is handled at a higher level during mapping
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    } else {
      current = (current as Record<string, unknown>)[part];
    }
  }

  return current;
}

/**
 * Apply a single transform or default value.
 */
function applyTransform(value: unknown, rule: MappingRule): unknown {
  let result = value;

  if (result == null && rule.default !== undefined) {
    result = rule.default;
  }

  if (rule.transform && TRANSFORMS[rule.transform]) {
    result = TRANSFORMS[rule.transform](result);
  }

  return result;
}

/**
 * Apply mapping rules to a source item and return one or more output rows.
 * If any rule has `expand: true`, the array is expanded into multiple rows.
 */
export function applyMapping(
  item: unknown,
  rules: MappingRule[],
  parentContext?: Record<string, unknown>,
): Record<string, unknown>[] {
  const context = item as Record<string, unknown>;
  const merged = parentContext ? { ...parentContext, ...context } : context;

  // Check if any rule has expand: true
  const expandRule = rules.find((r) => r.expand);

  if (expandRule) {
    const arrayData = getByPath(merged, expandRule.from);
    if (!Array.isArray(arrayData)) {
      return [];
    }

    // Collect parent (non-expand) fields first
    const parentFields: Record<string, unknown> = {};
    for (const rule of rules) {
      if (rule === expandRule) continue;
      const val = getByPath(merged, rule.from);
      parentFields[rule.to] = applyTransform(val, rule);
    }

    // Expand each array item
    const rows: Record<string, unknown>[] = [];
    for (const arrayItem of arrayData) {
      if (!expandRule.mapping) continue;

      const row: Record<string, unknown> = { ...parentFields };
      for (const childRule of expandRule.mapping) {
        // Handle cross-source references like "tajweed.ayahs[nomorAyat].text"
        let val: unknown;
        if (childRule.from.includes('[')) {
          // Complex cross-reference
          val = resolveCrossRef(childRule.from, arrayItem as Record<string, unknown>, merged);
        } else {
          val = getByPath(arrayItem, childRule.from);
        }
        row[childRule.to] = applyTransform(val, childRule);
      }
      rows.push(row);
    }

    return rows;
  }

  // No expand — single row
  const row: Record<string, unknown> = {};
  for (const rule of rules) {
    const val = getByPath(merged, rule.from);
    row[rule.to] = applyTransform(val, rule);
  }

  return [row];
}

/**
 * Resolve a cross-source reference like "tajweed.ayahs[nomorAyat].text".
 * Finds the item in the array where a matching key equals the current item's value.
 */
function resolveCrossRef(
  path: string,
  currentItem: Record<string, unknown>,
  fullContext: Record<string, unknown>,
): unknown {
  // Parse "tajweed.ayahs[nomorAyat].text"
  const bracketIdx = path.indexOf('[');
  const bracketEnd = path.indexOf(']');
  if (bracketIdx === -1 || bracketEnd === -1) return undefined;

  const beforeBracket = path.slice(0, bracketIdx);
  const indexField = path.slice(bracketIdx + 1, bracketEnd);
  const afterBracket = path.slice(bracketEnd + 1).replace(/^\./, '');

  // Get the array from full context
  const arr = getByPath(fullContext, beforeBracket);
  if (!Array.isArray(arr)) return undefined;

  // Get the matching value from current item
  const matchValue = getByPath(currentItem, indexField);
  if (matchValue == null) return undefined;

  // Find matching item in the array by the index field
  const found = arr.find((el: unknown) => {
    const elVal = getByPath(el, indexField);
    return elVal == matchValue;
  });

  if (!found) return undefined;

  return afterBracket ? getByPath(found, afterBracket) : found;
}
