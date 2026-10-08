import { TransformFnParams } from 'class-transformer';

/** Trims surrounding whitespace on strings; leaves other types untouched. */
export const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Trims and lower-cases an email so lookups and uniqueness are case-insensitive. */
export const normalizeEmail = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
