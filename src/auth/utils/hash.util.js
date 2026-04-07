import bcrypt from "bcrypt";

const SALT_ROUNDS = 12;

export const hashPassword  = (plain)        => bcrypt.hash(plain, SALT_ROUNDS);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);
export const hashToken      = (token)       => bcrypt.hash(token, 10);
export const verifyToken    = (token, hash) => bcrypt.compare(token, hash);