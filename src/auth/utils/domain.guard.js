import { authConfig } from "../config/auth.config.js";

export const isAllowedDomain = (email) => {
  const domain = email.split("@")[1]?.toLowerCase();
  return domain
    ? authConfig.allowedEmailDomains.includes(domain)
    : false;
};